
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

class InnertubeService {
    constructor(factory, dependencies = {}) {
        this.factory = factory;
        if (!dependencies.logger || typeof dependencies.logger.error !== 'function') {
            throw new Error('InnertubeService requires a logger');
        }
        this.logger = dependencies.logger;
        this.withTimeout = dependencies.withTimeout;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'innertube-service');
        
        // Instance cache for performance
        this.instanceCache = new Map();
        this.lastCleanup = Date.now();
        this.cleanupInterval = dependencies.cleanupInterval || 300000; // 5 minutes
        
        // Statistics for monitoring
        this.stats = {
            instancesCreated: 0,
            cacheHits: 0,
            cacheMisses: 0,
            errors: 0
        };
    }
    
    async getSharedInstance(key = 'shared') {
        try {
            // Clean up old instances periodically
            this._periodicCleanup();
            
            if (this.instanceCache.has(key)) {
                this.stats.cacheHits++;
                this.logger?.debug(`[InnertubeService] Using cached instance: ${key}`, 'innertube-service');
                return this.instanceCache.get(key).instance;
            }
            
            this.stats.cacheMisses++;
            this.logger?.debug(`[InnertubeService] Creating new instance: ${key}`, 'innertube-service');
            
            // Create new instance with timeout protection
            const instance = await this.factory.createWithTimeout(10000);
            
            // Cache with metadata
            this.instanceCache.set(key, {
                instance,
                created: Date.now(),
                lastUsed: Date.now()
            });
            
            this.stats.instancesCreated++;
            this.logger?.debug(`[InnertubeService] Cached new instance: ${key}`, 'innertube-service');
            
            return instance;
            
        } catch (error) {
            this.stats.errors++;
            this._logServiceError(`[InnertubeService] Failed to get instance: ${error.message}`, error);
            throw new Error(`InnertubeService instance creation failed: ${error.message}`);
        }
    }
    
    async getVideoInfo(videoId, options = {}) {
        try {
            const yt = await this.getSharedInstance(options.instanceKey);
            
            // Mark instance as recently used
            const cached = this.instanceCache.get(options.instanceKey || 'shared');
            if (cached) {
                cached.lastUsed = Date.now();
            }
            
            // Use timeout wrapper if available
            if (this.withTimeout) {
                return await this.withTimeout(
                    yt.getInfo(videoId, { client: 'WEB', ...options }),
                    options.timeout || 8000,
                    'YouTube getInfo call'
                );
            } else {
                return await yt.getInfo(videoId, { client: 'WEB', ...options });
            }
            
        } catch (error) {
            this.stats.errors++;
            this.logger?.debug(`[InnertubeService] getVideoInfo failed for ${videoId}: ${error.message}`, 'innertube-service');
            throw error;
        }
    }
    
    getStats() {
        return {
            ...this.stats,
            cachedInstances: this.instanceCache.size,
            uptime: Date.now() - (this.stats.startTime || Date.now())
        };
    }
    
    cleanup(maxAge = 600000) {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [key, cached] of this.instanceCache.entries()) {
            if (now - cached.lastUsed > maxAge) {
                this.instanceCache.delete(key);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            this.logger?.debug(`[InnertubeService] Cleaned up ${cleaned} old instances`, 'innertube-service');
        }
        
        this.lastCleanup = now;
    }
    
    dispose() {
        this.instanceCache.clear();
        this.logger?.debug('[InnertubeService] All instances disposed', 'innertube-service');
    }
    
    _periodicCleanup() {
        const now = Date.now();
        if (now - this.lastCleanup > this.cleanupInterval) {
            this.cleanup();
        }
    }

    _logServiceError(message, error = null, payload = null) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'innertube-service', payload, message);
        } else if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'innertube-service', payload || error);
        }
    }
}

module.exports = { InnertubeService };
