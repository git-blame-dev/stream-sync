
class OBSHealthChecker {
    obsManager: {
        isConnected: () => boolean;
        call: (requestType: string, payload: Record<string, unknown>) => Promise<unknown>;
    };
    cacheTimeout: number;
    maxFailures: number;
    timeProvider: () => number;
    lastCheck: number | null;
    lastResult: boolean | null;
    consecutiveFailures: number;

    constructor(obsConnectionManager: {
        isConnected: () => boolean;
        call: (requestType: string, payload: Record<string, unknown>) => Promise<unknown>;
    }, config: { cacheTimeout?: number; maxFailures?: number; timeProvider?: () => number } = {}) {
        if (!obsConnectionManager) {
            throw new Error('OBS connection manager is required');
        }
        
        this.obsManager = obsConnectionManager;
        this.cacheTimeout = config.cacheTimeout || 2000; // 2 seconds
        this.maxFailures = config.maxFailures || 3; // 3 failures
        this.timeProvider = typeof config.timeProvider === 'function' ? config.timeProvider : Date.now;
        
        // Health check state
        this.lastCheck = null;
        this.lastResult = null;
        this.consecutiveFailures = 0;
    }

    async isReady(): Promise<boolean> {
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

    async performHealthCheck(): Promise<boolean> {
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

    isCacheValid(): boolean {
        return this.lastCheck !== null && (this.timeProvider() - this.lastCheck) < this.cacheTimeout;
    }

    updateCache(result: boolean): boolean {
        this.lastCheck = this.timeProvider();
        this.lastResult = result;
        return result;
    }

    isCircuitOpen(): boolean {
        return this.consecutiveFailures >= this.maxFailures;
    }

    invalidateCache(): void {
        this.lastCheck = null;
        this.lastResult = null;
    }
}

export { OBSHealthChecker }; 
