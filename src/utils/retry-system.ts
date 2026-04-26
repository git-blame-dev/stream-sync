import {
    safeDelay,
    safeSetTimeout,
    validateExponentialBackoff,
    validateTimeout
} from './timeout-validator';
import { createPlatformErrorHandler } from './platform-error-handler';
import { resolveLogger } from './logger-resolver';

const ADAPTIVE_RETRY_CONFIG = {
    BASE_DELAY: 2000,
    MAX_DELAY: 60000,
    BACKOFF_MULTIPLIER: 1.3
} as const;

type RetryLogger = ReturnType<typeof resolveLogger>;

type RetryDependencies = {
    logger?: unknown;
    constants?: {
        RETRY_MAX_ATTEMPTS?: number;
    } | null;
    safeSetTimeout?: typeof safeSetTimeout;
    safeDelay?: typeof safeDelay;
    validateTimeout?: typeof validateTimeout;
    validateExponentialBackoff?: typeof validateExponentialBackoff;
};

class RetrySystem {
    logger: RetryLogger;
    constants: RetryDependencies['constants'];
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    retryTimers: Record<string, ReturnType<typeof setTimeout>>;
    safeSetTimeout: typeof safeSetTimeout;
    safeDelay: typeof safeDelay;
    validateTimeout: typeof validateTimeout;
    validateExponentialBackoff: typeof validateExponentialBackoff;
    isConnected: ((platform: string) => boolean) | null;
    platformRetryCount: Record<string, number>;

    constructor(dependencies: RetryDependencies = {}) {
        this.logger = resolveLogger(dependencies.logger, 'RetrySystem');
        this.constants = dependencies.constants || null;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'retry-system');
        this.retryTimers = {};

        this.safeSetTimeout = dependencies.safeSetTimeout || safeSetTimeout;
        this.safeDelay = dependencies.safeDelay || safeDelay;
        this.validateTimeout = dependencies.validateTimeout || validateTimeout;
        this.validateExponentialBackoff = dependencies.validateExponentialBackoff || validateExponentialBackoff;

        this.isConnected = null;
        this.platformRetryCount = {
            TikTok: 0,
            Twitch: 0,
            YouTube: 0
        };

        this.validateRetryConfig();
    }

    calculateAdaptiveRetryDelay(platform: string): number {
        const retryCount = this.platformRetryCount[platform] || 0;
        const delay = this.validateExponentialBackoff(
            ADAPTIVE_RETRY_CONFIG.BASE_DELAY,
            ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER,
            retryCount,
            ADAPTIVE_RETRY_CONFIG.MAX_DELAY
        );

        this.logger.debug(`Calculated adaptive retry delay: ${delay}ms for attempt ${retryCount + 1}`, 'retry-system');
        return delay;
    }

    incrementRetryCount(platform: string): number {
        if (!(platform in this.platformRetryCount)) {
            this.platformRetryCount[platform] = 0;
        }

        this.platformRetryCount[platform] = (this.platformRetryCount[platform] || 0) + 1;
        const delay = this.calculateAdaptiveRetryDelay(platform);
        this.logger.debug(`Incremented retry count to ${this.platformRetryCount[platform]}, next delay: ${delay}ms`, 'retry-system');
        return delay;
    }

    resetRetryCount(platform: string): void {
        const oldCount = this.platformRetryCount[platform] || 0;
        this.platformRetryCount[platform] = 0;
        if (oldCount > 0) {
            this.logger.debug(`Reset retry count from ${oldCount} to 0`, 'retry-system');
        }
    }

    getRetryCount(platform: string): number {
        return this.platformRetryCount[platform] || 0;
    }

    hasExceededMaxRetries(platform: string, maxAttempts = this.getMaxAttempts()): boolean {
        if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
            return false;
        }

        return this.getRetryCount(platform) >= maxAttempts;
    }

    getMaxAttempts(): number {
        const configured = this.constants?.RETRY_MAX_ATTEMPTS;
        if (configured === undefined || configured === null) {
            return Number.POSITIVE_INFINITY;
        }

        if (!Number.isFinite(configured) || configured <= 0) {
            return Number.POSITIVE_INFINITY;
        }

        return configured;
    }

    calculateTotalRetryTime(platform: string): number {
        const retryCount = this.getRetryCount(platform);
        let totalTime = 0;

        for (let index = 0; index < retryCount; index += 1) {
            const delay = Math.min(
                ADAPTIVE_RETRY_CONFIG.BASE_DELAY * Math.pow(ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER, index),
                ADAPTIVE_RETRY_CONFIG.MAX_DELAY
            );
            totalTime += delay;
        }

        return totalTime;
    }

    extractErrorMessage(error: unknown): string {
        if (!error) {
            return 'Unknown error';
        }

        if (typeof error === 'string') {
            return error;
        }

        if (error instanceof Error && typeof error.message === 'string') {
            return error.message;
        }

        if (typeof error === 'object' && error !== null) {
            const nestedError = error as {
                message?: unknown;
                error?: { message?: unknown };
                errors?: Array<{ message?: unknown }>;
                code?: unknown;
                status?: unknown;
                toString?: () => string;
            };

            if (typeof nestedError.message === 'string') {
                return nestedError.message;
            }

            if (nestedError.error && typeof nestedError.error.message === 'string') {
                return nestedError.error.message;
            }

            if (Array.isArray(nestedError.errors) && nestedError.errors.length > 0 && typeof nestedError.errors[0]?.message === 'string') {
                return nestedError.errors[0].message;
            }

            if (nestedError.code) {
                return `Error code: ${String(nestedError.code)}`;
            }

            if (nestedError.status) {
                return `HTTP ${String(nestedError.status)}`;
            }

            try {
                const jsonString = JSON.stringify(error);
                if (jsonString.length > 200) {
                    return `${jsonString.substring(0, 200)}...`;
                }
                return jsonString;
            } catch {
                if (nestedError.toString) {
                    return nestedError.toString();
                }
            }
        }

        return String(error);
    }

    handleConnectionError(
        platform: string,
        error: unknown,
        reconnectFunction: () => Promise<unknown>,
        cleanupFunction: (() => Promise<unknown> | unknown) | null = null,
        setConnectionStateFn: ((platformName: string, connected: boolean, metadata: unknown, ready: boolean) => void) | null = null
    ): void {
        const errorMessage = this.extractErrorMessage(error);
        const normalizedError = errorMessage.toLowerCase();

        if (
            normalizedError.includes('401')
            || normalizedError.includes('unauthorized')
            || normalizedError.includes('client id and oauth token do not match')
            || normalizedError.includes('clientid is required for twitch authentication')
            || normalizedError.includes('clientsecret is required for twitch authentication')
            || normalizedError.includes('expectedusername is required for twitch authentication')
            || normalizedError.includes('twitch authentication is not ready')
        ) {
            this.logger.warn('Connection failed due to unauthorized access (401). This is likely due to invalid credentials. Stopping retry attempts.', platform);

            if (cleanupFunction) {
                try {
                    void cleanupFunction();
                    this.logger.debug('Cleanup function executed successfully', 'retry-system');
                } catch (cleanupError) {
                    this.logger.debug(`Error during cleanup: ${this.extractErrorMessage(cleanupError)}`, 'retry-system');
                    this._handleRetryError(`${platform} cleanup failed`, cleanupError, 'cleanup', platform);
                }
            }

            if (setConnectionStateFn) {
                try {
                    setConnectionStateFn(platform, false, null, false);
                } catch (stateError) {
                    this.logger.debug(`Error resetting connection state: ${this.extractErrorMessage(stateError)}`, 'retry-system');
                }
            }

            return;
        }

        const adaptiveDelay = this.incrementRetryCount(platform);
        const retryAttempt = this.getRetryCount(platform);
        const maxAttempts = this.getMaxAttempts();

        if (this.hasExceededMaxRetries(platform, maxAttempts)) {
            this._handleRetryError(`Maximum retries reached for ${platform}, halting reconnect attempts.`, null, 'retry-max', platform);
            return;
        }

        this._handleRetryError(`Connection failed (attempt ${retryAttempt}): ${errorMessage}`, null, 'connection', platform);
        this.logger.info(`Retrying in ${adaptiveDelay / 1000} seconds...`, platform);

        const scheduleReconnect = (): void => {
            if (setConnectionStateFn) {
                try {
                    setConnectionStateFn(platform, false, null, false);
                } catch (stateError) {
                    this.logger.debug(`Error resetting connection state: ${this.extractErrorMessage(stateError)}`, 'retry-system');
                }
            }

            if (this.retryTimers[platform]) {
                clearTimeout(this.retryTimers[platform]);
            }

            const validatedDelay = this.validateTimeout(adaptiveDelay, ADAPTIVE_RETRY_CONFIG.BASE_DELAY, 'retry delay');
            this.retryTimers[platform] = this.safeSetTimeout(async () => {
                if (this.isConnected && this.isConnected(platform)) {
                    this.logger.debug(`Cancelling scheduled retry - ${platform} already connected`, 'retry-system');
                    return;
                }

                this.logger.debug(`Executing scheduled reconnection attempt ${retryAttempt + 1}`, 'retry-system');
                try {
                    await reconnectFunction();
                } catch (reconnectError) {
                    this.logger.debug(`Error in scheduled reconnection: ${this.extractErrorMessage(reconnectError)}`, 'retry-system');
                    this.handleConnectionError(platform, reconnectError, reconnectFunction, cleanupFunction, setConnectionStateFn);
                }
            }, validatedDelay);
        };

        const cleanupPromise = cleanupFunction
            ? Promise.resolve()
                .then(() => cleanupFunction())
                .then(() => {
                    this.logger.debug('Cleanup function executed successfully', 'retry-system');
                })
                .catch((cleanupError) => {
                    this.logger.debug(`Error during cleanup: ${this.extractErrorMessage(cleanupError)}`, 'retry-system');
                    this._handleRetryError(`${platform} cleanup failed`, cleanupError, 'cleanup', platform);
                })
            : null;

        if (cleanupPromise) {
            void cleanupPromise.then(scheduleReconnect);
            return;
        }

        scheduleReconnect();
    }

    handleConnectionSuccess(platform: string, _connection: unknown, context = ''): void {
        const message = context ? `Successfully connected (${context})` : 'Successfully connected';
        this.logger.info(message, platform);
        this.resetRetryCount(platform);
        if (this.retryTimers[platform]) {
            clearTimeout(this.retryTimers[platform]);
            delete this.retryTimers[platform];
        }
    }

    getRetryStatistics() {
        const stats: Record<string, {
            count: number;
            nextDelay: number;
            totalTime: number;
            hasExceededMax: boolean;
        }> = {};

        for (const platform of Object.keys(this.platformRetryCount)) {
            const count = this.getRetryCount(platform);
            const nextDelay = count > 0 ? this.calculateAdaptiveRetryDelay(platform) : ADAPTIVE_RETRY_CONFIG.BASE_DELAY;
            const totalTime = this.calculateTotalRetryTime(platform);

            stats[platform] = {
                count,
                nextDelay,
                totalTime,
                hasExceededMax: this.hasExceededMaxRetries(platform)
            };
        }

        return stats;
    }

    resetAllRetryCounts(platforms = Object.keys(this.platformRetryCount)): void {
        for (const platform of platforms) {
            this.resetRetryCount(platform);
        }

        this.logger.debug(`Reset retry counts for: ${platforms.join(', ')}`, 'retry-system');
    }

    async executeWithRetry<T>(platform: string, executeFunction: () => Promise<T>, maxRetries?: number): Promise<T> {
        let lastError: unknown;
        const effectiveMaxRetries = (typeof maxRetries === 'number' || maxRetries === Number.POSITIVE_INFINITY)
            ? maxRetries
            : this.getMaxAttempts();

        while (!this.hasExceededMaxRetries(platform, effectiveMaxRetries)) {
            try {
                const result = await executeFunction();
                this.resetRetryCount(platform);
                return result;
            } catch (error) {
                lastError = error;

                const errorMessage = this.extractErrorMessage(error);
                if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
                    this.logger.warn(`Non-retryable error detected: ${errorMessage}`, platform);
                    throw error;
                }

                const delay = this.incrementRetryCount(platform);
                const attemptNumber = this.getRetryCount(platform);
                this.logger.warn(`HTTP request failed (attempt ${attemptNumber}): ${errorMessage}`, platform);

                if (this.hasExceededMaxRetries(platform, effectiveMaxRetries)) {
                    this._handleRetryError(`Maximum retry attempts (${effectiveMaxRetries}) exceeded for ${platform}`, null, 'max-retries', platform);
                    throw lastError;
                }

                this.logger.info(`Retrying in ${delay / 1000} seconds...`, platform);
                await this.safeDelay(delay, delay || 1000, 'RetrySystem http retry delay');
            }
        }

        throw lastError;
    }

    validateRetryConfig(): true {
        const config = ADAPTIVE_RETRY_CONFIG;

        if (config.BASE_DELAY <= 0) {
            throw new Error('BASE_DELAY must be positive');
        }

        if (config.MAX_DELAY <= config.BASE_DELAY) {
            throw new Error('MAX_DELAY must be greater than BASE_DELAY');
        }

        if (config.BACKOFF_MULTIPLIER <= 1) {
            throw new Error('BACKOFF_MULTIPLIER must be greater than 1');
        }

        this.logger.debug('Configuration validation passed', 'retry-system');
        return true;
    }

    _validateConfigValue(value: unknown, fallback: number, configName: string): number {
        if (typeof value === 'number' && !Number.isNaN(value) && value > 0) {
            return value;
        }

        this.logger.warn(`Invalid ${configName} value: ${String(value)}. Using fallback: ${fallback}`, 'retry-system');
        return fallback;
    }

    _handleRetryError(message: string, error: unknown, eventType: string, platform: string): void {
        const handler = this.errorHandler || createPlatformErrorHandler(this.logger, 'retry-system');
        this.errorHandler = handler;

        if (error instanceof Error) {
            handler.handleEventProcessingError(error, eventType || 'retry', { platform }, message, platform || 'retry-system');
            return;
        }

        handler.logOperationalError(message, platform || 'retry-system', {
            eventType: eventType || 'retry',
            platform
        });
    }
}

function createRetrySystem(dependencies?: RetryDependencies): RetrySystem {
    return new RetrySystem(dependencies);
}

export {
    RetrySystem,
    createRetrySystem,
    ADAPTIVE_RETRY_CONFIG
};
