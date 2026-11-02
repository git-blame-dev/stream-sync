import { getYouTubeCapabilityErrors } from '../core/config-schema';
import { getUnifiedLogger } from '../core/logging';
import type { AppLogger } from '../core/logger/types';
import { InnertubeFactory } from '../factories/innertube-factory';
import { TikTokWebSocketClient } from '../platforms/tiktok-websocket-client';
import { RawPlatformDataLoggingService } from '../services/RawPlatformDataLoggingService';
import { InnertubeService } from '../services/innertube-service';
import { SelfMessageDetectionService } from '../services/SelfMessageDetectionService';
import { ViewerCountExtractionService } from '../services/viewer-count-extraction-service';
import { YouTubeStreamDetectionService } from '../services/youtube-stream-detection-service';
import { PlatformConnectionFactory } from './platform-connection-factory';

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

type RawPlatformDataLoggingServiceCtor = typeof RawPlatformDataLoggingService;

type InnertubeInfoClient = Awaited<ReturnType<ConstructorParameters<typeof InnertubeService>[0]['createWithTimeout']>>;

type InnertubeClassLike = {
    create: (config?: Record<string, unknown>) => Promise<unknown>;
};

type InnertubeDependency = InnertubeClassLike | (() => Promise<InnertubeClassLike> | InnertubeClassLike);

type DependencyFactoryOptions = Record<string, unknown> & {
    logger?: AppLogger;
    config?: SelfMessageConfig;
    streamDetectionService?: unknown;
    RawPlatformDataLoggingService?: RawPlatformDataLoggingServiceCtor;
    TikTokWebSocketClient?: unknown;
    twitchAuth?: unknown;
    axios?: unknown;
    WebSocketCtor?: unknown;
    Innertube?: InnertubeDependency;
    innertubeService?: InnertubeService;
    timeout?: number;
};

type DependencyInterfaceType = 'logger' | 'notificationManager' | 'apiClient';
type InterfaceValidator = (dependency: Record<string, unknown>) => void;
type InterfaceValidators = Record<DependencyInterfaceType, InterfaceValidator>;

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

    createYoutubeInnertubeService(options: DependencyFactoryOptions = {}): InnertubeService {
        return this._createInnertubeService(this._createInnertubeFactory(),
            options.logger || this.createValidatedLogger('youtube'), options);
    }

    // Without an injected root owner, the caller owns dependencies.innertubeService
    // and must await its disposal after retiring every consumer.
    createYoutubeDependencies(config: PlatformDependencyConfig, options: DependencyFactoryOptions = {}) {
        this._validateConfiguration(config, 'YouTube');
        this._validateOptions(options);

        const capabilityErrors = getYouTubeCapabilityErrors(config);
        if (capabilityErrors.length) throw new Error(capabilityErrors.join(' '));

        try {
            const normalizedOptions = { ...options };
            const injectedInnertubeService = normalizedOptions.innertubeService;
            delete normalizedOptions.innertubeService;
            const injectedStreamDetectionService = normalizedOptions.streamDetectionService || null;
            delete normalizedOptions.streamDetectionService;

            const logger = normalizedOptions.logger || this.createValidatedLogger('youtube');

            const innertubeFactory = this._createInnertubeFactory();
            const innertubeService = injectedInnertubeService || this.createYoutubeInnertubeService({ ...normalizedOptions, logger });
            const viewerExtractionService = this._createViewerExtractionService(innertubeService, logger, normalizedOptions);
            
            const ResolvedRawPlatformDataLoggingService = normalizedOptions.RawPlatformDataLoggingService || RawPlatformDataLoggingService;
            
            if (!normalizedOptions.config) {
                throw new Error('createYoutubeDependencies requires config object in options');
            }
            
            const selfMessageDetectionService = new SelfMessageDetectionService(normalizedOptions.config);

            const streamDetectionService = injectedStreamDetectionService ||
                new YouTubeStreamDetectionService(innertubeService, { logger, timeout: 3000 });
            
            const dependencies = {
                logger,
                streamDetectionService,
                
                innertubeFactory,
                innertubeService,
                viewerExtractionService,
                
                RawPlatformDataLoggingService: ResolvedRawPlatformDataLoggingService,
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
            const { TikTokWebSocketClient: injectedClient, ...platformOptions } = options;
            const Client = injectedClient ?? TikTokWebSocketClient;
            if (typeof Client !== 'function') {
                throw new Error('Missing TikTok dependencies: TikTokWebSocketClient. Provide a WebSocket client constructor.');
            }
            const ResolvedRawPlatformDataLoggingService = options.RawPlatformDataLoggingService || RawPlatformDataLoggingService;
            
            if (!options.config) {
                throw new Error('createTikTokDependencies requires config object in options');
            }
            
            const selfMessageDetectionService = new SelfMessageDetectionService(options.config);

            const dependencies = {
                logger,
                TikTokWebSocketClient: Client,
                connectionFactory: this._createTikTokConnectionFactory(config, logger),
                RawPlatformDataLoggingService: ResolvedRawPlatformDataLoggingService,
                selfMessageDetectionService,
                ...platformOptions
            };

            if (!options.logger) {
                this.validateDependencyInterface(dependencies.logger, 'logger');
            }

            return dependencies;

        } catch (error) {
            throw new Error(`Failed to create TikTok dependencies: ${getErrorMessage(error)}`);
        }
    }

    createStreamelementsDependencies(_config: PlatformDependencyConfig, options: DependencyFactoryOptions = {}) {
        return { ...options, logger: options.logger ?? this.createValidatedLogger('streamelements') };
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

            const sanitizedOptions = { ...options };
            const injectedTwitchAuth = sanitizedOptions.twitchAuth;
            delete sanitizedOptions.twitchAuth;

            if (!injectedTwitchAuth) {
                throw new Error('createTwitchDependencies requires twitchAuth');
            }

            const ResolvedRawPlatformDataLoggingService = options.RawPlatformDataLoggingService || RawPlatformDataLoggingService;
            
            if (!options.config) {
                throw new Error('createTwitchDependencies requires config object in options');
            }
            
            const selfMessageDetectionService = new SelfMessageDetectionService(options.config);
            
            const dependencies = {
                logger,
                twitchAuth: injectedTwitchAuth,
                RawPlatformDataLoggingService: ResolvedRawPlatformDataLoggingService,
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

    _createTikTokConnectionFactory(_config: PlatformDependencyConfig, logger: AppLogger) {
        return new PlatformConnectionFactory(logger);
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
            createWithConfig: async (config?: Record<string, unknown>) => {
                const dependency = options.Innertube;
                const instance = dependency
                    ? await (typeof dependency === 'function' ? await dependency() : dependency).create(config)
                    : await factory.createWithConfig(config);
                if (!isInnertubeInfoClient(instance)) {
                    throw new Error('InnertubeFactory returned an invalid client');
                }
                return instance;
            },
            createWithTimeout: async (timeoutMs?: number, config?: Record<string, unknown>) => {
                const instance = await factory.createWithTimeout(timeoutMs, config);
                if (!isInnertubeInfoClient(instance)) {
                    throw new Error('InnertubeFactory returned an invalid client');
                }
                return instance;
            }
        };

        return new InnertubeService(serviceFactory, {
            logger
        });
    }
    
    _createViewerExtractionService(innertubeService: InnertubeService, logger: AppLogger, options: DependencyFactoryOptions = {}) {
        return new ViewerCountExtractionService(innertubeService, {
            logger,
            timeout: options.timeout || 8000
        });
    }

    _capitalizeFirst(str: string) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

export { DependencyFactory };
export default { DependencyFactory };
