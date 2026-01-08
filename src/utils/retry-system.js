
const { safeSetTimeout, safeDelay, validateTimeout } = require('./timeout-validator');
const { createPlatformErrorHandler } = require('./platform-error-handler');
const { validateLoggerInterface } = require('./dependency-validator');

const ADAPTIVE_RETRY_CONFIG = {
    BASE_DELAY: 2000,        // Start with 2 seconds (balanced recovery)
    MAX_DELAY: 60000,        // Cap at 1 minute (faster reconnection)
    BACKOFF_MULTIPLIER: 1.3  // Gentle growth to reduce reconnect storm risk
};

class RetrySystem {
    constructor(dependencies = {}) {
        this.logger = this._resolveLogger(dependencies.logger);
        this.constants = dependencies.constants || null;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'retry-system');
        this.retryTimers = {};
        
        // Extract logger methods for convenience
        
        // Connection state checker interface (set by platforms)
        this.isConnected = null;
        
        this.platformRetryCount = {
            TikTok: 0,
            Twitch: 0,
            YouTube: 0
        };
        
        // Validate configuration on instance creation
        this.validateRetryConfig();
    }

    calculateAdaptiveRetryDelay(platform) {
        const retryCount = this.platformRetryCount[platform] || 0;
        
        // Use centralized timeout validation for consistent behavior
        const { validateExponentialBackoff } = require('./timeout-validator');
        
        const delay = validateExponentialBackoff(
            ADAPTIVE_RETRY_CONFIG.BASE_DELAY,
            ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER,
            retryCount,
            ADAPTIVE_RETRY_CONFIG.MAX_DELAY
        );
        
        this.logger.debug(`Calculated adaptive retry delay: ${delay}ms for attempt ${retryCount + 1}`, 'retry-system');
        return delay;
    }

    incrementRetryCount(platform) {
        // Initialize if not exists
        if (!(platform in this.platformRetryCount)) {
            this.platformRetryCount[platform] = 0;
        }
        
        this.platformRetryCount[platform] = (this.platformRetryCount[platform] || 0) + 1;
        const delay = this.calculateAdaptiveRetryDelay(platform);
        
        this.logger.debug(`Incremented retry count to ${this.platformRetryCount[platform]}, next delay: ${delay}ms`, 'retry-system');
        return delay;
    }

    resetRetryCount(platform) {
        const oldCount = this.platformRetryCount[platform] || 0;
        this.platformRetryCount[platform] = 0;
        
        if (oldCount > 0) {
            this.logger.debug(`Reset retry count from ${oldCount} to 0`, 'retry-system');
        }
    }

    getRetryCount(platform) {
        return this.platformRetryCount[platform] || 0;
    }

    hasExceededMaxRetries(platform, maxAttempts = this._getMaxAttempts()) {
        // Treat non-positive or non-finite values as "unlimited"
        if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
            return false;
        }
        const count = this.getRetryCount(platform);
        return count >= maxAttempts;
    }

    _getMaxAttempts() {
        const configured = this.constants && this.constants.RETRY_MAX_ATTEMPTS;

        if (configured === undefined || configured === null) {
            return Infinity;
        }

        if (!Number.isFinite(configured)) {
            // Infinity or invalid -> treat as unlimited
            return Infinity;
        }

        if (configured <= 0) {
            return Infinity;
        }

        return configured;
    }

    calculateTotalRetryTime(platform) {
        const retryCount = this.getRetryCount(platform);
        let totalTime = 0;
        
        for (let i = 0; i < retryCount; i++) {
            const delay = Math.min(
                ADAPTIVE_RETRY_CONFIG.BASE_DELAY * Math.pow(ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER, i),
                ADAPTIVE_RETRY_CONFIG.MAX_DELAY
            );
            totalTime += delay;
        }
        
        return totalTime;
    }

    extractErrorMessage(error) {
        if (!error) {
            return 'Unknown error';
        }
        
        // If it's already a string, return it
        if (typeof error === 'string') {
            return error;
        }
        
        // If it has a message property, use it
        if (error.message) {
            return error.message;
        }
        
        // If it has an error property (nested error)
        if (error.error && error.error.message) {
            return error.error.message;
        }
        
        // If it has errors array (multiple errors)
        if (error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
            const firstError = error.errors[0];
            if (firstError.message) {
                return firstError.message;
            }
        }
        
        // If it has a code or status
        if (error.code) {
            return `Error code: ${error.code}`;
        }
        
        if (error.status) {
            return `HTTP ${error.status}`;
        }
        
        // Try to stringify the object, but limit its size
        try {
            const jsonString = JSON.stringify(error);
            if (jsonString.length > 200) {
                return jsonString.substring(0, 200) + '...';
            }
            return jsonString;
        } catch {
            // If JSON.stringify fails, fall back to toString
            return error.toString() || 'Unknown error object';
        }
    }

    handleConnectionError(platform, error, reconnectFunction, cleanupFunction = null, setConnectionStateFn = null) {
        const errorMessage = this.extractErrorMessage(error);
        
        // Check for unauthorized errors (401) and stop retrying
        if (errorMessage.includes('401') || errorMessage.includes('Unauthorized') || errorMessage.includes('Client ID and OAuth token do not match')) {
            this.logger.warn(`Connection failed due to unauthorized access (401). This is likely due to invalid credentials. Stopping retry attempts.`, platform);
            
            // Perform cleanup without retrying
            if (cleanupFunction) {
                try {
                    cleanupFunction();
                    this.logger.debug('Cleanup function executed successfully', 'retry-system');
                } catch (cleanupError) {
                    this.logger.debug(`Error during cleanup: ${cleanupError.message || cleanupError}`, 'retry-system');
                    this._handleRetryError(`${platform} cleanup failed`, cleanupError, 'cleanup', platform);
                }
            }
            
            // Reset connection state flags
            if (setConnectionStateFn) {
                try {
                    setConnectionStateFn(platform, false, null, false);
                } catch (stateError) {
                    this.logger.debug(`Error resetting connection state: ${stateError.message || stateError}`, 'retry-system');
                }
            }
            
            return; // Stop retrying for auth errors
        }
        
        const adaptiveDelay = this.incrementRetryCount(platform);
        const retryAttempt = this.getRetryCount(platform);
        const maxAttempts = this._getMaxAttempts();

        if (this.hasExceededMaxRetries(platform, maxAttempts)) {
            this._handleRetryError(
                `Maximum retries reached for ${platform}, halting reconnect attempts.`,
                null,
                'retry-max',
                platform
            );
            return;
        }
        
        // Log the error with consistent platform-tagged formatting
                    this._handleRetryError(`Connection failed (attempt ${retryAttempt}): ${errorMessage}`, null, 'connection', platform);
            this.logger.info(`Retrying in ${adaptiveDelay/1000} seconds...`, platform);
        
        const scheduleReconnect = () => {
            // Reset connection state flags
            if (setConnectionStateFn) {
                try {
                    setConnectionStateFn(platform, false, null, false);
                } catch (stateError) {
                    this.logger.debug(`Error resetting connection state: ${stateError.message || stateError}`, 'retry-system');
                }
            }
            
            if (this.retryTimers[platform]) {
                clearTimeout(this.retryTimers[platform]);
            }

            // Schedule reconnection attempt after cleanup completes
            const validatedDelay = validateTimeout(adaptiveDelay, ADAPTIVE_RETRY_CONFIG.BASE_DELAY, 'retry delay');
            this.retryTimers[platform] = safeSetTimeout(async () => {
                if (this.isConnected && this.isConnected(platform)) {
                    this.logger.debug(`Cancelling scheduled retry - ${platform} already connected`, 'retry-system');
                    return;
                }
                
                this.logger.debug(`Executing scheduled reconnection attempt ${retryAttempt + 1}`, 'retry-system');
                try {
                    await reconnectFunction();
                } catch (reconnectError) {
                    this.logger.debug(`Error in scheduled reconnection: ${reconnectError.message || reconnectError}`, 'retry-system');
                    // Continue the retry cycle if a scheduled attempt fails
                    this.handleConnectionError(
                        platform,
                        reconnectError,
                        reconnectFunction,
                        cleanupFunction,
                        setConnectionStateFn
                    );
                }
            }, validatedDelay);
        };

        const cleanupPromise = cleanupFunction
            ? Promise.resolve().then(() => cleanupFunction()).then(() => {
                this.logger.debug('Cleanup function executed successfully', 'retry-system');
            }).catch((cleanupError) => {
                this.logger.debug(`Error during cleanup: ${cleanupError.message || cleanupError}`, 'retry-system');
                this._handleRetryError(`${platform} cleanup failed`, cleanupError, 'cleanup', platform);
            })
            : null;
        
        if (cleanupPromise) {
            cleanupPromise.then(scheduleReconnect);
        } else {
            scheduleReconnect();
        }
    }

    handleConnectionSuccess(platform, connection, context = '') {
        const message = context ? `Successfully connected (${context})` : 'Successfully connected';
        this.logger.info(message, platform);
        this.resetRetryCount(platform);
        if (this.retryTimers[platform]) {
            clearTimeout(this.retryTimers[platform]);
            delete this.retryTimers[platform];
        }
    }

    getRetryStatistics() {
        const stats = {};
        
        Object.keys(this.platformRetryCount).forEach(platform => {
            const count = this.getRetryCount(platform);
            const nextDelay = count > 0 ? this.calculateAdaptiveRetryDelay(platform) : ADAPTIVE_RETRY_CONFIG.BASE_DELAY;
            const totalTime = this.calculateTotalRetryTime(platform);
            
            stats[platform] = {
                count,
                nextDelay,
                totalTime,
                hasExceededMax: this.hasExceededMaxRetries(platform)
            };
        });
        
        return stats;
    }

    resetAllRetryCounts(platforms = Object.keys(this.platformRetryCount)) {
        platforms.forEach(platform => {
            this.resetRetryCount(platform);
        });
        
        this.logger.debug(`Reset retry counts for: ${platforms.join(', ')}`, 'retry-system');
    }

    async executeWithRetry(platform, executeFunction, maxRetries) {
        let lastError;
        const effectiveMaxRetries = (typeof maxRetries === 'number' || maxRetries === Infinity)
            ? maxRetries
            : this._getMaxAttempts();
        
        while (!this.hasExceededMaxRetries(platform, effectiveMaxRetries)) {
            try {
                const result = await executeFunction();
                // Success - reset retry count and return result
                this.resetRetryCount(platform);
                return result;
            } catch (error) {
                lastError = error;
                
                // Check for non-retryable errors (401, etc.)
                const errorMessage = this.extractErrorMessage(error);
                if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
                    this.logger.warn(`Non-retryable error detected: ${errorMessage}`, platform);
                    throw error;
                }
                
                // Increment retry count and calculate delay
                const delay = this.incrementRetryCount(platform);
                const attemptNumber = this.getRetryCount(platform);
                
                this.logger.warn(`HTTP request failed (attempt ${attemptNumber}): ${errorMessage}`, platform);
                
                // If we've exceeded max retries, throw the last error
                if (this.hasExceededMaxRetries(platform, effectiveMaxRetries)) {
                    this._handleRetryError(`Maximum retry attempts (${effectiveMaxRetries}) exceeded for ${platform}`, null, 'max-retries', platform);
                    throw lastError;
                }
                
                // Wait before retrying
                this.logger.info(`Retrying in ${delay/1000} seconds...`, platform);
                await safeDelay(delay, delay || 1000, 'RetrySystem http retry delay');
            }
        }
        
        // This shouldn't be reached, but throw the last error as fallback
        throw lastError;
    }

    validateRetryConfig() {
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

    _resolveLogger(logger) {
        const candidates = [];

        if (logger) {
            candidates.push(logger);
        }

        if (global.__TEST_LOGGER__) {
            candidates.push(global.__TEST_LOGGER__);
        }

        try {
            const logging = require('../core/logging');
            const unified = typeof logging.getUnifiedLogger === 'function'
                ? logging.getUnifiedLogger()
                : logging.logger;
            if (unified) {
                candidates.push(unified);
            }
        } catch {
            // Logging may not be ready yet; continue with other candidates
        }

        const selected = candidates.find(Boolean);
        if (!selected) {
            throw new Error('RetrySystem requires a logger dependency');
        }

        const normalized = this._normalizeLoggerMethods(selected);
        validateLoggerInterface(normalized);
        return normalized;
    }

    _validateConfigValue(value, fallback, configName) {
        if (typeof value === 'number' && !isNaN(value) && value > 0) {
            return value;
        }
        
        this.logger.warn(`Invalid ${configName} value: ${value}. Using fallback: ${fallback}`, 'retry-system');
        return fallback;
    }

    _normalizeLoggerMethods(logger) {
        const required = ['debug', 'info', 'warn', 'error'];
        const normalized = { ...logger };
        required.forEach((method) => {
            if (typeof normalized[method] !== 'function') {
                normalized[method] = () => {};
            }
        });
        return normalized;
    }
}

RetrySystem.prototype._handleRetryError = function(message, error, eventType, platform) {
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
};

function createRetrySystem(dependencies) {
    return new RetrySystem(dependencies);
}

// Export class and factory for explicit dependency injection
module.exports = {
    // Class exports
    RetrySystem,
    createRetrySystem,
    
    // Configuration
    ADAPTIVE_RETRY_CONFIG
}; 
