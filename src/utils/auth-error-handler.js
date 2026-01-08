
const { createPlatformErrorHandler } = require('./platform-error-handler');
const { validateLoggerInterface } = require('./dependency-validator');

class AuthErrorHandler {
    constructor(logger = null) {
        validateLoggerInterface(logger);
        this.logger = logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'auth-error-handler');
        
        // Error pattern constants for reuse
        this.ERROR_PATTERNS = {
            AUTH: [
                'token validation failed', 'invalid oauth token', 'token expired',
                'unauthorized', 'invalid_token', '401 unauthorized'
            ],
            NETWORK: [
                'econnrefused', 'etimedout', 'enotfound', 'network error',
                'connection refused', 'timeout'
            ],
            API: [
                'invalid api response', 'missing user_id or login',
                'request failed with status code'
            ],
            TWITCH_REFRESH: [
                'Invalid refresh token', 'invalid_grant', 'Token has been revoked',
                'Bad Request', '50 valid access tokens'
            ]
        };
        
        // User-friendly error messages
        this.USER_MESSAGES = {
            invalid_refresh_token: {
                title: 'Token refresh failed: Invalid refresh token',
                message: 'Re-authentication required - please run the OAuth flow again'
            },
            expired_refresh_token: {
                title: 'Refresh token expired',
                message: 'Manual re-authentication required - refresh token has expired'
            },
            token_limit_exceeded: {
                title: 'Token limit exceeded',
                message: 'Maximum of 50 valid access tokens per refresh token reached - re-authentication required'
            },
            rate_limited: {
                title: 'Rate limited by Twitch API',
                message: 'Please try again in a few moments'
            },
            network_error: {
                title: 'Network error during authentication',
                message: 'Please check your internet connection'
            },
            server_error: {
                title: 'Twitch server error during token refresh',
                message: 'Please try again in a few moments'
            }
        };
    }

    analyzeError(errorOrMessage) {
        let message = '';
        let statusCode = null;
        let category = 'unknown';
        
        // Extract information from error objects
        if (errorOrMessage && typeof errorOrMessage === 'object') {
            statusCode = errorOrMessage.response?.status;
            message = errorOrMessage.response?.data?.message || errorOrMessage.message || String(errorOrMessage);
            
            // Special handling for axios errors
            if (errorOrMessage.code === 'ERR_BAD_REQUEST' && statusCode === 401) {
                category = 'axios_auth';
            }
        } else {
            message = String(errorOrMessage || '');
        }
        
        const lowerMessage = message.toLowerCase();
        
        // Categorize error types using reusable patterns
        const isAuthError = this.ERROR_PATTERNS.AUTH.some(pattern => 
            lowerMessage.includes(pattern.toLowerCase())
        );
        const isNetworkError = this.ERROR_PATTERNS.NETWORK.some(pattern => 
            lowerMessage.includes(pattern.toLowerCase())
        );
        const isApiError = this.ERROR_PATTERNS.API.some(pattern => 
            lowerMessage.includes(pattern.toLowerCase())
        );
        
        if (isAuthError) category = 'authentication';
        else if (isNetworkError) category = 'network';
        else if (isApiError) category = 'api';
        
        return {
            message,
            statusCode,
            category,
            isAuthError,
            isNetworkError,
            isApiError,
            isRefreshable: isAuthError || isNetworkError || isApiError || statusCode === 401 || statusCode === 403
        };
    }

    analyzeRefreshError(error) {
        const errorData = error.response?.data || {};
        const statusCode = error.response?.status;
        const errorMessage = errorData.message || errorData.error_description || error.message || '';
        
        const lowerErrorMessage = errorMessage.toLowerCase();
        const hasTwitchRefreshPattern = this.ERROR_PATTERNS.TWITCH_REFRESH.some(pattern => 
            lowerErrorMessage.includes(pattern.toLowerCase())
        );
        
        // Handle token limit exceeded (50 valid access tokens per refresh token)
        if (lowerErrorMessage.includes('50 valid access tokens')) {
            return {
                category: 'token_limit_exceeded',
                severity: 'terminal',
                recoverable: false,
                action: 'oauth_required'
            };
        }
        
        // Enhanced invalid_grant detection with Twitch patterns
        if (errorData.error === 'invalid_grant') {
            return {
                category: 'invalid_refresh_token',
                severity: 'terminal',
                recoverable: false,
                action: 'oauth_required'
            };
        }
        
        // Detect 30-day refresh token expiry scenario (Twitch public client limitation)
        if (statusCode === 400 && lowerErrorMessage.includes('invalid refresh token') && !errorData.error) {
            return {
                category: 'expired_refresh_token',
                severity: 'terminal',
                recoverable: false,
                action: 'oauth_required'
            };
        }
        
        // Fallback for other 400 errors with Twitch patterns
        if (statusCode === 400 || hasTwitchRefreshPattern) {
            return {
                category: 'invalid_refresh_token',
                severity: 'terminal',
                recoverable: false,
                action: 'oauth_required'
            };
        }
        
        // Enhanced 401 handling with specific Twitch token revocation patterns
        if (statusCode === 401 || errorData.error === 'unauthorized' || 
            lowerErrorMessage.includes('token has been revoked')) {
            return {
                category: 'expired_refresh_token',
                severity: 'terminal',
                recoverable: false,
                action: 'oauth_required'
            };
        }
        
        if (statusCode === 429) {
            return {
                category: 'rate_limited',
                severity: 'recoverable',
                recoverable: true,
                retryAfter: error.response?.headers?.['retry-after'] || 60
            };
        }
        
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            return {
                category: 'network_error',
                severity: 'recoverable',
                recoverable: true
            };
        }
        
        if (statusCode >= 500) {
            return {
                category: 'server_error',
                severity: 'terminal',
                recoverable: false
            };
        }
        
        return {
            category: 'unknown',
            severity: 'unknown',
            recoverable: false
        };
    }

    isRefreshableError(errorOrMessage) {
        const errorAnalysis = this.analyzeError(errorOrMessage);
        
        // Check for direct HTTP status codes indicating auth issues
        if (errorAnalysis.statusCode === 401 || errorAnalysis.statusCode === 403) {
            this.logger.debug?.(`[AUTH] Detected ${errorAnalysis.statusCode} response - token refresh needed`);
            return true;
        }
        
        // Check for network/connectivity issues that might be transient
        if (errorAnalysis.isNetworkError) {
            this.logger.debug?.('[AUTH] Network error detected - token refresh might help with retry');
            return true;
        }
        
        // Check for OAuth-specific error patterns
        if (errorAnalysis.isAuthError) {
            this.logger.debug?.('[AUTH] Authentication error detected - token refresh needed');
            return true;
        }
        
        if (errorAnalysis.isRefreshable) {
            this.logger.debug?.('[AUTH] Error is refreshable', { 
                errorMessage: errorAnalysis.message,
                category: errorAnalysis.category
            });
        }
        
        return errorAnalysis.isRefreshable;
    }

    logUserFacingError(category, context = {}) {
        const userMessage = this.USER_MESSAGES[category];
        const metadata = { ...context, category };

        if (userMessage) {
            this._logAuthError(userMessage.title, null, metadata);
            this.logger.info?.(userMessage.message);
        } else {
            this._logAuthError(`Authentication error: ${category}`, null, metadata);
        }
    }

    handleTokenValidationError(error) {
        this._logAuthError('Error ensuring valid token', error, {
            message: error.message,
            stack: error.stack?.split('\n')[0] // First line of stack trace
        });
        
        // Return true to allow operations to proceed - they might still work
        // This maintains backward compatibility and prevents blocking operations
        // when token validation has temporary issues
        this.logger.debug?.('Allowing operation to proceed despite token validation error', 'auth-error-handler');
        return true;
    }

    createRetryStrategy(errorAnalysis, currentAttempt = 0, maxAttempts = 3) {
        if (!errorAnalysis.recoverable || currentAttempt >= maxAttempts) {
            return {
                shouldRetry: false,
                delay: 0,
                reason: errorAnalysis.recoverable ? 'Max attempts reached' : 'Error not recoverable'
            };
        }

        let delay = 1000; // Default 1 second

        switch (errorAnalysis.category) {
            case 'rate_limited':
                delay = (errorAnalysis.retryAfter || 60) * 1000;
                break;
            case 'network_error':
                delay = Math.pow(2, currentAttempt + 1) * 1000; // Exponential backoff
                break;
            default:
                delay = (currentAttempt + 1) * 1000; // Linear backoff
        }

        return {
            shouldRetry: true,
            delay,
            reason: `Retry ${currentAttempt + 1}/${maxAttempts} for ${errorAnalysis.category}`
        };
    }

    formatErrorForDebugging(error, context = 'unknown') {
        return {
            context,
            message: error.message,
            statusCode: error.response?.status,
            errorCode: error.code,
            isAxiosError: error.isAxiosError,
            hasResponse: !!error.response,
            responseData: error.response?.data,
            stack: error.stack?.split('\n').slice(0, 3) // First 3 lines of stack
        };
    }

    logOperationalError(message, context = 'auth-error-handler', payload = null) {
        if (!this.errorHandler) {
            this.errorHandler = createPlatformErrorHandler(this.logger, 'auth-error-handler');
        }
        this.errorHandler.logOperationalError(message, context, payload);
    }

    handleEventProcessingError(error, eventType, payload = null, message = null, logContext = 'auth-error-handler') {
        if (!this.errorHandler) {
            this.errorHandler = createPlatformErrorHandler(this.logger, 'auth-error-handler');
        }
        this.errorHandler.handleEventProcessingError(error, eventType, payload, message, logContext);
    }
}

module.exports = AuthErrorHandler;

AuthErrorHandler.prototype._logAuthError = function(message, error = null, payload = null, logContext = 'auth-error-handler') {
    if (!this.errorHandler) {
        this.errorHandler = createPlatformErrorHandler(this.logger, 'auth-error-handler');
    }

    if (error instanceof Error) {
        this.errorHandler.handleEventProcessingError(
            error,
            'auth-error',
            payload,
            message,
            logContext
        );
        return;
    }

    this.errorHandler.logOperationalError(message, logContext, payload);
};
