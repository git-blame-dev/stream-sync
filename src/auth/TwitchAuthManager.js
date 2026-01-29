
const TwitchAuthService = require('./TwitchAuthService');
const TwitchAuthInitializer = require('./TwitchAuthInitializer');
const TwitchAuthState = require('./TwitchAuthState');
const { TWITCH } = require('../core/endpoints');
const { getUnifiedLogger } = require('../core/logging');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { AUTH_STATES, AuthConstants, TOKEN_REFRESH_CONFIG } = require('../utils/auth-constants');
const { createEnhancedHttpClient } = require('../utils/enhanced-http-client');
const { createRetrySystem } = require('../utils/retry-system');
const AuthErrorHandler = require('../utils/auth-error-handler');
const { secrets } = require('../core/secrets');

// No global singleton - create independent instances

// Use centralized authentication states for consistency
const AuthStates = AUTH_STATES;

class TwitchAuthManager {
    constructor(config, dependencies = {}) {
        // Deep copy configuration to ensure complete isolation between instances
        this.config = JSON.parse(JSON.stringify(config));
        this.dependencies = { ...dependencies };
        this.state = AuthStates.UNINITIALIZED;
        this.twitchAuthService = null;
        this.twitchAuthInitializer = null;
        this.lastError = null;
        this.logger = dependencies.logger || getUnifiedLogger();
        this.errorHandler = createPlatformErrorHandler(this.logger, 'auth-manager');
        this.axios = dependencies.axios || null;
        
        // Initialize centralized error handler for consistent error processing
        this.errorHandler = new AuthErrorHandler(this.logger);

        this.enhancedHttpClient = dependencies.enhancedHttpClient || createEnhancedHttpClient({
            logger: this.logger,
            axios: this.axios || undefined,
            retrySystem: dependencies.retrySystem || createRetrySystem({ logger: this.logger })
        });
        
        // Add auth state machine to prevent race conditions
        this.authState = new TwitchAuthState(this.logger);
        
    }

    static getInstance(config, dependencies = {}) {
        return new TwitchAuthManager(config, dependencies);
    }

    static resetInstance() {
        // No-op - individual instances are managed independently
    }

    getState() {
        // Removed excessive debug logging - only log state changes, not every call
        return this.state;
    }

    getLastError() {
        return this.lastError;
    }

    getConfig() {
        return { ...this.config };
    }

    updateConfig(newConfig) {
        // Deep copy configuration to ensure complete isolation between instances
        this.config = JSON.parse(JSON.stringify(newConfig));
        this.state = AuthStates.UNINITIALIZED;
        this.lastError = null;
        
        if (this.twitchAuthService) {
            this.twitchAuthService.cleanup();
            this.twitchAuthService = null;
        }
        
        this.twitchAuthInitializer = null;
        
        this.logger.debug('Configuration updated, state reset to UNINITIALIZED', 'auth-manager');
    }

    validateConfig() {
        const requiredFields = ['clientId', 'channel'];
        const missingFields = requiredFields.filter(field => !this.config[field]);
        if (!secrets.twitch.clientSecret) {
            missingFields.push('clientSecret');
        }

        if (missingFields.length > 0) {
            const errorMessage = AuthConstants.formatErrorMessage('MISSING_CONFIG', {
                fields: missingFields.join(', ')
            });
            throw new Error(errorMessage);
        }

        if (!this.config.accessToken) {
            this.logger.info('Access token missing - OAuth flow required', 'auth-manager');
            return;
        }

        const validation = AuthConstants.validateConfig(this.config, false);
        
        // refreshToken is optional - system can work without it (no automatic refresh)
        if (!validation.hasRefreshCapability) {
            this.logger.debug('No refresh token provided - automatic token refresh will not be available', 'auth-manager');
        }
    }

    async initialize() {
        // Skip if already ready
        if (this.state === AuthStates.READY) {
            this.logger.debug('TwitchAuthManager already initialized, skipping', 'auth-manager');
            return;
        }

        // Skip if currently initializing
        if (this.state === AuthStates.INITIALIZING) {
            this.logger.debug('TwitchAuthManager currently initializing, waiting...', 'auth-manager');
            return;
        }

        this.state = AuthStates.INITIALIZING;
        this.lastError = null;

        try {
            this.logger.info('Initializing TwitchAuthManager...', 'auth-manager');
            
            // Validate configuration
            this.validateConfig();
            
            const TwitchAuthServiceClass = this.dependencies.TwitchAuthService || TwitchAuthService;
            const TwitchAuthInitializerClass = this.dependencies.TwitchAuthInitializer || TwitchAuthInitializer;

            this.twitchAuthService = new TwitchAuthServiceClass(this.config, { logger: this.logger });
            this.twitchAuthInitializer = new TwitchAuthInitializerClass({
                logger: this.logger,
                axios: this.axios || this.dependencies?.axios,
                mockOAuthHandler: this.dependencies?.mockOAuthHandler,
                tokenStorePath: this.config.tokenStorePath,
                enhancedHttpClient: this.dependencies?.enhancedHttpClient,
                retrySystem: this.dependencies?.retrySystem
            });
            
            // Initialize authentication using the new services
            const initSuccess = await this.twitchAuthInitializer.initializeAuthentication(this.twitchAuthService);
            if (!initSuccess) {
                throw new Error('Authentication initialization failed');
            }
            
            // Sync config after initialization (in case tokens were refreshed)
            this._syncConfigFromAuthService();
            
            // Schedule automatic token refresh if we have refresh capability
            if (this.config.refreshToken && this.twitchAuthService.tokenExpiresAt) {
                this.twitchAuthInitializer.scheduleTokenRefresh(this.twitchAuthService);
                this.logger.debug('Automatic token refresh scheduled', 'auth-manager');
            }
            
            this.state = AuthStates.READY;
            this.logger.info('TwitchAuthManager initialized successfully', 'auth-manager');
            
        } catch (error) {
            this.state = AuthStates.ERROR;
            this.lastError = error;
            this._logManagerError('TwitchAuthManager initialization failed', error);
            throw error;
        }
    }

    getAuthProvider() {
        if (this.state !== AuthStates.READY) {
            throw new Error('Authentication not initialized. Call initialize() first.');
        }
        
        // Return a simple object for backward compatibility
        return {
            userId: this.twitchAuthService.userId,
            accessToken: this.twitchAuthService.getAccessToken(),
            getAccessTokenForUser: async (userId) => {
                if (userId !== this.twitchAuthService.userId) {
                    throw new Error(`No token available for user ID: ${userId}`);
                }
                return {
                    accessToken: this.twitchAuthService.getAccessToken(),
                    refreshToken: this.config.refreshToken,
                    expiresAt: null
                };
            }
        };
    }

    getUserId() {
        this.logger.debug('[AUTH-DEBUG] getUserId() called', 'auth-manager', {
            currentState: this.state,
            hasAuthService: !!this.twitchAuthService,
            userId: this.twitchAuthService?.userId
        });
        
        if (this.state !== AuthStates.READY) {
            this._logManagerError('[AUTH-DEBUG] getUserId() failed - not ready', null, 'auth-manager', {
                state: this.state
            });
            throw new Error('Authentication not initialized. Call initialize() first.');
        }
        
        return this.twitchAuthService.userId;
    }

    async getScopes() {
        if (this.state !== AuthStates.READY) {
            throw new Error('Authentication not initialized. Call initialize() first.');
        }
        
        try {
            // Get scopes using centralized endpoints and enhanced HTTP client
            const response = await this.enhancedHttpClient.get(TWITCH.OAUTH.VALIDATE, {
                authToken: this.config.accessToken,
                authType: 'oauth',
                platform: 'twitch'
            });
            
            return response.data.scopes || [];
        } catch (error) {
            this._logManagerError('Failed to get token scopes', error);
            return [];
        }
    }

    async getAccessToken() {
        if (this.state !== AuthStates.READY) {
            throw new Error('Authentication not initialized. Call initialize() first.');
        }
        
        return this.twitchAuthService.getAccessToken();
    }

    _validateManagerState(operation) {
        if (this.state !== AuthStates.READY) {
            throw new Error(`Authentication not initialized for ${operation}. Call initialize() first.`);
        }
    }

    _assessRefreshCapability() {
        if (!this.twitchAuthInitializer) {
            return {
                available: false,
                reason: 'No auth initializer available for token refresh'
            };
        }
        
        if (!this.config.refreshToken) {
            return {
                available: false,
                reason: 'No refresh token available'
            };
        }
        
        return { available: true };
    }

    async _performTokenValidation(options = {}) {
        const initialTokens = {
            accessToken: this.config.accessToken,
            refreshToken: this.config.refreshToken
        };
        
        // Use the auth initializer's ensureValidToken method
        const isValid = await this.twitchAuthInitializer.ensureValidToken(this.twitchAuthService, options);
        
        // Check if tokens were updated during validation
        const tokensUpdated = (
            this.twitchAuthService.config.accessToken !== initialTokens.accessToken ||
            this.twitchAuthService.config.refreshToken !== initialTokens.refreshToken
        );
        
        return {
            isValid,
            tokensUpdated,
            reason: isValid ? 'Token validated successfully' : 'Token validation failed',
            canRetry: !isValid && !!this.config.refreshToken
        };
    }

    _handleTokenValidationError(error) {
        return this.errorHandler.handleTokenValidationError(error);
    }

    _syncConfigFromAuthService() {
        if (!this.twitchAuthService) {
            this.logger.warn('Cannot sync config: no auth service available', 'auth-manager');
            return;
        }
        
        const beforeSync = {
            accessToken: this.config.accessToken,
            refreshToken: this.config.refreshToken
        };
        
        // Update tokens in our config to match the auth service
        this.config.accessToken = this.twitchAuthService.config.accessToken;
        this.config.refreshToken = this.twitchAuthService.config.refreshToken;
        
        const tokensChanged = (
            beforeSync.accessToken !== this.config.accessToken ||
            beforeSync.refreshToken !== this.config.refreshToken
        );
        
        if (tokensChanged) {
            this.logger.info('Config synchronized with updated tokens', 'auth-manager', {
                accessTokenChanged: beforeSync.accessToken !== this.config.accessToken,
                refreshTokenChanged: beforeSync.refreshToken !== this.config.refreshToken
            });
        } else {
            this.logger.debug('Config sync completed (no token changes)', 'auth-manager');
        }
    }

    async ensureValidToken(options = {}) {
        // Use auth state machine to prevent race conditions with EventSub
        return await this.authState.executeWhenReady(async () => {
            this._validateManagerState('ensureValidToken');

            // Check if token refresh capabilities are available
            const refreshCapability = this._assessRefreshCapability();
            if (!refreshCapability.available) {
                this.logger.debug('Token refresh not available', 'auth-manager', refreshCapability.reason);
                return true; // Assume current token is valid
            }

            const expiresAt = this.twitchAuthService.tokenExpiresAt;
            const thresholdMs = (this.twitchAuthInitializer?.REFRESH_THRESHOLD_SECONDS || TOKEN_REFRESH_CONFIG.REFRESH_THRESHOLD_SECONDS) * 1000;
            const shouldRefresh = options.forceRefresh === true || (!!expiresAt && (expiresAt - Date.now()) <= thresholdMs);

            if (!shouldRefresh) {
                this.logger.debug('Token guard: token healthy, skipping refresh', 'auth-manager', {
                    expiresAt,
                    thresholdMs
                });
                return true;
            }

            // Mark auth as refreshing to queue EventSub operations
            this.authState.startRefresh();

            try {
                // Delegate token validation/refresh to initializer
                const validationResult = await this._performTokenValidation(options);
                
                // Synchronize configuration if tokens were updated
                if (validationResult.tokensUpdated) {
                    this._syncConfigFromAuthService();
                    this.logger.debug('Configuration synchronized after token refresh', 'auth-manager');
                }
                
                if (!validationResult.isValid) {
                    this.logger.warn('Token validation/refresh failed', 'auth-manager', {
                        reason: validationResult.reason,
                        willRetry: validationResult.canRetry
                    });
                }
                
                // Mark refresh as complete (success or failure)
                this.authState.finishRefresh(validationResult.isValid);
                return validationResult.isValid;
                
            } catch (error) {
                // Mark refresh as complete even on error to unblock operations
                this.authState.finishRefresh(false);
                return this._handleTokenValidationError(error);
            }
        });
    }

    getStatus() {
        return {
            state: this.state,
            hasAuthProvider: !!this.twitchAuthService,
            userId: this.twitchAuthService?.userId || null,
            configValid: this.state !== AuthStates.ERROR,
            lastError: this.lastError?.message || null
        };
    }

    async cleanup() {
        try {
            // Clean up auth state machine first to cancel any pending operations
            if (this.authState) {
                this.authState.clearQueue();
                this.authState.reset();
            }
            
            // Clean up auth service
            if (this.twitchAuthService) {
                this.twitchAuthService.cleanup();
                this.twitchAuthService = null;
            }
            
            // Clean up initializer and its timers
            if (this.twitchAuthInitializer) {
                if (typeof this.twitchAuthInitializer.cleanup === 'function') {
                    this.twitchAuthInitializer.cleanup();
                }
                this.twitchAuthInitializer = null;
            }
            
            // Reset state and error tracking
            this.state = AuthStates.UNINITIALIZED;
            this.lastError = null;
            
            // Clear dependencies for garbage collection but preserve config for instance identity
            this.dependencies = null;
            // Note: Preserving config for test isolation and instance identification
            
            this.logger.debug('TwitchAuthManager cleaned up with enhanced memory management', 'auth-manager');
            
        } catch (error) {
            this._logManagerError('Error during TwitchAuthManager cleanup', error);
        }
    }

    _logManagerError(message, error = null, eventType = 'auth-manager', payload = null) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, payload, message);
        } else if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'auth-manager', payload || error);
        }
    }
}

module.exports = TwitchAuthManager;
