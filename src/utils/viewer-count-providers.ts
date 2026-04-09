import { getUnifiedLogger } from '../core/logging';
import { createPlatformErrorHandler } from './platform-error-handler';

type ProviderLogger = {
    debug: (message: string, context?: string, payload?: unknown) => void;
    info: (message: string, context?: string, payload?: unknown) => void;
    warn: (message: string, context?: string, payload?: unknown) => void;
    error: (message: string, context?: string, payload?: unknown) => void;
};

type ProviderErrorStats = {
    totalErrors: number;
    lastError: string | null;
    errorTypes: Map<string, number>;
    consecutiveErrors: number;
};

type TwitchApiClient = {
    getStreamInfo: (channel: string) => Promise<{ isLive: boolean; viewerCount: number }>;
};

type YouTubeExtractionService = {
    getAggregatedViewerCount: (activeVideoIds: string[]) => Promise<{
        success: boolean;
        totalCount: number;
        successfulStreams: number;
    }>;
    extractViewerCount: (videoId: string) => Promise<{
        success: boolean;
        count: number;
    }>;
};

type TikTokPlatformLike = {
    connection?: {
        isConnected?: boolean;
    };
    getViewerCount?: () => Promise<unknown>;
};

class ViewerCountProvider {
    platform: string;
    logger: ProviderLogger;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    errorStats: ProviderErrorStats;

    constructor(platform: string, logger: ProviderLogger | null = null) {
        this.platform = platform;
        this.logger = logger || (getUnifiedLogger() as unknown as ProviderLogger);
        this.errorHandler = createPlatformErrorHandler(this.logger, `${platform}-viewer-count`);
        this.errorStats = {
            totalErrors: 0,
            lastError: null,
            errorTypes: new Map(),
            consecutiveErrors: 0
        };
    }

    async getViewerCount(): Promise<number> {
        throw new Error('getViewerCount() must be implemented by subclass');
    }

    isReady(): boolean {
        throw new Error('isReady() must be implemented by subclass');
    }

    _handleProviderError(error: unknown, operation = 'getViewerCount'): number {
        this.errorStats.totalErrors++;
        const message = (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string' && (error as { message: string }).message.length > 0)
            ? (error as { message: string }).message
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

    _categorizeError(error: unknown) {
        const message = typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message.toLowerCase()
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
    apiClient: TwitchApiClient;
    connectionStateFactory: unknown;
    config: { channel?: string } | null;
    getCurrentEventSub: unknown;

    constructor(apiClient: TwitchApiClient, connectionStateFactory: unknown, config: { channel?: string } | null, getCurrentEventSub: unknown = null, logger: ProviderLogger | null = null) {
        super('twitch', logger);
        this.apiClient = apiClient;
        this.connectionStateFactory = connectionStateFactory;
        this.config = config;
        this.getCurrentEventSub = getCurrentEventSub;
    }

    isReady() {
        return !!(this.config && this.config.channel);
    }

    async getViewerCount(): Promise<number> {
        this.logger.debug('Getting Twitch viewer count...', 'viewer-count-provider');
        
        if (!this.isReady()) {
            this.logger.debug('Twitch provider not ready, returning 0', 'viewer-count-provider');
            return 0;
        }

        try {
            const channel = this.config?.channel;
            if (!channel) {
                return 0;
            }

            const streamInfo = await this.apiClient.getStreamInfo(channel);
            
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
    config: Record<string, unknown> | null;
    getActiveVideoIds: (() => string[]) | null;
    viewerExtractionService: YouTubeExtractionService | null;
    innertubeService: unknown;
    stats: {
        totalRequests: number;
        successfulRequests: number;
        startTime: number;
    };

    constructor(
        innertubeManager: unknown,
        config: Record<string, unknown> | null,
        getActiveVideoIds: (() => string[]) | null,
        Innertube: unknown,
        dependencies: { viewerExtractionService?: YouTubeExtractionService; innertubeService?: unknown; logger?: ProviderLogger } = {}
    ) {
        super('youtube', dependencies.logger);
        this.config = config;
        this.getActiveVideoIds = getActiveVideoIds;
        this.viewerExtractionService = dependencies.viewerExtractionService || null;
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

    async getViewerCount(): Promise<number> {
        this.stats.totalRequests++;
        this.logger.debug('Getting YouTube viewer count - aggregating from all active streams', 'viewer-count-provider');
        
        if (!this.isReady()) {
            this.logger.debug('YouTube provider not ready, returning 0', 'viewer-count-provider');
            return 0;
        }

        try {
            const getActiveVideoIds = this.getActiveVideoIds;
            const extractionService = this.viewerExtractionService;
            if (!getActiveVideoIds || !extractionService) {
                return 0;
            }

            const activeVideoIds = getActiveVideoIds();
            
            if (!activeVideoIds || activeVideoIds.length === 0) {
                this.logger.debug('No active YouTube streams found', 'viewer-count-provider');
                return 0;
            }
            
            this.logger.debug(`Found ${activeVideoIds.length} active streams for aggregation: ${activeVideoIds.join(', ')}`, 'viewer-count-provider');
            
            const result = await extractionService.getAggregatedViewerCount(activeVideoIds);
            
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

    async getViewerCountForVideo(videoId: string): Promise<number> {
        this.logger.debug(`Getting YouTube viewer count for video: ${videoId}`, 'viewer-count-provider');
        
        try {
            const extractionService = this.viewerExtractionService;
            if (!extractionService) {
                return 0;
            }

            const result = await extractionService.extractViewerCount(videoId);
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
    tiktokPlatform: TikTokPlatformLike | null;

    constructor(platform: TikTokPlatformLike | null, options: { logger?: ProviderLogger } = {}) {
        super('tiktok', options.logger);
        this.tiktokPlatform = platform;
    }

    isReady() {
        if (!this.tiktokPlatform) return false;
        const connection = this.tiktokPlatform.connection;
        return !!(connection && connection.isConnected);
    }

    async getViewerCount(): Promise<number> {
        if (!this.tiktokPlatform || typeof this.tiktokPlatform.getViewerCount !== 'function') {
            return this._handleProviderError(new Error('TikTok platform not available'), 'platformGetViewerCount');
        }

        try {
            const count = await this.tiktokPlatform.getViewerCount();
            this._resetErrorCount();
            return typeof count === 'number' ? count : 0;
        } catch (error) {
            return this._handleProviderError(error, 'platformGetViewerCount');
        }
    }
}

class ViewerCountProviderFactory {
    static createTwitchProvider(apiClient: TwitchApiClient, connectionStateFactory: unknown, config: { channel?: string } | null, getCurrentEventSub: unknown = null) {
        return new TwitchViewerCountProvider(apiClient, connectionStateFactory, config, getCurrentEventSub);
    }

    static createYouTubeProvider(
        innertubeManager: unknown,
        config: Record<string, unknown> | null,
        getActiveVideoIds: (() => string[]) | null,
        Innertube: unknown,
        dependencies: { viewerExtractionService?: YouTubeExtractionService; innertubeService?: unknown; logger?: ProviderLogger } = {}
    ) {
        return new YouTubeViewerCountProvider(innertubeManager, config, getActiveVideoIds, Innertube, dependencies);
    }

    static createTikTokProvider(platform: TikTokPlatformLike | null, options: { logger?: ProviderLogger } = {}) {
        return new TikTokViewerCountProvider(platform, options);
    }
}

export {
    ViewerCountProvider,
    TwitchViewerCountProvider,
    YouTubeViewerCountProvider,
    TikTokViewerCountProvider,
    ViewerCountProviderFactory
};
