
const { withTimeout } = require('../utils/timeout-wrapper');
const {
    isChannelId,
    normalizeChannelHandle,
    normalizeHandleForCache,
    resolveChannelId
} = require('./youtube-channel-resolver');

class YouTubeLiveStreamService {
    
    static isVideoLive(video) {
        if (!video) return false;
        
        // Comprehensive live detection covering all YouTube.js variations
        return video.is_live || 
               video.is_live_content ||
               (video.badges && video.badges.some(badge => 
                   badge.label === 'LIVE' || 
                   badge.text === 'LIVE' ||
                   badge.style === 'BADGE_STYLE_TYPE_LIVE_NOW'
               ));
    }
    
    static async getLiveStreams(innertubeClient, channelHandle, options = {}) {
        const timeout = options.timeout || 2000;
        const logger = options.logger;
        
        try {
            const normalizedHandle = normalizeChannelHandle(channelHandle);
            if (!normalizedHandle) {
                const notFoundError = new Error('Channel not found');
                notFoundError.status = 404;
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
                notFoundError.status = 404;
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
                videoIds: liveStreams.map(stream => stream.videoId),
                count: liveStreams.length,
                hasContent: detectionMeta.hasContent,
                detectionMethod: detectionMeta.detectionMethod
            };
            
        } catch (error) {
            if (this._isChannelNotFoundError(error)) {
                const handleLabel = channelHandle || 'unknown channel';
                this._log(logger, 'warn', `[YouTube] Channel not found for ${handleLabel}`);
            } else {
                this._log(logger, 'error', `[YouTube] getLiveStreams failed for ${channelHandle}: ${error.message}`, error);
            }
            
            return {
                success: false,
                streams: [],
                videoIds: [],
                count: 0,
                hasContent: false,
                detectionMethod: 'error',
                error: error.message
            };
        }
    }
    
    static async getLiveStreamsWithParserTolerance(innertubeClient, channelHandle, options = {}) {
        try {
            return await this.getLiveStreams(innertubeClient, channelHandle, options);
        } catch (error) {
            // Handle YouTube.js parser errors gracefully
            if (error.message && (
                error.message.includes('not found!') || 
                error.message.includes('Type mismatch') ||
                error.message.includes('Parser') ||
                error.message.includes('YOUTUBEJS')
            )) {
                this._log(options.logger, 'warn', `YouTube.js parser error, returning empty results: ${error.message}`);
                return {
                    success: false,
                    streams: [],
                    videoIds: [],
                    count: 0,
                    hasContent: false,
                    parserError: true,
                    error: error.message
                };
            }
            throw error;
        }
    }
    
    static extractVideoIds(result) {
        if (!result || !result.streams) return [];
        return result.streams.map(stream => stream.videoId).filter(id => id);
    }
    
    static isChannelId(channelHandle) {
        return isChannelId(channelHandle);
    }

    static _isChannelNotFoundError(error) {
        if (!error) {
            return false;
        }
        if (error.status === 404) {
            return true;
        }
        const message = (error.message || '').toLowerCase();
        return message.includes('channel not found');
    }
    
    static _channelHasVideoContent(channel) {
        return Array.isArray(channel?.videos?.contents) && channel.videos.contents.length > 0;
    }
    
    static _extractLiveStreamsFromChannelVideos(channel, logger) {
        const videos = Array.isArray(channel?.videos?.contents) ? channel.videos.contents : [];
        return this._mapLiveVideos(videos, logger, 'channel_videos');
    }
    
    static async _getLiveStreamsFromChannelApi(channel, timeout, logger) {
        try {
            const liveStreams = await withTimeout(
                channel.getLiveStreams(),
                timeout,
                'YouTube getLiveStreams operation'
            );
            
            return {
                streams: this._mapLiveVideos(liveStreams?.videos || [], logger, 'channel_api'),
                hasContent: Boolean(liveStreams?.videos?.length)
            };
        } catch (error) {
            this._log(logger, 'debug', `[YouTube] channel.getLiveStreams failed: ${error.message}`);
            return { streams: [], hasContent: false };
        }
    }
    
    static _mapLiveVideos(videos, logger, context) {
        if (!Array.isArray(videos) || videos.length === 0) {
            return [];
        }
        
        return videos
            .filter(video => {
                const isLive = this.isVideoLive(video);
                if (isLive) {
                    const title = video.title?.text || video.title || 'Live Stream';
                    this._log(logger, 'debug', `[YouTube] Live stream found via ${context}: ${video.id || video.video_id} - ${title}`);
                }
                return isLive;
            })
            .map(video => ({
                videoId: video.id || video.video_id,
                title: video.title?.text || video.title || 'Live Stream',
                isLive: true,
                author: video.author?.name || null
            }))
            .filter(stream => stream.videoId);
    }
    
    static async _getOrResolveChannelId(innertubeClient, channelHandle, timeout, logger) {
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
        
        this._log(logger, 'debug', `[YouTube] Resolving channel handle to Channel ID`);
        
        const resolvedChannelId = await resolveChannelId(innertubeClient, channelHandle, {
            timeout,
            logger,
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
    
    static async _detectLiveStreamsViaSearch(innertubeClient, { channelId, channelHandle, timeout, logger }) {
        try {
            const searchQueryHandle = channelHandle.startsWith('@') ? channelHandle : `@${channelHandle}`;
            const searchResult = await withTimeout(
                innertubeClient.search(`${searchQueryHandle} live`, { type: 'video' }),
                timeout,
                'YouTube search live videos'
            );
            
            const videos = searchResult?.videos || [];
            const normalizedHandle = channelHandle.replace(/^@/, '').toLowerCase();
            
            const streams = videos
                .filter(video => {
                    const authorHandle = video.author?.handle?.replace(/^@/, '').toLowerCase();
                    const authorName = video.author?.name?.toLowerCase();
                    const belongsToChannel = video.author?.id === channelId ||
                        (authorHandle && authorHandle === normalizedHandle) ||
                        (authorName && authorName.includes(normalizedHandle));
                    return belongsToChannel && this.isVideoLive(video);
                })
                .map(video => ({
                    videoId: video.id || video.video_id,
                    title: video.title?.text || video.title || 'Live Stream',
                    isLive: true,
                    author: video.author?.name || null
                }))
                .filter(stream => stream.videoId);
            
            return {
                streams,
                hasContent: videos.length > 0
            };
        } catch (error) {
            this._log(logger, 'debug', `[YouTube] Search fallback failed: ${error.message}`);
            return {
                streams: [],
                hasContent: false
            };
        }
    }
}

YouTubeLiveStreamService._channelCache = new Map();
YouTubeLiveStreamService._channelCacheTtl = 10 * 60 * 1000; // 10 minutes

YouTubeLiveStreamService._log = function(logger, level, message, error) {
    if (!logger || typeof logger[level] !== 'function') {
        return;
    }
    if (typeof error !== 'undefined') {
        logger[level](message, 'youtube-live-stream-service', error);
    } else {
        logger[level](message, 'youtube-live-stream-service');
    }
};

module.exports = { YouTubeLiveStreamService };
