import fs from 'node:fs';
import { EventEmitter } from 'node:events';

import { UNKNOWN_CHAT_MESSAGE, UNKNOWN_CHAT_USERNAME } from '../constants/degraded-chat';
import { PlatformEvents } from '../interfaces/PlatformEvents';
import { YouTubeLiveStreamService } from '../services/youtube-live-stream-service';
import * as innertubeInstanceManager from '../services/innertube-instance-manager';
import { ChatFileLoggingService } from '../services/ChatFileLoggingService';
import { collectMissingFields, getMissingFields, mergeMissingFieldsMetadata } from '../utils/missing-fields';
import { normalizeYouTubeMessage } from '../utils/message-normalization';
import { getValidMessageParts } from '../utils/message-parts';
import { validateYouTubePlatformDependencies } from '../utils/dependency-validator';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { resolveYouTubeTimestampISO } from '../utils/platform-timestamp';
import { createRetrySystem } from '../utils/retry-system';
import { getSystemTimestampISO } from '../utils/timestamp';
import { safeSetInterval, validateTimeout } from '../utils/timeout-validator';
import { withTimeout } from '../utils/timeout-wrapper';
import { getFallbackUsername } from '../utils/validation';
import { ViewerCountProviderFactory } from '../utils/viewer-count-providers';
import { createYouTubeConnectionFactory } from './youtube/connections/youtube-connection-factory';
import { createYouTubeEventFactory } from './youtube/events/event-factory';
import { normalizeYouTubeEvent } from './youtube/events/event-normalizer';
import { createYouTubeEventRouter } from './youtube/events/event-router';
import { createYouTubeMonetizationParser, resolveYouTubeGiftMembershipCount } from './youtube/monetization/monetization-parser';
import { createYouTubeMultiStreamManager } from './youtube/streams/youtube-multistream-manager';
import { extractAuthor } from './youtube/youtube-author-extractor';
import { YouTubeConnectionManager } from './youtube/youtube-connection-manager';
import { extractMessageText } from './youtube/youtube-message-extractor';
import { YouTubeUserAgentManager } from './youtube/youtube-user-agent-manager';
import { normalizeYouTubeUsername } from './youtube/youtube-username-normalizer';

const INNERTUBE_CREATION_TIMEOUT_MS = 3000;

const IGNORED_DUPLICATE_EVENT_TYPES = new Set([
    'LiveChatPaidMessageRenderer',
    'LiveChatPaidStickerRenderer',
    'LiveChatMembershipItemRenderer',
    'LiveChatTickerPaidMessageItem',
    'LiveChatTickerPaidMessageItemRenderer',
    'LiveChatTickerPaidStickerItem',
    'LiveChatTickerPaidStickerItemRenderer',
    'LiveChatTickerSponsorItem',
    'LiveChatTickerSponsorItemRenderer',
    'LiveChatTickerSponsorshipsItemRenderer',
    'LiveChatSponsorshipsGiftPurchaseAnnouncementRenderer',
    'LiveChatSponsorshipsGiftRedemptionAnnouncement',
    'LiveChatSponsorshipsGiftRedemptionAnnouncementRenderer'
]);

const GIFT_MEMBERSHIP_REDEMPTION_EVENT_TYPES = new Set([
    'LiveChatSponsorshipsGiftRedemptionAnnouncement',
    'LiveChatSponsorshipsGiftRedemptionAnnouncementRenderer'
]);

type UnknownMap = Record<string, unknown>;
type StreamRefreshRequest = {
  requestImmediateRefresh?: boolean;
  source?: string;
  reason?: string;
};

type LoggerLike = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

type ErrorHandlerLike = {
  handleEventProcessingError?: (error: Error, eventType: string, eventData?: unknown, message?: string, source?: string) => void;
  handleConnectionError?: (error: Error, action?: string, message?: string) => void;
  handleCleanupError?: (error: unknown, resource: string, message?: string | null) => void;
  handleDataLoggingError?: (error: unknown, resource: string) => void;
  logOperationalError?: (message: string, action: string, metadata?: unknown) => void;
};

type ChatFileLoggingServiceLike = {
  logRawPlatformData: (platform: string, eventType: string, data: unknown, config: UnknownMap) => Promise<void>;
};

type ChatFileLoggingServiceConstructor = new (options: { logger: unknown; config: UnknownMap }) => ChatFileLoggingServiceLike;

type ViewerServiceLike = {
  _activeStream?: { videoId?: string };
  clearActiveStream?: () => void;
  cleanup?: () => void;
  setActiveStream?: (videoId: string) => Promise<void>;
};

type ViewerCountProviderLike = {
  getViewerCount: () => Promise<number | null>;
  getViewerCountForVideo?: (videoId: string) => Promise<number | null>;
};

type RetrySystemLike = {
  resetRetryCount: (platform: string) => void;
  handleConnectionSuccess: (platform: string, connections: unknown, label: string) => void;
  handleConnectionError: (
    platform: string,
    error: unknown,
    reconnect: () => Promise<void>,
    cleanup: () => Promise<void>
  ) => void | Promise<void>;
};

type StreamDetectionServiceLike = {
  detectLiveStreams: (channelHandle: unknown) => Promise<{
    success?: boolean;
    videoIds?: unknown;
    detectionMethod?: string;
    error?: string;
    message?: string;
  }>;
};

type YouTubeExtractionServiceLike = {
  getAggregatedViewerCount: (activeVideoIds: string[]) => Promise<{
    success: boolean;
    totalCount: number;
    successfulStreams: number;
    failedStreams?: number;
  }>;
  extractViewerCount?: (videoId: string) => Promise<{
    success: boolean;
    count: number;
  }>;
};

type YouTubeProviderExtractionServiceLike = YouTubeExtractionServiceLike & {
  extractViewerCount: (videoId: string) => Promise<{
    success: boolean;
    count: number;
  }>;
};

type ProviderLoggerLike = {
  debug: (message: string, context?: string, payload?: unknown) => void;
  info: (message: string, context?: string, payload?: unknown) => void;
  warn: (message: string, context?: string, payload?: unknown) => void;
  error: (message: string, context?: string, payload?: unknown) => void;
};

type YouTubeConnectionLike = {
  on: (event: string, handler: (payload?: unknown) => void) => void;
  start: () => void;
  applyFilter?: (filterName: string) => void;
  [key: string]: unknown;
};

type EventFactoryLike = ReturnType<typeof createYouTubeEventFactory>;
type EventRouterLike = ReturnType<typeof createYouTubeEventRouter>;
type MonetizationParserLike = ReturnType<typeof createYouTubeMonetizationParser>;
type YouTubeConnectionFactoryLike = ReturnType<typeof createYouTubeConnectionFactory>;
type YouTubeMultiStreamManagerLike = ReturnType<typeof createYouTubeMultiStreamManager>;

type HandlerMap = Record<string, (payload: unknown) => unknown>;

type YouTubeDependencies = UnknownMap & {
  logger: LoggerLike;
  USER_AGENTS?: string[] | undefined;
  Innertube?: unknown;
  timestampService?: unknown;
  viewerService?: ViewerServiceLike;
  ChatFileLoggingService?: ChatFileLoggingServiceConstructor;
  chatFileLoggingService?: ChatFileLoggingServiceLike;
  retrySystem?: RetrySystemLike;
  streamDetectionService?: StreamDetectionServiceLike;
  viewerCountProvider?: ViewerCountProviderLike;
  viewerExtractionService?: YouTubeExtractionServiceLike;
  innertubeService?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isYouTubeDependencies(value: UnknownMap): value is YouTubeDependencies {
  return isRecord(value.logger)
    && typeof value.logger.debug === 'function'
    && typeof value.logger.info === 'function'
    && typeof value.logger.warn === 'function';
}

function hasSendMessage(value: unknown): value is { sendMessage: (message: unknown) => Promise<boolean> } {
  return isRecord(value) && typeof value.sendMessage === 'function';
}

function isYouTubeConnectionLike(value: unknown): value is YouTubeConnectionLike {
  return isRecord(value) && typeof value.on === 'function' && typeof value.start === 'function';
}

function toUnknownMap(value: unknown): UnknownMap {
  return isRecord(value) ? value : {};
}

function isYouTubeExtractionService(value: unknown): value is YouTubeExtractionServiceLike {
  return isRecord(value)
    && typeof value.getAggregatedViewerCount === 'function';
}

function isYouTubeProviderExtractionService(value: unknown): value is YouTubeProviderExtractionServiceLike {
  return isYouTubeExtractionService(value)
    && typeof value.extractViewerCount === 'function';
}

function summarizeYouTubeConfig(config: UnknownMap): Record<string, unknown> {
    return {
        enabled: config.enabled === true,
        hasUsername: typeof config.username === 'string' && config.username.length > 0,
        maxStreams: typeof config.maxStreams === 'number' ? config.maxStreams : null,
        chatMode: typeof config.chatMode === 'string' ? config.chatMode : null,
        dataLoggingEnabled: config.dataLoggingEnabled === true
    };
}

class YouTubePlatform extends EventEmitter {
  handlers: HandlerMap;
  logger: LoggerLike;
  errorHandler: ErrorHandlerLike;
  platformLogger: LoggerLike;
  config: UnknownMap;
  platformName: string;
  eventFactory: EventFactoryLike;
  eventRouter: EventRouterLike;
  monetizationParser: MonetizationParserLike;
  USER_AGENTS?: string[] | undefined;
  Innertube: unknown;
  timestampService: unknown;
  viewerService: ViewerServiceLike | null;
  chatFileLoggingService: ChatFileLoggingServiceLike;
  isInitialized: boolean;
  monitoringInterval: ReturnType<typeof setInterval> | number | null;
  monitoringIntervalStart?: number | undefined;
  shortageState: {
    lastWarningTime: number | null;
    isInShortage: boolean;
    lastKnownAvailable: number;
    lastKnownRequired: number;
  };
  userAgentManager: YouTubeUserAgentManager;
  retrySystem: RetrySystemLike;
  connectionManager: YouTubeConnectionManager;
  _youtubeConnectionFactory: YouTubeConnectionFactoryLike;
  _youtubeMultiStreamManager: YouTubeMultiStreamManagerLike;
  streamDetectionService?: StreamDetectionServiceLike;
  viewerExtractionService: YouTubeExtractionServiceLike | null;
  viewerCountProvider: ViewerCountProviderLike | null;
  lastFullStreamCheck: number | null = null;
  lastYouTubeVideoIdsUpdateTime?: number | undefined;
  streamViewerCounts?: Map<string, number>;
  lastRecoveryTime?: number;
  currentVideoId?: string;

  constructor(config: UnknownMap = {}, dependencyInput: unknown = {}) {
        super();

        this.handlers = {};
    if (typeof dependencyInput === 'string' || typeof dependencyInput === 'number') {
            throw new Error('Dependencies should be a single object with logger property, not separate parameters. ' +
                           'Use: new YouTubePlatform(config, { logger, notificationManager, ... }) instead of separate arguments.');
        }

    const dependenciesInputRecord = isRecord(dependencyInput) ? dependencyInput : {};

        try {
            validateYouTubePlatformDependencies(dependenciesInputRecord);
        } catch (error) {
            throw new Error(`YouTube platform initialization failed: ${getErrorMessage(error)}`);
        }

    if (!isYouTubeDependencies(dependenciesInputRecord)) {
            throw new Error('YouTube platform initialization failed: missing required dependencies: logger dependency is required');
    }
    const dependencies = dependenciesInputRecord;

        this.logger = dependencies.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'youtube');
        this.platformLogger = this.logger;
        
        this.config = { ...config };
        this.platformName = 'youtube';
        this.eventFactory = createYouTubeEventFactory();
        try {
            this.eventRouter = createYouTubeEventRouter({ platform: this._createEventRouterPlatformAdapter() });
        } catch (error) {
            this._handleProcessingError('Failed to create event router', error, 'configuration');
            throw error;
        }
        this.monetizationParser = createYouTubeMonetizationParser({ logger: this.logger });
        this._ensureDataLoggingPath();

        this.USER_AGENTS = dependencies.USER_AGENTS;
        this.Innertube = dependencies.Innertube; // Lazy-loaded youtubei.js Innertube (null initially for startup performance)
        this.timestampService = dependencies.timestampService || null;
        this.viewerService = dependencies.viewerService || null;

        const defaultChatLoggingDependencies = {
            logger: this.logger,
            config: this.config
        } as ConstructorParameters<typeof ChatFileLoggingService>[0];
        this.chatFileLoggingService = dependencies.chatFileLoggingService || (dependencies.ChatFileLoggingService
            ? new dependencies.ChatFileLoggingService({ logger: this.logger, config: this.config })
            : new ChatFileLoggingService(defaultChatLoggingDependencies));

        this.isInitialized = false;
        this.monitoringInterval = null;
        
        this.shortageState = {
            lastWarningTime: null,
            isInShortage: false,
            lastKnownAvailable: 0,
            lastKnownRequired: 0
        };

        this.userAgentManager = new YouTubeUserAgentManager(this.logger, {
            ...(this.USER_AGENTS ? { userAgents: this.USER_AGENTS } : {})
        });

        this.retrySystem = dependencies.retrySystem || createRetrySystem({ logger: this.logger });
        
        this.connectionManager = new YouTubeConnectionManager(this.logger, {
            config: this.config
        });

        this._youtubeConnectionFactory = createYouTubeConnectionFactory({
            platform: this._createConnectionFactoryPlatformAdapter(),
            innertubeInstanceManager: this._createInnertubeInstanceManagerAdapter(),
            withTimeout,
            innertubeCreationTimeoutMs: INNERTUBE_CREATION_TIMEOUT_MS
        });

        this._youtubeMultiStreamManager = createYouTubeMultiStreamManager({
            platform: this._createMultiStreamPlatformAdapter(),
            safeSetInterval,
            validateTimeout,
            now: () => Date.now()
        });

        this.streamDetectionService = dependencies.streamDetectionService;

        this.logger.debug('YouTube platform initialized', 'youtube', summarizeYouTubeConfig(this.config));

        if (!this.handleChatMessage) {
            this._handleProcessingError(
                'handleChatMessage not defined after constructor',
                new Error('handleChatMessage not defined after constructor'),
                'configuration'
            );
        }
        if (!this.config) {
            this._handleProcessingError(
                'config not defined after constructor',
                new Error('config not defined after constructor'),
                'configuration'
            );
        }
        
        this.viewerExtractionService = isYouTubeExtractionService(dependencies.viewerExtractionService)
            ? dependencies.viewerExtractionService
            : null;

        if (dependencies.viewerCountProvider) {
            this.viewerCountProvider = dependencies.viewerCountProvider;
            this.logger.debug('Using injected viewer count provider', 'youtube');
        } else {
            try {
                const providerDependencies: {
                    viewerExtractionService?: YouTubeProviderExtractionServiceLike;
                    innertubeService?: unknown;
                    logger?: ProviderLoggerLike;
                } = {
                    innertubeService: dependencies.innertubeService,
                    logger: this._createProviderLoggerAdapter()
                };

                if (isYouTubeProviderExtractionService(this.viewerExtractionService)) {
                    providerDependencies.viewerExtractionService = this.viewerExtractionService;
                }

                this.viewerCountProvider = ViewerCountProviderFactory.createYouTubeProvider(
                    innertubeInstanceManager,
                    this.config,
                    () => this.getDetectedStreamIds(),
                    this.Innertube, // Can be null initially, service layer handles YouTube.js loading
                    providerDependencies
                );
                this.logger.debug('Created YouTube viewer count provider with service layer dependencies', 'youtube');
            } catch (error) {
                this.logger.warn('Failed to create viewer count provider, viewer counts will return 0', 'youtube', error);
                this.viewerCountProvider = null;
            }
        }
    }


    _createInnertubeInstanceManagerAdapter() {
        return {
            getInstance: (_options: { logger: LoggerLike }) => {
                const manager = innertubeInstanceManager.getInstance();
                return {
                    getInstance: async <T>(key: string, factory: () => Promise<T>): Promise<T> => {
                        const instance = await manager.getInstance(key, factory as () => Promise<{ [key: string]: unknown }>);
                        return instance as T;
                    }
                };
            }
        };
    }

    _createProviderLoggerAdapter(): ProviderLoggerLike {
        return {
            debug: (message: string, context?: string, payload?: unknown) => this.logger.debug(message, context, payload),
            info: (message: string, context?: string, payload?: unknown) => this.logger.info(message, context, payload),
            warn: (message: string, context?: string, payload?: unknown) => this.logger.warn(message, context, payload),
            error: (message: string, context?: string, payload?: unknown) => {
                if (this.errorHandler && typeof this.errorHandler.logOperationalError === 'function') {
                    this.errorHandler.logOperationalError(message, context || 'youtube', payload);
                    return;
                }
                this.logger.warn(message, context, payload);
            }
        };
    }

    _createEventRouterPlatformAdapter() {
        return {
            logger: this.logger,
            eventFactory: this.eventFactory,
            _emitPlatformEvent: (eventType: string, payload: unknown) => this._emitPlatformEvent(eventType, payload),
            handleLowPriorityEvent: (chatItem: unknown, eventType: string) => this.handleLowPriorityEvent(chatItem, eventType),
            handleSuperChat: (chatItem: unknown) => this.handleSuperChat(chatItem),
            handleSuperSticker: (chatItem: unknown) => this.handleSuperSticker(chatItem),
            handleGiftMessageView: (chatItem: unknown) => this.handleGiftMessageView(chatItem),
            handleMembership: (chatItem: unknown) => this.handleMembership(chatItem),
            handleGiftMembershipPurchase: (chatItem: unknown) => this.handleGiftMembershipPurchase(chatItem),
            handleChatTextMessage: (chatItem: unknown) => this.handleChatTextMessage(chatItem)
        };
    }

    _createConnectionFactoryPlatformAdapter() {
        return {
            logger: this.logger,
            config: this.config,
            ...(this.viewerService ? { viewerService: this.viewerService } : {}),
            setYouTubeConnectionReady: (videoId: string) => this.setYouTubeConnectionReady(videoId),
            disconnectFromYouTubeStream: (
                videoId: string,
                reason: string,
                options?: { requestImmediateRefresh?: boolean; source?: string }
            ) => this.disconnectFromYouTubeStream(videoId, reason, options),
            handleChatMessage: (message: UnknownMap) => {
                void this.handleChatMessage(message);
            },
            logRawPlatformData: async (channel: string, payload: unknown): Promise<void> => {
                await this.logRawPlatformData(channel, payload);
            },
            _validateVideoForConnection: (videoId: string, info: unknown) => this._validateVideoForConnection(videoId, info),
            _handleProcessingError: (message: string, error: unknown, category: string, metadata?: UnknownMap) => {
                this._handleProcessingError(message, error, category, metadata);
            },
            _extractMessagesFromChatItem: (chatItem: UnknownMap) => this._extractMessagesFromChatItem(chatItem),
            _shouldSkipMessage: (message: UnknownMap) => this._shouldSkipMessage(message),
            _resolveChatItemAuthorName: (message: UnknownMap) => this._resolveChatItemAuthorName(message)
        };
    }

    _createMultiStreamPlatformAdapter() {
        const thisPlatform = this;
        return {
            config: this.config as UnknownMap & { maxStreams: number; streamPollingInterval: number; fullCheckInterval: number },
            connectionManager: this.connectionManager,
            logger: this.logger,
            shortageState: this.shortageState,
            get monitoringInterval() {
                return thisPlatform.monitoringInterval;
            },
            set monitoringInterval(value: ReturnType<typeof setInterval> | number | null) {
                thisPlatform.monitoringInterval = value;
            },
            get monitoringIntervalStart() {
                return thisPlatform.monitoringIntervalStart ?? 0;
            },
            set monitoringIntervalStart(value: number) {
                thisPlatform.monitoringIntervalStart = value;
            },
            get lastFullStreamCheck() {
                return thisPlatform.lastFullStreamCheck;
            },
            set lastFullStreamCheck(value: number | null) {
                thisPlatform.lastFullStreamCheck = value;
            },
            get lastYouTubeVideoIdsUpdateTime() {
                return thisPlatform.lastYouTubeVideoIdsUpdateTime ?? 0;
            },
            set lastYouTubeVideoIdsUpdateTime(value: number) {
                thisPlatform.lastYouTubeVideoIdsUpdateTime = value;
            },
            checkMultiStream: (options?: { throwOnError?: boolean }) => this.checkMultiStream(options),
            checkStreamShortageAndWarn: (availableCount: number, maxStreams: number) => {
                this.checkStreamShortageAndWarn(availableCount, maxStreams);
            },
            getActiveYouTubeVideoIds: () => this.getActiveYouTubeVideoIds(),
            getLiveVideoIds: () => this.getLiveVideoIds(),
            connectToYouTubeStream: async (videoId: string) => {
                await this.connectToYouTubeStream(videoId);
            },
            disconnectFromYouTubeStream: async (
                videoId: string,
                reason: string,
                options?: { requestImmediateRefresh?: boolean; source?: string }
            ) => {
                await this.disconnectFromYouTubeStream(videoId, reason, options);
            },
            _logMultiStreamStatus: (includeDetails?: boolean, includeActiveStreamsList?: boolean) => {
                this._logMultiStreamStatus(includeDetails, includeActiveStreamsList);
            },
            _handleProcessingError: (message: string, error: unknown, category: string) => {
                this._handleProcessingError(message, error, category);
            },
            _handleConnectionErrorLogging: (message: string, error: unknown, category: string) => {
                this._handleConnectionErrorLogging(message, error, category);
            },
            _handleError: (error: unknown, context: string) => {
                this._handleError(error, context);
            },
            _emitPlatformEvent: (type: string, payload: UnknownMap) => {
                this._emitPlatformEvent(type, payload);
            }
        };
    }


    getNextUserAgent() {
        return this.userAgentManager.getNextUserAgent();
    }


  removeYouTubeConnection(videoId: string) {
        this.connectionManager.removeConnection(videoId);
        
        if (this.viewerService && typeof this.viewerService.clearActiveStream === 'function') {
            try {
                if (this.viewerService._activeStream && this.viewerService._activeStream.videoId === videoId) {
                    this.viewerService.clearActiveStream();
                    this.logger.debug(`Cleared active stream from viewer service: ${videoId}`, 'youtube');
                }
            } catch (serviceError: unknown) {
                this.logger.warn(`Failed to clear active stream in viewer service: ${getErrorMessage(serviceError)}`, 'youtube');
            }
        }
    }

    async disconnectFromYouTubeStream(videoId: string, reason = 'unknown', options: StreamRefreshRequest = {}): Promise<boolean> {
        if (!this.connectionManager) {
            return false;
        }

        const previousCount = this.connectionManager.getConnectionCount();
        const result = await this.connectionManager.disconnectFromStream(videoId, reason);
        this._emitStreamStatusIfNeeded(previousCount, { videoId, reason });

        if (result && options.requestImmediateRefresh === true) {
            const refreshContext = {
                videoId,
                reason,
                source: options.source || 'unknown'
            };

            const checkInProgress = this._youtubeMultiStreamManager &&
                typeof this._youtubeMultiStreamManager.isCheckInProgress === 'function' &&
                this._youtubeMultiStreamManager.isCheckInProgress() === true;

            if (checkInProgress) {
                this.requestImmediateYouTubeStreamRefresh(refreshContext).catch((error) => {
                    this._handleConnectionErrorLogging(
                        `Immediate stream refresh failed after disconnect: ${getErrorMessage(error)}`,
                        error,
                        'stream-refresh'
                    );
                });
            } else {
                await this.requestImmediateYouTubeStreamRefresh(refreshContext);
            }
        }

        return result;
    }

    async requestImmediateYouTubeStreamRefresh(context: UnknownMap = {}): Promise<void> {
        if (!this._youtubeMultiStreamManager || typeof this._youtubeMultiStreamManager.requestImmediateRefresh !== 'function') {
            return;
        }

        await this._youtubeMultiStreamManager.requestImmediateRefresh(context);
    }

    setYouTubeConnectionReady(videoId: string) {
        this.connectionManager.setConnectionReady(videoId);
    }

    isAnyYouTubeStreamReady(): boolean {
        return this.connectionManager.isAnyConnectionReady();
    }

    getActiveYouTubeVideoIds(): string[] {
        if (!this.connectionManager) {
            return [];
        }
        return this.connectionManager.getActiveVideoIds().filter((videoId: string) =>
            this.connectionManager.isConnectionReady(videoId)
        );
    }

    getDetectedStreamIds(): string[] {
        if (!this.connectionManager) {
            return [];
        }
        return this.connectionManager.getActiveVideoIds();
    }

    async initialize(handlers: HandlerMap = {}, forceReconnect = false): Promise<void> {
        if (this.isInitialized) {
            const activeConnectionCount = this.connectionManager.getConnectionCount();

            if (activeConnectionCount > 0 && !forceReconnect) {
                this.logger.debug(
                    `Already initialized with ${activeConnectionCount} active stream(s), skipping reinitialization`,
                    'youtube'
                );
                return;
            }

            if (activeConnectionCount === 0) {
                this.logger.debug(
                    'Already initialized but no active streams detected, allowing reinitialization for new stream detection',
                    'youtube'
                );
            } else if (forceReconnect) {
                this.logger.debug(
                    'Forcing reinitialization due to explicit reconnection request',
                    'youtube'
                );
            }
        }

        try {
            this.logger.info('Initializing YouTube platform with retry system...', 'youtube');
            
            this.retrySystem.resetRetryCount('YouTube');
            
            this.handlers = { ...this.handlers, ...handlers };

            if (this.config.enabled && this.config.username) {
                try {
                    await this.startMultiStreamMonitoring();
                } catch (error) {
                    this._handleConnectionErrorLogging(`Failed to start multi-stream monitoring: ${getErrorMessage(error)}`, error, 'multi-stream monitoring');
                    throw error;
                }
            }

            this.retrySystem.handleConnectionSuccess('YouTube', this.connectionManager.getAllConnections(), 'YouTube Live Chat');
            
            this.isInitialized = true;
            
        } catch (error) {
            this._handleProcessingError(`Error during initialization: ${getErrorMessage(error)}`, error, 'initialization');
            await this.retrySystem.handleConnectionError(
                'YouTube',
                error,
                () => this.initialize(handlers, true),
                () => this.cleanup()
            );
            throw error;
        }
    }

    async startMultiStreamMonitoring(): Promise<void> {
        return await this._youtubeMultiStreamManager.startMonitoring();
    }

    async checkMultiStream(options: { throwOnError?: boolean } = {}): Promise<void> {
        return await this._youtubeMultiStreamManager.checkMultiStream(options);
    }

    checkStreamShortageAndWarn(availableCount: number, maxStreams: number): void {
        return this._youtubeMultiStreamManager.checkStreamShortageAndWarn(availableCount, maxStreams);
    }


    async getLiveVideoIds(): Promise<string[]> {
        this.logger.debug('Using youtubei method for stream detection', 'youtube');
        return this.getLiveVideoIdsByYoutubei();
    }



    async getLiveVideoIdsByYoutubei(): Promise<string[]> {
        this.logger.debug('[YouTube] getLiveVideoIdsByYoutubei() called', 'youtube');
        
        const channelHandle = this.config.username;

        if (!this.streamDetectionService || typeof this.streamDetectionService.detectLiveStreams !== 'function') {
            const error = new Error('YouTube stream detection youtubei failed: Service unavailable');
            this._handleProcessingError(error.message, error, 'stream-detection');
            throw error;
        }

        const result = await this.streamDetectionService.detectLiveStreams(channelHandle);

        if (result.success && Array.isArray(result.videoIds) && result.videoIds.length > 0) {
            const method = result.detectionMethod || 'youtubei';
            this.logger.debug(`[YouTube] Found ${result.videoIds.length} live streams via youtubei service (method: ${method})`, 'youtube');
            return result.videoIds.filter((videoId: unknown): videoId is string => typeof videoId === 'string');
        }

        const message = result.error || result.message || 'No live streams detected';
        this.logger.debug(`[YouTube] youtubei service returned no live streams: ${message}`, 'youtube');
        return [];
    }


    async connectToYouTubeStream(videoId: string, options: StreamRefreshRequest = {}): Promise<boolean> {
        const hasExisting = this.connectionManager.hasConnection(videoId);
        
        if (hasExisting) {
            return true;
        }

        const previousCount = this.connectionManager.getConnectionCount();
        
        try {
            const success = await this.connectionManager.connectToStream(
                videoId, 
                (videoId: string) => this._createYouTubeConnection(videoId),
                { reason: 'stream detected', ...options }
            );
            
            if (success) {
                this.logger.info(`Connected to YouTube stream: ${videoId}`, 'youtube');
                const connectionId = `youtube-${videoId}`;
                const timestamp = getSystemTimestampISO();
                const chatConnectedEvent = this.eventFactory.createChatConnectedEvent({ videoId, connectionId, timestamp });
                const eventPlatform = chatConnectedEvent.platform;
                this.emit('platform:event', {
                    platform: eventPlatform,
                    type: PlatformEvents.CHAT_CONNECTED,
                    data: chatConnectedEvent
                });
                this._emitStreamStatusIfNeeded(previousCount, {
                    videoId,
                    reason: options.reason || 'stream detected'
                });
            } else {
                this.logger.warn(`Failed to connect to YouTube stream: ${videoId}`, 'youtube');
            }
            
            return success;
            
        } catch (error) {
            this._handleConnectionErrorLogging(`Failed to connect to YouTube stream: ${getErrorMessage(error)}`, error, 'stream-connect');
            throw error;
        }
    }

    async _createYouTubeConnection(videoId: string): Promise<{ [key: string]: unknown }> {
        try {
            const connection = await this._youtubeConnectionFactory.createConnection(videoId);
            if (!isYouTubeConnectionLike(connection)) {
                throw new Error('YouTube connection factory returned invalid connection');
            }
            await this._setupConnectionEventListeners(connection, videoId);
            return connection;
        } catch (error) {
            this._handleConnectionErrorLogging(`Failed to create YouTube connection: ${getErrorMessage(error)}`, error, 'connection-create');
            throw error;
        }
    }
    
    async _setupConnectionEventListeners(connection: YouTubeConnectionLike, videoId: string): Promise<void> {
        return await this._youtubeConnectionFactory.setupConnectionEventListeners(connection, videoId);
	    }

    async handleChatMessage(chatItem: unknown): Promise<void> {
        this.logger.debug('handleChatMessage() called', 'youtube');
        
        if (!chatItem) {
            this.logger.debug('Received null/undefined chat item, skipping', 'youtube');
            return;
        }

        const chatRecord = toUnknownMap(chatItem);
        const modernEventType = toUnknownMap(chatRecord.item).type;
        const { normalizedChatItem, eventType, debugMetadata } = normalizeYouTubeEvent(chatItem);
        const resolvedEventType = eventType || modernEventType;
        if (!normalizedChatItem) {
            if (debugMetadata?.reason === 'missing_gift_purchase_author') {
                this._handleMissingGiftPurchaseAuthor(chatItem, debugMetadata);
                return;
            }
            this.logger.debug('Chat item has no recognizable structure, skipping', 'youtube', debugMetadata);
            return;
        }

        const authorForLog = this._resolveChatItemAuthorNameForLog(normalizedChatItem);

        if (this._shouldSkipEvent(normalizedChatItem)) {
            this.logger.debug('Skipping filtered event', 'youtube', {
                eventType: resolvedEventType,
                author: authorForLog
            });
            return;
        }

        if (this._isIgnoredDuplicateEventType(resolvedEventType)) {
            this.handleIgnoredDuplicateEvent(normalizedChatItem, resolvedEventType);
            return;
        }

        this.logger.debug('YouTube event routing', 'youtube', {
            eventType: resolvedEventType,
            author: authorForLog
        });
        
        try {
            const routed = await this.eventRouter.routeEvent(normalizedChatItem, resolvedEventType);
            if (!routed) {
                this._handleMissingChatEvent(resolvedEventType, normalizedChatItem);
            }
        } catch (error) {
            this._handleProcessingError(
                `Error handling event type ${resolvedEventType}: ${getErrorMessage(error)}`,
                error,
                String(resolvedEventType),
                normalizedChatItem
            );
        }
    }

    async handleSuperChat(chatItem: unknown): Promise<void> {
        const author = this._resolveMonetizationAuthor(chatItem);
        try {
            const parsed = this.monetizationParser.parseSuperChat(toUnknownMap(chatItem));
            const payload = this.eventFactory.createGiftEvent({
                ...parsed,
                ...author
            });
            this._emitPlatformEvent(PlatformEvents.GIFT, payload);
        } catch (error) {
            this._handleProcessingError(`Error processing Super Chat: ${getErrorMessage(error)}`, error, 'superchat', chatItem);
            this._emitGiftError(chatItem, {
                giftType: 'Super Chat',
                giftCount: 1,
                author
            });
        }
    }

    async handleSuperSticker(chatItem: unknown): Promise<void> {
        const author = this._resolveMonetizationAuthor(chatItem);
        try {
            const parsed = this.monetizationParser.parseSuperSticker(toUnknownMap(chatItem));
            const payload = this.eventFactory.createGiftEvent({
                ...parsed,
                ...author
            });
            this._emitPlatformEvent(PlatformEvents.GIFT, payload);
        } catch (error) {
            this._handleProcessingError(`Error processing Super Sticker: ${getErrorMessage(error)}`, error, 'supersticker', chatItem);
            this._emitGiftError(chatItem, {
                giftType: 'Super Sticker',
                giftCount: 1,
                author
            });
        }
    }

    async handleGiftMessageView(chatItem: unknown): Promise<void> {
        const author = this._resolveGiftMessageViewAuthor(chatItem);
        try {
            const parsed = this.monetizationParser.parseGiftMessageView(toUnknownMap(chatItem));
            const missingFields = collectMissingFields({
                userId: !!author.userId
            });
            const payload = this.eventFactory.createGiftEvent({
                ...parsed,
                ...author,
                ...(missingFields.length > 0
                    ? { metadata: mergeMissingFieldsMetadata({}, missingFields) }
                    : {})
            });
            this._emitPlatformEvent(PlatformEvents.GIFT, payload);
        } catch (error) {
            this._handleProcessingError(`Error processing GiftMessageView: ${getErrorMessage(error)}`, error, 'gift-message-view', chatItem);
            this._emitGiftError(chatItem, {
                giftType: 'YouTube Gift',
                giftCount: 1,
                author,
                label: 'YouTube GiftMessageView'
            });
        }
    }

    handleChatTextMessage(chatItem: unknown): void {
        const chatRecord = toUnknownMap(chatItem);
        if (!isRecord(chatRecord.item)) {
            this.logger.warn('Skipping chat message: missing chat item payload', 'youtube');
            return;
        }
        this._processRegularChatMessage(chatRecord);
    }

    async handleMembership(chatItem: unknown): Promise<void> {
        const author = this._resolveMonetizationAuthor(chatItem);
        try {
            const parsed = this.monetizationParser.parseMembership(toUnknownMap(chatItem));
            const payload = this.eventFactory.createPaypiggyEvent({
                ...parsed,
                ...author
            });
            this._emitPlatformEvent(PlatformEvents.PAYPIGGY, payload);
        } catch (error) {
            this._handleProcessingError(`Error processing membership: ${getErrorMessage(error)}`, error, 'membership', chatItem);
            this._emitPaypiggyError(chatItem, { author });
        }
    }

    async handleGiftMembershipPurchase(chatItem: unknown): Promise<void> {
        const author = this._resolveMonetizationAuthor(chatItem);
        try {
            const parsed = this.monetizationParser.parseGiftPurchase(toUnknownMap(chatItem));
            const payload = this.eventFactory.createGiftPaypiggyEvent({
                ...parsed,
                ...author
            });
            this._emitPlatformEvent(PlatformEvents.GIFTPAYPIGGY, payload);
        } catch (error) {
            this._handleProcessingError(`Error processing gift membership purchase: ${getErrorMessage(error)}`, error, 'gift-membership', chatItem);
            this._emitGiftPaypiggyError(chatItem, { author });
        }
    }



    _shouldSkipEvent(chatItem: UnknownMap): boolean {
        return chatItem.type === 'RemoveChatItemByAuthorAction' ||
               chatItem.type === 'RemoveChatItemAction' ||
               chatItem.type === 'MarkChatItemsByAuthorAsDeletedAction';
    }

    _processRegularChatMessage(chatItem: UnknownMap): void {

        let normalizedData;
        try {
            normalizedData = normalizeYouTubeMessage(chatItem, 'youtube');
        } catch (error) {
            if (!this._isRecoverableYouTubeChatNormalizationError(error)) {
                this._handleProcessingError(
                    `Error normalizing chat message: ${getErrorMessage(error)}`,
                    error,
                    'chat-normalization',
                    chatItem
                );
                return;
            }

            normalizedData = this._buildDegradedYouTubeChatData(chatItem);
        }

        const normalizedRecord = toUnknownMap(normalizedData);
        const normalizedMessageRecord = isRecord(normalizedRecord.message) ? normalizedRecord.message : {};
        const messageParts = getValidMessageParts({ message: { parts: normalizedMessageRecord.parts } }, { allowWhitespaceText: true });
        const hasMessageParts = messageParts.length > 0;
        const missingFields = getMissingFields(normalizedRecord.metadata);
        const isMessageMarkedMissing = missingFields.includes('message');


        const messageText = typeof normalizedMessageRecord.text === 'string'
            ? normalizedMessageRecord.text
            : '';

        if (!messageText && !hasMessageParts && !isMessageMarkedMissing) {
            this.logger.debug('Skipping empty message', 'youtube', {
                author: this._resolveChatItemAuthorNameForLog(chatItem),
                hasMessageText: messageText.length > 0,
                messageLength: messageText.length
            });
            return;
        }
        
        const normalizedDataWithVideoId = normalizedData as UnknownMap & { videoId?: unknown; username?: unknown; message?: { text?: unknown } };
        normalizedDataWithVideoId.videoId = chatItem.videoId;
        
        this.logger.debug('Processing multi-stream chat', 'youtube', {
            videoId: chatItem.videoId || 'unknown',
            username: normalizedDataWithVideoId.username,
            messageLength: messageText.length,
            hasMessageParts
        });

        try {
            const eventData = this.eventFactory.createChatMessageEvent(normalizedData);
            this._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, eventData);
            this.logger.debug(`Chat message event emitted for ${String(normalizedDataWithVideoId.username)}`, 'youtube');
        } catch (eventError) {
            this._handleProcessingError(`Error emitting chat message event: ${getErrorMessage(eventError)}`, eventError, 'chat-message', normalizedDataWithVideoId);
        }
    }

    _isRecoverableYouTubeChatNormalizationError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : '';
        return message === 'Missing YouTube author data'
            || message === 'Missing YouTube userId'
            || message === 'Missing YouTube username'
            || message === 'Missing YouTube message text'
            || message === 'Missing YouTube timestamp';
    }

    _buildDegradedYouTubeChatData(chatItem: UnknownMap = {}) {
        const messageData = isRecord(chatItem.item)
            ? chatItem.item
            : {};
        const author = isRecord(messageData.author)
            ? messageData.author
            : {};
        const userId = typeof author.id === 'string' ? author.id.trim() : '';
        const username = this._resolveChatItemAuthorName(chatItem);
        const messageText = extractMessageText(messageData.message).trim();
        const messagePartsSource = isRecord(messageData.message)
            ? messageData.message.parts
            : messageData.message;
        const messageParts = getValidMessageParts({ message: { parts: messagePartsSource } }, { allowWhitespaceText: true });
        const timestamp = resolveYouTubeTimestampISO(chatItem);

        const hasBadgeTooltip = (fragment: unknown): boolean => {
            if (typeof fragment !== 'string') {
                return false;
            }
            return fragment.toLowerCase().includes('member');
        };

        const authorBadges = Array.isArray(author.badges) ? author.badges : [];
        const isBroadcaster = authorBadges.some((badge: unknown) => isRecord(badge) && badge.icon_type === 'OWNER');
        const isPaypiggy = authorBadges.some((badge: unknown) => isRecord(badge) && hasBadgeTooltip(badge.tooltip));
        const missingFields = collectMissingFields({
            userId: !!userId,
            username: !!username,
            message: !!messageText || messageParts.length > 0,
            timestamp: typeof timestamp === 'string' && timestamp.trim().length > 0
        });

        const degradedMessage: { text: string; parts?: unknown } = {
            text: messageText || (messageParts.length > 0 ? '' : UNKNOWN_CHAT_MESSAGE)
        };
        if (messageParts.length > 0) {
            degradedMessage.parts = messageParts;
        }

        const firstThumbnail = Array.isArray(author.thumbnails) ? toUnknownMap(author.thumbnails[0]) : {};

        return {
            platform: 'youtube',
            ...(userId ? { userId } : {}),
            username: username || UNKNOWN_CHAT_USERNAME,
            avatarUrl: typeof firstThumbnail.url === 'string'
                ? firstThumbnail.url.trim()
                : '',
            message: degradedMessage,
            ...(typeof timestamp === 'string' && timestamp.trim().length > 0 ? { timestamp } : {}),
            isMod: author.is_moderator === true,
            isPaypiggy,
            isBroadcaster,
            metadata: mergeMissingFieldsMetadata({
                uniqueId: messageData.id || null,
                isSuperChat: !!messageData.superchat,
                isSuperSticker: !!messageData.supersticker,
                isMembership: !!messageData.isMembership,
                authorPhoto: firstThumbnail.url || null
            }, missingFields, {
                ...(typeof timestamp === 'string' && timestamp.trim().length > 0 ? { sourceTimestamp: timestamp } : {})
            })
        };
    }

    _resolveMonetizationAuthor(chatItem: unknown): UnknownMap {
        const author = extractAuthor(chatItem);
        if (!author) {
            return {};
        }
        return {
            username: author.name,
            userId: author.id
        };
    }

    _resolveGiftMessageViewAuthor(chatItem: unknown): UnknownMap {
        const chatRecord = toUnknownMap(chatItem);
        const item = isRecord(chatRecord.item)
            ? chatRecord.item
            : {};
        const resolveName = (candidate: unknown): string | null => {
            if (typeof candidate === 'string') {
                return normalizeYouTubeUsername(candidate);
            }
            if (!candidate || typeof candidate !== 'object') {
                return null;
            }
            const candidateRecord = toUnknownMap(candidate);
            if (typeof candidateRecord.content === 'string') {
                return normalizeYouTubeUsername(candidateRecord.content);
            }
            if (typeof candidateRecord.text === 'string') {
                return normalizeYouTubeUsername(candidateRecord.text);
            }
            if (typeof candidateRecord.simpleText === 'string') {
                return normalizeYouTubeUsername(candidateRecord.simpleText);
            }
            return null;
        };

        const itemAuthor = toUnknownMap(item.author);
        const username = resolveName(item.authorName)
            || resolveName(item.author_name)
            || resolveName(itemAuthor.name);

        const rawUserId = typeof itemAuthor.id === 'string' ? itemAuthor.id.trim() : '';
        return {
            ...(username ? { username } : {}),
            ...(rawUserId ? { userId: rawUserId } : {})
        };
    }

    _resolveMonetizationTimestamp(chatItem: unknown, label: string): string {
        try {
            return this.monetizationParser.resolveTimestamp(toUnknownMap(chatItem), label);
        } catch (error) {
            this._handleProcessingError(`Missing timestamp for ${label}: ${getErrorMessage(error)}`, error, 'monetization', chatItem);
            return getSystemTimestampISO();
        }
    }

    _resolveMonetizationId(chatItem: unknown): unknown {
        return this.monetizationParser.resolveOptionalId(toUnknownMap(chatItem));
    }

    _emitGiftError(chatItem: unknown, options: { label?: string; giftType?: string; giftCount?: number; author?: UnknownMap } = {}): void {
        const timestamp = this._resolveMonetizationTimestamp(chatItem, options.label || 'YouTube gift');
        if (!timestamp) {
            return;
        }
        const id = this._resolveMonetizationId(chatItem);
        const payload = this.eventFactory.createGiftEvent({
            isError: true,
            ...(options.giftType ? { giftType: options.giftType } : {}),
            ...(options.giftCount !== undefined ? { giftCount: options.giftCount } : {}),
            ...(id ? { id } : {}),
            ...(options.author || {}),
            timestamp
        });
        this._emitPlatformEvent(PlatformEvents.GIFT, payload);
    }

    _emitGiftPaypiggyError(chatItem: unknown, options: { label?: string; giftCount?: number; author?: UnknownMap } = {}): void {
        const timestamp = this._resolveMonetizationTimestamp(chatItem, options.label || 'YouTube gift membership');
        if (!timestamp) {
            return;
        }
        const id = this._resolveMonetizationId(chatItem);
        const payload = this.eventFactory.createGiftPaypiggyEvent({
            isError: true,
            ...(options.giftCount !== undefined ? { giftCount: options.giftCount } : {}),
            ...(id ? { id } : {}),
            ...(options.author || {}),
            timestamp
        });
        this._emitPlatformEvent(PlatformEvents.GIFTPAYPIGGY, payload);
    }

    _emitPaypiggyError(chatItem: unknown, options: { label?: string; author?: UnknownMap } = {}): void {
        const timestamp = this._resolveMonetizationTimestamp(chatItem, options.label || 'YouTube membership');
        if (!timestamp) {
            return;
        }
        const id = this._resolveMonetizationId(chatItem);
        const payload = this.eventFactory.createPaypiggyEvent({
            isError: true,
            ...(id ? { id } : {}),
            ...(options.author || {}),
            timestamp
        });
        this._emitPlatformEvent(PlatformEvents.PAYPIGGY, payload);
    }

    async handleLowPriorityEvent(chatItem: unknown, eventType: string): Promise<void> {
        const author = this._resolveChatItemAuthorName(chatItem);
        const resolvedAuthor = author || getFallbackUsername();
        const authorLabel = ` from ${resolvedAuthor}`;
        
        if (this.logger) {
            this.logger.debug(
                `[LOW PRIORITY EVENT] Ignoring ${eventType}${authorLabel} (not needed for core functionality)`,
                'youtube',
                {
                    eventType,
                    author: resolvedAuthor,
                    action: 'ignored_intentionally',
                    reason: 'not_critical_for_core_functionality'
                }
            );
        }
    }

    handleIgnoredDuplicateEvent(chatItem: unknown, eventType: string): void {
        if (!this.logger) {
            return;
        }

        if (this._isGiftMembershipRedemptionEventType(eventType)) {
            const recipientName = this._getGiftRedemptionRecipientName(chatItem);
            this.logger.debug(
                `ignored gifted membership announcement for ${recipientName}`,
                'youtube',
                {
                    eventType,
                    recipient: recipientName,
                    action: 'ignored_gifted_membership_announcement'
                }
            );
            return;
        }

        const author = this._resolveChatItemAuthorName(chatItem) || getFallbackUsername();
        this.logger.debug(`ignored duplicate ${eventType}`, 'youtube', {
            eventType,
            author,
            action: 'ignored_duplicate'
        });
    }

    _getGiftRedemptionRecipientName(chatItem: unknown): string {
        const item = toUnknownMap(toUnknownMap(chatItem).item);
        const author = toUnknownMap(item.author);
        const rawName = typeof author.name === 'string' ? author.name : '';
        const normalizedName = normalizeYouTubeUsername(rawName);
        return normalizedName || getFallbackUsername();
    }

    _handleMissingGiftPurchaseAuthor(chatItem: unknown, debugMetadata: UnknownMap | null | undefined): void {
        let resolvedGiftCount: number | undefined;
        try {
            resolvedGiftCount = resolveYouTubeGiftMembershipCount(toUnknownMap(chatItem));
        } catch {
            resolvedGiftCount = undefined;
        }

        this.logger.warn('Gift membership purchase missing author data; sending error notification', 'youtube', {
            eventType: debugMetadata?.eventType || 'LiveChatSponsorshipsGiftPurchaseAnnouncement',
            giftCount: resolvedGiftCount
        });

        this._emitGiftPaypiggyError(chatItem, {
            ...(resolvedGiftCount !== undefined ? { giftCount: resolvedGiftCount } : {})
        });
    }

    _resolveChatItemAuthorName(chatItem: unknown): string {
        const item = toUnknownMap(toUnknownMap(chatItem).item);
        const author = toUnknownMap(item.author);
        const rawName = author.name;
        return normalizeYouTubeUsername(rawName) || '';
    }

    _resolveChatItemAuthorNameForLog(chatItem: unknown): string {
        return this._resolveChatItemAuthorName(chatItem) || getFallbackUsername();
    }

    _isIgnoredDuplicateEventType(eventType: unknown): eventType is string {
        if (typeof eventType !== 'string') {
            return false;
        }
        return IGNORED_DUPLICATE_EVENT_TYPES.has(eventType);
    }

    _isGiftMembershipRedemptionEventType(eventType: string): boolean {
        return GIFT_MEMBERSHIP_REDEMPTION_EVENT_TYPES.has(eventType);
    }
    

    
    async getViewerCount(): Promise<number | null> {
        try {
            this.logger.debug('YouTube getViewerCount() called - using provider', 'youtube');
            
            if (!this.viewerCountProvider) {
                this.logger.warn('Viewer count provider not available', 'youtube');
                return 0;
            }
            
            const viewerCount = await this.viewerCountProvider.getViewerCount();
            this.logger.debug(`Provider returned viewer count: ${viewerCount}`, 'youtube');

            return typeof viewerCount === 'number' ? viewerCount : null;
            
        } catch (error) {
            this._handleProcessingError('Error getting viewer count via provider', error, 'viewer-count');
            return 0;
        }
    }

    async getViewerCountByYoutubei(): Promise<number> {
        const activeVideoIds = this.getDetectedStreamIds();
        if (this.viewerExtractionService && activeVideoIds.length > 0) {
            try {
                const result = await this.viewerExtractionService.getAggregatedViewerCount(activeVideoIds);
                if (result.success && typeof result.totalCount === 'number') {
                    return result.totalCount;
                }
            } catch (error) {
                this._handleProcessingError('Error aggregating YouTube viewer count via extraction service', error, 'viewer-count', { activeVideoIds });
            }
        }

        return await this.getViewerCount() ?? 0;
    }

    async getViewerCountForVideo(videoId: string): Promise<number> {
        this.logger.debug('Using provider for single video viewer count', 'youtube');
        
        if (!this.viewerCountProvider) {
            this.logger.warn('Viewer count provider not available for single video', 'youtube');
            return 0;
        }
        
        try {
            if (typeof this.viewerCountProvider.getViewerCountForVideo === 'function') {
                const viewerCount = await this.viewerCountProvider.getViewerCountForVideo(videoId);
                return typeof viewerCount === 'number' ? viewerCount : 0;
            } else {
                this.logger.debug('Provider does not support single video viewer count', 'youtube');
                return 0;
            }
        } catch (error) {
            this._handleProcessingError(`Error getting viewer count for video ${videoId} via provider: ${getErrorMessage(error)}`, error, 'viewer-count', { videoId });
            return 0;
        }
    }








    async logRawPlatformData(eventType: string, data: unknown): Promise<void> {
        return this.chatFileLoggingService.logRawPlatformData('youtube', eventType, data, this.config);
    }


    getConnectionState(): UnknownMap {
        const activeConnections = this.getActiveYouTubeVideoIds();
        const connectionState = {
            isConnected: this.connectionManager ? this.connectionManager.getConnectionCount() > 0 : false,
            isMonitoring: !!this.monitoringInterval,
            activeConnections,
            totalConnections: this.connectionManager ? this.connectionManager.getConnectionCount() : 0
        };

        return connectionState;
    }

    getStats(): UnknownMap {
        const stats = {
            platform: 'youtube',
            enabled: this.config.enabled === true,
            connected: this.connectionManager ? this.connectionManager.getConnectionCount() > 0 : false,
            monitoring: !!this.monitoringInterval,
            activeConnections: this.getActiveYouTubeVideoIds().length,
            totalConnections: this.connectionManager ? this.connectionManager.getConnectionCount() : 0
        };

        return stats;
    }

    isConfigured(): boolean {
        return !!(this.config.enabled && this.config.username);
    }

    getStatus(): { isReady: boolean; issues: string[] } {
        const issues = [];
        const connectionCount = this.connectionManager?.getConnectionCount() ?? 0;

        if (this.config.enabled === true && connectionCount === 0) {
            issues.push('Not connected');
        }

        return {
            isReady: this.config.enabled === true && connectionCount > 0,
            issues
        };
    }

    validateConfig(): { isReady: boolean; issues: string[] } {
        return this.getStatus();
    }


    isConnected(): boolean {
        if (this.connectionManager) {
            return this.connectionManager.getConnectionCount() > 0;
        }
        
        return this.isAnyYouTubeStreamReady();
    }

    async sendMessage(message: unknown): Promise<boolean> {
        for (const videoId of this.connectionManager.getAllVideoIds()) {
            const connection = this.connectionManager.getConnection(videoId);
            if (hasSendMessage(connection) && this.connectionManager.getConnectionStatus(videoId)?.ready) {
                try {
                    const success = await connection.sendMessage(message);
                    if (success) {
                        this.logger.debug(`Message sent to stream ${videoId}`, 'youtube');
                        return true;
                    }
                } catch (error) {
                    this.logger.debug(`Failed to send message to stream ${videoId}: ${getErrorMessage(error)}`, 'youtube');
                }
            }
        }
        return false;
    }

    _validateVideoForConnection(videoId: string, info: unknown) {
        const infoRecord = toUnknownMap(info);
        const basicInfo = toUnknownMap(infoRecord.basic_info);
        const streamingData = toUnknownMap(infoRecord.streaming_data);
        const playabilityStatus = toUnknownMap(infoRecord.playability_status);
        
        const liveStatus = basicInfo.live_status;
        const liveSignals = {
            isLive: !!basicInfo.is_live,
            isLiveContent: !!basicInfo.is_live_content,
            isLiveDvr: !!basicInfo.is_live_dvr_enabled,
            isLowLatency: !!basicInfo.is_low_latency_live_stream,
            liveStatusFlag: typeof liveStatus === 'string' && liveStatus.toLowerCase().startsWith('live'),
            hasHlsManifest: !!streamingData.hls_manifest_url,
            hasLiveStreamability: !!playabilityStatus.liveStreamability
        };
        
        const badgeDetectedLive = typeof YouTubeLiveStreamService?.isVideoLive === 'function'
            ? YouTubeLiveStreamService.isVideoLive(basicInfo)
            : false;
        
        const isLive = Object.values(liveSignals).some(Boolean) || badgeDetectedLive;
        const isUpcoming = !!basicInfo.is_upcoming;
        
        this.logger.debug('YouTube live validation snapshot', 'youtube', {
            videoId,
            liveSignals,
            badgeDetectedLive,
            isUpcoming,
            playabilityStatus: playabilityStatus.status || null
        });
        
        if (isLive) {
            this._handlePremiereDetection(videoId, isLive, isUpcoming, info);
            return { shouldConnect: true, isLive, isUpcoming, liveStatus, reason: 'Stream is live' };
        }
        
        if (isUpcoming) {
            return { shouldConnect: false, isLive, isUpcoming, liveStatus, reason: 'Stream is upcoming but not yet live' };
        }
        
        const isPlayable = playabilityStatus.status === undefined || playabilityStatus.status === 'OK';
        
        if (!isPlayable) {
            return { shouldConnect: false, isLive, isUpcoming, liveStatus, reason: 'Video is not live content (replay/VOD)' };
        }
        
        return { shouldConnect: false, isLive, isUpcoming, liveStatus, reason: 'Video is not live content (replay/VOD)' };
    }

    _handlePremiereDetection(videoId: string, isLive: boolean, isUpcoming: boolean, info: unknown): void {
        if (isLive && isUpcoming) {
            const title = toUnknownMap(toUnknownMap(info).basic_info).title || 'Unknown Title';
            this.logger.info(`Premiere detected: ${title} (${videoId})`, 'youtube');
            this.logger.info('Premiere connection established, waiting for start event...', 'youtube');
        }
    }

    _logMultiStreamStatus(includeDetails = false, includeActiveStreamsList = false): void {
        return this._youtubeMultiStreamManager.logStatus(includeDetails, includeActiveStreamsList);
    }

    _generateErrorMessage(context: string, videoId: string | null = null): string {
        switch (context) {
            case 'connectToYouTubeStream':
                return `Failed to connect to YouTube stream ${videoId}. This commonly occurs if a stream is a 'Premiere' that has ended, or is not currently live.`;
            case 'liveChatListener':
                return `A live chat error occurred.`;
            case 'checkMultiStream':
                return `Error occurred while checking multi-stream connections.`;
            case 'getLiveVideoIds':
                return `Failed to retrieve live video IDs from YouTube.`;
            default:
                return `An unexpected error occurred in ${context}.`;
        }
    }

    _handleError(error: unknown, context: string, { shouldDisconnect = false, shouldEmit = true, videoId = null }: { shouldDisconnect?: boolean; shouldEmit?: boolean; videoId?: string | null } = {}): void {
        const errorDetails = error instanceof Error ? error : new Error(JSON.stringify(error, null, 2));
        const message = this._generateErrorMessage(context, videoId);
        const normalizedContext = { operation: context };

        this._handleProcessingError(`${message} Raw error`, errorDetails, context, { videoId });

        if (shouldEmit) {
            const eventData = this.eventFactory.createErrorEvent({
                error: errorDetails,
                context: normalizedContext,
                recoverable: !shouldDisconnect,
                videoId,
                timestamp: getSystemTimestampISO()
            });

            const eventPlatform = eventData.platform;
            this.emit('platform:event', {
                platform: eventPlatform,
                type: PlatformEvents.ERROR,
                data: eventData
            });
        }
        if (shouldDisconnect) {
            Promise.resolve(this.cleanup()).catch((cleanupError) => {
                this._handleCleanupErrorLogging(
                    `Error cleaning up after ${context}: ${getErrorMessage(cleanupError)}`,
                    cleanupError,
                    'cleanup'
                );
            });
        }
    }

    async reconnect() {
        this.logger.info('Attempting to reconnect to YouTube', 'youtube');
        try {
            await this.initialize(this.handlers);
        } catch (error) {
            this._handleConnectionErrorLogging(`Reconnection failed: ${getErrorMessage(error)}`, error, 'reconnect');
            throw error;
        }
    }

    updateViewerCountForStream(streamId: string, count: number): void {
        if (!this.streamViewerCounts) {
            this.streamViewerCounts = new Map();
        }
        
        this.streamViewerCounts.set(streamId, count);
        this.logger.debug(`Updated viewer count for ${streamId}: ${count}`, 'youtube');

        const totalViewers = this.getTotalViewerCount();
        try {
            const eventData = this.eventFactory.createViewerCountEvent({
                count: totalViewers,
                streamId,
                streamViewerCount: count,
                timestamp: getSystemTimestampISO()
            });
            this._emitPlatformEvent(PlatformEvents.VIEWER_COUNT, eventData);
        } catch (eventError) {
            this._handleProcessingError(`Error emitting viewer count event: ${getErrorMessage(eventError)}`, eventError, 'viewer-count', {
                streamId,
                count,
                totalViewers
            });
        }
    }

    getTotalViewerCount() {
        if (!this.streamViewerCounts) {
            return 0;
        }

        let total = 0;
        for (const count of this.streamViewerCounts.values()) {
            total += count;
        }
        return total;
    }

    _emitPlatformEvent(type: string, payload: unknown): void {
        const payloadRecord = toUnknownMap(payload);
        const platform = payloadRecord.platform || 'youtube';

        this.emit('platform:event', { platform, type, data: payload });

        const handlerMap = {
            [PlatformEvents.CHAT_MESSAGE]: 'onChat',
            [PlatformEvents.GIFT]: 'onGift',
            [PlatformEvents.GIFTPAYPIGGY]: 'onGiftPaypiggy',
            [PlatformEvents.PAYPIGGY]: 'onPaypiggy',
            [PlatformEvents.STREAM_STATUS]: 'onStreamStatus',
            [PlatformEvents.STREAM_DETECTED]: 'onStreamDetected',
            [PlatformEvents.VIEWER_COUNT]: 'onViewerCount'
        };

        const handlerName = handlerMap[type as keyof typeof handlerMap];
        if (!handlerName) {
            this.logger.debug(`No handler registered for event type: ${type}`, 'youtube');
            return;
        }
        const handler = this.handlers?.[handlerName];

        if (typeof handler === 'function') {
            handler(payload);
        } else {
            this.logger.debug(`No handler registered for event type: ${type}`, 'youtube');
        }
    }

    _emitStreamStatusIfNeeded(previousCount: number, context: UnknownMap = {}): void {
        if (!this.connectionManager) {
            return;
        }

        const nextCount = this.connectionManager.getConnectionCount();
        const becameLive = previousCount === 0 && nextCount > 0;
        const wentOffline = previousCount > 0 && nextCount === 0;

        if (!becameLive && !wentOffline) {
            return;
        }

        const isLive = becameLive;
        this._emitPlatformEvent(PlatformEvents.STREAM_STATUS, {
            platform: 'youtube',
            isLive,
            timestamp: getSystemTimestampISO()
        });

    }

    getHealthStatus(): UnknownMap {
        const activeConnections = this.connectionManager ? this.connectionManager.getConnectionCount() : 0;
        const monitoringActive = !!this.monitoringInterval;
        const overall = activeConnections > 0 ? 'healthy' : (monitoringActive ? 'idle' : 'degraded');

        return {
            overall,
            services: {
                connectionManager: activeConnections > 0 ? 'healthy' : 'idle',
                monitoring: monitoringActive ? 'active' : 'stopped'
            },
            lastRecovery: this.lastRecoveryTime || null
        };
    }


    _clearMonitoringInterval(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }

    _ensureDataLoggingPath(): void {
        if (typeof this.config.dataLoggingPath !== 'string' || this.config.dataLoggingPath.length === 0) {
            return;
        }
        try {
            fs.mkdirSync(this.config.dataLoggingPath, { recursive: true });
        } catch (error) {
            this.errorHandler?.handleDataLoggingError?.(error, 'dataLoggingPath');
            this.logger?.warn?.(
                `Failed to prepare data logging path '${this.config.dataLoggingPath}': ${getErrorMessage(error)}`,
                'youtube'
            );
        }
    }


    async cleanup(): Promise<void> {
        this.logger.debug('Cleaning up YouTube platform resources', 'youtube');

        try {
            this._clearMonitoringInterval();

            if (this.connectionManager) {
                await this.connectionManager.cleanupAllConnections();
                const activeStreams = this.connectionManager.getActiveVideoIds();
                for (const videoId of activeStreams) {
                    await this.connectionManager.removeConnection(videoId);
                }
            }
        } catch (error) {
            this._handleCleanupErrorLogging(`Error disconnecting from YouTube: ${getErrorMessage(error)}`, error, 'disconnect');
        }

        try {
            if (this.viewerService) {
                this.viewerService.cleanup?.();
            }
        } catch (error) {
            this._handleCleanupErrorLogging('Error during cleanup: viewerService', error, 'viewerService');
        }

        this.isInitialized = false;
    }

    isActive(): boolean {
        try {
            return this.isConnected() && this.config.enabled === true;
        } catch (error) {
            this._handleProcessingError('Error checking active status', error, 'active-status');
            return false;
        }
    }

    _extractMessagesFromChatItem(chatItem: UnknownMap): UnknownMap[] {
        try {
            if (!chatItem || typeof chatItem !== 'object') {
                return [];
            }

            const messages: UnknownMap[] = [];
            
            if (Array.isArray(chatItem.actions)) {
                for (const action of chatItem.actions) {
                    const actionRecord = toUnknownMap(action);
                    const addChatItemAction = toUnknownMap(actionRecord.addChatItemAction);
                    if (addChatItemAction.item) {
                        messages.push({
                            type: toUnknownMap(addChatItemAction.item).type || 'unknown',
                            item: addChatItemAction.item,
                            originalChatItem: chatItem
                        });
                    }
                }
            } else {
                const item = toUnknownMap(chatItem.item || chatItem);
                messages.push({
                    type: item.type || chatItem.type || 'unknown',
                    item,
                    originalChatItem: chatItem
                });
            }

            return messages;
        } catch (error) {
            this.logger.debug(`Error extracting messages from chat item: ${getErrorMessage(error)}`, 'youtube');
            return [];
        }
    }

    _shouldSkipMessage(message: UnknownMap): boolean {
        try {
            if (typeof message.type !== 'string') {
                return true;
            }

            if (this._isIgnoredDuplicateEventType(message.type)) {
                return false;
            }

            const systemMessages = [
                'LiveChatViewerEngagementMessage',
                'LiveChatPurchaseMessage',
                'LiveChatPlaceholderItem',
                'UpdateLiveChatPollAction',
                'RemoveChatItemAction',
                'RemoveChatItemByAuthorAction',
                'MarkChatItemsByAuthorAsDeletedAction'
            ];

            if (systemMessages.includes(message.type)) {
                return true;
            }

            return false;
        } catch (error) {
            this.logger.debug(`Error checking if message should be skipped: ${getErrorMessage(error)}`, 'youtube');
            return true;
        }
    }

    async getConnectionStatus(): Promise<UnknownMap> {
        return {
            platform: 'youtube',
            status: this.isConnected() ? 'connected' : 'disconnected',
            timestamp: getSystemTimestampISO()
        };
    }

    _handleProcessingError(message: string, error: unknown, eventType = 'general', eventData: unknown = null): void {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError?.(error, eventType, eventData, message);
            return;
        }

        const errorMessage = getErrorMessage(error);
        if (this.errorHandler && typeof this.errorHandler.logOperationalError === 'function') {
            this.errorHandler.logOperationalError(message, eventType, {
                eventData,
                error: errorMessage
            });
        }
    }

    _handleMissingChatEvent(eventType: unknown, chatItem: unknown): void {
        const resolvedEventType = eventType || 'unknown';
        const author = this._resolveChatItemAuthorName(chatItem) || getFallbackUsername();
        if (this.logger && typeof this.logger.debug === 'function') {
            this.logger.debug(`Unknown event type: ${resolvedEventType}`, 'youtube', {
                eventType: resolvedEventType,
                author
            });
        }
        const chatRecord = toUnknownMap(chatItem);
        const chatItemVideoId = chatRecord.videoId;
        const nestedVideoId = toUnknownMap(chatRecord.item).videoId;
        const resolvedVideoId = chatItemVideoId || nestedVideoId || this.currentVideoId || 'unknown';

        const enhancedData = {
            ...chatRecord,
            author,
            metadata: {
                handler: 'handleActions',
                videoId: resolvedVideoId
            }
        };

        this.logRawPlatformData(String(resolvedEventType), enhancedData).catch((error: unknown) => {
            if (this.logger && typeof this.logger.debug === 'function') {
                this.logger.debug(`Failed to log unknown event: ${getErrorMessage(error)}`, 'youtube');
            }
        });
    }

    _handleConnectionErrorLogging(message: string, error: unknown, action = 'operation'): void {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleConnectionError?.(error, action, message);
            return;
        }

        const errorMessage = getErrorMessage(error);
        if (this.errorHandler && typeof this.errorHandler.logOperationalError === 'function') {
            this.errorHandler.logOperationalError(message, action, {
                error: errorMessage
            });
        }
    }

    _handleCleanupErrorLogging(message: string, error: unknown, resource = 'resource'): void {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleCleanupError?.(error, resource, message);
            return;
        }

        const errorMessage = getErrorMessage(error);
        if (this.errorHandler && typeof this.errorHandler.logOperationalError === 'function') {
            this.errorHandler.logOperationalError(message, resource, {
                error: errorMessage
            });
        }
    }
}

export { YouTubePlatform };
