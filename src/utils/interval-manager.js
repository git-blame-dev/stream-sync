const timeoutValidator = require('./timeout-validator');

class IntervalManager {
    constructor(platformName, logger, dependencies = {}) {
        this.platformName = platformName;
        this.logger = logger;
        this.safeSetInterval = dependencies.safeSetInterval || timeoutValidator.safeSetInterval;

        this.activeIntervals = new Map();
        this.intervalHistory = [];
        this.cleanupHistory = [];

        this.intervalCount = 0;
        this.totalIntervalsCreated = 0;
        this.totalIntervalsCleaned = 0;

        this.logger.debug('IntervalManager initialized', this.platformName);
    }
    
    createInterval(name, callback, intervalMs, type = 'generic', options = {}) {
        // Clean up existing interval with same name
        if (this.activeIntervals.has(name)) {
            this.logger.debug(`Cleaning up existing interval '${name}' before creating new one`, this.platformName);
            this.clearInterval(name);
        }
        
        // Validate parameters
        if (typeof callback !== 'function') {
            throw new Error(`Invalid callback for interval '${name}': must be a function`);
        }
        
        if (intervalMs < 100 || intervalMs > 300000) { // 100ms to 5 minutes
            this.logger.warn(
                `Interval duration ${intervalMs}ms for '${name}' is outside recommended range (100ms-300000ms)`,
                this.platformName
            );
        }
        
        const intervalId = this.safeSetInterval(callback, intervalMs);
        this.totalIntervalsCreated++;
        this.intervalCount++;
        
        // Register interval
        const intervalInfo = {
            id: intervalId,
            name,
            type,
            startTime: new Date().toISOString(),
            intervalMs,
            callback: callback.name || 'anonymous',
            options
        };
        
        this.activeIntervals.set(name, intervalInfo);
        this.intervalHistory.push({
            ...intervalInfo,
            action: 'created'
        });
        
        this.logger.debug(
            `Created ${type} interval '${name}' (${intervalMs}ms) with ID: ${intervalId}`,
            this.platformName
        );
        
        return intervalId;
    }
    
    clearInterval(name) {
        const intervalInfo = this.activeIntervals.get(name);
        
        if (!intervalInfo) {
            this.logger.debug(`No active interval found with name '${name}'`, this.platformName);
            return false;
        }
        
        // Clear the interval
        clearInterval(intervalInfo.id);
        this.totalIntervalsCleaned++;
        this.intervalCount--;
        
        // Update tracking
        this.activeIntervals.delete(name);
        this.cleanupHistory.push({
            ...intervalInfo,
            clearedAt: new Date().toISOString(),
            duration: Date.now() - new Date(intervalInfo.startTime).getTime()
        });
        
        this.logger.debug(
            `Cleared ${intervalInfo.type} interval '${name}' (ID: ${intervalInfo.id})`,
            this.platformName
        );
        
        return true;
    }
    
    clearAllIntervals(type = null) {
        let clearedCount = 0;
        const intervalNames = Array.from(this.activeIntervals.keys());
        
        for (const name of intervalNames) {
            const intervalInfo = this.activeIntervals.get(name);
            
            // Skip if type filter specified and doesn't match
            if (type && intervalInfo.type !== type) {
                continue;
            }
            
            if (this.clearInterval(name)) {
                clearedCount++;
            }
        }
        
        this.logger.debug(
            `Cleared ${clearedCount} intervals${type ? ` of type '${type}'` : ''}`,
            this.platformName
        );
        
        return clearedCount;
    }
    
    hasInterval(name) {
        return this.activeIntervals.has(name);
    }
    
    getIntervalInfo(name) {
        return this.activeIntervals.get(name) || null;
    }
    
    getActiveIntervals(type = null) {
        const intervals = Array.from(this.activeIntervals.values());
        
        if (type) {
            return intervals.filter(interval => interval.type === type);
        }
        
        return intervals;
    }
    
    getStatistics() {
        const activeIntervals = Array.from(this.activeIntervals.values());
        const intervalsByType = {};
        
        // Group by type
        for (const interval of activeIntervals) {
            if (!intervalsByType[interval.type]) {
                intervalsByType[interval.type] = 0;
            }
            intervalsByType[interval.type]++;
        }
        
        return {
            activeCount: this.intervalCount,
            totalCreated: this.totalIntervalsCreated,
            totalCleaned: this.totalIntervalsCleaned,
            intervalsByType,
            platform: this.platformName,
            oldestInterval: activeIntervals.length > 0 
                ? Math.min(...activeIntervals.map(i => new Date(i.startTime).getTime()))
                : null
        };
    }
    
    getCleanupHistory(limit = 50) {
        return this.cleanupHistory.slice(-limit);
    }
    
    createMonitoringInterval(name, callback, intervalMs = 60000) {
        return this.createInterval(name, callback, intervalMs, 'monitoring', {
            isMonitoring: true,
            autoRestart: false
        });
    }
    
    createPollingInterval(name, callback, intervalMs = 5000) {
        return this.createInterval(name, callback, intervalMs, 'polling', {
            isPolling: true,
            autoRestart: false
        });
    }
    
    createKeepAliveInterval(name, callback, intervalMs = 30000) {
        return this.createInterval(name, callback, intervalMs, 'keepalive', {
            isKeepAlive: true,
            critical: true
        });
    }
    
    cleanup() {
        const clearedCount = this.clearAllIntervals();
        
        this.logger.info(
            `IntervalManager cleanup complete: cleared ${clearedCount} intervals`,
            this.platformName
        );
        
        // Reset counters for fresh start
        this.intervalCount = 0;
    }
    
    getHealthCheck() {
        const activeIntervals = this.getActiveIntervals();
        const now = Date.now();
        
        // Check for long-running intervals (over 1 hour)
        const longRunningIntervals = activeIntervals.filter(interval => {
            const runtime = now - new Date(interval.startTime).getTime();
            return runtime > 3600000; // 1 hour
        });
        
        return {
            healthy: longRunningIntervals.length === 0,
            activeCount: this.intervalCount,
            longRunningCount: longRunningIntervals.length,
            longRunningIntervals: longRunningIntervals.map(i => ({
                name: i.name,
                type: i.type,
                runtime: now - new Date(i.startTime).getTime()
            })),
            memoryEfficient: this.intervalCount < 20 // Arbitrary threshold
        };
    }
}

module.exports = {
    IntervalManager
};
