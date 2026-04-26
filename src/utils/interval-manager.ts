import { safeSetInterval as defaultSafeSetInterval } from './timeout-validator';
import { getSystemTimestampISO } from './timestamp';

type LoggerLike = {
    debug: (message: string, scope?: string, payload?: unknown) => void;
    info: (message: string, scope?: string, payload?: unknown) => void;
    warn: (message: string, scope?: string, payload?: unknown) => void;
};

type IntervalCallback = () => void;
type IntervalType = 'generic' | 'monitoring' | 'polling' | 'keepalive' | string;

type IntervalInfo = {
    id: ReturnType<typeof globalThis.setInterval>;
    name: string;
    type: IntervalType;
    startTime: string;
    intervalMs: number;
    callback: string;
    options: Record<string, unknown>;
};

type CleanupInfo = IntervalInfo & {
    clearedAt: string;
    duration: number;
};

type IntervalHistoryRecord = IntervalInfo & {
    action: 'created';
};

type IntervalManagerDependencies = {
    safeSetInterval?: typeof defaultSafeSetInterval;
};

class IntervalManager {
    platformName: string;
    logger: LoggerLike;
    safeSetInterval: typeof defaultSafeSetInterval;
    activeIntervals: Map<string, IntervalInfo>;
    intervalHistory: IntervalHistoryRecord[];
    cleanupHistory: CleanupInfo[];
    intervalCount: number;
    totalIntervalsCreated: number;
    totalIntervalsCleaned: number;

    constructor(platformName: string, logger: LoggerLike, dependencies: IntervalManagerDependencies = {}) {
        this.platformName = platformName;
        this.logger = logger;
        this.safeSetInterval = dependencies.safeSetInterval ?? defaultSafeSetInterval;
        this.activeIntervals = new Map();
        this.intervalHistory = [];
        this.cleanupHistory = [];
        this.intervalCount = 0;
        this.totalIntervalsCreated = 0;
        this.totalIntervalsCleaned = 0;

        this.logger.debug('IntervalManager initialized', this.platformName);
    }

    createInterval(
        name: string,
        callback: IntervalCallback,
        intervalMs: number,
        type: IntervalType = 'generic',
        options: Record<string, unknown> = {}
    ): ReturnType<typeof globalThis.setInterval> {
        if (this.activeIntervals.has(name)) {
            this.logger.debug(`Cleaning up existing interval '${name}' before creating new one`, this.platformName);
            this.clearInterval(name);
        }

        if (typeof callback !== 'function') {
            throw new Error(`Invalid callback for interval '${name}': must be a function`);
        }

        if (intervalMs < 100 || intervalMs > 300000) {
            this.logger.warn(
                `Interval duration ${intervalMs}ms for '${name}' is outside recommended range (100ms-300000ms)`,
                this.platformName
            );
        }

        const intervalId = this.safeSetInterval(callback, intervalMs);
        this.totalIntervalsCreated += 1;
        this.intervalCount += 1;

        const intervalInfo: IntervalInfo = {
            id: intervalId,
            name,
            type,
            startTime: getSystemTimestampISO(),
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
            `Created ${type} interval '${name}' (${intervalMs}ms) with ID: ${String(intervalId)}`,
            this.platformName
        );

        return intervalId;
    }

    clearInterval(name: string): boolean {
        const intervalInfo = this.activeIntervals.get(name);

        if (!intervalInfo) {
            this.logger.debug(`No active interval found with name '${name}'`, this.platformName);
            return false;
        }

        globalThis.clearInterval(intervalInfo.id);
        this.totalIntervalsCleaned += 1;
        this.intervalCount -= 1;

        this.activeIntervals.delete(name);
        this.cleanupHistory.push({
            ...intervalInfo,
            clearedAt: getSystemTimestampISO(),
            duration: Date.now() - new Date(intervalInfo.startTime).getTime()
        });

        this.logger.debug(
            `Cleared ${intervalInfo.type} interval '${name}' (ID: ${String(intervalInfo.id)})`,
            this.platformName
        );

        return true;
    }

    clearAllIntervals(type: IntervalType | null = null): number {
        let clearedCount = 0;
        const intervalNames = Array.from(this.activeIntervals.keys());

        for (const name of intervalNames) {
            const intervalInfo = this.activeIntervals.get(name);
            if (!intervalInfo) {
                continue;
            }
            if (type && intervalInfo.type !== type) {
                continue;
            }

            if (this.clearInterval(name)) {
                clearedCount += 1;
            }
        }

        this.logger.debug(
            `Cleared ${clearedCount} intervals${type ? ` of type '${type}'` : ''}`,
            this.platformName
        );

        return clearedCount;
    }

    hasInterval(name: string): boolean {
        return this.activeIntervals.has(name);
    }

    getIntervalInfo(name: string): IntervalInfo | null {
        return this.activeIntervals.get(name) ?? null;
    }

    getActiveIntervals(type: IntervalType | null = null): IntervalInfo[] {
        const intervals = Array.from(this.activeIntervals.values());
        if (!type) {
            return intervals;
        }

        return intervals.filter((interval) => interval.type === type);
    }

    getStatistics(): {
        activeCount: number;
        totalCreated: number;
        totalCleaned: number;
        intervalsByType: Record<string, number>;
        platform: string;
        oldestInterval: number | null;
    } {
        const activeIntervals = Array.from(this.activeIntervals.values());
        const intervalsByType: Record<string, number> = {};

        for (const interval of activeIntervals) {
            const currentCount = intervalsByType[interval.type] ?? 0;
            intervalsByType[interval.type] = currentCount + 1;
        }

        return {
            activeCount: this.intervalCount,
            totalCreated: this.totalIntervalsCreated,
            totalCleaned: this.totalIntervalsCleaned,
            intervalsByType,
            platform: this.platformName,
            oldestInterval: activeIntervals.length > 0
                ? Math.min(...activeIntervals.map((interval) => new Date(interval.startTime).getTime()))
                : null
        };
    }

    getCleanupHistory(limit = 50): CleanupInfo[] {
        return this.cleanupHistory.slice(-limit);
    }

    createMonitoringInterval(name: string, callback: IntervalCallback, intervalMs = 60000): ReturnType<typeof globalThis.setInterval> {
        return this.createInterval(name, callback, intervalMs, 'monitoring', {
            isMonitoring: true,
            autoRestart: false
        });
    }

    createPollingInterval(name: string, callback: IntervalCallback, intervalMs = 5000): ReturnType<typeof globalThis.setInterval> {
        return this.createInterval(name, callback, intervalMs, 'polling', {
            isPolling: true,
            autoRestart: false
        });
    }

    createKeepAliveInterval(name: string, callback: IntervalCallback, intervalMs = 30000): ReturnType<typeof globalThis.setInterval> {
        return this.createInterval(name, callback, intervalMs, 'keepalive', {
            isKeepAlive: true,
            critical: true
        });
    }

    cleanup(): void {
        const clearedCount = this.clearAllIntervals();

        this.logger.info(
            `IntervalManager cleanup complete: cleared ${clearedCount} intervals`,
            this.platformName
        );

        this.intervalCount = 0;
    }

    getHealthCheck(): {
        healthy: boolean;
        activeCount: number;
        longRunningCount: number;
        longRunningIntervals: Array<{ name: string; type: string; runtime: number }>;
        memoryEfficient: boolean;
    } {
        const activeIntervals = this.getActiveIntervals();
        const now = Date.now();

        const longRunningIntervals = activeIntervals.filter((interval) => {
            const runtime = now - new Date(interval.startTime).getTime();
            return runtime > 3600000;
        });

        return {
            healthy: longRunningIntervals.length === 0,
            activeCount: this.intervalCount,
            longRunningCount: longRunningIntervals.length,
            longRunningIntervals: longRunningIntervals.map((interval) => ({
                name: interval.name,
                type: interval.type,
                runtime: now - new Date(interval.startTime).getTime()
            })),
            memoryEfficient: this.intervalCount < 20
        };
    }
}

export { IntervalManager };
