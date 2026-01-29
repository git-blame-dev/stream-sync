
const { TOKEN_REFRESH_CONFIG, TWITCH_ENDPOINTS, AuthConstants } = require('./auth-constants');
const AuthErrorHandler = require('./auth-error-handler');
const { createPlatformErrorHandler } = require('./platform-error-handler');
const { validateLoggerInterface } = require('./dependency-validator');
const tokenStore = require('./token-store');
const { secrets } = require('../core/secrets');

class TokenRefreshUtility {
    constructor(dependencies = {}) {
        this.axios = dependencies.axios || require('axios');
        this.enhancedHttpClient = dependencies.enhancedHttpClient;
        validateLoggerInterface(dependencies.logger);
        this.logger = dependencies.logger;
        this.fs = dependencies.fs || require('fs');
        this.tokenStore = dependencies.tokenStore || tokenStore;
        this.tokenStorePath = dependencies.tokenStorePath;
        
        // Initialize error handler for consistent error processing
        this.authErrorHandler = new AuthErrorHandler(this.logger);
        this.platformErrorHandler = createPlatformErrorHandler(this.logger, 'token-refresh-util');
        
        // Performance tracking
        this.performanceMetrics = {
            validationCalls: 0,
            refreshCalls: 0,
            averageValidationTime: 0,
            averageRefreshTime: 0
        };
    }

    validateRefreshPrerequisites(config) {
        if (!config.refreshToken) {
            return { 
                canRefresh: false, 
                reason: 'No refresh token available for refresh' 
            };
        }

        if (!config.clientId || !secrets.twitch.clientSecret) {
            return { 
                canRefresh: false, 
                reason: 'Missing client credentials for token refresh' 
            };
        }

        return {
            canRefresh: true,
            context: {
                hasRefreshToken: !!config.refreshToken,
                hasClientId: !!config.clientId,
                hasClientSecret: !!secrets.twitch.clientSecret
            }
        };
    }

    async executeTokenRefresh(config) {
        const startTime = Date.now();
        
        try {
            const formData = this._buildRefreshFormData(config);
            
            // Use enhanced HTTP client if available, otherwise fallback to axios
            const response = this.enhancedHttpClient 
                ? await this._refreshWithEnhancedClient(formData)
                : await this._refreshWithAxios(formData);

            const refreshTime = Date.now() - startTime;
            this._updateRefreshMetrics(refreshTime);

            if (!response || !response.data) {
                throw new Error('Invalid response from token refresh endpoint');
            }

            const { access_token, refresh_token, expires_in } = response.data;

            // Validate response contains required fields
            if (!access_token || !refresh_token) {
                this._logTokenRefreshError(
                    'Invalid token response: missing required fields',
                    null,
                    response.data
                );
                return { success: false, refreshTimeMs: refreshTime };
            }

            this.logger.info?.('[TOKEN-UTIL] Token refresh completed successfully', {
                refreshTimeMs: refreshTime,
                expiresInHours: expires_in ? (expires_in / 3600).toFixed(1) : 'unknown'
            });

            return {
                success: true,
                tokens: { access_token, refresh_token, expires_in },
                refreshTimeMs: refreshTime
            };

        } catch (error) {
            const refreshTime = Date.now() - startTime;
            this._updateRefreshMetrics(refreshTime);
            
            // Use error handler for consistent error processing
            const errorAnalysis = this.authErrorHandler.analyzeRefreshError(error);
            
            this._logTokenRefreshError('[TOKEN-UTIL] Token refresh failed', error, {
                category: errorAnalysis.category,
                severity: errorAnalysis.severity,
                refreshTimeMs: refreshTime,
                error: error.message
            });

            return {
                success: false,
                errorAnalysis,
                refreshTimeMs: refreshTime,
                error
            };
        }
    }

    async persistTokens(accessToken, refreshToken, expiresAt) {
        try {
            await this.tokenStore.saveTokens(
                {
                    tokenStorePath: this.tokenStorePath,
                    fs: this.fs,
                    logger: this.logger
                },
                {
                    accessToken,
                    refreshToken,
                    expiresAt
                }
            );

            this.logger.debug?.('[TOKEN-UTIL] Token store updated with Twitch tokens', {
                tokenStorePath: this.tokenStorePath
            });
            return true;
        } catch (error) {
            this._logTokenRefreshError('[TOKEN-UTIL] Failed to persist tokens to token store', error, {
                tokenStorePath: this.tokenStorePath,
                hasAccessToken: !!accessToken,
                hasRefreshToken: !!refreshToken,
                error: error.message,
                stack: error.stack,
                name: error.name
            });
            return false;
        }
    }

    calculateRefreshScheduling(expiresAt) {
        if (!expiresAt) {
            return {
                canSchedule: false,
                reason: 'No expiration time available'
            };
        }

        const timing = AuthConstants.calculateRefreshTiming(expiresAt);
        
        return {
            canSchedule: true,
            timing,
            shouldRefreshImmediately: timing.shouldRefreshImmediately,
            scheduleDelayMs: timing.actualDelay,
            reason: timing.shouldRefreshImmediately 
                ? `Token expires within ${TOKEN_REFRESH_CONFIG.SCHEDULE_BUFFER_MINUTES} minutes`
                : 'Normal scheduling'
        };
    }

    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            thresholds: {
                validationMs: TOKEN_REFRESH_CONFIG.VALIDATION_TIMEOUT_MS,
                refreshMs: TOKEN_REFRESH_CONFIG.EXCHANGE_TIMEOUT_MS
            }
        };
    }

    resetPerformanceMetrics() {
        this.performanceMetrics = {
            validationCalls: 0,
            refreshCalls: 0,
            averageValidationTime: 0,
            averageRefreshTime: 0
        };
    }

    // Private helper methods

    _buildRefreshFormData(config) {
        return {
            grant_type: 'refresh_token',
            refresh_token: config.refreshToken,
            client_id: config.clientId,
            client_secret: secrets.twitch.clientSecret
        };
    }

    async _refreshWithEnhancedClient(formData) {
        // Convert to URLSearchParams for proper encoding
        const encodedData = new URLSearchParams(formData).toString();
        
        return await this.enhancedHttpClient.post(
            TWITCH_ENDPOINTS.OAUTH.TOKEN,
            encodedData,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                platform: 'twitch' // Enable retry system support
            }
        );
    }

    async _refreshWithAxios(formData) {
        // Convert to URLSearchParams for proper encoding
        const encodedData = new URLSearchParams(formData).toString();
        
        return await this.axios.post(
            TWITCH_ENDPOINTS.OAUTH.TOKEN,
            encodedData,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: TOKEN_REFRESH_CONFIG.EXCHANGE_TIMEOUT_MS // Uses 5000ms for streaming optimization
            }
        );
    }

    _updateValidationMetrics(validationTime) {
        this.performanceMetrics.validationCalls++;
        this.performanceMetrics.averageValidationTime = 
            ((this.performanceMetrics.averageValidationTime * (this.performanceMetrics.validationCalls - 1)) + validationTime) / 
            this.performanceMetrics.validationCalls;
    }

    _updateRefreshMetrics(refreshTime) {
        this.performanceMetrics.refreshCalls++;
        this.performanceMetrics.averageRefreshTime = 
            ((this.performanceMetrics.averageRefreshTime * (this.performanceMetrics.refreshCalls - 1)) + refreshTime) / 
            this.performanceMetrics.refreshCalls;
    }
}

module.exports = TokenRefreshUtility;

TokenRefreshUtility.prototype._logTokenRefreshError = function(message, error = null, payload = null) {
    const handler = this.platformErrorHandler || createPlatformErrorHandler(this.logger, 'token-refresh-util');
    this.platformErrorHandler = handler;

    if (error instanceof Error) {
        handler.handleEventProcessingError(
            error,
            'token-refresh',
            payload,
            message,
            'token-refresh-util'
        );
        return;
    }

    handler.logOperationalError(message, 'token-refresh-util', payload);
};
