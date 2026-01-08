const { safeDelay } = require('./timeout-validator');
const { createPlatformErrorHandler } = require('./platform-error-handler');
const { resolveLogger } = require('./logger-resolver');

class AuthError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'AuthError';
        this.code = options.code || 'AUTH_ERROR';
        this.category = options.category || 'auth_error';
        this.recoverable = options.recoverable !== undefined ? options.recoverable : false;
        this.retryable = options.retryable !== undefined ? options.retryable : false;
        this.needsRefresh = options.needsRefresh !== undefined ? options.needsRefresh : false;
        this.needsNewTokens = options.needsNewTokens !== undefined ? options.needsNewTokens : false;
        this.originalError = options.originalError || null;
        this.context = options.context || {};
        this.timestamp = Date.now();
        
        // Capture stack trace excluding constructor
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
    
    getUserMessage() {
        return this.message;
    }
    
    getTechnicalDetails() {
        return {
            code: this.code,
            category: this.category,
            originalError: this.originalError?.message,
            context: this.context,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }
    
    getRecoveryActions() {
        return ['Check authentication configuration', 'Verify network connectivity'];
    }
    
    static fromHttpError(error, options = {}) {
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        
        const context = {
            status,
            statusText,
            url: error.config?.url,
            method: error.config?.method,
            ...options.context
        };
        
        return new this(`HTTP ${status}: ${statusText}`, {
            ...options,
            originalError: error,
            context
        });
    }
}

class TokenRefreshError extends AuthError {
    constructor(message, options = {}) {
        super(message, {
            ...options,
            category: options.category || 'token_refresh_error',
            needsRefresh: true
        });
        this.name = 'TokenRefreshError';
        this.code = options.code || 'TOKEN_REFRESH_FAILED';
    }
    
    getRecoveryActions() {
        const actions = ['Verify refresh token validity'];
        
        if (this.originalError?.response?.status === 400) {
            actions.push('Refresh token may be expired - OAuth flow required');
        } else if (this.originalError?.response?.status === 401) {
            actions.push('Invalid refresh token - OAuth flow required');
        } else if (this.originalError?.code && this._isNetworkError(this.originalError)) {
            actions.push('Check network connectivity');
            actions.push('Retry operation after network is restored');
        } else {
            actions.push('Manual token regeneration may be required');
        }
        
        return actions;
    }
    
    _isNetworkError(error) {
        const networkCodes = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNABORTED', 'ECONNRESET'];
        return networkCodes.includes(error.code);
    }
}

class ApiCallError extends AuthError {
    constructor(message, options = {}) {
        super(message, {
            ...options,
            category: options.category || 'api_call_error'
        });
        this.name = 'ApiCallError';
        this.code = options.code || 'API_CALL_FAILED';
        this.endpoint = options.endpoint || null;
        this.method = options.method || null;
    }
    
    getRecoveryActions() {
        const actions = super.getRecoveryActions();
        
        if (this.originalError?.response?.status === 403) {
            actions.push('Check API permissions and scopes');
        } else if (this.originalError?.response?.status === 404) {
            actions.push('Verify endpoint URL and resource existence');
        } else if (this.originalError?.response?.status === 429) {
            actions.push('Wait for rate limit reset');
            actions.push('Implement exponential backoff');
        } else if (this.originalError?.response?.status >= 500) {
            actions.push('Retry after temporary server issue');
        }
        
        return actions;
    }
}

class ConfigError extends AuthError {
    constructor(message, options = {}) {
        super(message, {
            ...options,
            category: 'config_error',
            recoverable: false
        });
        this.name = 'ConfigError';
        this.code = options.code || 'CONFIG_ERROR';
        this.missingFields = options.missingFields || [];
    }
    
    getRecoveryActions() {
        const actions = ['Check configuration file integrity'];
        
        if (this.missingFields.length > 0) {
            actions.push(`Provide missing fields: ${this.missingFields.join(', ')}`);
        }
        
        actions.push('Verify configuration file permissions');
        actions.push('Ensure configuration follows expected format');
        
        return actions;
    }
}

class NetworkError extends AuthError {
    constructor(message, options = {}) {
        super(message, {
            ...options,
            category: 'network_error',
            retryable: true,
            recoverable: true
        });
        this.name = 'NetworkError';
        this.code = options.code || 'NETWORK_ERROR';
    }
    
    getRecoveryActions() {
        return [
            'Check internet connectivity',
            'Verify firewall and proxy settings',
            'Retry operation after network is restored',
            'Check DNS resolution'
        ];
    }
}

class AuthErrorFactory {
    static categorizeError(error, context = {}) {
        // Network errors
        if (error.code && ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNABORTED', 'ECONNRESET'].includes(error.code)) {
            return new NetworkError(`Network error: ${error.code}`, {
                originalError: error,
                context,
                code: error.code
            });
        }
        
        // HTTP errors
        if (error.response) {
            const status = error.response.status;
            
            if (status === 401) {
                return new TokenRefreshError('Unauthorized - token refresh required', {
                    originalError: error,
                    context,
                    needsRefresh: true,
                    code: 'TOKEN_EXPIRED'
                });
            } else if (status === 400 && context.operation === 'token_refresh') {
                return new TokenRefreshError('Refresh token expired - OAuth flow required', {
                    originalError: error,
                    context,
                    needsNewTokens: true,
                    code: 'REFRESH_TOKEN_EXPIRED'
                });
            } else if (status === 403) {
                return new ApiCallError('Forbidden - insufficient permissions', {
                    originalError: error,
                    context,
                    code: 'INSUFFICIENT_PERMISSIONS'
                });
            } else if (status === 404) {
                return new ApiCallError('Resource not found', {
                    originalError: error,
                    context,
                    code: 'RESOURCE_NOT_FOUND'
                });
            } else if (status === 429) {
                return new ApiCallError('Rate limit exceeded', {
                    originalError: error,
                    context,
                    retryable: true,
                    code: 'RATE_LIMITED'
                });
            } else if (status >= 500) {
                return new ApiCallError('Server error', {
                    originalError: error,
                    context,
                    retryable: true,
                    code: 'SERVER_ERROR'
                });
            }
            
            return new ApiCallError(`HTTP ${status}: ${error.response.statusText}`, {
                originalError: error,
                context,
                code: 'HTTP_ERROR'
            });
        }
        
        // Token refresh specific errors
        if (error.message && (
            error.message.includes('Token refresh failed') ||
            error.message.includes('refresh') ||
            error.message.includes('Invalid refresh token')
        )) {
            return new TokenRefreshError(error.message, {
                originalError: error,
                context,
                code: 'TOKEN_REFRESH_FAILED'
            });
        }
        
        // Configuration errors
        if (error.message && (
            error.message.includes('Missing required') ||
            error.message.includes('Invalid configuration') ||
            error.message.includes('config')
        )) {
            return new ConfigError(error.message, {
                originalError: error,
                context,
                code: 'CONFIG_INVALID'
            });
        }
        
        // Default to generic auth error
        return new AuthError(error.message || 'Unknown authentication error', {
            originalError: error,
            context,
            code: 'UNKNOWN_ERROR'
        });
    }
    
    static createTokenRefreshError(originalError, refreshContext = {}) {
        if (originalError.response?.status === 400) {
            return new TokenRefreshError('Refresh token expired - OAuth flow required', {
                originalError,
                context: { ...refreshContext, operation: 'token_refresh' },
                needsNewTokens: true,
                code: 'REFRESH_TOKEN_EXPIRED'
            });
        } else if (originalError.response?.status === 401) {
            return new TokenRefreshError('Invalid refresh token - OAuth flow required', {
                originalError,
                context: { ...refreshContext, operation: 'token_refresh' },
                needsNewTokens: true,
                code: 'INVALID_REFRESH_TOKEN'
            });
        } else if (originalError.code && ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNABORTED', 'ECONNRESET'].includes(originalError.code)) {
            return new NetworkError('Token refresh failed due to network error', {
                originalError,
                context: { ...refreshContext, operation: 'token_refresh' },
                retryable: true,
                code: originalError.code
            });
        }
        
        return new TokenRefreshError('Token refresh failed - OAuth flow required', {
            originalError,
            context: { ...refreshContext, operation: 'token_refresh' },
            needsNewTokens: true,
            code: 'TOKEN_REFRESH_FAILED'
        });
    }
    
    static createApiCallError(originalError, apiContext = {}) {
        const context = {
            endpoint: apiContext.endpoint,
            method: apiContext.method,
            operation: apiContext.operationName,
            ...apiContext
        };
        
        return this.categorizeError(originalError, context);
    }
}

class ErrorRecoveryStrategy {
    static getStrategy(error) {
        if (error instanceof NetworkError) {
            return {
                type: 'retry',
                maxAttempts: 3,
                backoffMs: 1000,
                exponential: true
            };
        } else if (error instanceof TokenRefreshError) {
            if (error.needsNewTokens) {
                return {
                    type: 'oauth_flow',
                    requiresUserAction: true
                };
            } else if (error.retryable) {
                return {
                    type: 'retry',
                    maxAttempts: 2,
                    backoffMs: 500
                };
            }
        } else if (error instanceof ApiCallError && error.originalError?.response?.status === 429) {
            const retryAfter = error.originalError.response.headers['retry-after'];
            return {
                type: 'rate_limit_backoff',
                waitMs: retryAfter ? parseInt(retryAfter) * 1000 : 60000
            };
        }
        
        return {
            type: 'fail',
            requiresUserAction: !error.recoverable
        };
    }
    
    static async executeStrategy(strategy, operation, context = {}) {
        const logger = resolveLogger(context.logger, 'ErrorRecoveryStrategy');
        
        switch (strategy.type) {
            case 'retry':
                return await this._executeRetryStrategy(strategy, operation, logger);
            
            case 'rate_limit_backoff':
                logger.info(`Rate limited, waiting ${strategy.waitMs}ms before retry`, 'auth-recovery');
                await this._sleep(strategy.waitMs);
                return await operation();
            
            case 'oauth_flow':
                logger.warn('OAuth flow required for authentication recovery', 'auth-recovery');
                throw new AuthError('OAuth flow required - user intervention needed', {
                    code: 'OAUTH_REQUIRED',
                    recoverable: false
                });
            
            case 'fail':
            default:
                throw new AuthError('Operation failed - no recovery strategy available', {
                    code: 'NO_RECOVERY',
                    recoverable: false
                });
        }
    }
    
    static async _executeRetryStrategy(strategy, operation, logger) {
        let lastError;
        let backoffMs = strategy.backoffMs || 1000;
        const recoveryHandler = logger ? createPlatformErrorHandler(logger, 'auth-recovery') : null;
        
        for (let attempt = 1; attempt <= strategy.maxAttempts; attempt++) {
            try {
                if (attempt > 1) {
                    logger.info(`Retry attempt ${attempt}/${strategy.maxAttempts} after ${backoffMs}ms`, 'auth-recovery');
                    await this._sleep(backoffMs);
                }
                
                return await operation();
                
            } catch (error) {
                lastError = error;
                
                if (attempt === strategy.maxAttempts) {
                    if (recoveryHandler) {
                        recoveryHandler.logOperationalError(
                            `All ${strategy.maxAttempts} retry attempts failed`,
                            'auth-recovery',
                            { attempts: strategy.maxAttempts }
                        );
                    }
                    break;
                }
                
                // Exponential backoff
                if (strategy.exponential) {
                    backoffMs *= 2;
                }
            }
        }
        
        throw lastError;
    }
    
    static _sleep(ms) {
        return safeDelay(ms, ms || 1000, 'AuthErrors sleep');
    }
}

class ErrorMonitor {
    constructor() {
        this.errorCounts = new Map();
        this.errorFrequency = new Map();
        this.performanceImpact = new Map();
        this.recoverySuccess = new Map();
    }
    
    recordError(error, context = {}) {
        const key = `${error.constructor.name}:${error.code}`;
        
        // Increment error count
        this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1);
        
        // Track frequency (errors per hour)
        const hourKey = `${key}:${Math.floor(Date.now() / 3600000)}`;
        this.errorFrequency.set(hourKey, (this.errorFrequency.get(hourKey) || 0) + 1);
        
        // Track performance impact
        if (context.duration) {
            const impacts = this.performanceImpact.get(key) || [];
            impacts.push(context.duration);
            this.performanceImpact.set(key, impacts);
        }
    }
    
    recordRecovery(error, success, context = {}) {
        const key = `${error.constructor.name}:${error.code}`;
        const recoveries = this.recoverySuccess.get(key) || { attempts: 0, successes: 0 };
        
        recoveries.attempts++;
        if (success) {
            recoveries.successes++;
        }
        
        this.recoverySuccess.set(key, recoveries);
    }
    
    getStats() {
        const stats = {
            totalErrors: 0,
            errorTypes: {},
            topErrors: [],
            recoveryRates: {},
            performanceImpact: {}
        };
        
        // Calculate totals and sort
        for (const [key, count] of this.errorCounts) {
            stats.totalErrors += count;
            stats.errorTypes[key] = count;
        }
        
        // Top errors
        stats.topErrors = Array.from(this.errorCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([key, count]) => ({ type: key, count }));
        
        // Recovery rates
        for (const [key, recovery] of this.recoverySuccess) {
            stats.recoveryRates[key] = {
                attempts: recovery.attempts,
                successes: recovery.successes,
                rate: recovery.attempts > 0 ? recovery.successes / recovery.attempts : 0
            };
        }
        
        // Performance impact
        for (const [key, durations] of this.performanceImpact) {
            if (durations.length > 0) {
                const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
                const max = Math.max(...durations);
                stats.performanceImpact[key] = { avgMs: avg, maxMs: max, samples: durations.length };
            }
        }
        
        return stats;
    }
    
    cleanup(hoursToKeep = 24) {
        const cutoff = Math.floor(Date.now() / 3600000) - hoursToKeep;
        
        for (const key of this.errorFrequency.keys()) {
            const hour = parseInt(key.split(':').pop());
            if (hour < cutoff) {
                this.errorFrequency.delete(key);
            }
        }
    }
}

// Global error monitor instance
const globalErrorMonitor = new ErrorMonitor();

class ErrorHandler {
    constructor(logger) {
        this.logger = resolveLogger(logger, 'AuthErrorHandler');
        this.monitor = globalErrorMonitor;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'auth-error');
    }
    
    async handleError(error, context = {}) {
        const startTime = Date.now();
        let categorizedError = error;
        
        // Categorize error if needed
        if (!(error instanceof AuthError)) {
            categorizedError = AuthErrorFactory.categorizeError(error, context);
        }
        
        // Record error
        this.monitor.recordError(categorizedError, context);
        
        // Log error with consistent format
        this._logError(categorizedError, context);
        
        // Attempt recovery if possible
        if (categorizedError.recoverable) {
            try {
                const strategy = ErrorRecoveryStrategy.getStrategy(categorizedError);
                
                if (context.operation && strategy.type !== 'fail') {
                    const result = await ErrorRecoveryStrategy.executeStrategy(
                        strategy, 
                        context.operation, 
                        { logger: this.logger }
                    );
                    
                    this.monitor.recordRecovery(categorizedError, true, {
                        duration: Date.now() - startTime
                    });
                    
                    return result;
                }
            } catch (recoveryError) {
                this.monitor.recordRecovery(categorizedError, false, {
                    duration: Date.now() - startTime
                });
                throw recoveryError;
            }
        }
        
        throw categorizedError;
    }
    
    _logError(error, context = {}) {
        const logContext = {
            code: error.code,
            category: error.category,
            recoverable: error.recoverable,
            retryable: error.retryable,
            needsRefresh: error.needsRefresh,
            needsNewTokens: error.needsNewTokens,
            ...context
        };
        
        // Log at appropriate level
        if (error instanceof NetworkError && error.retryable) {
            this.logger.warn?.(error.message, 'auth-error', logContext);
        } else if (error.recoverable) {
            this.logger.info?.(error.message, 'auth-error', logContext);
        } else {
            this._logAuthError(error.message, error, logContext);
        }
        
        // Log technical details in debug mode
        if (this.logger.debug) {
            this.logger.debug('Error technical details', 'auth-error', error.getTechnicalDetails());
        }
    }

    _logAuthError(message, error, payload = null) {
        if (!this.errorHandler) {
            this.errorHandler = createPlatformErrorHandler(this.logger, 'auth-error');
        }

        if (error instanceof Error) {
            this.errorHandler.handleEventProcessingError(
                error,
                'auth-error',
                payload,
                message,
                'auth-error'
            );
            return;
        }

        this.errorHandler.logOperationalError(message, 'auth-error', payload);
    }
    
    getStats() {
        return this.monitor.getStats();
    }
    
    cleanup() {
        this.monitor.cleanup();
    }
}

module.exports = {
    AuthError,
    TokenRefreshError,
    ApiCallError,
    ConfigError,
    NetworkError,
    AuthErrorFactory,
    ErrorRecoveryStrategy,
    ErrorMonitor,
    ErrorHandler
};
