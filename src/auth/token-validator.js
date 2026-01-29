
const TwitchAuthFactory = require('./TwitchAuthFactory');
const { handleUserFacingError } = require('../utils/user-friendly-errors');
const { createPlatformErrorHandler, ensurePlatformErrorHandler } = require('../utils/platform-error-handler');
const { secrets } = require('../core/secrets');

class TokenValidator {
    constructor(authFactory = null, dependencies = {}) {
        this.logger = null;
        this.authFactory = authFactory;
        this.dependencies = { ...dependencies };
        this.errorHandler = null;
        this.axios = dependencies.axios || null;
    }
    
    initializeLogger() {
        if (!this.logger) {
            const { getUnifiedLogger } = require('../core/logging');
            this.logger = getUnifiedLogger();
        }
        this.errorHandler = ensurePlatformErrorHandler(this.errorHandler, this.logger, 'token-validator');
    }

    async validateTwitchTokens(config) {
        this.initializeLogger();
        
        const validation = {
            isValid: false,
            needsRefresh: false,
            needsNewTokens: false,
            errors: [],
            warnings: [],
            retryable: false,
            userExperience: 'interrupted', // Default to interrupted, set to seamless if valid
            missingClientCredentials: false
        };

        try {
            // Check if basic auth config exists
            if (!config.clientId || !secrets.twitch.clientSecret) {
                validation.errors.push('Missing clientId or clientSecret');
                validation.needsNewTokens = true;
                validation.missingClientCredentials = true;
                return validation;
            }

            if (!config.accessToken || !config.refreshToken) {
                validation.errors.push('Missing accessToken or refreshToken');
                validation.needsNewTokens = true;
                return validation;
            }

            // Check for placeholder/test tokens that should not be accepted
            if (this._isPlaceholderToken(config.accessToken)) {
                validation.errors.push('Placeholder or test accessToken detected - real OAuth token required');
                validation.needsNewTokens = true;
                return validation;
            }
            
            // Validate token scopes before proceeding with full auth
            const scopeValidation = await this._validateTokenScopes(config);
            if (!scopeValidation.valid) {
                validation.errors.push(...scopeValidation.errors);
                
                // Propagate specific flags from scope validation
                if (scopeValidation.needsRefresh) {
                    validation.needsRefresh = true;
                    validation.needsNewTokens = true; // 401 means we need new tokens
                } else if (scopeValidation.retryable) {
                    validation.retryable = scopeValidation.retryable;
                    // Don't set needsNewTokens for network errors
                } else {
                    validation.needsNewTokens = true;
                }
                
                return validation;
            }

            // Use shared auth factory to get or create auth manager
            const authFactory = this.authFactory || new TwitchAuthFactory(config);
            
            try {
                // Try to get initialized auth manager (will test tokens)
                const authManager = await authFactory.getInitializedAuthManager();
                
                // Try to get access token (this will trigger refresh if needed)
                await authManager.getAccessToken();
                
                // Verify auth provider is working
                authManager.getAuthProvider();
                authManager.getUserId();

                // If we get here, authentication is working
                validation.isValid = true;
                validation.userExperience = 'seamless'; // No interruption needed
                validation.authManager = authManager; // Return the validated instance for reuse
                validation.authFactory = authFactory; // Return factory for dependency injection
                this.logger.info('Twitch tokens validated successfully', 'token-validator');
                
            } catch (authError) {
                // Cleanup on error
                await authFactory.cleanup();
                
                // Check if it's a token expiration error
                if (authError.message.includes('401') || 
                    authError.message.includes('Invalid OAuth token') ||
                    authError.message.includes('Token expired') ||
                    authError.message.includes('invalid_grant') ||
                    authError.message.includes('Invalid refresh token') ||
                    authError.message.includes('Could not find a token') ||
                    authError.message.includes('Could not retrieve a valid token')) {
                    
                    validation.needsRefresh = true;
                    validation.errors.push('Access token expired or invalid');
                    
                    // Check if refresh token might also be expired
                    if (authError.message.includes('refresh') || 
                        authError.message.includes('400') ||
                        authError.message.includes('Invalid refresh token')) {
                        validation.needsNewTokens = true;
                        validation.errors.push('Refresh token may also be expired');
                    }
                } else {
                    // Other authentication errors
                    validation.needsNewTokens = true;
                    validation.errors.push(`Authentication failed: ${authError.message}`);
                }
            }

        } catch (error) {
            validation.errors.push(`Token validation failed: ${error.message}`);
            validation.needsNewTokens = true;
        }

        return validation;
    }

    async runOAuthFlow(config) {
        this.initializeLogger();
        
        try {
            // Use new architecture: TwitchAuthInitializer instead of deprecated TwitchAuth facade
            const TwitchAuthService = require('./TwitchAuthService');
            const TwitchAuthInitializer = require('./TwitchAuthInitializer');
            
            const authService = new TwitchAuthService(config, { logger: this.logger });
            const authInitializer = new TwitchAuthInitializer({ logger: this.logger });
            
            // Call triggerOAuthFlow instead of initializeAuthentication to open browser
            const tokens = await authInitializer.triggerOAuthFlow(authService);
            
            if (tokens) {
                this.logger.info('OAuth flow completed successfully', 'token-validator');
                return tokens;
            }
            
            this._logValidatorError('OAuth flow failed');
            return null;
            
        } catch (error) {
            this._logValidatorError(`OAuth flow failed: ${error.message}`, error);
            
            // Show user-friendly error message
            handleUserFacingError(error, {
                logger: this.logger,
                category: 'authentication',
                platform: 'twitch'
            }, {
                showInConsole: true,
                includeActions: true,
                logTechnical: true
            });
            
            return null;
        }
    }

    async validateAllTokens(config) {
        this.initializeLogger();
        
        const results = {
            isValid: true,
            platforms: {}
        };

        // Check Twitch if enabled
        if (config.twitch?.enabled) {
            this.logger.info('Validating Twitch authentication tokens...', 'token-validator');
            results.platforms.twitch = await this.validateTwitchTokens(config.twitch);
            
            if (!results.platforms.twitch.isValid) {
                results.isValid = false;
            }
        }

        // Future: Add other platforms that require token validation
        // YouTube API tokens, TikTok API tokens, etc.

        return results;
    }

    async handleAuthenticationFlow(results, config) {
        this.initializeLogger();
        
        if (results.isValid) {
            this.logger.info('All authentication tokens validated successfully', 'token-validator');
            return true;
        }

        // Handle platform-specific authentication issues
        for (const [platform, validation] of Object.entries(results.platforms)) {
            if (!validation.isValid && platform === 'twitch') {
                if (validation.missingClientCredentials) {
                    const missingCredentialsError = new Error('Missing clientId or clientSecret for Twitch authentication');
                    handleUserFacingError(missingCredentialsError, {
                        logger: this.logger,
                        category: 'authentication',
                        operation: 'startup'
                    }, {
                        showInConsole: true,
                        includeActions: true,
                        logTechnical: true
                    });
                    return false;
                }
                const tokens = await this.runOAuthFlow(config.twitch || {});
                if (!tokens) {
                    return false;
                }

                const updatedTwitchConfig = {
                    ...(config.twitch || {}),
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token
                };

                // Re-validate with the new credentials
                const revalidation = await this.validateTwitchTokens(updatedTwitchConfig);
                results.platforms.twitch = revalidation;
                results.isValid = revalidation.isValid;

                if (revalidation.isValid) {
                    this.logger.info('Authentication restored after OAuth flow', 'token-validator');
                    return true;
                }

                const postOAuthError = new Error('Authentication validation failed after OAuth flow');
                handleUserFacingError(postOAuthError, {
                    logger: this.logger,
                    category: 'authentication',
                    operation: 'startup'
                }, {
                    showInConsole: true,
                    includeActions: true,
                    logTechnical: true
                });
                
                return false;
            }
        }

        // Authentication failed - show user-friendly message
        const authError = new Error('Authentication validation failed - unable to connect to streaming platforms');
        handleUserFacingError(authError, {
            logger: this.logger,
            category: 'authentication',
            operation: 'startup'
        }, {
            showInConsole: true,
            includeActions: true,
            logTechnical: true
        });
        
        return false;
    }

    async _validateTokenScopes(config) {
        const TwitchAuthService = require('./TwitchAuthService');
        const ReactiveTokenRefresh = require('../utils/reactive-token-refresh');
        const axios = this.axios || require('axios');
        
        const authService = new TwitchAuthService(config, { logger: this.logger });
        const requiredScopes = authService.getRequiredScopes();
        
        // Create reactive token refresh wrapper
        const tokenRefresh = new ReactiveTokenRefresh(config, { 
            logger: this.logger,
            TwitchTokenRefresh: require('../utils/twitch-token-refresh')
        });
        
        // API call function that will be wrapped with reactive refresh logic
        const validateTokenScopes = async () => {
            const response = await axios.get('https://id.twitch.tv/oauth2/validate', {
                headers: {
                    'Authorization': `Bearer ${config.accessToken}`
                },
                timeout: 10000
            });
            
            const actualScopes = response.data.scopes || [];
            const actualScopeSet = new Set(actualScopes);
            
            // Find missing scopes
            const missingScopes = requiredScopes.filter(scope => !actualScopeSet.has(scope));
            
            if (missingScopes.length > 0) {
                this.logger?.warn?.('Token missing required scopes for EventSub', 'token-validator', {
                    required: requiredScopes,
                    actual: actualScopes,
                    missing: missingScopes
                });
                
                // Return missing scopes as part of response data for processing
                return {
                    ...response,
                    data: {
                        ...response.data,
                        missingScopes
                    }
                };
            }
            
            return response;
        };
        
        try {
            // Execute token validation with automatic refresh handling
            const result = await tokenRefresh.wrapApiCall(validateTokenScopes, 'token scope validation');
            
            if (!result.success) {
                // Handle categorized errors from reactive refresh
                return this._handleScopeValidationError(result);
            }
            
            // Check if validation succeeded but has missing scopes
            const missingScopes = result.response.data.missingScopes;
            if (missingScopes && missingScopes.length > 0) {
                return {
                    valid: false,
                    errors: missingScopes.map(scope => `Missing required OAuth scope: ${scope}`)
                };
            }
            
            // Log success with refresh status for backward compatibility
            if (result.refreshed) {
                this.logger?.info?.('Token refreshed successfully, retrying validation', 'token-validator');
                this.logger?.info?.('Token configuration updated successfully', 'token-validator');
                this.logger?.info?.('Token scopes validated successfully', 'token-validator');
            } else {
                this.logger?.info?.('Token scopes validated successfully', 'token-validator');
            }
            
            return { valid: true, errors: [] };
            
        } catch (error) {
            // Handle errors that weren't caught by reactive refresh (e.g., no refresh token case)
            this._logValidatorError('Failed to validate token scopes', error);
            
            // Handle specific HTTP error codes
            if (error.response) {
                const status = error.response.status;
                const message = error.response.data?.message || error.response.data?.error || error.message;
                
                if (status === 401) {
                    // 401 without refresh token available - handle directly
                    if (!config.refreshToken) {
                        this.logger?.warn?.('No refresh token available for automatic refresh', 'token-validator');
                        return {
                            valid: false,
                            errors: ['No refresh token available - OAuth flow required'],
                            needsRefresh: true
                        };
                    }
                    
                    // Other 401 cases (this shouldn't happen with reactive refresh)
                    return {
                        valid: false,
                        errors: [`Token validation failed: ${status}`],
                        needsRefresh: true
                    };
                } else if (status === 403) {
                    return {
                        valid: false,
                        errors: [`Token validation failed: 403 - Forbidden`]
                        // No needsRefresh for 403 errors
                    };
                } else if (status === 500) {
                    return {
                        valid: false,
                        errors: [`Token validation failed: ${status} - Internal Server Error`]
                        // No needsRefresh for 500 errors
                    };
                }
                
                return {
                    valid: false,
                    errors: [`Token validation failed: ${status} - ${message}`]
                };
            }
            
            // Handle network errors for backward compatibility
            if (error.code === 'ECONNREFUSED' || 
                error.code === 'ETIMEDOUT' || 
                error.code === 'ENOTFOUND' ||
                error.code === 'ECONNABORTED' ||
                error.code === 'ECONNRESET') {
                return {
                    valid: false,
                    errors: [`Token validation failed: Network error`],
                    retryable: true
                };
            }
            
            // Check if this is a refresh-related error
            if (error.message && (
                error.message.includes('Token refresh failed') ||
                error.message.includes('Token refresh returned same token') ||
                error.message.includes('Token refresh completed but retry validation failed') ||
                error.message.includes('Refresh token expired')
            )) {
                // For network errors during refresh, preserve retryable flag
                const result = {
                    valid: false,
                    errors: [error.message]
                };
                
                if (error.message.includes('Token refresh failed due to network error')) {
                    result.retryable = true;
                } else {
                    result.needsRefresh = true;
                }
                
                return result;
            }
            
            // Check if this error has the refresh error flag
            if (error.isRefreshError) {
                return {
                    valid: false,
                    errors: [error.message],
                    needsRefresh: true
                };
            }
            
            return {
                valid: false,
                errors: [`Scope validation failed: ${error.message}`]
            };
        }
    }

    _handleScopeValidationError(result) {
        const { error, category } = result;

        // Handle specific error messages first
        if (error && error.message) {
            if (error.message.includes('Token refresh completed but retry validation failed')) {
                return {
                    valid: false,
                    errors: ['Token refresh completed but retry validation failed - OAuth required'],
                    needsRefresh: true
                };
            }
            
            if (error.message.includes('Token refresh returned same token')) {
                return {
                    valid: false,
                    errors: ['Token refresh returned same token - OAuth required'],
                    needsRefresh: true
                };
            }
        }
        
        // Map reactive refresh categories to validation result format
        switch (category) {
            case 'missing_refresh_token':
                return {
                    valid: false,
                    errors: ['No refresh token available - OAuth flow required'],
                    needsRefresh: true
                };
                
            case 'expired_refresh_token':
                return {
                    valid: false,
                    errors: ['Refresh token expired - OAuth flow required'],
                    needsRefresh: true
                };
                
            case 'invalid_refresh_token':
                return {
                    valid: false,
                    errors: ['Refresh token expired - OAuth flow required'],
                    needsRefresh: true
                };
                
            case 'refresh_failed':
            case 'config_update_failed':
                return {
                    valid: false,
                    errors: ['Token refresh failed - OAuth flow required'],
                    needsRefresh: true
                };
                
            case 'network_error':
                // For network errors, check if it happened during refresh
                if (error.code && ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNABORTED', 'ECONNRESET'].includes(error.code)) {
                    return {
                        valid: false,
                        errors: ['Token refresh failed due to network error'],
                        retryable: true
                    };
                } else {
                    return {
                        valid: false,
                        errors: ['Token validation failed: Network error'],
                        retryable: true
                    };
                }
                
            case 'auth_error':
                return {
                    valid: false,
                    errors: ['Token refresh failed - OAuth flow required'],
                    needsRefresh: true
                };
                
            case 'server_error':
                return {
                    valid: false,
                    errors: [`Token validation failed: ${error.response?.status} - Server error`]
                };
                
            case 'client_error':
                return {
                    valid: false,
                    errors: [`Token validation failed: ${error.response?.status} - ${error.response?.data?.message || error.message}`]
                };
                
            default:
                // For unknown errors, fall back to original error handling
                if (error.response?.status) {
                    return {
                        valid: false,
                        errors: [`Token validation failed: ${error.response.status}`],
                        needsRefresh: error.response.status === 401 ? true : undefined
                    };
                }
                
                return {
                    valid: false,
                    errors: [`Token refresh failed - OAuth flow required`],
                    needsRefresh: true
                };
        }
    }

    _isPlaceholderToken(token) {
        if (!token || typeof token !== 'string') {
            return false;
        }

        // Common placeholder token patterns
        const placeholderPatterns = [
            /^new_access_\d+$/i,         // new_access_123456789
            /^test_token_/i,             // test_token_123
            /^placeholder_/i,            // placeholder_token
            /your_access_token/i,        // your_access_token_here
            /^example_/i,                // example_token
            /^demo_/i,                   // demo_access_token
            /^temp_token_/i,             // temp_token_xyz
            /^sample_/i,                 // sample_token
            /^dummy_/i,                  // dummy_token
            /^mock_/i,                   // mock_token
            /^null$/i,                   // "null" string
            /^undefined$/i               // "undefined" string  
        ];

        return placeholderPatterns.some(pattern => pattern.test(token));
    }

    _logValidatorError(message, error = null, eventType = 'token-validator', payload = null) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, payload, message);
        } else if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'token-validator', payload || error);
        }
    }
}

async function validateAuthentication(config, authFactory = null, dependencies = {}) {
    const { getUnifiedLogger } = require('../core/logging');
    const logger = getUnifiedLogger();
    
    logger.debug('DEBUG: validateAuthentication started', 'auth');
    
    const validator = new TokenValidator(authFactory, dependencies);
    logger.debug('DEBUG: TokenValidator created', 'auth');
    
    logger.debug('DEBUG: About to call validateAllTokens', 'auth');
    const results = await validator.validateAllTokens(config);
    logger.debug('DEBUG: validateAllTokens completed', 'auth');
    
    logger.debug('DEBUG: About to call handleAuthenticationFlow', 'auth');
    const isValid = await validator.handleAuthenticationFlow(results, config);
    logger.debug('DEBUG: handleAuthenticationFlow completed', 'auth');
    
    return {
        isValid,
        authFactory: results.platforms?.twitch?.authFactory || null,
        authManager: results.platforms?.twitch?.authManager || null
    };
}

module.exports = {
    TokenValidator,
    validateAuthentication
};
