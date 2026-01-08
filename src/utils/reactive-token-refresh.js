
const { 
    AuthErrorFactory, 
    ErrorHandler, 
    TokenRefreshError,
    NetworkError
} = require('./auth-errors');
const { createPlatformErrorHandler } = require('./platform-error-handler');
const { resolveLogger } = require('./logger-resolver');

class ReactiveTokenRefresh {
    constructor(config, dependencies = {}) {
        this.config = config;
        this.logger = resolveLogger(dependencies.logger, 'ReactiveTokenRefresh');
        this.TwitchTokenRefresh = dependencies.TwitchTokenRefresh || require('./twitch-token-refresh');
        
        // Enhanced error handling
        this.errorHandler = new ErrorHandler(this.logger);
        this.platformErrorHandler = createPlatformErrorHandler(this.logger, 'reactive-token-refresh');
        
        // Track refresh attempts to prevent loops
        this.refreshAttempted = false;
        
        // Performance tracking
        this.metrics = {
            totalCalls: 0,
            refreshAttempts: 0,
            successfulRefreshes: 0,
            failedRefreshes: 0
        };
    }

    async wrapApiCall(apiCall, operationName = 'API call') {
        const startTime = Date.now();
        this.metrics.totalCalls++;
        
        try {
            // Reset refresh tracking for new operation
            this.refreshAttempted = false;

            // Execute initial API call
            this.logger.debug?.(`[REACTIVE-REFRESH] Executing ${operationName}`, 'reactive-token-refresh');
            const result = await this._executeWithRefreshHandling(apiCall, operationName);
            
            // Track successful call metrics
            const duration = Date.now() - startTime;
            this.logger.debug?.(`[REACTIVE-REFRESH] ${operationName} completed in ${duration}ms`, 'reactive-token-refresh');
            
            return result;

        } catch (error) {
            // Enhanced error handling with standardized categorization
            const duration = Date.now() - startTime;
            const context = {
                operationName,
                duration,
                refreshAttempted: this.refreshAttempted,
                operation: () => this.wrapApiCall(apiCall, operationName)
            };
            
            try {
                return await this.errorHandler.handleError(error, context);
            } catch (handledError) {
                // Log final error with enhanced context
                this._logReactiveRefreshError(
                    `[REACTIVE-REFRESH] ${operationName} failed after ${duration}ms`,
                    handledError,
                    {
                        errorType: handledError.constructor.name,
                        errorCode: handledError.code,
                        refreshAttempted: this.refreshAttempted
                    },
                    'reactive-token-refresh',
                    'wrap-api-call'
                );
                throw handledError;
            }
        }
    }

    async _executeWithRefreshHandling(apiCall, operationName) {
        try {
            // Make the initial API call
            const response = await apiCall();
            
            this.logger.debug?.(`[REACTIVE-REFRESH] ${operationName} succeeded`, 'reactive-token-refresh');
            return {
                success: true,
                response,
                refreshed: false
            };

        } catch (error) {
            // Enhanced error categorization and handling
            const categorizedError = this._categorizeApiError(error, operationName);
            
            // Check if this is a network error - these should not go through refresh pattern
            if (categorizedError instanceof NetworkError) {
                this.logger.debug?.(`[REACTIVE-REFRESH] Network error for ${operationName}, not attempting refresh`, 'reactive-token-refresh');
                throw categorizedError;
            }
            
            // Check if this is a 401 error that can be handled with refresh
            // Other HTTP errors (403, 500, etc.) should not go through refresh pattern
            if (this._is401UnauthorizedError(error)) {
                if (this._canAttemptRefresh()) {
                    this.logger.info?.(`[REACTIVE-REFRESH] 401 Unauthorized detected for ${operationName}, attempting token refresh`, 'reactive-token-refresh');
                    
                    // Attempt token refresh with enhanced error handling
                    const refreshResult = await this._attemptTokenRefresh();
                    if (refreshResult.success) {
                        // Retry the original API call with new token
                        return await this._retryWithNewToken(apiCall, operationName);
                    } else {
                        // Refresh failed, throw standardized refresh error
                        throw refreshResult.error;
                    }
                } else {
                    // Cannot attempt refresh, create appropriate error
                    this.logger.debug?.(`[REACTIVE-REFRESH] Cannot attempt refresh for ${operationName}`, 'reactive-token-refresh');
                    throw new TokenRefreshError('Cannot attempt token refresh', {
                        originalError: error,
                        context: { operationName, reason: 'refresh_already_attempted_or_no_refresh_token' },
                        needsNewTokens: !this.config.refreshToken
                    });
                }
            }

            // For non-401, non-network errors, throw categorized error
            throw categorizedError;
        }
    }

    async _retryWithNewToken(apiCall, operationName) {
        try {
            this.logger.info?.(`[REACTIVE-REFRESH] Retrying ${operationName} with refreshed token`, 'reactive-token-refresh');
            
            const response = await apiCall();
            
            this.logger.info?.(`[REACTIVE-REFRESH] ${operationName} succeeded after token refresh`, 'reactive-token-refresh');
            return {
                success: true,
                response,
                refreshed: true
            };

        } catch (retryError) {
            // If retry also fails with 401, don't attempt another refresh (prevent loops)
            if (this._is401UnauthorizedError(retryError)) {
                this.logger.warn?.(`Token refresh succeeded but validation still failing`, 'token-validator');
                throw new Error('Token refresh completed but retry validation failed - OAuth required');
            }

            // For other retry errors, propagate them
            this._logReactiveRefreshError(
                `[REACTIVE-REFRESH] ${operationName} failed on retry:`,
                retryError,
                null,
                'reactive-token-refresh',
                'retry-with-new-token'
            );
            throw retryError;
        }
    }

    async _attemptTokenRefresh() {
        this.metrics.refreshAttempts++;
        
        // Check if refresh token is available
        if (!this.config.refreshToken) {
            this.logger.warn?.('[REACTIVE-REFRESH] No refresh token available for automatic refresh', 'reactive-token-refresh');
            const error = new TokenRefreshError('No refresh token available - OAuth flow required', {
                code: 'MISSING_REFRESH_TOKEN',
                needsNewTokens: true,
                context: { hasRefreshToken: false }
            });
            return {
                success: false,
                error,
                category: 'missing_refresh_token'
            };
        }

        // Store original token to detect if refresh returns same token
        const originalToken = this.config.accessToken;

        try {
            // Mark that we've attempted refresh to prevent loops
            this.refreshAttempted = true;

            // Initialize token refresh utility
            const tokenRefresh = new this.TwitchTokenRefresh(this.config);

            // Attempt token refresh
            this.logger.info?.('[REACTIVE-REFRESH] Attempting token refresh', 'reactive-token-refresh');
            const newTokenData = await tokenRefresh.refreshToken(this.config.refreshToken);

            if (!newTokenData) {
                this.metrics.failedRefreshes++;
                this._logReactiveRefreshError(
                    'Token refresh failed, OAuth flow required',
                    null,
                    {
                        context: { refreshTokenProvided: true, apiResponseNull: true }
                    },
                    'token-validator',
                    'token-validator'
                );
                const error = new TokenRefreshError('Token refresh failed - OAuth flow required', {
                    code: 'REFRESH_API_FAILED',
                    needsNewTokens: true,
                    context: { refreshTokenProvided: true, apiResponseNull: true }
                });
                return {
                    success: false,
                    error,
                    category: 'refresh_failed'
                };
            }

            // Check if refresh returned same token (shouldn't happen but guard against it)
            if (newTokenData.access_token === originalToken) {
                this.metrics.failedRefreshes++;
                this._logReactiveRefreshError(
                    'Token refresh returned identical token',
                    null,
                    {
                        context: { originalToken: originalToken?.substring(0, 10) + '...', sameTokenReturned: true }
                    },
                    'token-validator',
                    'token-validator'
                );
                const error = new TokenRefreshError('Token refresh returned same token - OAuth required', {
                    code: 'IDENTICAL_TOKEN_RETURNED',
                    needsNewTokens: true,
                    context: { originalToken: originalToken?.substring(0, 10) + '...', sameTokenReturned: true }
                });
                return {
                    success: false,
                    error,
                    category: 'identical_token'
                };
            }

            // Update config with new tokens
            const updateSuccess = await tokenRefresh.updateConfig(newTokenData);
            if (!updateSuccess) {
                this.metrics.failedRefreshes++;
                this._logReactiveRefreshError(
                    '[REACTIVE-REFRESH] Failed to update configuration with new tokens',
                    null,
                    { tokensReceived: true, configUpdateFailed: true },
                    'reactive-token-refresh',
                    'config-update'
                );
                const error = new TokenRefreshError('Token configuration update failed - OAuth flow required', {
                    code: 'CONFIG_UPDATE_FAILED',
                    needsNewTokens: true,
                    context: { tokensReceived: true, configUpdateFailed: true }
                });
                return {
                    success: false,
                    error,
                    category: 'config_update_failed'
                };
            }

            // Update the config object that was passed in (for retry)
            this.config.accessToken = newTokenData.access_token;
            this.config.apiKey = newTokenData.access_token;
            this.config.refreshToken = newTokenData.refresh_token;

            this.metrics.successfulRefreshes++;
            this.logger.info?.('[REACTIVE-REFRESH] Token refreshed successfully', 'reactive-token-refresh');
            
            // Log success message for test compatibility
            this.logger.info?.('Token configuration updated successfully', 'token-validator');
            
            return {
                success: true,
                tokens: newTokenData
            };

        } catch (refreshError) {
            this.metrics.failedRefreshes++;
            return this._handleRefreshError(refreshError);
        }
    }

    _handleRefreshError(refreshError) {
        const categorizedError = AuthErrorFactory.createTokenRefreshError(refreshError, {
            operationName: 'token_refresh',
            refreshAttempted: this.refreshAttempted
        });
        
        this._logReactiveRefreshError(
            '[REACTIVE-REFRESH] Token refresh error',
            refreshError,
            {
                category: categorizedError.category,
                code: categorizedError.code,
                message: categorizedError.message,
                status: refreshError.response?.status,
                recoverable: categorizedError.recoverable
            },
            'reactive-token-refresh',
            'token-refresh'
        );

        return {
            success: false,
            error: categorizedError,
            category: categorizedError.category,
            recoverable: categorizedError.recoverable
        };
    }

    _categorizeApiError(error, operationName) {
        const context = {
            operationName,
            refreshAttempted: this.refreshAttempted,
            hasRefreshToken: !!this.config.refreshToken
        };
        
        return AuthErrorFactory.categorizeError(error, context);
    }

    _is401UnauthorizedError(error) {
        return error.response?.status === 401;
    }
    
    getMetrics() {
        return {
            ...this.metrics,
            refreshSuccessRate: this.metrics.refreshAttempts > 0 
                ? this.metrics.successfulRefreshes / this.metrics.refreshAttempts 
                : 0,
            errorStats: this.errorHandler.getStats()
        };
    }
    
    resetMetrics() {
        this.metrics = {
            totalCalls: 0,
            refreshAttempts: 0,
            successfulRefreshes: 0,
            failedRefreshes: 0
        };
        this.errorHandler.cleanup();
    }

    _canAttemptRefresh() {
        // Don't attempt refresh if we already tried for this operation
        if (this.refreshAttempted) {
            this.logger.debug?.('[REACTIVE-REFRESH] Refresh already attempted for this operation', 'reactive-token-refresh');
            return false;
        }

        // Check if refresh token is available
        if (!this.config.refreshToken) {
            this.logger.debug?.('[REACTIVE-REFRESH] No refresh token available', 'reactive-token-refresh');
            return false;
        }

        return true;
    }
}

// Export error classes for external use
ReactiveTokenRefresh.AuthError = require('./auth-errors').AuthError;
ReactiveTokenRefresh.TokenRefreshError = require('./auth-errors').TokenRefreshError;
ReactiveTokenRefresh.NetworkError = require('./auth-errors').NetworkError;

module.exports = ReactiveTokenRefresh;

ReactiveTokenRefresh.prototype._logReactiveRefreshError = function(
    message,
    error = null,
    payload = null,
    logContext = 'reactive-token-refresh',
    eventType = 'reactive-token-refresh'
) {
    if (!this.platformErrorHandler) {
        this.platformErrorHandler = createPlatformErrorHandler(this.logger, 'reactive-token-refresh');
    }

    if (error instanceof Error) {
        this.platformErrorHandler.handleEventProcessingError(
            error,
            eventType,
            payload,
            message,
            logContext
        );
        return;
    }

    this.platformErrorHandler.logOperationalError(message, logContext, payload);
};
