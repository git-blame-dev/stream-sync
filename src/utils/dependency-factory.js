
const { PlatformConnectionFactory } = require('./platform-connection-factory');

class DependencyFactory {
    constructor() {
        // Initialize with dependency validation utilities
        this.interfaceValidators = this._createInterfaceValidators();
    }

    createYoutubeDependencies(config, options = {}) {
        // Validate inputs
        this._validateConfiguration(config, 'YouTube');
        this._validateOptions(options);

        // Validate YouTube-specific configuration
        // API key is only required when using API methods (not for youtubei)
        const needsApiKey = config.enableAPI || 
                           config.streamDetectionMethod === 'api' || 
                           config.viewerCountMethod === 'api';
        
        if (needsApiKey && !config.apiKey) {
            throw new Error('YouTube API key is required when enableAPI=true or using API methods (use "apiKey" field)');
        }

        const normalizedConfig = {
            ...config
        };

        if (!normalizedConfig.username) {
            throw new Error('YouTube username is required');
        }

        try {
            const normalizedOptions = { ...options };
            const injectedStreamDetectionService = normalizedOptions.streamDetectionService || null;
            delete normalizedOptions.streamDetectionService;

            // Create standardized logger (or use provided one)
            const logger = normalizedOptions.logger || this.createValidatedLogger('youtube');

            // Create core services for modular architecture
            const innertubeFactory = this._createInnertubeFactory();
            const innertubeService = this._createInnertubeService(innertubeFactory, logger, normalizedOptions);
            const viewerExtractionService = this._createViewerExtractionService(innertubeService, logger, normalizedOptions);
            
            // Create extracted services for clean architecture
            const ChatFileLoggingService = normalizedOptions.ChatFileLoggingService || require('../services/ChatFileLoggingService');
            const SelfMessageDetectionService = require('../services/SelfMessageDetectionService');
            
            // Create self-message detection service with configuration
            const selfMessageDetectionService = new SelfMessageDetectionService(normalizedOptions.config || require('../core/config').configManager);

            const streamDetectionService = injectedStreamDetectionService ||
                this._createYouTubeStreamDetectionService(normalizedConfig, logger, normalizedOptions);
            
            // Create YouTube-specific dependencies
            const dependencies = {
                logger,
                apiClient: this._createYouTubeApiClient(normalizedConfig, logger),
                connectionManager: this._createYouTubeConnectionManager(normalizedConfig, logger),
                streamDetectionService,
                
                // Modern service layer
                innertubeFactory,
                innertubeService,
                viewerExtractionService,
                
                // Extracted services
                ChatFileLoggingService,
                selfMessageDetectionService,
                
                ...normalizedOptions // Allow options to override defaults
            };

            // Validate critical dependencies only if logger was created by factory
            if (!normalizedOptions.logger) {
                this.validateDependencyInterface(dependencies.logger, 'logger');
            }

            return dependencies;

        } catch (error) {
            throw new Error(`Failed to create YouTube dependencies: ${error.message}`);
        }
    }

    createTiktokDependencies(config, options = {}) {
        // Validate inputs
        this._validateConfiguration(config, 'TikTok');
        this._validateOptions(options);

        // Validate TikTok-specific configuration
        if (!config.username || typeof config.username !== 'string' || config.username.trim() === '') {
            throw new Error('TikTok username is required and must be a non-empty string');
        }

        try {
            const logger = options.logger || this.createValidatedLogger('tiktok');
            const {
                TikTokWebSocketClient,
                WebcastEvent,
                ControlEvent,
                WebcastPushConnection
            } = this._resolveTikTokConnectorDependencies(options);
            const sanitizedOptions = { ...options };
            delete sanitizedOptions.TikTokWebSocketClient;
            delete sanitizedOptions.WebcastEvent;
            delete sanitizedOptions.ControlEvent;
            delete sanitizedOptions.WebcastPushConnection;
            delete sanitizedOptions.tiktokConnector;
            delete sanitizedOptions.modulePreloader;
            
            // Create extracted services for clean architecture
            const ChatFileLoggingService = options.ChatFileLoggingService || require('../services/ChatFileLoggingService');
            const SelfMessageDetectionService = require('../services/SelfMessageDetectionService');
            
            // Create self-message detection service with configuration
            const selfMessageDetectionService = new SelfMessageDetectionService(options.config || require('../core/config').configManager);

            // Create TikTok-specific dependencies
            const dependencies = {
                logger,
                TikTokWebSocketClient,
                WebcastEvent,
                ControlEvent,
                WebcastPushConnection,
                connectionFactory: this._createTikTokConnectionFactory(config, logger),
                stateManager: this._createTikTokStateManager(config, logger),
                ChatFileLoggingService, // Include extracted service
                selfMessageDetectionService,
                ...sanitizedOptions // Allow options to override defaults
            };

            // Validate critical dependencies only if logger was created by factory
            if (!options.logger) {
                this.validateDependencyInterface(dependencies.logger, 'logger');
            }

            return dependencies;

        } catch (error) {
            throw new Error(`Failed to create TikTok dependencies: ${error.message}`);
        }
    }

    createTwitchDependencies(config, options = {}) {
        // Validate inputs
        this._validateConfiguration(config, 'Twitch');
        this._validateOptions(options);

        // Validate Twitch-specific configuration
        const channel = config.channel;

        if (!channel || typeof channel !== 'string' || channel.trim() === '') {
            throw new Error('Twitch channel is required and must be a non-empty string (use "channel" field)');
        }

        try {
            // Create standardized logger
            const logger = this.createValidatedLogger('twitch');

            // Create normalized config
            const normalizedConfig = {
                ...config,
                channel: channel,
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                accessToken: config.accessToken,
                refreshToken: config.refreshToken
            };
            delete normalizedConfig.apiKey;

            const sanitizedOptions = { ...options };
            const injectedAuthManager = sanitizedOptions.authManager;
            const injectedAuthFactory = sanitizedOptions.authFactory;
            delete sanitizedOptions.authManager;
            delete sanitizedOptions.authFactory;

            const authResources = this._resolveTwitchAuthResources(
                normalizedConfig,
                logger,
                injectedAuthManager,
                injectedAuthFactory
            );

            // Create extracted services for clean architecture
            const ChatFileLoggingService = options.ChatFileLoggingService || require('../services/ChatFileLoggingService');
            const SelfMessageDetectionService = require('../services/SelfMessageDetectionService');
            
            // Create self-message detection service with configuration
            const selfMessageDetectionService = new SelfMessageDetectionService(options.config || require('../core/config').configManager);
            
            // Create Twitch-specific dependencies
            const dependencies = {
                logger,
                authManager: authResources.authManager,
                authFactory: authResources.authFactory,
                apiClient: this._createTwitchApiClient(normalizedConfig, logger),
                ChatFileLoggingService, // Include extracted service
                selfMessageDetectionService,
                axios: options.axios,
                WebSocketCtor: options.WebSocketCtor,
                ...sanitizedOptions // Allow options to override defaults (without overriding auth resources)
            };

            // Validate critical dependencies only if logger was created by factory
            if (!options.logger) {
                this.validateDependencyInterface(dependencies.logger, 'logger');
            }

            return dependencies;

        } catch (error) {
            throw new Error(`Failed to create Twitch dependencies: ${error.message}`);
        }
    }

    createValidatedLogger(type) {
        if (!type || typeof type !== 'string') {
            throw new Error('Logger type is required and must be a string');
        }

        try {
            // Import logger utilities with explicit failure if missing
            const { getUnifiedLogger } = require('../core/logging');
            const logger = getUnifiedLogger();

            // Validate the created logger
            this.validateDependencyInterface(logger, 'logger');

            return logger;

        } catch (error) {
            throw new Error(`Failed to create logger for ${type}: ${error.message}`);
        }
    }

    validateDependencyInterface(dependency, interfaceType) {
        if (!dependency || typeof dependency !== 'object') {
            throw new Error('Dependency must be an object');
        }

        const validator = this.interfaceValidators[interfaceType];
        if (!validator) {
            throw new Error(`Unknown interface type: ${interfaceType}`);
        }

        try {
            validator(dependency);
        } catch (error) {
            throw new Error(`${this._capitalizeFirst(interfaceType)} interface validation failed: ${error.message}`);
        }
    }

    // Private helper methods

    _validateConfiguration(config, platform) {
        if (!config || typeof config !== 'object') {
            throw new Error('Configuration is required and must be an object');
        }
    }

    _validateOptions(options) {
        if (options === null || (options !== undefined && typeof options !== 'object')) {
            throw new Error('Options must be an object');
        }
    }

    _createYouTubeApiClient(config, logger) {
        return {
            apiKey: config.apiKey,
            username: config.username,
            logger,
            isValid: true,
            
            // API client interface methods
            get: async () => Promise.resolve({}),
            post: async () => Promise.resolve({}),
            authenticate: async () => Promise.resolve(true)
        };
    }

    _createYouTubeConnectionManager(config, logger) {
        return {
            config,
            logger,
            isConnected: false,
            
            // Connection manager interface methods
            connect: async () => Promise.resolve(true),
            disconnect: async () => Promise.resolve(true),
            isConnected: () => false,
            getStatus: () => ({ connected: false, health: 'good' })
        };
    }

    _createYouTubeStreamDetectionService(config, logger, options = {}) {
        try {
            // Try to load the actual YouTubeStreamDetectionService
            const { YouTubeStreamDetectionService } = require('../services/youtube-stream-detection-service');
            
            // Use the Innertube class from options if available (preferred for youtubei method)
            // Support both direct class references and lazy loading functions for modular design
            if (config.streamDetectionMethod === 'youtubei') {
                if (!options.Innertube) {
                    throw new Error('Innertube dependency required for youtubei stream detection');
                }
                logger.debug('Creating Innertube instance for stream detection service', 'dependency-factory');
                
                // Create a deferred service that will initialize Innertube when first used
                const deferredService = {
                    _innertubeInstance: null,
                    _initializePromise: null,
                    _innertubeClient: null, // Expose for testing
                    _streamDetectionService: null, // Cache the detection service instance

                    async _getInnertubeInstance() {
                        if (this._innertubeInstance) {
                            return this._innertubeInstance;
                        }

                        if (!this._initializePromise) {
                            // Handle both direct class and lazy loading function references
                            const InnertubeClass = typeof options.Innertube === 'function' ?
                                await options.Innertube() : // Lazy loading function
                                options.Innertube;         // Direct class reference

                            this._initializePromise = InnertubeClass.create();
                        }

                        this._innertubeInstance = await this._initializePromise;
                        this._innertubeClient = this._innertubeInstance; // Expose for testing
                        return this._innertubeInstance;
                    },

                    async _getStreamDetectionService() {
                        // Cache the detection service instance to ensure API consistency
                        if (this._streamDetectionService) {
                            return this._streamDetectionService;
                        }

                        const innertube = await this._getInnertubeInstance();
                        this._streamDetectionService = new YouTubeStreamDetectionService(innertube, {
                            logger,
                            timeout: 3000
                        });
                        return this._streamDetectionService;
                    },

                    async detectLiveStreams(channel, detectOptions = {}) {
                        const service = await this._getStreamDetectionService();
                        return service.detectLiveStreams(channel, detectOptions);
                    },
                    
                    getUsageMetrics() {
                        // Return basic metrics for the deferred service
                        return {
                            totalRequests: 0,
                            successfulRequests: 0,
                            failedRequests: 0,
                            averageResponseTime: 0,
                            errorRate: 0,
                            errorsByType: {}
                        };
                    }
                };
                
                return deferredService;
            }
            
            // Create mock client as fallback (for non-youtubei methods or when Innertube not available)
            logger.debug('Using mock Innertube client for stream detection service', 'dependency-factory');
            const mockInnertubeClient = {
                search: async (query) => ({ results: [] }),
                getChannel: async (handle) => ({ videos: [] })
            };
            
            return new YouTubeStreamDetectionService(mockInnertubeClient, {
                logger,
                timeout: 3000
            });
            
        } catch (error) {
            if (config.streamDetectionMethod === 'youtubei') {
                throw error;
            }
            // Fallback service for test environments
            logger.debug('Using fallback YouTube stream detection service', 'dependency-factory');
            return {
                config,
                logger,
                
                // Stream detection interface methods
                detectLiveStreams: async (channelHandle, options = {}) => {
                    return {
                        success: false,
                        videoIds: [],
                        message: 'YouTube stream detection service not available',
                        responseTime: 0,
                        retryable: true
                    };
                },
                getUsageMetrics: () => ({
                    totalRequests: 0,
                    successfulRequests: 0,
                    averageResponseTime: 0
                }),
                isLive: async () => Promise.resolve(false),
                checkStream: async () => Promise.resolve({ live: false }),
                startMonitoring: () => {},
                stopMonitoring: () => {}
            };
        }
    }

    _resolveTikTokConnectorDependencies(options = {}) {
        const connectorOverrides = options.tiktokConnector || {};
        const resolved = {
            TikTokWebSocketClient: options.TikTokWebSocketClient || connectorOverrides.TikTokWebSocketClient,
            WebcastEvent: options.WebcastEvent || connectorOverrides.WebcastEvent,
            ControlEvent: options.ControlEvent || connectorOverrides.ControlEvent,
            WebcastPushConnection: options.WebcastPushConnection || connectorOverrides.WebcastPushConnection
        };

        const fallbackEvents = () => ({
            CHAT: 'chat',
            GIFT: 'gift',
            FOLLOW: 'follow',
            SHARE: 'share',
            ENVELOPE: 'envelope',
            SUBSCRIBE: 'subscribe',
            SUPER_FAN: 'superfan',
            LIKE: 'like',
            SOCIAL: 'social',
            MEMBER: 'member',
            EMOTE: 'emote',
            QUESTION_NEW: 'questionNew',
            ROOM_USER: 'roomUser',
            ERROR: 'error',
            DISCONNECT: 'disconnected',
            STREAM_END: 'streamEnd'
        });

        const fallbackControl = () => ({
            CONNECTED: 'connected',
            DISCONNECTED: 'disconnected',
            ERROR: 'error',
            WEBSOCKET_CONNECTED: 'connected'
        });

        const needsConnectorLoad = (!resolved.TikTokWebSocketClient) ||
            !resolved.WebcastEvent ||
            !resolved.ControlEvent ||
            !resolved.WebcastPushConnection;

        if (needsConnectorLoad) {
            if (!resolved.TikTokWebSocketClient) {
                try {
                    const { TikTokWebSocketClient } = require('../platforms/tiktok-websocket-client');
                    resolved.TikTokWebSocketClient = TikTokWebSocketClient;
                } catch {
                    // Fallback handled below
                }
            }

            // No connector fallback; WebSocket client is required
        }

        const missingDependencies = [];
        if (typeof resolved.TikTokWebSocketClient !== 'function') {
            missingDependencies.push('TikTokWebSocketClient');
        }

        if (!resolved.WebcastEvent || typeof resolved.WebcastEvent !== 'object') {
            resolved.WebcastEvent = fallbackEvents();
        }
        if (!resolved.ControlEvent || typeof resolved.ControlEvent !== 'object') {
            resolved.ControlEvent = fallbackControl();
        }
        resolved.WebcastPushConnection = resolved.WebcastPushConnection || function noopPushConnection() {};

        if (missingDependencies.length > 0) {
            throw new Error(
                `Missing TikTok dependencies: ${missingDependencies.join(', ')}. ` +
                'Provide these via DependencyFactory options or ensure WebSocket client is available.'
            );
        }

        return resolved;
    }

    _createTikTokConnectionFactory(config, logger) {
        // Use the shared platform connection factory to ensure consistent, validated connections
        return new PlatformConnectionFactory(logger);
    }

    _createTikTokStateManager(config, logger) {
        return {
            config,
            logger,
            state: 'disconnected',
            
            // State manager interface methods
            getState: () => 'disconnected',
            setState: (state) => {},
            isConnected: () => false,
            reset: () => {}
        };
    }

    _resolveTwitchAuthResources(config, logger, injectedAuthManager, injectedAuthFactory) {
        if (injectedAuthManager) {
            return {
                authManager: injectedAuthManager,
                authFactory: injectedAuthFactory || null
            };
        }

        if (injectedAuthFactory && typeof injectedAuthFactory.createAuthManager === 'function') {
            const createdAuthManager = injectedAuthFactory.createAuthManager();
            if (!createdAuthManager || typeof createdAuthManager.initialize !== 'function') {
                throw new Error('Provided authFactory did not return a valid Twitch auth manager');
            }
            return {
                authManager: createdAuthManager,
                authFactory: injectedAuthFactory
            };
        }

        const TwitchAuthFactory = require('../auth/TwitchAuthFactory');
        const authFactory = new TwitchAuthFactory(config, { logger });
        const authManager = authFactory.createAuthManager();

        if (!authManager || typeof authManager.initialize !== 'function') {
            throw new Error('Failed to create Twitch auth manager via TwitchAuthFactory');
        }

        return {
            authManager,
            authFactory
        };
    }

    _createTwitchApiClient(config, logger) {
        return {
            config,
            logger,
            
            // API client interface methods
            get: async () => Promise.resolve({}),
            post: async () => Promise.resolve({}),
            authenticate: async () => Promise.resolve(true),
            getChannel: async () => Promise.resolve({ name: config.channel })
        };
    }

    _createInterfaceValidators() {
        return {
            logger: (logger) => {
                const requiredMethods = ['debug', 'info', 'warn', 'error'];
                for (const method of requiredMethods) {
                    if (typeof logger[method] !== 'function') {
                        throw new Error(`Logger missing required method: ${method}`);
                    }
                }
            },

            notificationManager: (manager) => {
                // Flexible validation - accept different notification manager patterns
                const hasEventEmitter = typeof manager.emit === 'function' && typeof manager.on === 'function';
                const hasHandlerMethods = typeof manager.handleNotification === 'function';
                
                if (!hasEventEmitter && !hasHandlerMethods) {
                    throw new Error(`NotificationManager missing required methods. Expected either event emitter methods (emit, on) or handler methods (handleNotification)`);
                }
            },

            apiClient: (client) => {
                const requiredMethods = ['get', 'post'];
                for (const method of requiredMethods) {
                    if (typeof client[method] !== 'function') {
                        throw new Error(`ApiClient missing required method: ${method}`);
                    }
                }
            }
        };
    }

    _createInnertubeFactory() {
        const { InnertubeFactory } = require('../factories/innertube-factory');
        return InnertubeFactory;
    }
    
    _createInnertubeService(factory, logger, options = {}) {
        const { InnertubeService } = require('../services/innertube-service');
        const { withTimeout } = require('../utils/timeout-wrapper');
        
        return new InnertubeService(factory, {
            logger,
            withTimeout,
            cleanupInterval: options.cleanupInterval || 300000
        });
    }
    
    _createViewerExtractionService(innertubeService, logger, options = {}) {
        const { ViewerCountExtractionService } = require('../services/viewer-count-extraction-service');
        const { YouTubeViewerExtractor } = require('../extractors/youtube-viewer-extractor');
        
        return new ViewerCountExtractionService(innertubeService, {
            logger,
            YouTubeViewerExtractor,
            timeout: options.timeout || 8000,
            strategies: options.strategies || ['view_text', 'video_details', 'basic_info'],
            debug: options.debug || false,
            retries: options.retries || 0
        });
    }

    _capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

module.exports = { DependencyFactory };
