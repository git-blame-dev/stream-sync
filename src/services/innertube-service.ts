import { createPlatformErrorHandler } from '../utils/platform-error-handler';

type LoggerLike = {
    error: (message: string, scope?: string, payload?: unknown) => void;
    debug?: (message: string, scope?: string, payload?: unknown) => void;
};

type InnertubeInfoClient = {
    getInfo: (videoId: string, options?: Record<string, unknown>) => Promise<unknown>;
};

type InnertubeFactoryLike = {
    createWithTimeout: (timeoutMs?: number) => Promise<InnertubeInfoClient>;
};

type TimeoutWrapper = <T>(promise: Promise<T>, timeoutMs: number, operationName: string) => Promise<T>;

type CachedInnertubeInstance = {
    instance: InnertubeInfoClient;
    created: number;
    lastUsed: number;
};

type ServiceStats = {
    instancesCreated: number;
    cacheHits: number;
    cacheMisses: number;
    errors: number;
    startTime: number;
};

class InnertubeService {
    factory: InnertubeFactoryLike;
    logger: LoggerLike;
    withTimeout?: TimeoutWrapper;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    instanceCache: Map<string, CachedInnertubeInstance>;
    lastCleanup: number;
    cleanupInterval: number;
    stats: ServiceStats;

    constructor(factory: InnertubeFactoryLike, dependencies: { logger: LoggerLike; withTimeout?: TimeoutWrapper; cleanupInterval?: number }) {
        this.factory = factory;
        if (!dependencies.logger || typeof dependencies.logger.error !== 'function') {
            throw new Error('InnertubeService requires a logger');
        }

        this.logger = dependencies.logger;
        this.withTimeout = dependencies.withTimeout;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'innertube-service');

        this.instanceCache = new Map();
        this.lastCleanup = Date.now();
        this.cleanupInterval = dependencies.cleanupInterval || 300000;

        this.stats = {
            instancesCreated: 0,
            cacheHits: 0,
            cacheMisses: 0,
            errors: 0,
            startTime: Date.now()
        };
    }

    async getSharedInstance(key = 'shared') {
        try {
            this._periodicCleanup();

            if (this.instanceCache.has(key)) {
                this.stats.cacheHits += 1;
                this.logger.debug?.(`[InnertubeService] Using cached instance: ${key}`, 'innertube-service');
                const cached = this.instanceCache.get(key);
                if (cached) {
                    return cached.instance;
                }
            }

            this.stats.cacheMisses += 1;
            this.logger.debug?.(`[InnertubeService] Creating new instance: ${key}`, 'innertube-service');

            const instance = await this.factory.createWithTimeout(10000);

            this.instanceCache.set(key, {
                instance,
                created: Date.now(),
                lastUsed: Date.now()
            });

            this.stats.instancesCreated += 1;
            this.logger.debug?.(`[InnertubeService] Cached new instance: ${key}`, 'innertube-service');

            return instance;
        } catch (error) {
            this.stats.errors += 1;
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._logServiceError(`[InnertubeService] Failed to get instance: ${errorMessage}`, error);
            throw new Error(`InnertubeService instance creation failed: ${errorMessage}`);
        }
    }

    async getVideoInfo(videoId: string, options: { instanceKey?: string; timeout?: number; [key: string]: unknown } = {}) {
        try {
            const yt = await this.getSharedInstance(options.instanceKey);

            const cached = this.instanceCache.get(options.instanceKey || 'shared');
            if (cached) {
                cached.lastUsed = Date.now();
            }

            const requestOptions: Record<string, unknown> = { client: 'WEB', ...options };
            if (this.withTimeout) {
                return await this.withTimeout(
                    yt.getInfo(videoId, requestOptions),
                    options.timeout || 8000,
                    'YouTube getInfo call'
                );
            }

            return await yt.getInfo(videoId, requestOptions);
        } catch (error) {
            this.stats.errors += 1;
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.debug?.(`[InnertubeService] getVideoInfo failed for ${videoId}: ${errorMessage}`, 'innertube-service');
            throw error;
        }
    }

    getStats() {
        return {
            ...this.stats,
            cachedInstances: this.instanceCache.size,
            uptime: Date.now() - this.stats.startTime
        };
    }

    cleanup(maxAge = 600000) {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, cached] of this.instanceCache.entries()) {
            if (now - cached.lastUsed > maxAge) {
                this.instanceCache.delete(key);
                cleaned += 1;
            }
        }

        if (cleaned > 0) {
            this.logger.debug?.(`[InnertubeService] Cleaned up ${cleaned} old instances`, 'innertube-service');
        }

        this.lastCleanup = now;
    }

    dispose() {
        this.instanceCache.clear();
        this.logger.debug?.('[InnertubeService] All instances disposed', 'innertube-service');
    }

    _periodicCleanup() {
        const now = Date.now();
        if (now - this.lastCleanup > this.cleanupInterval) {
            this.cleanup();
        }
    }

    _logServiceError(message: string, error: unknown = null, payload: Record<string, unknown> | null = null) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'innertube-service', payload, message);
        } else if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'innertube-service', payload || error);
        }
    }
}

export { InnertubeService };
