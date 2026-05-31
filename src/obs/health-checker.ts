
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
        this.cacheTimeout = config.cacheTimeout || 2000;
        this.maxFailures = config.maxFailures || 3;
        this.timeProvider = typeof config.timeProvider === 'function' ? config.timeProvider : Date.now;
        
        this.lastCheck = null;
        this.lastResult = null;
        this.consecutiveFailures = 0;
    }

    async isReady(): Promise<boolean> {
        if (!this.obsManager.isConnected()) {
            return this.updateCache(false);
        }

        if (this.isCacheValid() && this.lastResult === true) {
            return this.lastResult;
        }

        return await this.performHealthCheck();
    }

    async performHealthCheck(): Promise<boolean> {
        try {
            await this.obsManager.call('GetVersion', {});
            
            this.consecutiveFailures = 0;
            return this.updateCache(true);
            
        } catch {
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
