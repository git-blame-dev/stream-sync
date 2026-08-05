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
streams: LiveStreamRecord[];
videoIds: string[];
count: number;
hasContent: boolean;
detectionMethod?: string;
parserError?: boolean;
error?: string;
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

            let liveStreams = this._extractLiveStreamsFromChannelVideos(channel, logger);
            detectionMeta.hasContent = detectionMeta.hasContent || this._channelHasVideoContent(channel);

            if (typeof channel.getLiveStreams === 'function') {
                const remainingTimeout = Math.max(1, timeout - (Date.now() - detectionStartedAt));
                const apiTimeout = liveStreams.length
                    ? Math.max(1, Math.floor(remainingTimeout / 2))
                    : timeout;
                const apiStreams = await this._getLiveStreamsFromChannelApi(channel, apiTimeout, logger);
                detectionMeta.hasContent = detectionMeta.hasContent || apiStreams.hasContent;
                const streamIds = new Set(liveStreams.map((stream) => stream.videoId));
                const additionalApiStreams = apiStreams.streams.filter((stream) => !streamIds.has(stream.videoId));
                liveStreams = liveStreams.concat(additionalApiStreams);
                if (additionalApiStreams.length) {
                    detectionMeta.detectionMethod = 'channel_api';
                }
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
                detectionMeta.hasContent = detectionMeta.hasContent || searchStreams.hasContent;
                liveStreams = searchStreams.streams;

                if (liveStreams.length) {
                    detectionMeta.detectionMethod = 'search';
                }
            }

            return {
                success: true,
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

static _channelHasVideoContent(channel: ChannelLike): boolean {
        return Array.isArray(channel?.videos) && channel.videos.length > 0;
    }

static _extractLiveStreamsFromChannelVideos(channel: ChannelLike, logger?: LoggerLike): LiveStreamRecord[] {
        const videos = Array.isArray(channel?.videos) ? channel.videos : [];
        return this._mapLiveVideos(videos, logger, 'channel_videos');
    }

static async _getLiveStreamsFromChannelApi(channel: ChannelLike, timeout: number, logger?: LoggerLike): Promise<{ streams: LiveStreamRecord[]; hasContent: boolean }> {
        try {
            const liveStreams = await withTimeout(
                channel.getLiveStreams ? channel.getLiveStreams() : Promise.resolve({ videos: [] }),
                timeout,
                'YouTube getLiveStreams operation'
            );

            return {
                streams: this._mapLiveVideos(liveStreams?.videos ?? [], logger, 'channel_api'),
                hasContent: !!liveStreams?.videos?.length
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._log(logger, 'debug', `[YouTube] channel.getLiveStreams failed: ${errorMessage}`);
            return { streams: [], hasContent: false };
        }
    }

    static _mapLiveVideos(videos: ChannelVideo[], logger: LoggerLike | undefined, context: string): LiveStreamRecord[] {
        if (!Array.isArray(videos) || videos.length === 0) {
            return [];
        }

        const seenVideoIds = new Set<string>();
        return videos
            .filter((video) => {
                const isLive = this.isVideoLive(video);
                if (isLive) {
                    const title = this._getVideoTitle(video);
                    this._log(logger, 'debug', `[YouTube] Live stream found via ${context}: ${this._getVideoId(video)} - ${title}`);
                }
                return isLive;
            })
            .map((video) => ({
                videoId: this._getVideoId(video),
                title: this._getVideoTitle(video),
                isLive: true as const,
                author: video.author?.name || null
            }))
            .filter((stream): stream is LiveStreamRecord => {
                if (!stream.videoId || seenVideoIds.has(stream.videoId)) {
                    return false;
                }
                seenVideoIds.add(stream.videoId);
                return true;
            });
    }

    static _getVideoId(video: ChannelVideo): string {
        return String(video.id || video.video_id || video.content_id || '');
    }

    static _getVideoTitle(video: ChannelVideo): string {
        const title = video.title ?? video.metadata?.title;
        if (typeof title === 'string') {
            return title || 'Live Stream';
        }
        return title?.text || title?.content || 'Live Stream';
    }

    static _videoBelongsToChannel(video: ChannelVideo, channelId: string, normalizedHandle: string): boolean {
        const authorHandle = video.author?.handle?.replace(/^@/, '').toLowerCase();
        if (video.author?.id === channelId || authorHandle === normalizedHandle) {
            return true;
        }

        return (video.metadata?.metadata?.metadata_rows ?? []).some((row) =>
            (row.metadata_parts ?? []).some((part) =>
                part.text?.endpoint?.payload?.browseId === channelId
            )
        );
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
): Promise<{ streams: LiveStreamRecord[]; hasContent: boolean }> {
        try {
            if (typeof innertubeClient.search !== 'function') {
                return {
                    streams: [],
                    hasContent: false
                };
            }

            const searchQueryHandle = channelHandle.startsWith('@') ? channelHandle : `@${channelHandle}`;
            const searchResult = await withTimeout(
                innertubeClient.search(`${searchQueryHandle} live`, { type: 'video' }),
                timeout,
                'YouTube search live videos'
            );

            const videos: ChannelVideo[] = searchResult?.videos ?? [];
            const normalizedHandle = channelHandle.replace(/^@/, '').toLowerCase();

            const ownedVideos = videos
                .filter((video) => this._videoBelongsToChannel(video, channelId, normalizedHandle));
            const streams = this._mapLiveVideos(ownedVideos, logger, 'search');

            return {
                streams,
                hasContent: ownedVideos.length > 0
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._log(logger, 'debug', `[YouTube] Search fallback failed: ${errorMessage}`);
            return {
                streams: [],
                hasContent: false
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
