import type { AppLogger } from '../core/logger/types';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { withTimeout } from '../utils/timeout-wrapper';
import { sanitizeLogText } from '../core/logger/safe-log-serializer';
import {
    isChannelId,
    normalizeChannelHandle,
    normalizeHandleForCache,
    resolveChannelId
} from './youtube-channel-resolver';

const MAX_CHANNEL_CACHE_ENTRIES = 64;
const MAX_STREAM_PAGES = 10;

type LoggerLike = Pick<AppLogger<string>, 'error'> & Partial<Pick<AppLogger<string>, 'debug' | 'warn'>>;

type ChannelVideo = {
    id?: string;
    video_id?: string;
    content_id?: string;
    title?: { text?: string; content?: string } | string;
    is_live?: boolean;
    is_live_content?: boolean;
    is_upcoming?: boolean;
    is_post_live_dvr?: boolean;
    end_timestamp?: unknown;
    badges?: Array<{ label?: string; text?: string; style?: string }>;
    content_image?: {
        overlays?: Array<{
            badges?: Array<{
                text?: string;
                icon_name?: string;
                badge_style?: string;
            }>;
        }>;
    };
    metadata?: {
        title?: { text?: string; content?: string } | string;
        metadata?: {
            metadata_rows?: Array<{
                metadata_parts?: Array<{
                    text?: {
                        text?: string;
                        content?: string;
                        endpoint?: {
                            payload?: {
                                browseId?: string;
                            };
                        };
                    } | null;
                }>;
            }>;
        };
    };
    author?: {
        id?: string;
        name?: string;
        handle?: string;
    };
};

type StreamsPage = {
    videos?: ChannelVideo[];
    has_continuation?: boolean;
    getContinuation?: () => Promise<StreamsPage>;
};

type ChannelLike = {
    videos?: ChannelVideo[];
    getLiveStreams?: () => Promise<StreamsPage>;
};

type InnertubeClientLike = {
    getChannel: (channelId: string) => Promise<ChannelLike | null>;
    resolveURL?: (url: string) => Promise<{ payload?: { browseId?: string } }>;
    search?: (query: string, options?: Record<string, unknown>) => Promise<{ videos?: ChannelVideo[] }>;
};

type GetLiveStreamOptions = {
    timeout?: number;
    logger?: LoggerLike;
};

type LiveStreamRecord = {
    videoId: string;
    title: string;
    isLive: true;
author: string | null;
};

type LiveStreamsResult = {
success: boolean;
observationKind: DiscoveryObservationKind;
qualityReason?: DiscoveryQualityReason;
streams: LiveStreamRecord[];
videoIds: string[];
count: number;
hasContent: boolean;
detectionMethod?: string;
parserError?: boolean;
error?: string;
};

// Observation quality does not authorize removal of omitted known streams.
export type DiscoveryObservationKind = 'complete' | 'partial' | 'unavailable';
export type DiscoveryQualityReason = 'missing_capability' | 'malformed_collection' | 'acquisition_failed' | 'parser_error' | 'invalid_video_ids' | 'detection_unavailable' | 'pagination_incomplete';
export function isYouTubeVideoId(videoId: unknown): videoId is string {
    if (!videoId || typeof videoId !== 'string') return false;
    return /^[a-zA-Z0-9_-]{11}$/.test(videoId) || /^[a-zA-Z0-9_-]+$/.test(videoId);
}
type VideoObservation = {
    streams: LiveStreamRecord[];
    hasContent: boolean;
    observed: boolean;
    qualityReason?: DiscoveryQualityReason;
};

function safeDiagnosticText(value: string): string {
    return sanitizeLogText(value).slice(0, 4096);
}

function isParserErrorMessage(message: string): boolean {
    return message.includes('not found!') || message.includes('Type mismatch')
        || message.includes('Parser') || message.includes('YOUTUBEJS');
}

class YouTubeLiveStreamService {
    static _channelCache = new Map<string, { channelId: string; timestamp: number }>();
    static _channelCacheTtl = 10 * 60 * 1000;

static isVideoLive(video: ChannelVideo | null | undefined): boolean {
        if (!video) {
            return false;
        }

        // Historical live content and SDK-inferred live getters do not override
        // explicit upcoming or ended evidence.
        if (video.is_upcoming === true || video.is_post_live_dvr === true
            || video.end_timestamp != null || video.is_live === false) return false;

        return !!(
            video.is_live
            || video.is_live_content
            || (video.badges && video.badges.some((badge) =>
                badge.label === 'LIVE'
                || badge.text === 'LIVE'
                || badge.style === 'BADGE_STYLE_TYPE_LIVE_NOW'
            ))
            || video.content_image?.overlays?.some((overlay) =>
                overlay.badges?.some((badge) =>
                    badge.text === 'LIVE'
                    || badge.icon_name === 'LIVE'
                    || badge.badge_style === 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE'
                )
            )
        );
    }

    static async getLiveStreams(innertubeClient: InnertubeClientLike, channelHandle: unknown, options: GetLiveStreamOptions = {}): Promise<LiveStreamsResult> {
        const timeout: number = options.timeout ?? 2000;
        const logger = options.logger;
        const detectionStartedAt = performance.now();
        const remainingTime = () => Math.max(1, Math.ceil(timeout - (performance.now() - detectionStartedAt)));

        try {
            const normalizedHandle = normalizeChannelHandle(channelHandle);
            if (!normalizedHandle) {
                const notFoundError = new Error('Channel not found');
                Object.assign(notFoundError, { status: 404 });
                throw notFoundError;
            }

            const channelId = await this._getOrResolveChannelId(
                innertubeClient,
                normalizedHandle,
                remainingTime(),
                logger
            );

            if (!channelId) {
                const notFoundError = new Error('Channel not found');
                Object.assign(notFoundError, { status: 404 });
                throw notFoundError;
            }

            const channel = await withTimeout(
                innertubeClient.getChannel(channelId),
                remainingTime(),
                'YouTube getChannel operation'
            );

            if (!channel) {
                throw new Error(`Channel not found for ID: ${channelId}`);
            }

            const detectionMeta: {
                detectionMethod: 'channel_videos' | 'channel_api' | 'search';
                hasContent: boolean;
            } = {
                detectionMethod: 'channel_videos',
                hasContent: false
            };

            const channelVideos = this._extractLiveStreamsFromChannelVideos(channel, channelId, normalizedHandle.replace(/^@/, '').toLowerCase(), logger);
            let liveStreams = channelVideos.streams;
            let observed = channelVideos.observed;
            let qualityReason = channelVideos.qualityReason;
            let parserError = qualityReason === 'parser_error';
            let authoritativeStreams = false;
            detectionMeta.hasContent = channelVideos.hasContent;

            if (typeof channel.getLiveStreams === 'function') {
                const remainingTimeout = remainingTime();
                const apiTimeout = liveStreams.length
                    ? Math.max(1, Math.floor(remainingTimeout / 2))
                    : remainingTimeout;
                const apiStreams = await this._getLiveStreamsFromChannelApi(channel, apiTimeout, logger);
                if (!apiStreams.qualityReason && apiStreams.observed) {
                    // A complete target streams tab owns membership, including an
                    // empty result; homepage recommendations cannot extend it.
                    authoritativeStreams = true;
                    liveStreams = apiStreams.streams;
                    observed = true;
                    qualityReason = undefined;
                    parserError = false;
                    detectionMeta.hasContent = apiStreams.hasContent;
                    detectionMeta.detectionMethod = 'channel_api';
                } else {
                    parserError ||= apiStreams.qualityReason === 'parser_error';
                    observed = observed || apiStreams.observed;
                    qualityReason ??= apiStreams.qualityReason;
                    detectionMeta.hasContent = detectionMeta.hasContent || apiStreams.hasContent;
                    const streamIds = new Set(liveStreams.map((stream) => stream.videoId));
                    const additionalApiStreams = apiStreams.streams.filter((stream) => !streamIds.has(stream.videoId));
                    liveStreams = liveStreams.concat(additionalApiStreams);
                    if (additionalApiStreams.length) detectionMeta.detectionMethod = 'channel_api';
                }
            } else {
                qualityReason ??= 'missing_capability';
            }

            if (!liveStreams.length && !authoritativeStreams) {
                const searchOptions: {
                    channelId: string;
                    channelHandle: string;
                    timeout: number;
                    logger?: LoggerLike;
                } = {
                    channelId,
                    channelHandle: normalizedHandle,
                    timeout: remainingTime()
                };
                if (logger !== undefined) {
                    searchOptions.logger = logger;
                }

                const searchStreams = await this._detectLiveStreamsViaSearch(innertubeClient, searchOptions);
                parserError ||= searchStreams.qualityReason === 'parser_error';
                observed = observed || searchStreams.observed;
                qualityReason ??= searchStreams.qualityReason;
                detectionMeta.hasContent = detectionMeta.hasContent || searchStreams.hasContent;
                liveStreams = searchStreams.streams;

                if (liveStreams.length) {
                    detectionMeta.detectionMethod = 'search';
                }
            }

            return {
                success: !qualityReason || liveStreams.length > 0,
                observationKind: qualityReason ? (observed ? 'partial' : 'unavailable') : 'complete',
                ...(qualityReason ? { qualityReason } : {}),
                ...(parserError ? { parserError: true } : {}),
                streams: liveStreams,
                videoIds: liveStreams.map((stream) => stream.videoId),
                count: liveStreams.length,
                hasContent: detectionMeta.hasContent,
                detectionMethod: detectionMeta.detectionMethod
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const parserError = isParserErrorMessage(errorMessage);
            if (this._isChannelNotFoundError(error)) {
                const handleLabel = typeof channelHandle === 'string' ? channelHandle : 'unknown channel';
                this._log(logger, 'warn', `[YouTube] Channel not found for ${handleLabel}`);
            } else {
                this._log(logger, 'error', `[YouTube] getLiveStreams failed for ${String(channelHandle)}: ${errorMessage}`, error);
            }

            return {
                success: false,
                observationKind: 'unavailable',
                qualityReason: parserError ? 'parser_error' : 'acquisition_failed',
                ...(parserError ? { parserError: true } : {}),
                streams: [],
                videoIds: [],
                count: 0,
                hasContent: false,
                detectionMethod: 'error',
                error: safeDiagnosticText(errorMessage)
            };
        }
    }

static async getLiveStreamsWithParserTolerance(innertubeClient: InnertubeClientLike, channelHandle: unknown, options: GetLiveStreamOptions = {}): Promise<LiveStreamsResult> {
        try {
            const result = await this.getLiveStreams(innertubeClient, channelHandle, options);
            if (result.parserError || result.qualityReason === 'parser_error' || (!result.success && result.error && isParserErrorMessage(result.error))) {
                this._log(options.logger, 'warn', 'YouTube.js parser error; discovery is incomplete');
                return { ...result, parserError: true };
            }
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (isParserErrorMessage(errorMessage)) {
                this._log(options.logger, 'warn', 'YouTube.js parser error; discovery is unavailable');
                return {
                    success: false,
                    observationKind: 'unavailable',
                    qualityReason: 'parser_error',
                    streams: [],
                    videoIds: [],
                    count: 0,
                    hasContent: false,
                    parserError: true,
                    error: safeDiagnosticText(errorMessage)
                };
            }
            throw error;
        }
    }

static _isChannelNotFoundError(error: unknown): boolean {
        if (!error || typeof error !== 'object') {
            return false;
        }

        if ('status' in error && error.status === 404) {
            return true;
        }

        const message = 'message' in error && typeof error.message === 'string'
            ? error.message.toLowerCase()
            : '';
        return message.includes('channel not found');
    }

static _extractLiveStreamsFromChannelVideos(channel: ChannelLike, channelId: string, normalizedHandle: string, logger?: LoggerLike): VideoObservation {
        return this._mapLiveVideos(channel?.videos, logger, 'channel_videos',
            video => this._videoBelongsToChannel(video, channelId, normalizedHandle));
    }

static async _getLiveStreamsFromChannelApi(channel: ChannelLike, timeout: number, logger?: LoggerLike): Promise<VideoObservation> {
        const result: VideoObservation = { streams: [], hasContent: false, observed: false };
        const deadline = performance.now() + timeout;
        const remainingTime = () => Math.max(1, Math.ceil(deadline - performance.now()));
        try {
            if (typeof channel.getLiveStreams !== 'function') {
                return { ...result, qualityReason: 'missing_capability' };
            }
            let page = await withTimeout(channel.getLiveStreams(), remainingTime(), 'YouTube getLiveStreams operation');
            const streams = new Map<string, LiveStreamRecord>();
            for (let pageIndex = 0; pageIndex < MAX_STREAM_PAGES; pageIndex++) {
                const observation = this._mapLiveVideos(page?.videos, logger, 'channel_api');
                for (const stream of observation.streams) streams.set(stream.videoId, stream);
                result.streams = [...streams.values()];
                result.observed ||= observation.observed;
                result.hasContent ||= observation.hasContent;
                if (observation.qualityReason) result.qualityReason ??= observation.qualityReason;
                if (page?.has_continuation === false || page?.has_continuation === undefined) return result;
                if (page.has_continuation !== true || typeof page.getContinuation !== 'function'
                    || pageIndex + 1 === MAX_STREAM_PAGES || performance.now() >= deadline) {
                    return { ...result, qualityReason: result.qualityReason ?? 'pagination_incomplete' };
                }
                // Leave time to return acquired positives before the enclosing owner deadline.
                page = await withTimeout(page.getContinuation(), Math.max(1, Math.floor(remainingTime() * 0.9)), 'YouTube streams continuation operation');
            }
            return { ...result, qualityReason: result.qualityReason ?? 'pagination_incomplete' };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._log(logger, 'debug', `[YouTube] channel.getLiveStreams failed: ${errorMessage}`);
            return { ...result, qualityReason: result.qualityReason ?? (isParserErrorMessage(errorMessage) ? 'parser_error' : 'acquisition_failed') };
        }
    }

    static _mapLiveVideos(videos: unknown, logger: LoggerLike | undefined, context: string,
        belongsToChannel: (video: ChannelVideo) => boolean | undefined = () => true): VideoObservation {
        if (!Array.isArray(videos)) {
            return { streams: [], hasContent: false, observed: false, qualityReason: 'malformed_collection' };
        }
        const streams = new Map<string, LiveStreamRecord>();
        let observed = videos.length === 0;
        let hasContent = false;
        let qualityReason: DiscoveryQualityReason | undefined;
        for (const video of videos) {
            if (!video || typeof video !== 'object' || Array.isArray(video)) {
                qualityReason = 'malformed_collection';
                continue;
            }
            try {
                const videoId = this._getVideoId(video);
                if (!isYouTubeVideoId(videoId)) {
                    qualityReason = 'malformed_collection';
                    continue;
                }
                const attribution = belongsToChannel(video);
                if (attribution === undefined) {
                    qualityReason = 'malformed_collection';
                    continue;
                }
                if (attribution) {
                    if (this.isVideoLive(video)) {
                        const title = this._getVideoTitle(video);
                        this._log(logger, 'debug', `[YouTube] Live stream found via ${context}: ${videoId} - ${title}`);
                        if (!streams.has(videoId)) streams.set(videoId, {
                            videoId, title, isLive: true, author: video.author?.name || null
                        });
                    }
                    hasContent = true;
                }
                observed = true;
            } catch {
                qualityReason = 'malformed_collection';
            }
        }
        return { streams: [...streams.values()], hasContent, observed, ...(qualityReason ? { qualityReason } : {}) };
    }

    static _getVideoId(video: ChannelVideo): string {
        const id = video.id || video.video_id || video.content_id;
        return typeof id === 'string' ? id : '';
    }

    static _getVideoTitle(video: ChannelVideo): string {
        const title = video.title ?? video.metadata?.title;
        if (typeof title === 'string') {
            return title || 'Live Stream';
        }
        return title?.text || title?.content || 'Live Stream';
    }

    static _videoBelongsToChannel(video: ChannelVideo, channelId: string, normalizedHandle: string): boolean | undefined {
        const channelIds = new Set<string>();
        const authorId = video.author?.id;
        if (authorId !== undefined) {
            if (authorId !== channelId && !isChannelId(authorId)) return undefined;
            channelIds.add(authorId);
        }
        const rawHandle = video.author?.handle;
        if (rawHandle !== undefined && typeof rawHandle !== 'string') return undefined;
        const authorHandle = rawHandle?.replace(/^@/, '').toLowerCase();
        if (authorHandle !== undefined && (!authorHandle || /[@\s]/u.test(authorHandle))) return undefined;
        const rows = video.metadata?.metadata?.metadata_rows ?? [];
        if (!Array.isArray(rows)) return undefined;
        for (const row of rows) {
            if (!row || !Array.isArray(row.metadata_parts ?? [])) return undefined;
            for (const part of row.metadata_parts ?? []) {
                if (!part) return undefined;
                const browseId = part.text?.endpoint?.payload?.browseId;
                if (browseId === undefined) continue;
                if (typeof browseId !== 'string') return undefined;
                // Metadata rows also link playlists; those are not author identities.
                if (browseId === channelId || isChannelId(browseId)) channelIds.add(browseId);
            }
        }
        if (channelIds.size > 1) return undefined;
        const hasTargetHandle = normalizedHandle !== channelId.toLowerCase();
        const handleMatches = hasTargetHandle && authorHandle === normalizedHandle;
        if (channelIds.has(channelId)) return true; // Stable identity survives a renamed handle.
        if (channelIds.size === 1) return handleMatches ? undefined : false;
        return authorHandle !== undefined && hasTargetHandle ? handleMatches : undefined;
    }

static async _getOrResolveChannelId(
innertubeClient: InnertubeClientLike,
channelHandle: string,
timeout: number,
logger?: LoggerLike
): Promise<string | null> {
        if (isChannelId(channelHandle)) {
            return channelHandle;
        }

        const cacheKey = normalizeHandleForCache(channelHandle);
        const cached = cacheKey ? this._channelCache?.get(cacheKey) : null;
        const now = Date.now();
        if (cached && isChannelId(cached.channelId) && (now - cached.timestamp) < this._channelCacheTtl) {
            this._log(logger, 'debug', `[YouTube] Using cached Channel ID: ${cached.channelId}`);
            return cached.channelId;
        }
        if (cacheKey) this._channelCache.delete(cacheKey);

        this._log(logger, 'debug', '[YouTube] Resolving channel handle to Channel ID');

        const safeLogger: LoggerLike | undefined = logger && typeof logger.error === 'function' ? logger : undefined;

        const resolveOptions: {
            timeout: number;
            logger?: LoggerLike;
            throwOnError: true;
        } = {
            timeout,
            throwOnError: true
        };
        if (safeLogger !== undefined) {
            resolveOptions.logger = safeLogger;
        }

        const resolvedChannelId = await resolveChannelId(innertubeClient, channelHandle, resolveOptions);
        if (resolvedChannelId && isChannelId(resolvedChannelId) && cacheKey) {
            if (!this._channelCache) {
                this._channelCache = new Map();
            }
            while (this._channelCache.size >= MAX_CHANNEL_CACHE_ENTRIES) {
                const oldestKey = this._channelCache.keys().next().value;
                if (oldestKey === undefined) break;
                this._channelCache.delete(oldestKey);
            }
            this._channelCache.set(cacheKey, {
                channelId: resolvedChannelId,
                timestamp: now
            });
        }
return resolvedChannelId;
}

static async _detectLiveStreamsViaSearch(
innertubeClient: InnertubeClientLike,
{
channelId,
channelHandle,
timeout,
logger
}: {
channelId: string;
channelHandle: string;
timeout: number;
logger?: LoggerLike;
}
): Promise<VideoObservation> {
        try {
            if (typeof innertubeClient.search !== 'function') {
                return {
                    streams: [],
                    hasContent: false,
                    observed: false,
                    qualityReason: 'missing_capability'
                };
            }

            const searchQueryHandle = channelHandle.startsWith('@') ? channelHandle : `@${channelHandle}`;
            const searchResult = await withTimeout(
                innertubeClient.search(`${searchQueryHandle} live`, { type: 'video' }),
                timeout,
                'YouTube search live videos'
            );

            const normalizedHandle = channelHandle.replace(/^@/, '').toLowerCase();

            return this._mapLiveVideos(searchResult?.videos, logger, 'search',
                video => this._videoBelongsToChannel(video, channelId, normalizedHandle));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._log(logger, 'debug', `[YouTube] Search fallback failed: ${errorMessage}`);
            return {
                streams: [],
                hasContent: false,
                observed: false,
                qualityReason: isParserErrorMessage(errorMessage) ? 'parser_error' : 'acquisition_failed'
            };
        }
    }

static _log(logger: LoggerLike | undefined, level: 'error' | 'warn' | 'debug', message: string, error?: unknown): void {
        message = safeDiagnosticText(message);
        if (level === 'error' || level === 'warn') {
            const handler = createPlatformErrorHandler(logger, 'youtube-live-stream');
            if (error instanceof Error) {
                handler.handleConnectionError(error, 'live-stream', message);
            } else {
                const normalizedError = typeof error === 'string' && error
                    ? new Error(error)
                    : new Error(message);
                handler.handleServiceUnavailableError('youtube-live-stream', normalizedError);
            }
            return;
        }
        if (!logger || typeof logger[level] !== 'function') {
            return;
        }
        if (typeof error !== 'undefined') {
            logger[level]?.(message, 'youtube-live-stream-service', {
                error: safeDiagnosticText(error instanceof Error ? error.message : String(error))
            });
        } else {
            logger[level]?.(message, 'youtube-live-stream-service');
        }
    }
}

export { YouTubeLiveStreamService };
