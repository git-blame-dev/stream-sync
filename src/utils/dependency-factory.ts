import { secrets } from '../core/secrets';
import { getUnifiedLogger } from '../core/logging';
import type { AppLogger } from '../core/logger/types';
import { InnertubeFactory } from '../factories/innertube-factory';
import { TikTokWebSocketClient } from '../platforms/tiktok-websocket-client';
import { ChatFileLoggingService } from '../services/ChatFileLoggingService';
import { InnertubeService } from '../services/innertube-service';
import { SelfMessageDetectionService } from '../services/SelfMessageDetectionService';
import { ViewerCountExtractionService } from '../services/viewer-count-extraction-service';
import { YouTubeStreamDetectionService } from '../services/youtube-stream-detection-service';
import { YouTubeViewerExtractor } from '../extractors/youtube-viewer-extractor';
import { PlatformConnectionFactory } from './platform-connection-factory';
import { withTimeout } from './timeout-wrapper';

type PlatformDependencyConfig = Record<string, unknown> & {
    username?: unknown;
    channel?: unknown;
    clientId?: unknown;
    clientSecret?: unknown;
    apiKey?: unknown;
    enableAPI?: boolean;
    streamDetectionMethod?: string;
    viewerCountMethod?: string;
};

type SelfMessageConfig = ConstructorParameters<typeof SelfMessageDetectionService>[0];

type ChatFileLoggingServiceCtor = typeof ChatFileLoggingService;

type TikTokConnectorDependencyMap = {
    TikTokWebSocketClient?: unknown;
    WebcastEvent?: unknown;
    ControlEvent?: unknown;
    WebcastPushConnection?: unknown;
};

type InnertubeDetectionClient = ConstructorParameters<typeof YouTubeStreamDetectionService>[0];
type InnertubeInfoClient = Awaited<ReturnType<ConstructorParameters<typeof InnertubeService>[0]['createWithTimeout']>>;

type InnertubeClassLike = {
    create: () => Promise<InnertubeDetectionClient>;
};

type InnertubeDependency = InnertubeClassLike | (() => Promise<InnertubeClassLike> | InnertubeClassLike);

type DependencyFactoryOptions = Record<string, unknown> & {
    logger?: AppLogger;
    config?: SelfMessageConfig;
    streamDetectionService?: unknown;
    ChatFileLoggingService?: ChatFileLoggingServiceCtor;
    TikTokWebSocketClient?: unknown;
    WebcastEvent?: unknown;
    ControlEvent?: unknown;
    WebcastPushConnection?: unknown;
    tiktokConnector?: TikTokConnectorDependencyMap;
    modulePreloader?: unknown;
    twitchAuth?: unknown;
    axios?: unknown;
    WebSocketCtor?: unknown;
    Innertube?: InnertubeDependency;
    cleanupInterval?: number;
    timeout?: number;
    strategies?: string[];
    debug?: boolean;
    retries?: number;
};

type DependencyInterfaceType = 'logger' | 'notificationManager' | 'apiClient';
type InterfaceValidator = (dependency: Record<string, unknown>) => void;
type InterfaceValidators = Record<DependencyInterfaceType, InterfaceValidator>;

type DeferredYouTubeStreamDetectionService = {
    _innertubeInstance: InnertubeDetectionClient | null;
    _initializePromise: Promise<InnertubeDetectionClient> | null;
    _streamDetectionService: YouTubeStreamDetectionService | null;
    _getInnertubeInstance: () => Promise<InnertubeDetectionClient>;
    _getStreamDetectionService: () => Promise<YouTubeStreamDetectionService>;
    detectLiveStreams: (channel: string, detectOptions?: Record<string, unknown>) => Promise<unknown>;
    getUsageMetrics: () => Record<string, unknown>;
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isDependencyInterfaceType(value: string): value is DependencyInterfaceType {
    return value === 'logger' || value === 'notificationManager' || value === 'apiClient';
}

function toDependencyRecord(dependency: unknown): Record<string, unknown> {
    if (!dependency || typeof dependency !== 'object') {
        throw new Error('Dependency must be an object');
    }

    return dependency as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isInnertubeInfoClient(value: unknown): value is InnertubeInfoClient {
    return isRecord(value) && typeof value.getInfo === 'function';
}

class DependencyFactory {
    interfaceValidators: InterfaceValidators;

    constructor() {
        this.interfaceValidators = this._createInterfaceValidators();
    }

    createYoutubeDependencies(config: PlatformDependencyConfig, options: DependencyFactoryOptions = {}) {
        this._validateConfiguration(config, 'YouTube');
        this._validateOptions(options);

        const needsApiKey = config.enableAPI || 
                           config.streamDetectionMethod === 'api' || 
                           config.viewerCountMethod === 'api';
        const apiKey = secrets.youtube.apiKey || null;
        
        if (needsApiKey && !apiKey) {
            throw new Error('YouTube API key is required when enableAPI=true or using API methods (set YOUTUBE_API_KEY)');
        }

        const normalizedConfig = {
            ...config
        };

        try {
            const normalizedOptions = { ...options };
            const injectedStreamDetectionService = normalizedOptions.streamDetectionService || null;
            delete normalizedOptions.streamDetectionService;

            const logger = normalizedOptions.logger || this.createValidatedLogger('youtube');

            const innertubeFactory = this._createInnertubeFactory();
            const innertubeService = this._createInnertubeService(innertubeFactory, logger, normalizedOptions);
            const viewerExtractionService = this._createViewerExtractionService(innertubeService, logger, normalizedOptions);
            
            const ResolvedChatFileLoggingService = normalizedOptions.ChatFileLoggingService || ChatFileLoggingService;
            
            if (!normalizedOptions.config) {
                throw new Error('createYoutubeDependencies requires config object in options');
            }
            
            const selfMessageDetectionService = new SelfMessageDetectionService(normalizedOptions.config);

            const streamDetectionService = injectedStreamDetectionService ||
                this._createYouTubeStreamDetectionService(normalizedConfig, logger, normalizedOptions);
            
            const dependencies = {
                logger,
                apiClient: this._createYouTubeApiClient(normalizedConfig, logger),
                connectionManager: this._createYouTubeConnectionManager(normalizedConfig, logger),
                streamDetectionService,
                
                innertubeFactory,
                innertubeService,
                viewerExtractionService,
                
                ChatFileLoggingService: ResolvedChatFileLoggingService,
                selfMessageDetectionService,
                
                ...normalizedOptions
            };

            if (!normalizedOptions.logger) {
                this.validateDependencyInterface(dependencies.logger, 'logger');
            }

            return dependencies;

        } catch (error) {
            throw new Error(`Failed to create YouTube dependencies: ${getErrorMessage(error)}`);
        }
    }

    createTiktokDependencies(config: PlatformDependencyConfig, options: DependencyFactoryOptions = {}) {
        this._validateConfiguration(config, 'TikTok');
        this._validateOptions(options);

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
            
            const ResolvedChatFileLoggingService = options.ChatFileLoggingService || ChatFileLoggingService;
            
            if (!options.config) {
                throw new Error('createTikTokDependencies requires config object in options');
            }
            
            const selfMessageDetectionService = new SelfMessageDetectionService(options.config);

            const dependencies = {
                logger,
                TikTokWebSocketClient,
                WebcastEvent,
                ControlEvent,
                WebcastPushConnection,
                connectionFactory: this._createTikTokConnectionFactory(config, logger),
                stateManager: this._createTikTokStateManager(config, logger),
                ChatFileLoggingService: ResolvedChatFileLoggingService,
                selfMessageDetectionService,
                ...sanitizedOptions
            };

            if (!options.logger) {
                this.validateDependencyInterface(dependencies.logger, 'logger');
            }

            return dependencies;

        } catch (error) {
            throw new Error(`Failed to create TikTok dependencies: ${getErrorMessage(error)}`);
        }
    }

    createTwitchDependencies(config: PlatformDependencyConfig, options: DependencyFactoryOptions = {}) {
        this._validateConfiguration(config, 'Twitch');
        this._validateOptions(options);

        const channel = config.channel;

        if (!channel || typeof channel !== 'string' || channel.trim() === '') {
            throw new Error('Twitch channel is required and must be a non-empty string (use "channel" field)');
        }

        try {
            const logger = this.createValidatedLogger('twitch');

            const normalizedConfig: PlatformDependencyConfig = {
                ...config,
                channel: channel
            };
            delete normalizedConfig.clientSecret;
            delete normalizedConfig.apiKey;

            const sanitizedOptions = { ...options };
            const injectedTwitchAuth = sanitizedOptions.twitchAuth;
            delete sanitizedOptions.twitchAuth;

            if (!injectedTwitchAuth) {
                throw new Error('createTwitchDependencies requires twitchAuth');
            }

            const ResolvedChatFileLoggingService = options.ChatFileLoggingService || ChatFileLoggingService;
            
            if (!options.config) {
                throw new Error('createTwitchDependencies requires config object in options');
            }
            
            const selfMessageDetectionService = new SelfMessageDetectionService(options.config);
            
            const dependencies = {
                logger,
                twitchAuth: injectedTwitchAuth,
                apiClient: this._createTwitchApiClient(normalizedConfig, logger),
                ChatFileLoggingService: ResolvedChatFileLoggingService,
                selfMessageDetectionService,
                axios: options.axios,
                WebSocketCtor: options.WebSocketCtor,
                ...sanitizedOptions
            };

            if (!options.logger) {
                this.validateDependencyInterface(dependencies.logger, 'logger');
            }

            return dependencies;

        } catch (error) {
            throw new Error(`Failed to create Twitch dependencies: ${getErrorMessage(error)}`);
        }
    }

    createValidatedLogger(type: unknown): AppLogger {
        if (!type || typeof type !== 'string') {
            throw new Error('Logger type is required and must be a string');
        }

        try {
            const logger = getUnifiedLogger();

            this.validateDependencyInterface(logger, 'logger');

            return logger;

        } catch (error) {
            throw new Error(`Failed to create logger for ${type}: ${getErrorMessage(error)}`);
        }
    }

    validateDependencyInterface(dependency: unknown, interfaceType: string) {
        const dependencyRecord = toDependencyRecord(dependency);

        if (!isDependencyInterfaceType(interfaceType)) {
            throw new Error(`Unknown interface type: ${interfaceType}`);
        }

        const validator = this.interfaceValidators[interfaceType];

        try {
            validator(dependencyRecord);
        } catch (error) {
            throw new Error(`${this._capitalizeFirst(interfaceType)} interface validation failed: ${getErrorMessage(error)}`);
        }
    }

    _validateConfiguration(config: unknown, _platform: string) {
        if (!config || typeof config !== 'object') {
            throw new Error('Configuration is required and must be an object');
        }
    }

    _validateOptions(options: unknown) {
        if (options === null || (options !== undefined && typeof options !== 'object')) {
            throw new Error('Options must be an object');
        }
    }

    _createYouTubeApiClient(config: PlatformDependencyConfig, logger: AppLogger) {
        return {
            apiKey: secrets.youtube.apiKey || null,
            username: config.username,
            logger,
            isValid: true,
            
            get: async () => Promise.resolve({}),
            post: async () => Promise.resolve({}),
            authenticate: async () => Promise.resolve(true)
        };
    }

    _createYouTubeConnectionManager(config: PlatformDependencyConfig, logger: AppLogger) {
        return {
            config,
            logger,
            
            connect: async () => Promise.resolve(true),
            disconnect: async () => Promise.resolve(true),
            isConnected: () => false,
            getStatus: () => ({ connected: false, health: 'good' })
        };
    }

    _createYouTubeStreamDetectionService(config: PlatformDependencyConfig, logger: AppLogger, options: DependencyFactoryOptions = {}) {
        try {
            // Support both direct class references and lazy loading functions for modular design
            if (config.streamDetectionMethod === 'youtubei') {
                if (!options.Innertube) {
                    throw new Error('Innertube dependency required for youtubei stream detection');
                }
                logger.debug('Creating Innertube instance for stream detection service', 'dependency-factory');
                const innertubeDependency = options.Innertube;
                
                const deferredService: DeferredYouTubeStreamDetectionService = {
                    _innertubeInstance: null,
                    _initializePromise: null,
                    _streamDetectionService: null,

                    async _getInnertubeInstance(): Promise<InnertubeDetectionClient> {
                        if (this._innertubeInstance) {
                            return this._innertubeInstance;
                        }

                        if (!this._initializePromise) {
                            const InnertubeClass = typeof innertubeDependency === 'function' ?
                                await innertubeDependency() :
                                innertubeDependency;

                            this._initializePromise = InnertubeClass.create();
                        }

                        this._innertubeInstance = await this._initializePromise;
                        return this._innertubeInstance;
                    },

                    async _getStreamDetectionService(): Promise<YouTubeStreamDetectionService> {
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

                    async detectLiveStreams(channel: string, detectOptions: Record<string, unknown> = {}) {
                        const service = await this._getStreamDetectionService();
                        return service.detectLiveStreams(channel, detectOptions);
                    },
                    
                    getUsageMetrics() {
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
            
            logger.debug('Using mock Innertube client for stream detection service', 'dependency-factory');
            const mockInnertubeClient: InnertubeDetectionClient = {
                search: async (_query: string) => ({ videos: [] }),
                getChannel: async (_handle: string) => ({ videos: { contents: [] } })
            };
            
            return new YouTubeStreamDetectionService(mockInnertubeClient, {
                logger,
                timeout: 3000
            });
            
        } catch (error) {
            if (config.streamDetectionMethod === 'youtubei') {
                throw error;
            }
            logger.debug('Using fallback YouTube stream detection service', 'dependency-factory');
            return {
                config,
                logger,
                
                detectLiveStreams: async (_channelHandle: string, _options: Record<string, unknown> = {}) => {
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

    _resolveTikTokConnectorDependencies(options: DependencyFactoryOptions = {}) {
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
                resolved.TikTokWebSocketClient = TikTokWebSocketClient;
            }

        }

        const missingDependencies: string[] = [];
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

    _createTikTokConnectionFactory(_config: PlatformDependencyConfig, logger: AppLogger) {
        return new PlatformConnectionFactory(logger);
    }

    _createTikTokStateManager(config: PlatformDependencyConfig, logger: AppLogger) {
        return {
            config,
            logger,
            state: 'disconnected',
            
            getState: () => 'disconnected',
            setState: (_state: string) => {},
            isConnected: () => false,
            reset: () => {}
        };
    }

    _createTwitchApiClient(config: PlatformDependencyConfig, logger: AppLogger) {
        return {
            config,
            logger,
            
            get: async () => Promise.resolve({}),
            post: async () => Promise.resolve({}),
            authenticate: async () => Promise.resolve(true),
            getChannel: async () => Promise.resolve({ name: config.channel })
        };
    }

    _createInterfaceValidators(): InterfaceValidators {
        return {
            logger: (logger: Record<string, unknown>) => {
                const requiredMethods = ['debug', 'info', 'warn', 'error'];
                for (const method of requiredMethods) {
                    if (typeof logger[method] !== 'function') {
                        throw new Error(`Logger missing required method: ${method}`);
                    }
                }
            },

            notificationManager: (manager: Record<string, unknown>) => {
                const hasEventEmitter = typeof manager.emit === 'function' && typeof manager.on === 'function';
                const hasHandlerMethods = typeof manager.handleNotification === 'function';
                
                if (!hasEventEmitter && !hasHandlerMethods) {
                    throw new Error(`NotificationManager missing required methods. Expected either event emitter methods (emit, on) or handler methods (handleNotification)`);
                }
            },

            apiClient: (client: Record<string, unknown>) => {
                const requiredMethods = ['get', 'post'];
                for (const method of requiredMethods) {
                    if (typeof client[method] !== 'function') {
                        throw new Error(`ApiClient missing required method: ${method}`);
                    }
                }
            }
        };
    }

    _createInnertubeFactory(): typeof InnertubeFactory {
        return InnertubeFactory;
    }
    
    _createInnertubeService(factory: typeof InnertubeFactory, logger: AppLogger, options: DependencyFactoryOptions = {}) {
        const serviceFactory: ConstructorParameters<typeof InnertubeService>[0] = {
            createWithTimeout: async (timeoutMs?: number) => {
                const instance = await factory.createWithTimeout(timeoutMs);
                if (!isInnertubeInfoClient(instance)) {
                    throw new Error('InnertubeFactory returned an invalid client');
                }
                return instance;
            }
        };

        return new InnertubeService(serviceFactory, {
            logger,
            withTimeout,
            cleanupInterval: options.cleanupInterval || 300000
        });
    }
    
    _createViewerExtractionService(innertubeService: InnertubeService, logger: AppLogger, options: DependencyFactoryOptions = {}) {
        const viewerInnertubeService: ConstructorParameters<typeof ViewerCountExtractionService>[0] = {
            getVideoInfo: async (videoId, videoOptions) => {
                const normalizedVideoOptions: { timeout?: number; instanceKey?: string } = {};
                if (typeof videoOptions?.timeout === 'number') {
                    normalizedVideoOptions.timeout = videoOptions.timeout;
                }
                if (typeof videoOptions?.instanceKey === 'string') {
                    normalizedVideoOptions.instanceKey = videoOptions.instanceKey;
                }

                const videoInfo = await innertubeService.getVideoInfo(videoId, normalizedVideoOptions);
                return isRecord(videoInfo) ? videoInfo : {};
            }
        };

        return new ViewerCountExtractionService(viewerInnertubeService, {
            logger,
            YouTubeViewerExtractor,
            timeout: options.timeout || 8000,
            strategies: options.strategies || ['view_text', 'video_details', 'basic_info'],
            debug: options.debug || false,
            retries: options.retries || 0
        });
    }

    _capitalizeFirst(str: string) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

export { DependencyFactory };
export default { DependencyFactory };
