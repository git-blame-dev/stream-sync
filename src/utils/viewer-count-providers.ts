import type { AppLogger } from '../core/logger/types';
import { getUnifiedLogger } from '../core/logging';
import { sanitizeLogText } from '../core/logger/safe-log-serializer';
import { createPlatformErrorHandler } from './platform-error-handler';
import { parseNotificationCount } from './notification-count';
import type { ViewerCountObservation, ViewerMembershipSnapshot } from '../contracts/viewer-count';

type ProviderLogger = Pick<AppLogger<string>, 'debug' | 'info' | 'warn' | 'error'>;

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
        failedStreams?: number;
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

type ProviderErrorType = 'network' | 'authentication' | 'rate_limit' | 'resource_not_found' | 'unknown';

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.length > 0) {
        return error.message;
    }

    if (typeof error === 'object' && error !== null) {
        const objectError = error as { message?: unknown };
        if (typeof objectError.message === 'string' && objectError.message.length > 0) {
            return objectError.message;
        }
    }

    return 'Unknown error';
}

class ViewerCountProvider {
    platform: string;
    logger: ProviderLogger;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    errorStats: ProviderErrorStats;

    constructor(platform: string, logger: ProviderLogger | null = null) {
        this.platform = platform;
        this.logger = logger ?? (getUnifiedLogger() as ProviderLogger);
        this.errorHandler = createPlatformErrorHandler(this.logger, `${platform}-viewer-count`);
        this.errorStats = {
            totalErrors: 0,
            lastError: null,
            errorTypes: new Map(),
            consecutiveErrors: 0
        };
    }

    async getViewerCount(): Promise<number | null> {
        throw new Error('getViewerCount() must be implemented by subclass');
    }

    isReady(): boolean {
        throw new Error('isReady() must be implemented by subclass');
    }

    _handleProviderError(error: unknown, operation = 'getViewerCount'): number {
        this.errorStats.totalErrors++;
        const message = getErrorMessage(error);
        this.errorStats.lastError = sanitizeLogText(message);
        this.errorStats.consecutiveErrors++;

        const normalizedError = error instanceof Error ? error : new Error(message);
        const errorType = this._categorizeError(error);
        const currentCount = this.errorStats.errorTypes.get(errorType) || 0;
        this.errorStats.errorTypes.set(errorType, currentCount + 1);

        this.errorHandler.handleEventProcessingError(
            normalizedError, operation, null, `${this.platform} ${operation} failed: ${message}`
        );

        return 0;
    }

    _categorizeError(error: unknown): ProviderErrorType {
        const message = getErrorMessage(error).toLowerCase();
        const record = typeof error === 'object' && error !== null ? error as { status?: unknown; response?: { status?: unknown } } : null;
        if (record?.status === 404 || record?.response?.status === 404 || /\b404\b|not[ _-]found/.test(message)) {
            return 'resource_not_found';
        }

        if (message.includes('network') || message.includes('timeout') || message.includes('connect')) {
            return 'network';
        }
        if (message.includes('auth') || message.includes('token') || message.includes('unauthorized')) {
            return 'authentication';
        }
        if (message.includes('rate limit') || message.includes('too many requests')) {
            return 'rate_limit';
        }
        return 'unknown';
    }

    _resetErrorCount(): void {
        this.errorStats.consecutiveErrors = 0;
    }

    getErrorStats(): Omit<ProviderErrorStats, 'errorTypes'> & { errorTypes: Record<string, number> } {
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

    override isReady() {
        return typeof this.config?.channel === 'string' && this.config.channel.trim().length > 0;
    }

    override async getViewerCount(): Promise<number | null> {
        this.logger.debug('Getting Twitch viewer count...', 'viewer-count-provider');
        
        if (!this.isReady()) {
            this.logger.debug('Twitch provider not ready, viewer count unavailable', 'viewer-count-provider');
            return null;
        }

        try {
            const channel = this.config?.channel?.trim();
            if (!channel) {
                return null;
            }

            const streamInfo = await this.apiClient.getStreamInfo(channel);
            if (streamInfo.isLive !== true && streamInfo.isLive !== false) {
                throw new TypeError('Invalid Twitch stream status');
            }
            const viewerCount = streamInfo.isLive === true
                ? typeof streamInfo.viewerCount === 'number' ? parseNotificationCount(streamInfo.viewerCount) : null
                : 0;
            if (viewerCount === null) {
                throw new TypeError('Invalid Twitch viewer count');
            }
            
            this.logger.debug('Twitch stream info received', 'viewer-count-provider', {
                isLive: streamInfo.isLive,
                viewerCount: streamInfo.viewerCount
            });

            this._resetErrorCount();
            return viewerCount;
            
        } catch (error) {
            this._handleProviderError(error, 'getStreamInfo');
            return null;
        }
    }
}


class YouTubeViewerCountProvider extends ViewerCountProvider {
    config: Record<string, unknown> | null;
    viewerExtractionService: YouTubeExtractionService | null;
    getMembershipSnapshot: (() => ViewerMembershipSnapshot) | null;
    stats: {
        totalRequests: number;
        successfulRequests: number;
        startTime: number;
    };

    constructor(
        config: Record<string, unknown> | null,
        getMembershipSnapshot: (() => ViewerMembershipSnapshot) | null,
        dependencies: { viewerExtractionService?: YouTubeExtractionService; logger?: ProviderLogger } = {}
    ) {
        super('youtube', dependencies.logger);
        this.config = config;
        this.viewerExtractionService = dependencies.viewerExtractionService || null;
        this.getMembershipSnapshot = getMembershipSnapshot;
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            startTime: Date.now()
        };
    }

    override isReady() {
        return !!(this.viewerExtractionService && this.config && this.getMembershipSnapshot);
    }

    override async getViewerCount(): Promise<number | null> {
        const observation = await this.getViewerCountObservation();
        return observation.kind === 'complete' ? observation.count : null;
    }

    async getViewerCountObservation(): Promise<ViewerCountObservation> {
        this.stats.totalRequests++;
        let membership: ViewerMembershipSnapshot | undefined;
        try {
            membership = this.getMembershipSnapshot?.();
        } catch (error) {
            this._handleProviderError(error, 'getMembershipSnapshot');
            return { kind: 'unavailable', membershipGeneration: 0, reason: 'capability_missing' };
        }
        const membershipGeneration = membership?.generation ?? 0;
        const unavailable = (reason: Extract<ViewerCountObservation, { kind: 'unavailable' }>['reason']): ViewerCountObservation =>
            ({ kind: 'unavailable', membershipGeneration, reason });
        if (!membership) return unavailable('capability_missing');
        if (membership.videoIds.length === 0) {
            if (membership.availability !== 'offline') return unavailable('membership_unknown');
            this.stats.successfulRequests++;
            this._resetErrorCount();
            return { kind: 'complete', count: 0, membershipGeneration };
        }
        if (!this.isReady()) return unavailable('capability_missing');
        try {
            const extractionService = this.viewerExtractionService;
            if (!extractionService) return unavailable('capability_missing');
            const activeVideoIds = [...new Set(membership.videoIds)];
            const result = await extractionService.getAggregatedViewerCount(activeVideoIds);
            if (this.getMembershipSnapshot?.().generation !== membershipGeneration) return unavailable('membership_changed');
            if (result.success && result.successfulStreams === activeVideoIds.length && !result.failedStreams
                && Number.isSafeInteger(result.totalCount) && result.totalCount >= 0) {
                this.stats.successfulRequests++;
                this.logger.debug(`YouTube aggregation complete: ${result.totalCount} total viewers from ${result.successfulStreams}/${activeVideoIds.length} streams`, 'viewer-count-provider');
                this._resetErrorCount();
                return { kind: 'complete', count: result.totalCount, membershipGeneration };
            } else {
                this._handleProviderError(new Error('Service layer aggregation unavailable'), 'getAggregatedViewerCount');
                return unavailable('extraction_unavailable');
            }
            
        } catch (error) {
            this._handleProviderError(error, 'getAggregatedViewerCount');
            return unavailable('extraction_unavailable');
        }
    }

    async getViewerCountForVideo(videoId: string): Promise<number | null> {
        this.logger.debug(`Getting YouTube viewer count for video: ${videoId}`, 'viewer-count-provider');
        
        try {
            const extractionService = this.viewerExtractionService;
            if (!extractionService) {
                return null;
            }

            const result = await extractionService.extractViewerCount(videoId);
            if (result.success && Number.isSafeInteger(result.count) && result.count >= 0) {
                this._resetErrorCount();
                return result.count;
            } else {
                this._handleProviderError(new Error('Video extraction failed'), 'extractViewerCount');
                return null;
            }
        } catch (error) {
            this._handleProviderError(error, 'extractViewerCount');
            return null;
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

    override isReady() {
        if (!this.tiktokPlatform) return false;
        const connection = this.tiktokPlatform.connection;
        return !!(connection && connection.isConnected);
    }

    override async getViewerCount(): Promise<number> {
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
        config: Record<string, unknown> | null,
        getMembershipSnapshot: (() => ViewerMembershipSnapshot) | null,
        dependencies: { viewerExtractionService?: YouTubeExtractionService; logger?: ProviderLogger } = {}
    ) {
        return new YouTubeViewerCountProvider(config, getMembershipSnapshot, dependencies);
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
