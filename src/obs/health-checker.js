
class OBSHealthChecker {
    constructor(obsConnectionManager, config = {}) {
        if (!obsConnectionManager) {
            throw new Error('OBS connection manager is required');
        }
        
        this.obsManager = obsConnectionManager;
        this.cacheTimeout = config.cacheTimeout || 2000; // 2 seconds
        this.maxFailures = config.maxFailures || 3; // 3 failures
        
        // Health check state
        this.lastCheck = null;
        this.lastResult = null;
        this.consecutiveFailures = 0;
    }

    async isReady() {
        // Quick check - if not connected, definitely not ready
        if (!this.obsManager.isConnected()) {
            return this.updateCache(false);
        }

        // Use cached result if available and valid (but only for successful results)
        if (this.isCacheValid() && this.lastResult === true) {
            return this.lastResult;
        }

        // Perform actual health check
        return await this.performHealthCheck();
    }

    async performHealthCheck() {
        try {
            // Use GetVersion as a lightweight test call
            await this.obsManager.call('GetVersion', {});
            
            // Success - reset failure counter and cache result
            this.consecutiveFailures = 0;
            return this.updateCache(true);
            
        } catch {
            // Failure - increment counter and cache result
            this.consecutiveFailures++;
            return this.updateCache(false);
        }
    }

    isCacheValid() {
        return this.lastCheck !== null && (Date.now() - this.lastCheck) < this.cacheTimeout;
    }

    updateCache(result) {
        this.lastCheck = Date.now();
        this.lastResult = result;
        return result;
    }

    isCircuitOpen() {
        return this.consecutiveFailures >= this.maxFailures;
    }

    invalidateCache() {
        this.lastCheck = null;
        this.lastResult = null;
    }
}

module.exports = OBSHealthChecker; 
