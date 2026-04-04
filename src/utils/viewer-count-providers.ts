
const { getUnifiedLogger } = require('../core/logging');
const { createPlatformErrorHandler } = require('./platform-error-handler');

class ViewerCountProvider {
    constructor(platform, logger = null) {
        this.platform = platform;
        this.logger = logger || getUnifiedLogger();
        this.errorHandler = createPlatformErrorHandler(this.logger, `${platform}-viewer-count`);
        this.errorStats = {
            totalErrors: 0,
            lastError: null,
            errorTypes: new Map(),
            consecutiveErrors: 0
        };
    }

    async getViewerCount() {
        throw new Error('getViewerCount() must be implemented by subclass');
    }

    isReady() {
        throw new Error('isReady() must be implemented by subclass');
    }

    _handleProviderError(error, operation = 'getViewerCount') {
        this.errorStats.totalErrors++;
        const message = (error && typeof error.message === 'string' && error.message.length > 0)
            ? error.message
            : 'Unknown error';
        this.errorStats.lastError = message;
        this.errorStats.consecutiveErrors++;

        const normalizedError = error instanceof Error ? error : new Error(message);
        const errorType = this._categorizeError(normalizedError);
        const currentCount = this.errorStats.errorTypes.get(errorType) || 0;
        this.errorStats.errorTypes.set(errorType, currentCount + 1);

        this.errorHandler.handleEventProcessingError(
            normalizedError, operation, null, `${this.platform} ${operation} failed: ${message}`
        );

        return 0;
    }

    _categorizeError(error) {
        const message = typeof error?.message === 'string'
            ? error.message.toLowerCase()
            : '';
        
        if (message.includes('network') || message.includes('timeout') || message.includes('connect')) {
            return 'network';
        }
        if (message.includes('auth') || message.includes('token') || message.includes('unauthorized')) {
            return 'authentication';
        }
        if (message.includes('rate limit') || message.includes('too many requests')) {
            return 'rate_limit';
        }
        if (message.includes('not found') || message.includes('stream') || message.includes('video')) {
            return 'resource_not_found';
        }
        
        return 'unknown';
    }

    _resetErrorCount() {
        this.errorStats.consecutiveErrors = 0;
    }

    getErrorStats() {
        return {
            ...this.errorStats,
            errorTypes: Object.fromEntries(this.errorStats.errorTypes)
        };
    }
}

class TwitchViewerCountProvider extends ViewerCountProvider {
    constructor(apiClient, connectionStateFactory, config, getCurrentEventSub = null, logger = null) {
        super('twitch', logger);
        this.apiClient = apiClient;
        this.connectionStateFactory = connectionStateFactory;
        this.config = config;
        this.getCurrentEventSub = getCurrentEventSub;
    }

    isReady() {
        return !!(this.config && this.config.channel);
    }

    async getViewerCount() {
        this.logger.debug('Getting Twitch viewer count...', 'viewer-count-provider');
        
        if (!this.isReady()) {
            this.logger.debug('Twitch provider not ready, returning 0', 'viewer-count-provider');
            return 0;
        }

        try {
            const streamInfo = await this.apiClient.getStreamInfo(this.config.channel);
            
            this.logger.debug('Twitch stream info received', 'viewer-count-provider', {
                isLive: streamInfo.isLive,
                viewerCount: streamInfo.viewerCount
            });

            this._resetErrorCount();
            return streamInfo.viewerCount;
            
        } catch (error) {
            return this._handleProviderError(error, 'getStreamInfo');
        }
    }
}


class YouTubeViewerCountProvider extends ViewerCountProvider {
    constructor(innertubeManager, config, getActiveVideoIds, Innertube, dependencies = {}) {
        super('youtube', dependencies.logger);
        this.config = config;
        this.getActiveVideoIds = getActiveVideoIds;
        this.viewerExtractionService = dependencies.viewerExtractionService;
        this.innertubeService = dependencies.innertubeService;
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            startTime: Date.now()
        };
    }

    isReady() {
        return !!(this.viewerExtractionService && this.config && this.getActiveVideoIds);
    }

    async getViewerCount() {
        this.stats.totalRequests++;
        this.logger.debug('Getting YouTube viewer count - aggregating from all active streams', 'viewer-count-provider');
        
        if (!this.isReady()) {
            this.logger.debug('YouTube provider not ready, returning 0', 'viewer-count-provider');
            return 0;
        }

        try {
            const activeVideoIds = this.getActiveVideoIds();
            
            if (!activeVideoIds || activeVideoIds.length === 0) {
                this.logger.debug('No active YouTube streams found', 'viewer-count-provider');
                return 0;
            }
            
            this.logger.debug(`Found ${activeVideoIds.length} active streams for aggregation: ${activeVideoIds.join(', ')}`, 'viewer-count-provider');
            
            const result = await this.viewerExtractionService.getAggregatedViewerCount(activeVideoIds);
            
            if (result.success) {
                this.stats.successfulRequests++;
                this.logger.debug(`YouTube aggregation complete: ${result.totalCount} total viewers from ${result.successfulStreams}/${activeVideoIds.length} streams`, 'viewer-count-provider');
                this._resetErrorCount();
                return result.totalCount;
            } else {
                return this._handleProviderError(new Error('Service layer aggregation failed'), 'getAggregatedViewerCount');
            }
            
        } catch (error) {
            return this._handleProviderError(error, 'getAggregatedViewerCount');
        }
    }

    async getViewerCountForVideo(videoId) {
        this.logger.debug(`Getting YouTube viewer count for video: ${videoId}`, 'viewer-count-provider');
        
        try {
            const result = await this.viewerExtractionService.extractViewerCount(videoId);
            if (result.success) {
                this._resetErrorCount();
                return result.count;
            } else {
                return this._handleProviderError(new Error('Video extraction failed'), 'extractViewerCount');
            }
        } catch (error) {
            return this._handleProviderError(error, 'extractViewerCount');
        }
    }
    
    getStats() {
        return {
            ...this.stats,
            uptime: Date.now() - this.stats.startTime,
            successRate: this.stats.totalRequests > 0 ? 
                (this.stats.successfulRequests / this.stats.totalRequests * 100).toFixed(2) + '%' : '0%'
        };
    }
}

class TikTokViewerCountProvider extends ViewerCountProvider {
    constructor(platform, options = {}) {
        super('tiktok', options.logger);
        this.platform = platform;
    }

    isReady() {
        if (!this.platform) return false;
        const connection = this.platform.connection;
        return !!(connection && connection.isConnected);
    }

    async getViewerCount() {
        if (!this.platform || typeof this.platform.getViewerCount !== 'function') {
            return this._handleProviderError(new Error('TikTok platform not available'), 'platformGetViewerCount');
        }

        try {
            const count = await this.platform.getViewerCount();
            this._resetErrorCount();
            return typeof count === 'number' ? count : 0;
        } catch (error) {
            return this._handleProviderError(error, 'platformGetViewerCount');
        }
    }
}

class ViewerCountProviderFactory {
    static createTwitchProvider(apiClient, connectionStateFactory, config, getCurrentEventSub = null) {
        return new TwitchViewerCountProvider(apiClient, connectionStateFactory, config, getCurrentEventSub);
    }

    static createYouTubeProvider(innertubeManager, config, getActiveVideoIds, Innertube, dependencies = {}) {
        return new YouTubeViewerCountProvider(innertubeManager, config, getActiveVideoIds, Innertube, dependencies);
    }

    static createTikTokProvider(platform, options = {}) {
        return new TikTokViewerCountProvider(platform, options);
    }
}

module.exports = {
    ViewerCountProvider,
    TwitchViewerCountProvider,
    YouTubeViewerCountProvider,
    TikTokViewerCountProvider,
    ViewerCountProviderFactory
};
