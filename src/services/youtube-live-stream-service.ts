import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { withTimeout } from '../utils/timeout-wrapper';
import {
    isChannelId,
    normalizeChannelHandle,
    normalizeHandleForCache,
    resolveChannelId
} from './youtube-channel-resolver';

type LoggerLike = {
    error: (message: string, scope?: string, payload?: unknown) => void;
    debug?: (message: string, scope?: string, payload?: unknown) => void;
    warn?: (message: string, scope?: string, payload?: unknown) => void;
};

type ChannelVideo = {
    id?: string;
    video_id?: string;
    content_id?: string;
    title?: { text?: string; content?: string } | string;
    is_live?: boolean;
    is_live_content?: boolean;
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

type ChannelLike = {
    videos?: ChannelVideo[];
    getLiveStreams?: () => Promise<{ videos?: ChannelVideo[] }>;
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
export type DiscoveryQualityReason = 'missing_capability' | 'malformed_collection' | 'acquisition_failed' | 'parser_error' | 'invalid_video_ids' | 'detection_unavailable';
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

class YouTubeLiveStreamService {
    static _channelCache = new Map<string, { channelId: string; timestamp: number }>();
    static _channelCacheTtl = 10 * 60 * 1000;

static isVideoLive(video: ChannelVideo | null | undefined): boolean {
        if (!video) {
            return false;
        }

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
        const detectionStartedAt = Date.now();

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
                timeout,
                logger
            );

            if (!channelId) {
                const notFoundError = new Error('Channel not found');
                Object.assign(notFoundError, { status: 404 });
                throw notFoundError;
            }

            const channel = await withTimeout(
                innertubeClient.getChannel(channelId),
                timeout,
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

            const channelVideos = this._extractLiveStreamsFromChannelVideos(channel, logger);
            let liveStreams = channelVideos.streams;
            let observed = channelVideos.observed;
            let qualityReason = channelVideos.qualityReason;
            detectionMeta.hasContent = channelVideos.hasContent;

            if (typeof channel.getLiveStreams === 'function') {
                const remainingTimeout = Math.max(1, timeout - (Date.now() - detectionStartedAt));
                const apiTimeout = liveStreams.length
                    ? Math.max(1, Math.floor(remainingTimeout / 2))
                    : timeout;
                const apiStreams = await this._getLiveStreamsFromChannelApi(channel, apiTimeout, logger);
                observed = observed || apiStreams.observed;
                qualityReason ??= apiStreams.qualityReason;
                detectionMeta.hasContent = detectionMeta.hasContent || apiStreams.hasContent;
                const streamIds = new Set(liveStreams.map((stream) => stream.videoId));
                const additionalApiStreams = apiStreams.streams.filter((stream) => !streamIds.has(stream.videoId));
                liveStreams = liveStreams.concat(additionalApiStreams);
                if (additionalApiStreams.length) {
                    detectionMeta.detectionMethod = 'channel_api';
                }
            } else {
                qualityReason ??= 'missing_capability';
            }

            if (!liveStreams.length) {
                const searchOptions: {
                    channelId: string;
                    channelHandle: string;
                    timeout: number;
                    logger?: LoggerLike;
                } = {
                    channelId,
                    channelHandle: normalizedHandle,
                    timeout
                };
                if (logger !== undefined) {
                    searchOptions.logger = logger;
                }

                const searchStreams = await this._detectLiveStreamsViaSearch(innertubeClient, searchOptions);
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
                streams: liveStreams,
                videoIds: liveStreams.map((stream) => stream.videoId),
                count: liveStreams.length,
                hasContent: detectionMeta.hasContent,
                detectionMethod: detectionMeta.detectionMethod
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (this._isChannelNotFoundError(error)) {
                const handleLabel = typeof channelHandle === 'string' ? channelHandle : 'unknown channel';
                this._log(logger, 'warn', `[YouTube] Channel not found for ${handleLabel}`);
            } else {
                this._log(logger, 'error', `[YouTube] getLiveStreams failed for ${String(channelHandle)}: ${errorMessage}`, error);
            }

            return {
                success: false,
                observationKind: 'unavailable',
                qualityReason: 'acquisition_failed',
                streams: [],
                videoIds: [],
                count: 0,
                hasContent: false,
                detectionMethod: 'error',
                error: errorMessage
            };
        }
    }

static async getLiveStreamsWithParserTolerance(innertubeClient: InnertubeClientLike, channelHandle: unknown, options: GetLiveStreamOptions = {}): Promise<LiveStreamsResult> {
        try {
            return await this.getLiveStreams(innertubeClient, channelHandle, options);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (
                errorMessage.includes('not found!')
                || errorMessage.includes('Type mismatch')
                || errorMessage.includes('Parser')
                || errorMessage.includes('YOUTUBEJS')
            ) {
                this._log(options.logger, 'warn', `YouTube.js parser error, returning empty results: ${errorMessage}`);
                return {
                    success: false,
                    observationKind: 'unavailable',
                    qualityReason: 'parser_error',
                    streams: [],
                    videoIds: [],
                    count: 0,
                    hasContent: false,
                    parserError: true,
                    error: errorMessage
                };
            }
            throw error;
        }
    }

static extractVideoIds(result: { streams?: Array<{ videoId?: string }> } | null | undefined): string[] {
        if (!result || !result.streams) {
            return [];
        }

        return result.streams
            .map((stream) => stream.videoId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0);
    }

static isChannelId(channelHandle: unknown): boolean {
        return isChannelId(channelHandle);
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

static _extractLiveStreamsFromChannelVideos(channel: ChannelLike, logger?: LoggerLike): VideoObservation {
        return this._mapLiveVideos(channel?.videos, logger, 'channel_videos');
    }

static async _getLiveStreamsFromChannelApi(channel: ChannelLike, timeout: number, logger?: LoggerLike): Promise<VideoObservation> {
        try {
            if (typeof channel.getLiveStreams !== 'function') {
                return { streams: [], hasContent: false, observed: false, qualityReason: 'missing_capability' };
            }
            const liveStreams = await withTimeout(
                channel.getLiveStreams(),
                timeout,
                'YouTube getLiveStreams operation'
            );

            return this._mapLiveVideos(liveStreams?.videos, logger, 'channel_api');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._log(logger, 'debug', `[YouTube] channel.getLiveStreams failed: ${errorMessage}`);
            return { streams: [], hasContent: false, observed: false, qualityReason: 'acquisition_failed' };
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
        if (cached && (now - cached.timestamp) < this._channelCacheTtl) {
            this._log(logger, 'debug', `[YouTube] Using cached Channel ID: ${cached.channelId}`);
            return cached.channelId;
        }

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
        if (resolvedChannelId && cacheKey) {
            if (!this._channelCache) {
                this._channelCache = new Map();
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
                qualityReason: 'acquisition_failed'
            };
        }
    }

static _log(logger: LoggerLike | undefined, level: 'error' | 'warn' | 'debug', message: string, error?: unknown): void {
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
            logger[level]?.(message, 'youtube-live-stream-service', error);
        } else {
            logger[level]?.(message, 'youtube-live-stream-service');
        }
    }
}

export { YouTubeLiveStreamService };
