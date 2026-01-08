
const { validateTimeout, safeSetInterval } = require('../utils/timeout-validator');
const { logger } = require('../core/logging');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

const innertubeManagerErrorHandler = createPlatformErrorHandler(logger, 'innertube-manager');

let defaultRuntimeConstants = null;

function resolveRuntimeConstants(runtimeConstants) {
    const resolved = runtimeConstants
        || defaultRuntimeConstants
        || (process.env.NODE_ENV === 'test' ? global.__TEST_RUNTIME_CONSTANTS__ : null);
    if (!resolved || !resolved.PLATFORM_TIMEOUTS) {
        throw new Error('InnertubeInstanceManager requires runtimeConstants.PLATFORM_TIMEOUTS');
    }
    return resolved;
}

function resolveInstanceTimeout(explicitTimeout, runtimeConstants) {
    const { PLATFORM_TIMEOUTS } = runtimeConstants;
    const candidate = explicitTimeout ?? PLATFORM_TIMEOUTS.INNERTUBE_INSTANCE_TTL;

    const validatedTimeout = validateTimeout(
        candidate,
        PLATFORM_TIMEOUTS.INNERTUBE_MIN_TTL,
        'innertube-instance-timeout'
    );

    return Math.max(validatedTimeout, PLATFORM_TIMEOUTS.INNERTUBE_MIN_TTL);
}

function handleInnertubeManagerError(message, error, eventType = 'innertube') {
    if (error instanceof Error) {
        innertubeManagerErrorHandler.handleEventProcessingError(error, eventType, null, message);
    } else {
        innertubeManagerErrorHandler.logOperationalError(message, 'youtube', error);
    }
}

class InnertubeInstanceManager {
    constructor(options = {}) {
        this.runtimeConstants = resolveRuntimeConstants(options.runtimeConstants);
        this.activeInstances = new Map(); // key: identifier, value: instance + metadata
        this.maxInstances = 2; // Limit concurrent instances
        this.instanceTimeout = resolveInstanceTimeout(options.instanceTimeout, this.runtimeConstants);
        this.cleanupInterval = null;
        this.disposed = false;
        
        this._startCleanupMonitoring();
    }
    
    async getInstance(identifier = 'default', createFunction = null) {
        if (this.disposed) {
            throw new Error('InnertubeInstanceManager has been disposed');
        }
        
        // Check if we have a healthy cached instance
        const cached = this._getCachedInstance(identifier);
        if (cached && this._isInstanceHealthy(cached)) {
            logger.debug(`[InnertubeManager] Reusing cached instance: ${identifier}`, 'youtube');
            this._updateInstanceAccess(identifier);
            return cached.instance;
        }
        
        // Check instance limits
        if (this.activeInstances.size >= this.maxInstances) {
            logger.warn(`[InnertubeManager] Maximum instances reached (${this.maxInstances}), cleaning up oldest`, 'youtube');
            await this._cleanupOldestInstance();
        }
        
        // Create new instance
        try {
            logger.debug(`[InnertubeManager] Creating new Innertube instance: ${identifier}`, 'youtube');
            
            if (!createFunction) {
                // Default Innertube creation
                const { Innertube } = await import('youtubei.js');
                const instance = await Innertube.create();
                return this._cacheInstance(identifier, instance);
            } else {
                const instance = await createFunction();
                return this._cacheInstance(identifier, instance);
            }
        } catch (error) {
            handleInnertubeManagerError(`[InnertubeManager] Failed to create Innertube instance: ${identifier}`, error, 'create-instance');
            throw new Error(`Failed to create Innertube instance: ${error.message}`);
        }
    }
    
    markInstanceUnhealthy(identifier, error = null) {
        const cached = this.activeInstances.get(identifier);
        if (cached) {
            cached.healthy = false;
            cached.error = error;
            logger.warn(`[InnertubeManager] Marked instance as unhealthy: ${identifier}`, 'youtube', error);
        }
    }
    
    async disposeInstance(identifier) {
        const cached = this.activeInstances.get(identifier);
        if (cached) {
            await this._disposeInstanceSafely(cached.instance);
            this.activeInstances.delete(identifier);
            logger.debug(`[InnertubeManager] Disposed instance: ${identifier}`, 'youtube');
        }
    }
    
    async cleanup() {
        if (this.disposed) return;
        
        logger.info('[InnertubeManager] Cleaning up all instances', 'youtube');
        
        // Stop cleanup monitoring
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        
        // Dispose all instances
        const disposePromises = Array.from(this.activeInstances.values()).map(cached => 
            this._disposeInstanceSafely(cached.instance)
        );
        
        await Promise.allSettled(disposePromises);
        this.activeInstances.clear();
        this.disposed = true;
        
        logger.info('[InnertubeManager] Cleanup completed', 'youtube');
    }
    
    getStats() {
        return {
            activeInstances: this.activeInstances.size,
            maxInstances: this.maxInstances,
            instanceDetails: Array.from(this.activeInstances.entries()).map(([id, cached]) => ({
                identifier: id,
                healthy: cached.healthy,
                lastAccessed: cached.lastAccessed,
                age: Date.now() - cached.created
            }))
        };
    }
    
    // Private methods
    
    _getCachedInstance(identifier) {
        return this.activeInstances.get(identifier);
    }
    
    _isInstanceHealthy(cached) {
        if (!cached.healthy) return false;
        
        // Check if instance is too old
        const age = Date.now() - cached.created;
        if (age > this.instanceTimeout) {
            return false;
        }
        
        return true;
    }
    
    _updateInstanceAccess(identifier) {
        const cached = this.activeInstances.get(identifier);
        if (cached) {
            cached.lastAccessed = Date.now();
        }
    }
    
    _cacheInstance(identifier, instance) {
        const cached = {
            instance,
            created: Date.now(),
            lastAccessed: Date.now(),
            healthy: true,
            error: null
        };
        
        this.activeInstances.set(identifier, cached);
        logger.debug(`[InnertubeManager] Cached new instance: ${identifier}`, 'youtube');
        
        return instance;
    }
    
    async _cleanupOldestInstance() {
        let oldest = null;
        let oldestTime = Date.now();
        
        for (const [id, cached] of this.activeInstances.entries()) {
            if (cached.lastAccessed < oldestTime) {
                oldest = id;
                oldestTime = cached.lastAccessed;
            }
        }
        
        if (oldest) {
            await this.disposeInstance(oldest);
        }
    }
    
    async _disposeInstanceSafely(instance) {
        try {
            if (instance && typeof instance.session?.close === 'function') {
                await instance.session.close();
            }
            if (instance && typeof instance.dispose === 'function') {
                await instance.dispose();
            }
        } catch (error) {
            logger.warn('[InnertubeManager] Error during instance disposal', 'youtube', error);
        }
    }
    
    _startCleanupMonitoring() {
        const cleanupInterval = validateTimeout(30000, 30000); // 30 second intervals
        
        this.cleanupInterval = safeSetInterval(() => {
            this._performPeriodicCleanup();
        }, cleanupInterval);
    }
    
    async _performPeriodicCleanup() {
        const now = Date.now();
        const expiredInstances = [];
        
        for (const [id, cached] of this.activeInstances.entries()) {
            if (!this._isInstanceHealthy(cached) || (now - cached.lastAccessed) > this.instanceTimeout) {
                expiredInstances.push(id);
            }
        }
        
        for (const id of expiredInstances) {
            await this.disposeInstance(id);
        }
        
        if (expiredInstances.length > 0) {
            logger.debug(`[InnertubeManager] Cleaned up ${expiredInstances.length} expired instances`, 'youtube');
        }
    }
}

// Singleton instance
let instance = null;

module.exports = {
    setRuntimeConstants(runtimeConstants) {
        defaultRuntimeConstants = runtimeConstants;
    },

    getInstance(options = {}) {
        const resolvedRuntimeConstants = resolveRuntimeConstants(options.runtimeConstants);
        if (!instance) {
            instance = new InnertubeInstanceManager({
                ...options,
                runtimeConstants: resolvedRuntimeConstants
            });
        }
        return instance;
    },
    
    async cleanup() {
        if (instance) {
            await instance.cleanup();
            instance = null;
        }
    },
    
    // For testing
    _resetInstance() {
        instance = null;
    }
};
