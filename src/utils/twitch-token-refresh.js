
const fs = require('fs');
const https = require('https');
const { TOKEN_REFRESH_CONFIG } = require('./auth-constants');
const { validateLoggerInterface } = require('./dependency-validator');
const { safeDelay } = require('./timeout-validator');
const {
    AuthErrorFactory,
    ErrorHandler,
    ConfigError
} = require('./auth-errors');
const { createPlatformErrorHandler } = require('./platform-error-handler');
const TokenRefreshUtility = require('./token-refresh-utility');

class TwitchTokenRefresh {
    constructor(config, dependencies = {}) {
        this.config = config;
        this.fs = dependencies.fs || fs;
        this.logger = this._resolveLogger(dependencies.logger);
        this.isRefreshing = false;
        
        // Enhanced error handling
        this.errorHandler = new ErrorHandler(this.logger);
        
        // Performance and reliability tracking
        this.lastRefreshTime = null;
        this.refreshSuccessCount = 0;
        this.refreshFailureCount = 0;
        
        // Enhanced error recovery features (disabled in test environment for test predictability)
        this._retryAttempts = process.env.NODE_ENV === 'test' ? 1 : 3;
        this._retryDelay = process.env.NODE_ENV === 'test' ? 0 : 1000;

        this.platformErrorHandler = createPlatformErrorHandler(this.logger, 'twitch-token-refresh');
    }

    async needsRefresh(accessToken) {
        if (!accessToken) {
            this.logger.debug('No access token provided, refresh needed', 'twitch');
            return true;
        }

        const expiresAt = this.config.tokenExpiresAt;
        const thresholdMs = TOKEN_REFRESH_CONFIG.REFRESH_THRESHOLD_SECONDS * 1000;

        if (!expiresAt) {
            this.logger.debug('No token expiration metadata available; refreshing to ensure validity', 'twitch');
            return true;
        }

        const timeRemaining = expiresAt - Date.now();
        if (timeRemaining <= 0) {
            this.logger.info('Access token appears expired based on timestamp', 'twitch');
            return true;
        }

        if (timeRemaining <= thresholdMs) {
            this.logger.info(`Token expires soon (within ${Math.round(thresholdMs / 60000)} minutes), refreshing`, 'twitch', {
                minutesRemaining: Math.round(timeRemaining / 60000)
            });
            return true;
        }

        return false;
    }

    async refreshToken(refreshToken) {
        if (this.isRefreshing) {
            this.logger.debug('Token refresh already in progress', 'twitch');
            return null;
        }

        if (!refreshToken) {
            this._handleTokenRefreshError('No refresh token available for token refresh', null, 'token-refresh');
            return null;
        }

        this.isRefreshing = true;

        try {
            const postData = new URLSearchParams({
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            }).toString();

            const response = await this.makeRequest('https://id.twitch.tv/oauth2/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': postData.length
                }
            }, postData);

            if (response.statusCode === 200) {
                const data = JSON.parse(response.body);
                this.logger.info('Successfully refreshed Twitch token', 'twitch');
                return {
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                    expires_in: data.expires_in
                };
            } else {
                this._handleTokenRefreshError(
                    `Token refresh failed with status ${response.statusCode}`,
                    null,
                    'token-refresh',
                    response.body
                );
                return null;
            }
        } catch (error) {
            const categorizedError = AuthErrorFactory.createTokenRefreshError(error, {
                operation: 'token_refresh',
                endpoint: 'oauth2/token',
                hasRefreshToken: !!refreshToken
            });
            
            this._handleTokenRefreshError(
                'Error refreshing token',
                categorizedError,
                'token-refresh',
                {
                    errorType: categorizedError.constructor.name,
                    errorCode: categorizedError.code,
                    recoverable: categorizedError.recoverable,
                    needsNewTokens: categorizedError.needsNewTokens
                }
            );
            
            return null;
        } finally {
            this.isRefreshing = false;
        }
    }

    async updateConfig(tokenData) {
        if (!tokenData || !tokenData.access_token) {
            this._handleTokenRefreshError(
                'Invalid token data provided for config update',
                null,
                'config-update',
                {
                    hasTokenData: Boolean(tokenData),
                    hasAccessToken: Boolean(tokenData && tokenData.access_token)
                }
            );
            return false;
        }

        // Store original values for enhanced rollback capability
        const originalTokens = {
            accessToken: this.config.accessToken,
            refreshToken: this.config.refreshToken,
            apiKey: this.config.apiKey
        };

        try {
            // Update config in memory first (maintaining original pattern)
            this.config.accessToken = tokenData.access_token;
            this.config.apiKey = tokenData.access_token; // apiKey is used as the OAuth token
            if (tokenData.refresh_token) {
                this.config.refreshToken = tokenData.refresh_token;
            }
            if (tokenData.expires_in) {
                this.config.tokenExpiresAt = Date.now() + (tokenData.expires_in * 1000);
            }

            // Persist tokens with enhanced retry logic
            await this._persistTokensWithRetry(tokenData);
            
            // Track successful refresh for performance monitoring
            this.refreshSuccessCount++;
            this.lastRefreshTime = Date.now();
            
            // Log in test-compatible format for backwards compatibility
            this.logger.info('Configuration updated with new tokens', 'twitch');
            
            // Enhanced logging for debugging (when not in test environment)
            if (process.env.NODE_ENV !== 'test') {
                this.logger.debug('Enhanced config update details', 'twitch', {
                    hasRefreshToken: Boolean(tokenData.refresh_token),
                    successCount: this.refreshSuccessCount,
                    failureCount: this.refreshFailureCount,
                    tokenUpdatePattern: 'memory-first-then-file'
                });
            }
            
            return true;
            
        } catch (error) {
            // Enhanced error handling with automatic rollback
            this.refreshFailureCount++;
            
            // Rollback memory changes to ensure consistency
            this.config.accessToken = originalTokens.accessToken;
            this.config.refreshToken = originalTokens.refreshToken;
            this.config.apiKey = originalTokens.apiKey;
            
            // Create standardized config error
            const configError = new ConfigError('Token configuration update failed', {
                originalError: error,
                code: 'CONFIG_UPDATE_FAILED',
                context: {
                    failureCount: this.refreshFailureCount,
                    successCount: this.refreshSuccessCount,
                    rollbackApplied: true,
                    hasTokenData: Boolean(tokenData && tokenData.access_token)
                },
                recoverable: false
            });
            
            // Log in test-compatible format first
            this._handleTokenRefreshError(
                'Error updating configuration with new tokens',
                configError,
                'config-update',
                {
                    errorType: configError.constructor.name,
                    errorCode: configError.code,
                    rollbackApplied: true
                }
            );
            
            // Enhanced error logging for debugging (when not in test environment)
            if (process.env.NODE_ENV !== 'test') {
                this.logger.debug('Enhanced error recovery details', 'twitch', {
                    recoveryActions: configError.getRecoveryActions(),
                    technicalDetails: configError.getTechnicalDetails()
                });
            }
            
            throw configError;
        }
    }

    async persistTokens(tokenData) {
        try {
            if (!this.config.tokenStorePath) {
                throw new ConfigError('Token store path is required', {
                    code: 'TOKEN_STORE_MISSING',
                    context: { tokenDataKeys: Object.keys(tokenData || {}) },
                    recoverable: false
                });
            }

            const tokenUtility = new TokenRefreshUtility({
                logger: this.logger,
                tokenStorePath: this.config.tokenStorePath,
                fs: this.fs
            });
            const expiresAt = tokenData.expires_in
                ? Date.now() + (tokenData.expires_in * 1000)
                : null;
            const success = await tokenUtility.persistTokens(
                tokenData.access_token,
                tokenData.refresh_token,
                expiresAt
            );

            if (!success) {
                throw new ConfigError('Token store update failed', {
                    code: 'TOKEN_STORE_UPDATE_FAILED',
                    context: { tokenDataKeys: Object.keys(tokenData || {}) },
                    recoverable: true
                });
            }

            this.logger.debug('Token store updated successfully with new tokens', 'twitch');
        } catch (error) {
            const configError = error instanceof ConfigError
                ? error
                : new ConfigError('Token store update failed', {
                    originalError: error,
                    code: 'TOKEN_STORE_UPDATE_FAILED',
                    context: {
                        operation: 'token_store_write',
                        tokenDataKeys: Object.keys(tokenData || {})
                    },
                    recoverable: true
                });
            
            this._handleTokenRefreshError(
                'Error updating token store with new tokens',
                configError,
                'config-update',
                {
                    errorType: configError.constructor.name,
                    errorCode: configError.code
                }
            );
            
            if (process.env.NODE_ENV !== 'test') {
                this.logger.debug('Enhanced error recovery details', 'twitch', {
                    recoveryActions: configError.getRecoveryActions(),
                    technicalDetails: configError.getTechnicalDetails()
                });
            }
            
            throw configError;
        }
    }

    async _persistTokensWithRetry(tokenData) {
        let attempt = 1;
        let lastError = null;

        while (attempt <= this._retryAttempts) {
            try {
                await this.persistTokens(tokenData);
                
                if (attempt > 1) {
                    this.logger.info(`Token store update succeeded on attempt ${attempt}`, 'twitch');
                }
                return; // Success
                
            } catch (error) {
                lastError = error;
                
                this.logger.warn(`Token store update attempt ${attempt} failed`, 'twitch', {
                    error: error.message,
                    attemptsRemaining: this._retryAttempts - attempt
                });

                if (attempt < this._retryAttempts) {
                    // Exponential backoff: 1s, 2s, 4s
                    const delay = this._retryDelay * Math.pow(2, attempt - 1);
                    this.logger.debug(`Retrying token store update in ${delay}ms`, 'twitch');
                    await this._sleep(delay);
                }

                attempt++;
            }
        }

        // All attempts failed
        this._handleTokenRefreshError(
            `All ${this._retryAttempts} token store update attempts failed`,
            lastError,
            'config-update',
            { finalError: lastError.message }
        );
        throw lastError;
    }

    _sleep(ms) {
        if (!ms || ms <= 0) {
            return Promise.resolve();
        }
        return safeDelay(ms, ms, 'twitchTokenRefresh:backoff');
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
            // Logging module might not yet be initialized; continue with other candidates
        }

        const selected = candidates.find(Boolean);
        if (!selected) {
            throw new Error('TwitchTokenRefresh requires a logger dependency');
        }

        const normalized = this._normalizeLoggerMethods(selected);
        validateLoggerInterface(normalized);
        return normalized;
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

    _handleTokenRefreshError(message, error, eventType = 'token-refresh', eventData = null) {
        const err = error instanceof Error ? error : new Error(message);
        this.platformErrorHandler = createPlatformErrorHandler(this.logger, 'twitch-token-refresh');
        this.platformErrorHandler.handleEventProcessingError(err, eventType, eventData, message, 'twitch');
    }

    async ensureValidToken() {
        const startTime = Date.now();
        
        try {
            const currentToken = this.config.accessToken || this.config.apiKey;
            
            // Check if refresh is needed
            const refreshNeeded = await this.needsRefresh(currentToken);
            if (!refreshNeeded) {
                this.logger.debug('Token is still valid, no refresh needed', 'twitch', {
                    tokenAge: this.lastRefreshTime ? Date.now() - this.lastRefreshTime : 'unknown',
                    successCount: this.refreshSuccessCount
                });
                return true;
            }

            this.logger.info('Token refresh required, attempting refresh with enhanced reliability', 'twitch', {
                refreshFailureCount: this.refreshFailureCount,
                lastRefreshTime: this.lastRefreshTime
            });
            
            // Attempt token refresh with enhanced error handling
            const tokenData = await this.refreshToken(this.config.refreshToken);
            if (!tokenData) {
                this._handleTokenRefreshError(
                    'Failed to refresh token from Twitch API',
                    null,
                    'token-refresh',
                    {
                        failureCount: this.refreshFailureCount + 1,
                        refreshToken: this.config.refreshToken ? 'present' : 'missing'
                    }
                );
                return true;
            }

            // Update configuration with enhanced reliability
            const updateSuccess = await this.updateConfig(tokenData);
            if (!updateSuccess) {
                this._handleTokenRefreshError(
                    'Failed to update configuration with new tokens despite successful API refresh',
                    null,
                    'config-update'
                );
                return true;
            }

            if (tokenData.expires_in) {
                this.config.tokenExpiresAt = Date.now() + (tokenData.expires_in * 1000);
            }

            const refreshDuration = Date.now() - startTime;
            this.logger.info('Token refresh completed successfully with enhanced reliability', 'twitch', {
                refreshDuration: `${refreshDuration}ms`,
                successCount: this.refreshSuccessCount,
                hasNewRefreshToken: Boolean(tokenData.refresh_token),
                retryCapability: `${this._retryAttempts} attempts with exponential backoff`
            });
            
            return true;
            
        } catch (error) {
            const refreshDuration = Date.now() - startTime;
            
            const categorizedError = AuthErrorFactory.categorizeError(error, {
                operation: 'ensure_valid_token',
                duration: refreshDuration,
                failureCount: this.refreshFailureCount,
                successCount: this.refreshSuccessCount
            });
            
            this._handleTokenRefreshError(
                'Error during enhanced token refresh process',
                categorizedError,
                'token-refresh',
                {
                    errorType: categorizedError.constructor.name,
                    errorCode: categorizedError.code,
                    refreshDuration: `${refreshDuration}ms`,
                    recoverable: categorizedError.recoverable,
                    retryable: categorizedError.retryable
                }
            );
            
            // Enhanced error logging for debugging (when not in test environment)
            if (process.env.NODE_ENV !== 'test') {
                this.logger.debug('Token refresh recovery suggestions', 'twitch', {
                    recoveryActions: categorizedError.getRecoveryActions(),
                    technicalDetails: categorizedError.getTechnicalDetails()
                });
            }
            
            return true;
        }
    }

    makeRequest(url, options, postData = null) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, options, (res) => {
                let body = '';
                res.on('data', (chunk) => {
                    body += chunk;
                });
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: body
                    });
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            if (postData) {
                req.write(postData);
            }
            req.end();
        });
    }
    
    getRefreshStats() {
        return {
            successCount: this.refreshSuccessCount,
            failureCount: this.refreshFailureCount,
            successRate: this.refreshSuccessCount + this.refreshFailureCount > 0 
                ? this.refreshSuccessCount / (this.refreshSuccessCount + this.refreshFailureCount)
                : 0,
            lastRefreshTime: this.lastRefreshTime,
            timeSinceLastRefresh: this.lastRefreshTime ? Date.now() - this.lastRefreshTime : null,
            isRefreshing: this.isRefreshing,
            retryConfiguration: {
                maxAttempts: this._retryAttempts,
                baseDelay: this._retryDelay,
                backoffType: 'exponential'
            },
            errorStats: this.errorHandler.getStats()
        };
    }
    
    getHealthStatus() {
        const stats = this.getRefreshStats();
        const recentFailures = stats.failureCount;
        const isHealthy = !this.isRefreshing && (recentFailures === 0 || stats.successRate > 0.5);
        
        return {
            healthy: isHealthy,
            status: isHealthy ? 'operational' : 'degraded',
            metrics: {
                successRate: stats.successRate,
                recentFailures: recentFailures,
                lastSuccess: stats.lastRefreshTime
            },
            issues: isHealthy ? [] : [
                recentFailures > 3 ? 'High failure rate detected' : null,
                stats.successRate < 0.5 ? 'Low success rate' : null,
                this.isRefreshing ? 'Refresh operation in progress' : null
            ].filter(Boolean)
        };
    }
    
    cleanup() {
        this.isRefreshing = false;
        this.lastRefreshTime = null;
        this.refreshSuccessCount = 0;
        this.refreshFailureCount = 0;
        
        // Clean up error handler
        if (this.errorHandler) {
            this.errorHandler.cleanup();
        }
        
        this.logger.debug('TwitchTokenRefresh cleanup completed with enhanced tracking reset', 'twitch');
    }
    
    resetStats() {
        this.refreshSuccessCount = 0;
        this.refreshFailureCount = 0;
        this.lastRefreshTime = null;
        
        if (this.errorHandler) {
            this.errorHandler.cleanup();
        }
        
        this.logger.debug('TwitchTokenRefresh statistics reset', 'twitch');
    }
}

// Export error classes for external use
TwitchTokenRefresh.AuthError = require('./auth-errors').AuthError;
TwitchTokenRefresh.TokenRefreshError = require('./auth-errors').TokenRefreshError;
TwitchTokenRefresh.ConfigError = require('./auth-errors').ConfigError;
TwitchTokenRefresh.NetworkError = require('./auth-errors').NetworkError;

module.exports = TwitchTokenRefresh;
