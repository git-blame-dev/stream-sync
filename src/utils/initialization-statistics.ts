import { randomUUID } from 'node:crypto';
import { createPlatformErrorHandler } from './platform-error-handler';

type LoggerLike = {
    debug: (message: string, scope?: string, payload?: unknown) => void;
    info: (message: string, scope?: string, payload?: unknown) => void;
    warn: (message: string, scope?: string, payload?: unknown) => void;
};

type AttemptMetrics = {
    connectionTime?: number;
    serviceInitTime?: number;
    configValidationTime?: number;
    dependencyTime?: number;
};

type TimingData = {
    attemptId: string;
    duration: number;
    startTime: number;
    endTime: number;
    success: boolean;
    metrics?: AttemptMetrics;
    error?: ErrorRecord;
};

type ErrorRecord = {
    attemptId: string;
    duration: number;
    timestamp: number;
    errorType: string;
    errorMessage: string;
    context: Record<string, unknown>;
    consecutiveFailure: number;
};

type PerformanceBuckets = {
    connectionEstablishmentTime: number[];
    serviceInitializationTime: number[];
    configurationValidationTime: number[];
    dependencyResolutionTime: number[];
};

type PerformanceSummary = {
    average: number;
    count: number;
    min: number | null;
    max: number | null;
};

function resolveErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    const candidate = error as { message?: unknown } | null;
    if (candidate && typeof candidate.message === 'string') {
        return candidate.message;
    }

    return 'Unknown error';
}

function resolveErrorType(error: unknown): string {
    const candidate = error as { constructor?: { name?: unknown } } | null;
    return candidate?.constructor && typeof candidate.constructor.name === 'string'
        ? candidate.constructor.name
        : 'UnknownError';
}

class InitializationStatistics {
    platformName: string;
    logger: LoggerLike;
    errorHandler: ReturnType<typeof createPlatformErrorHandler> | null;
    totalAttempts: number;
    successfulAttempts: number;
    failedAttempts: number;
    preventedAttempts: number;
    timingHistory: TimingData[];
    totalInitializationTime: number;
    averageInitializationTime: number;
    fastestInitialization: { duration: number; timestamp: number; attemptId: string } | null;
    slowestInitialization: { duration: number; timestamp: number; attemptId: string } | null;
    errorHistory: ErrorRecord[];
    errorTypes: Map<string, number>;
    consecutiveFailures: number;
    lastSuccessTime: number | null;
    performanceMetrics: PerformanceBuckets;
    firstInitializationTime: number | null;
    lastInitializationTime: number | null;
    isCurrentlyInitializing: boolean;
    currentAttemptStartTime: number | null;

    constructor(platformName: string, logger: LoggerLike) {
        this.platformName = platformName;
        this.logger = logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, platformName || 'initialization');
        this.totalAttempts = 0;
        this.successfulAttempts = 0;
        this.failedAttempts = 0;
        this.preventedAttempts = 0;
        this.timingHistory = [];
        this.totalInitializationTime = 0;
        this.averageInitializationTime = 0;
        this.fastestInitialization = null;
        this.slowestInitialization = null;
        this.errorHistory = [];
        this.errorTypes = new Map();
        this.consecutiveFailures = 0;
        this.lastSuccessTime = null;
        this.performanceMetrics = {
            connectionEstablishmentTime: [],
            serviceInitializationTime: [],
            configurationValidationTime: [],
            dependencyResolutionTime: []
        };
        this.firstInitializationTime = null;
        this.lastInitializationTime = null;
        this.isCurrentlyInitializing = false;
        this.currentAttemptStartTime = null;

        this.logger.debug('InitializationStatistics tracker created', this.platformName);
    }

    startInitializationAttempt(metadata: Record<string, unknown> = {}): string {
        const startTime = Date.now();
        const attemptId = `${this.platformName}-${startTime}-${randomUUID()}`;

        this.totalAttempts += 1;
        this.isCurrentlyInitializing = true;
        this.currentAttemptStartTime = startTime;

        if (!this.firstInitializationTime) {
            this.firstInitializationTime = this.currentAttemptStartTime;
        }

        this.logger.debug(
            `Starting initialization attempt ${this.totalAttempts} (ID: ${attemptId})`,
            this.platformName,
            metadata
        );

        return attemptId;
    }

    recordSuccess(attemptId: string, metrics: AttemptMetrics = {}): void {
        if (!this.isCurrentlyInitializing || this.currentAttemptStartTime === null) {
            this.logger.warn('recordSuccess called but no active initialization attempt', this.platformName);
            return;
        }

        const endTime = Date.now();
        const duration = endTime - this.currentAttemptStartTime;

        this.successfulAttempts += 1;
        this.consecutiveFailures = 0;
        this.lastSuccessTime = endTime;
        this.lastInitializationTime = endTime;
        this.isCurrentlyInitializing = false;
        this.totalInitializationTime += duration;
        this.averageInitializationTime = this.totalInitializationTime / this.successfulAttempts;

        if (!this.fastestInitialization || duration < this.fastestInitialization.duration) {
            this.fastestInitialization = { duration, timestamp: endTime, attemptId };
        }

        if (!this.slowestInitialization || duration > this.slowestInitialization.duration) {
            this.slowestInitialization = { duration, timestamp: endTime, attemptId };
        }

        const timingData: TimingData = {
            attemptId,
            duration,
            startTime: this.currentAttemptStartTime,
            endTime,
            success: true,
            metrics
        };

        this.timingHistory.push(timingData);

        if (metrics.connectionTime) {
            this.performanceMetrics.connectionEstablishmentTime.push(metrics.connectionTime);
        }
        if (metrics.serviceInitTime) {
            this.performanceMetrics.serviceInitializationTime.push(metrics.serviceInitTime);
        }
        if (metrics.configValidationTime) {
            this.performanceMetrics.configurationValidationTime.push(metrics.configValidationTime);
        }
        if (metrics.dependencyTime) {
            this.performanceMetrics.dependencyResolutionTime.push(metrics.dependencyTime);
        }

        this.logger.info(
            `Initialization successful in ${duration}ms (attempt ${this.totalAttempts})`,
            this.platformName
        );

        if (this.timingHistory.length > 100) {
            this.timingHistory = this.timingHistory.slice(-100);
        }
    }

    recordFailure(attemptId: string, error: unknown, context: Record<string, unknown> = {}): void {
        if (!this.isCurrentlyInitializing || this.currentAttemptStartTime === null) {
            this.logger.warn('recordFailure called but no active initialization attempt', this.platformName);
            return;
        }

        const endTime = Date.now();
        const duration = endTime - this.currentAttemptStartTime;

        this.failedAttempts += 1;
        this.consecutiveFailures += 1;
        this.lastInitializationTime = endTime;
        this.isCurrentlyInitializing = false;

        const errorType = resolveErrorType(error);
        this.errorTypes.set(errorType, (this.errorTypes.get(errorType) ?? 0) + 1);

        const errorData: ErrorRecord = {
            attemptId,
            duration,
            timestamp: endTime,
            errorType,
            errorMessage: resolveErrorMessage(error),
            context,
            consecutiveFailure: this.consecutiveFailures
        };

        this.errorHistory.push(errorData);
        this.timingHistory.push({
            attemptId,
            duration,
            startTime: this.currentAttemptStartTime,
            endTime,
            success: false,
            error: errorData
        });

        this.handleInitializationError(
            `Initialization failed after ${duration}ms (attempt ${this.totalAttempts}, consecutive failures: ${this.consecutiveFailures}): ${resolveErrorMessage(error)}`,
            error,
            { attemptId, errorType }
        );

        if (this.errorHistory.length > 50) {
            this.errorHistory = this.errorHistory.slice(-50);
        }
    }

    recordPreventedAttempt(reason: string): void {
        this.preventedAttempts += 1;

        this.logger.debug(
            `Initialization attempt prevented: ${reason} (total prevented: ${this.preventedAttempts})`,
            this.platformName
        );
    }

    getStatistics(): {
        totalAttempts: number;
        successfulAttempts: number;
        failedAttempts: number;
        preventedAttempts: number;
        successRate: number;
        consecutiveFailures: number;
        averageInitializationTime: number;
        totalInitializationTime: number;
        fastestInitialization: { duration: number; timestamp: number; attemptId: string } | null;
        slowestInitialization: { duration: number; timestamp: number; attemptId: string } | null;
        firstInitializationTime: number | null;
        lastInitializationTime: number | null;
        lastSuccessTime: number | null;
        timeSinceLastSuccess: number | null;
        errorTypes: Record<string, number>;
        recentErrors: ErrorRecord[];
        performanceMetrics: Record<string, PerformanceSummary>;
        isHealthy: boolean;
        platform: string;
    } {
        const now = Date.now();
        const successRate = this.totalAttempts > 0 ? (this.successfulAttempts / this.totalAttempts) * 100 : 0;

        return {
            totalAttempts: this.totalAttempts,
            successfulAttempts: this.successfulAttempts,
            failedAttempts: this.failedAttempts,
            preventedAttempts: this.preventedAttempts,
            successRate,
            consecutiveFailures: this.consecutiveFailures,
            averageInitializationTime: this.averageInitializationTime,
            totalInitializationTime: this.totalInitializationTime,
            fastestInitialization: this.fastestInitialization,
            slowestInitialization: this.slowestInitialization,
            firstInitializationTime: this.firstInitializationTime,
            lastInitializationTime: this.lastInitializationTime,
            lastSuccessTime: this.lastSuccessTime,
            timeSinceLastSuccess: this.lastSuccessTime ? now - this.lastSuccessTime : null,
            errorTypes: Object.fromEntries(this.errorTypes),
            recentErrors: this.errorHistory.slice(-10),
            performanceMetrics: this.calculatePerformanceAverages(),
            isHealthy: successRate >= 80 && this.consecutiveFailures < 3,
            platform: this.platformName
        };
    }

    getTimingHistory(limit = 20): TimingData[] {
        return this.timingHistory.slice(-limit);
    }

    getErrorAnalysis(): {
        totalErrors: number;
        recentErrors: number;
        errorFrequency: Record<string, number>;
        mostCommonError: string | null;
        consecutiveFailures: number;
        errorTypes: string[];
        recommendedAction: string;
    } {
        const recentErrors = this.errorHistory.slice(-20);
        const errorFrequency: Record<string, number> = {};

        for (const errorRecord of recentErrors) {
            const currentCount = errorFrequency[errorRecord.errorType] ?? 0;
            errorFrequency[errorRecord.errorType] = currentCount + 1;
        }

        let mostCommonError: string | null = null;
        let maxCount = 0;
        for (const [errorType, count] of Object.entries(errorFrequency)) {
            if (count > maxCount) {
                mostCommonError = errorType;
                maxCount = count;
            }
        }

        return {
            totalErrors: this.errorHistory.length,
            recentErrors: recentErrors.length,
            errorFrequency,
            mostCommonError,
            consecutiveFailures: this.consecutiveFailures,
            errorTypes: Array.from(this.errorTypes.keys()),
            recommendedAction: this.getRecommendedAction()
        };
    }

    reset(): void {
        this.totalAttempts = 0;
        this.successfulAttempts = 0;
        this.failedAttempts = 0;
        this.preventedAttempts = 0;
        this.timingHistory = [];
        this.totalInitializationTime = 0;
        this.averageInitializationTime = 0;
        this.fastestInitialization = null;
        this.slowestInitialization = null;
        this.errorHistory = [];
        this.errorTypes.clear();
        this.consecutiveFailures = 0;
        this.lastSuccessTime = null;
        this.performanceMetrics = {
            connectionEstablishmentTime: [],
            serviceInitializationTime: [],
            configurationValidationTime: [],
            dependencyResolutionTime: []
        };
        this.firstInitializationTime = null;
        this.lastInitializationTime = null;
        this.isCurrentlyInitializing = false;
        this.currentAttemptStartTime = null;

        this.logger.debug('Initialization statistics reset', this.platformName);
    }

    private calculatePerformanceAverages(): Record<string, PerformanceSummary> {
        const averages: Record<string, PerformanceSummary> = {};

        for (const [metric, values] of Object.entries(this.performanceMetrics)) {
            if (values.length > 0) {
                const sum = values.reduce((accumulator, value) => accumulator + value, 0);
                averages[metric] = {
                    average: sum / values.length,
                    count: values.length,
                    min: Math.min(...values),
                    max: Math.max(...values)
                };
            } else {
                averages[metric] = {
                    average: 0,
                    count: 0,
                    min: null,
                    max: null
                };
            }
        }

        return averages;
    }

    private getRecommendedAction(): string {
        if (this.consecutiveFailures >= 5) {
            return 'CRITICAL: Consider restarting platform or checking configuration';
        }
        if (this.consecutiveFailures >= 3) {
            return 'WARNING: Investigate recurring initialization failures';
        }
        if (this.averageInitializationTime > 30000) {
            return 'OPTIMIZATION: Initialization time is slow, consider performance improvements';
        }
        if (this.successfulAttempts === 0 && this.totalAttempts > 0) {
            return 'ERROR: No successful initializations, check platform configuration';
        }

        return 'NORMAL: Platform initialization is functioning normally';
    }

    private handleInitializationError(message: string, error: unknown, eventData: Record<string, unknown>): void {
        if (!this.errorHandler) {
            this.errorHandler = createPlatformErrorHandler(this.logger, this.platformName);
        }

        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'initialization', eventData, message);
            return;
        }

        if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, this.platformName, eventData);
        }
    }
}

export { InitializationStatistics };
