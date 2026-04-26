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
    title?: { text?: string } | string;
    is_live?: boolean;
    is_live_content?: boolean;
    badges?: Array<{ label?: string; text?: string; style?: string }>;
    author?: {
        id?: string;
        name?: string;
        handle?: string;
    };
};

type ChannelLike = {
    videos?: {
        contents?: ChannelVideo[];
    };
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

class YouTubeLiveStreamService {
    static _channelCache = new Map<string, { channelId: string; timestamp: number }>();
    static _channelCacheTtl = 10 * 60 * 1000;

    static isVideoLive(video: ChannelVideo | null | undefined) {
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
        );
    }

    static async getLiveStreams(innertubeClient: InnertubeClientLike, channelHandle: unknown, options: GetLiveStreamOptions = {}) {
        const timeout = options.timeout || 2000;
        const logger = options.logger;

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

            const detectionMeta = {
                detectionMethod: 'channel_videos',
                hasContent: false
            };

            let liveStreams = this._extractLiveStreamsFromChannelVideos(channel, logger);
            detectionMeta.hasContent = detectionMeta.hasContent || this._channelHasVideoContent(channel);

            if (!liveStreams.length && typeof channel.getLiveStreams === 'function') {
                const apiStreams = await this._getLiveStreamsFromChannelApi(channel, timeout, logger);
                detectionMeta.hasContent = detectionMeta.hasContent || apiStreams.hasContent;
                liveStreams = apiStreams.streams;
                if (liveStreams.length) {
                    detectionMeta.detectionMethod = 'channel_api';
                }
            }

            if (!liveStreams.length) {
                const searchStreams = await this._detectLiveStreamsViaSearch(
                    innertubeClient,
                    {
                        channelId,
                        channelHandle: normalizedHandle,
                        timeout,
                        logger
                    }
                );
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

    static async getLiveStreamsWithParserTolerance(innertubeClient: InnertubeClientLike, channelHandle: unknown, options: GetLiveStreamOptions = {}) {
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

    static extractVideoIds(result: { streams?: Array<{ videoId?: string }> } | null | undefined) {
        if (!result || !result.streams) {
            return [];
        }

        return result.streams.map((stream) => stream.videoId).filter((id): id is string => !!id);
    }

    static isChannelId(channelHandle: unknown) {
        return isChannelId(channelHandle);
    }

    static _isChannelNotFoundError(error: unknown) {
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

    static _channelHasVideoContent(channel: ChannelLike) {
        return Array.isArray(channel?.videos?.contents) && channel.videos.contents.length > 0;
    }

    static _extractLiveStreamsFromChannelVideos(channel: ChannelLike, logger?: LoggerLike) {
        const videos = Array.isArray(channel?.videos?.contents) ? channel.videos.contents : [];
        return this._mapLiveVideos(videos, logger, 'channel_videos');
    }

    static async _getLiveStreamsFromChannelApi(channel: ChannelLike, timeout: number, logger?: LoggerLike) {
        try {
            const liveStreams = await withTimeout(
                channel.getLiveStreams ? channel.getLiveStreams() : Promise.resolve({ videos: [] }),
                timeout,
                'YouTube getLiveStreams operation'
            );

            return {
                streams: this._mapLiveVideos(liveStreams?.videos || [], logger, 'channel_api'),
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

        return videos
            .filter((video) => {
                const isLive = this.isVideoLive(video);
                if (isLive) {
                    const title = (typeof video.title === 'string' ? video.title : video.title?.text) || 'Live Stream';
                    this._log(logger, 'debug', `[YouTube] Live stream found via ${context}: ${video.id || video.video_id} - ${title}`);
                }
                return isLive;
            })
            .map((video) => ({
                videoId: String(video.id || video.video_id || ''),
                title: (typeof video.title === 'string' ? video.title : video.title?.text) || 'Live Stream',
                isLive: true as const,
                author: video.author?.name || null
            }))
            .filter((stream) => !!stream.videoId);
    }

    static async _getOrResolveChannelId(
        innertubeClient: InnertubeClientLike,
        channelHandle: string,
        timeout: number,
        logger?: LoggerLike
    ) {
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

        const resolvedChannelId = await resolveChannelId(innertubeClient, channelHandle, {
            timeout,
            logger: logger && typeof logger.error === 'function' ? logger : undefined,
            throwOnError: true
        });
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
    ) {
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

            const videos = searchResult?.videos || [];
            const normalizedHandle = channelHandle.replace(/^@/, '').toLowerCase();

            const streams = videos
                .filter((video) => {
                    const authorHandle = video.author?.handle?.replace(/^@/, '').toLowerCase();
                    const authorName = video.author?.name?.toLowerCase();
                    const belongsToChannel = video.author?.id === channelId
                        || (authorHandle && authorHandle === normalizedHandle)
                        || (authorName && authorName.includes(normalizedHandle));
                    return belongsToChannel && this.isVideoLive(video);
                })
                .map((video) => ({
                    videoId: String(video.id || video.video_id || ''),
                    title: (typeof video.title === 'string' ? video.title : video.title?.text) || 'Live Stream',
                    isLive: true as const,
                    author: video.author?.name || null
                }))
                .filter((stream) => stream.videoId);

            return {
                streams,
                hasContent: videos.length > 0
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

    static _log(logger: LoggerLike | undefined, level: 'error' | 'warn' | 'debug', message: string, error?: unknown) {
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
