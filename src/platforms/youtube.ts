import type { AppLogger } from '../core/logger/types';
import { EventEmitter } from 'node:events';
import type { ViewerCountObservation, ViewerMembershipSnapshot } from '../contracts/viewer-count';
import type { InnertubeService } from '../services/innertube-service';
import { isChannelId } from '../services/youtube-channel-resolver';
import { isYouTubeVideoId, type DiscoveryQualityReason } from '../services/youtube-live-stream-service';

import { UNKNOWN_CHAT_MESSAGE, UNKNOWN_CHAT_USERNAME } from '../constants/degraded-chat';
import { PlatformEvents } from '../interfaces/PlatformEvents';
import { RawPlatformDataLoggingService, type RawEventSink } from '../services/RawPlatformDataLoggingService';
import { collectMissingFields, getMissingFields, mergeMissingFieldsMetadata } from '../utils/missing-fields';
import { extractYouTubeBadgeImages, normalizeYouTubeMessage } from '../utils/message-normalization';
import { getValidMessageParts } from '../utils/message-parts';
import { validateYouTubePlatformDependencies } from '../utils/dependency-validator';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { resolveYouTubeTimestampISO } from '../utils/platform-timestamp';
import { ensureLogDirectorySync } from '../utils/log-directory';
import { mapConcurrent } from '../utils/map-concurrent';
import { getSystemTimestampISO } from '../utils/timestamp';
import { safeSetInterval, validateTimeout } from '../utils/timeout-validator';
import { getFallbackUsername } from '../utils/validation';
import { ViewerCountProviderFactory } from '../utils/viewer-count-providers';
import { createYouTubeConnectionFactory } from './youtube/connections/youtube-connection-factory';
import { createYouTubeEventFactory } from './youtube/events/event-factory';
import { normalizeYouTubeEvent } from './youtube/events/event-normalizer';
import { createYouTubeEventRouter } from './youtube/events/event-router';
import { createYouTubeMonetizationParser, resolveYouTubeGiftMembershipCount } from './youtube/monetization/monetization-parser';
import { createYouTubeMultiStreamManager } from './youtube/streams/youtube-multistream-manager';
import { extractAuthor } from './youtube/youtube-author-extractor';
import { YouTubeConnectionManager, type YouTubeConnectionAttemptContext } from './youtube/youtube-connection-manager';
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

type UnknownMap = Record<string, unknown>;
type StreamRefreshRequest = {
  requestImmediateRefresh?: boolean;
  source?: string;
  reason?: string;
  expectedAttemptId?: number;
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

type RawPlatformDataLoggingServiceLike = {
  logRawPlatformData: (platform: string, eventType: string, data: unknown, config: UnknownMap) => Promise<void>;
};

type RawPlatformDataLoggingServiceConstructor = new (options: { logger: unknown; config: UnknownMap; rawEventLogWriter?: RawEventSink | undefined }) => RawPlatformDataLoggingServiceLike;

type ViewerServiceLike = {
  _activeStream?: { videoId?: string };
  clearActiveStream?: () => void;
  cleanup?: () => void | Promise<void>;
  setActiveStream?: (videoId: string) => Promise<void>;
};

type ViewerCountProviderLike = {
  getViewerCount: () => Promise<number | null>;
  getViewerCountObservation?: () => Promise<ViewerCountObservation>;
};

type StreamDetectionServiceLike = {
  cleanup?: () => void | Promise<void>;
  detectLiveStreams: (channelHandle: unknown, options?: { signal?: AbortSignal }) => Promise<{
    success?: boolean;
    channelId?: string;
    observationKind?: 'complete' | 'partial' | 'unavailable';
    qualityReason?: DiscoveryQualityReason;
    videoIds?: unknown;
    detectionMethod?: string | null;
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
};

type ProviderLoggerLike = Pick<AppLogger<string>, 'debug' | 'info' | 'warn' | 'error'>;

type YouTubeConnectionLike = {
  on: (event: string, handler: (payload?: unknown) => void) => void;
  start: () => void | Promise<void>;
  applyFilter?: (filterName: string) => void | Promise<void>;
  [key: string]: unknown;
};

type EventFactoryLike = ReturnType<typeof createYouTubeEventFactory>;
type EventRouterLike = ReturnType<typeof createYouTubeEventRouter>;
type MonetizationParserLike = ReturnType<typeof createYouTubeMonetizationParser>;
type YouTubeConnectionFactoryLike = ReturnType<typeof createYouTubeConnectionFactory>;
type YouTubeMultiStreamManagerLike = ReturnType<typeof createYouTubeMultiStreamManager>;

type HandlerMap = Record<string, (payload: unknown) => unknown>;

type YouTubeDependencies = UnknownMap & {
  rawEventLogWriter?: RawEventSink | undefined;
  logger: LoggerLike;
  USER_AGENTS?: string[] | undefined;
  timestampService?: unknown;
  viewerService?: ViewerServiceLike;
  RawPlatformDataLoggingService?: RawPlatformDataLoggingServiceConstructor;
  rawPlatformDataLoggingService?: RawPlatformDataLoggingServiceLike;
  streamDetectionService?: StreamDetectionServiceLike;
  viewerCountProvider?: ViewerCountProviderLike;
  viewerExtractionService?: YouTubeExtractionServiceLike;
  innertubeService?: unknown;
  now?: () => number;
  monotonicNow?: () => number;
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
  timestampService: unknown;
  viewerService: ViewerServiceLike | null;
  rawPlatformDataLoggingService: RawPlatformDataLoggingServiceLike;
  isInitialized: boolean;
  monitoringInterval: ReturnType<typeof setInterval> | number | null;
  monitoringIntervalStart?: number | undefined;
  userAgentManager: YouTubeUserAgentManager;
  connectionManager: YouTubeConnectionManager;
  _youtubeConnectionFactory: YouTubeConnectionFactoryLike;
  _youtubeMultiStreamManager: YouTubeMultiStreamManagerLike;
  streamDetectionService?: StreamDetectionServiceLike;
  viewerExtractionService: YouTubeExtractionServiceLike | null;
  viewerCountProvider: ViewerCountProviderLike | null;
  lastFullStreamCheck: number | null = null;
  lastYouTubeVideoIdsUpdateTime?: number | undefined;
  lastRecoveryTime?: number;
  currentVideoId?: string;
  private membership: ViewerMembershipSnapshot = { generation: 0, videoIds: [], availability: 'unknown', discoveryComplete: false };
  private membershipLifetime = new AbortController();
  private membershipRequest = 0;
  private metadataOwner?: Pick<InnertubeService, 'withMetadataOperation'>;
  private now: () => number;
  private monotonicNow: () => number;
  private lastDiscoveryWarningAt: number | null = null;

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
        this.now = dependencies.now ?? Date.now;
        this.monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
        if (isRecord(dependencies.innertubeService) && typeof dependencies.innertubeService.withMetadataOperation === 'function') {
            this.metadataOwner = dependencies.innertubeService as Pick<InnertubeService, 'withMetadataOperation'>;
        }
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
        this.timestampService = dependencies.timestampService || null;
        this.viewerService = dependencies.viewerService || null;

        const defaultRawPlatformDataLoggingDependencies = {
            rawEventLogWriter: dependencies.rawEventLogWriter,
            logger: this.logger,
            config: this.config
        } as ConstructorParameters<typeof RawPlatformDataLoggingService>[0];
        this.rawPlatformDataLoggingService = dependencies.rawPlatformDataLoggingService || (dependencies.RawPlatformDataLoggingService
            ? new dependencies.RawPlatformDataLoggingService({ logger: this.logger, config: this.config, rawEventLogWriter: dependencies.rawEventLogWriter })
            : new RawPlatformDataLoggingService(defaultRawPlatformDataLoggingDependencies));

        this.isInitialized = false;
        this.monitoringInterval = null;
        
        this.userAgentManager = new YouTubeUserAgentManager(this.logger, {
            ...(this.USER_AGENTS ? { userAgents: this.USER_AGENTS } : {})
        });

        this.connectionManager = new YouTubeConnectionManager(this.logger, {
            config: this.config
        });

        this._youtubeConnectionFactory = createYouTubeConnectionFactory({
            platform: this._createConnectionFactoryPlatformAdapter(),
            innertubeService: dependencies.innertubeService,
            innertubeCreationTimeoutMs: INNERTUBE_CREATION_TIMEOUT_MS
        });

        this._youtubeMultiStreamManager = createYouTubeMultiStreamManager({
            platform: this._createMultiStreamPlatformAdapter(),
            safeSetInterval,
            validateTimeout,
            now: () => this.now()
        });

        this.streamDetectionService = dependencies.streamDetectionService;

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
        } else {
            try {
                const providerDependencies: {
                    viewerExtractionService?: YouTubeExtractionServiceLike;
                    logger?: ProviderLoggerLike;
                } = {
                    logger: this._createProviderLoggerAdapter()
                };

                if (isYouTubeExtractionService(this.viewerExtractionService)) {
                    providerDependencies.viewerExtractionService = this.viewerExtractionService;
                }

                this.viewerCountProvider = ViewerCountProviderFactory.createYouTubeProvider(
                    this.config,
                    () => this.getViewerMembershipSnapshot(),
                    providerDependencies
                );
            } catch (error) {
                this.logger.warn('Failed to create viewer count provider, viewer counts are unavailable', 'youtube', error);
                this.viewerCountProvider = null;
            }
        }
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
            isCurrentYouTubeConnection: (videoId: string, attemptId: number) => {
                return this.connectionManager.isCurrentAttempt(videoId, attemptId);
            },
            setYouTubeConnectionReady: (videoId: string, attemptId: number) => {
                this.setYouTubeConnectionReady(videoId, attemptId);
            },
            disconnectFromYouTubeStream: (
                videoId: string,
                reason: string,
                options?: { requestImmediateRefresh?: boolean; source?: string; expectedAttemptId?: number }
            ) => this.disconnectFromYouTubeStream(videoId, reason, options),
            handleChatMessage: (message: UnknownMap, isCurrent?: () => boolean) => this.handleChatMessage(message, isCurrent),
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
            getActiveYouTubeVideoIds: () => this.getActiveYouTubeVideoIds(),
            getLiveVideoIds: () => this.getLiveVideoIds(),
            connectToYouTubeStream: async (videoId: string) => {
                if (this.membershipLifetime.signal.aborted || !this.membership.videoIds.includes(videoId)) return false;
                return await this.connectToYouTubeStream(videoId);
            },
            disconnectFromYouTubeStream: async (
                videoId: string,
                reason: string,
                options?: { requestImmediateRefresh?: boolean; source?: string }
            ) => {
                await this.disconnectFromYouTubeStream(videoId, reason, options);
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


    async disconnectFromYouTubeStream(videoId: string, reason = 'unknown', options: StreamRefreshRequest = {}): Promise<boolean> {
        if (!this.connectionManager) {
            return false;
        }

        if (options.expectedAttemptId !== undefined
            && !this.connectionManager.isCurrentAttempt(videoId, options.expectedAttemptId)) {
            return false;
        }

        const result = await this.connectionManager.disconnectFromStream(videoId, reason, options.expectedAttemptId);
        if (!result) {
            return false;
        }
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
                return result;
            }

            try {
                await this.requestImmediateYouTubeStreamRefresh(refreshContext);
            } catch (error: unknown) {
                this._handleConnectionErrorLogging(
                    `Immediate stream refresh failed after disconnect: ${getErrorMessage(error)}`,
                    error,
                    'stream-refresh'
                );
                return result;
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

    setYouTubeConnectionReady(videoId: string, attemptId: number) {
        this.connectionManager.setConnectionReady(videoId, attemptId);
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
        return [...this.membership.videoIds];
    }

    getViewerMembershipGeneration(): number {
        return this.membership.generation;
    }

    getViewerMembershipSnapshot(): ViewerMembershipSnapshot {
        return { ...this.membership, videoIds: [...this.membership.videoIds] };
    }

    private setMembership(videoIds: string[], availability: ViewerMembershipSnapshot['availability'], discoveryComplete: boolean): void {
        const previous = this.membership;
        if (previous.availability === availability && videoIds.length === previous.videoIds.length
            && videoIds.every(id => previous.videoIds.includes(id))) {
            this.membership = { ...previous, discoveryComplete };
            return;
        }
        this.membership = { generation: previous.generation + 1, videoIds: [...videoIds], availability, discoveryComplete };
        if (availability === 'offline') {
            this.logger.info('YouTube offline; monitoring for next stream', 'youtube');
        } else if (availability === 'live') {
            this.logger.info(`YouTube live streams changed: ${videoIds.length} detected`, 'youtube');
        }
        if (availability !== previous.availability && availability !== 'unknown') {
            this._emitPlatformEvent(PlatformEvents.STREAM_STATUS, {
                platform: 'youtube', isLive: availability === 'live',
                ...(availability === 'offline' ? { status: 'stream-ended' } : {}),
                timestamp: getSystemTimestampISO()
            });
        }
    }

    async initialize(handlers: HandlerMap = {}, forceReconnect = false): Promise<void> {
        if (this.membershipLifetime.signal.aborted) this.membershipLifetime = new AbortController();
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
            
            this.handlers = { ...this.handlers, ...handlers };
            this.connectionManager.startLifecycle();

            if (this.config.enabled && this.config.username) {
                try {
                    await this.startMultiStreamMonitoring();
                } catch (error) {
                    this._handleConnectionErrorLogging(`Failed to start multi-stream monitoring: ${getErrorMessage(error)}`, error, 'multi-stream monitoring');
                    throw error;
                }
            }

            this.isInitialized = true;
            
        } catch (error) {
            this._handleProcessingError(`Error during initialization: ${getErrorMessage(error)}`, error, 'initialization');
            throw error;
        }
    }

    async startMultiStreamMonitoring(): Promise<void> {
        return await this._youtubeMultiStreamManager.startMonitoring();
    }

    async checkMultiStream(options: { throwOnError?: boolean } = {}): Promise<void> {
        return await this._youtubeMultiStreamManager.checkMultiStream(options);
    }


    async getLiveVideoIds(): Promise<string[]> {
        return this.getLiveVideoIdsByYoutubei();
    }



    async getLiveVideoIdsByYoutubei(): Promise<string[]> {
        
        const channelHandle = this.config.username;

        if (!this.streamDetectionService || typeof this.streamDetectionService.detectLiveStreams !== 'function') {
            const error = new Error('YouTube stream detection youtubei failed: Service unavailable');
            this._handleProcessingError(error.message, error, 'stream-detection');
            throw error;
        }

        const lifetime = this.membershipLifetime;
        const request = ++this.membershipRequest;
        const isCurrent = () => !lifetime.signal.aborted && lifetime === this.membershipLifetime && request === this.membershipRequest;
        if (!isCurrent()) return [];
        const result = await this.streamDetectionService.detectLiveStreams(channelHandle, { signal: lifetime.signal });
        if (!isCurrent()) return [];
        const positives = Array.isArray(result.videoIds)
            ? [...new Set(result.videoIds.filter(isYouTubeVideoId))] : [];
        const previousIds = this.getDetectedStreamIds();
        const verificationSignal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(8000)]);
        const statuses = await mapConcurrent([...new Set([...positives, ...previousIds])], 3, async videoId => ({
            videoId, status: await this.confirmStream(videoId, verificationSignal, result.channelId ?? channelHandle, !previousIds.includes(videoId))
        }));
        if (!isCurrent()) return this.getDetectedStreamIds();
        const states = new Map(statuses.map(({ videoId, status }) => [videoId, status]));
        const verificationUnavailable = positives.some(id => states.get(id) === 'unknown');
        const complete = result.success === true && result.observationKind === 'complete'
            && Array.isArray(result.videoIds) && result.videoIds.every(isYouTubeVideoId) && !verificationUnavailable;
        this.reportDiscoveryHealth(complete, {
            observationKind: verificationUnavailable && result.observationKind === 'complete' ? 'partial' : result.observationKind ?? 'unavailable',
            reason: verificationUnavailable ? 'detection_unavailable' : result.qualityReason ??
                (result.observationKind === 'complete' ? 'invalid_video_ids' : 'detection_unavailable'),
            detectedStreams: positives.length
        });
        const added = positives.filter(id => !previousIds.includes(id) && states.get(id) === 'live');
        const ended = previousIds.filter(id => states.get(id) === 'ended');
        const members = [...previousIds.filter(id => !ended.includes(id)), ...added];
        this.setMembership(members, members.length ? 'live' : complete ? 'offline' : 'unknown', complete);
        if (added.length > 0) this._emitPlatformEvent(PlatformEvents.STREAM_DETECTED, {
            platform: 'youtube', eventType: 'stream-detected', newStreamIds: added,
            allStreamIds: members, detectionTime: this.now(), connectionCount: this.connectionManager.getConnectionCount()
        });
        if (!isCurrent()) return this.getDetectedStreamIds();
        const retirements = ended.map(videoId => ({ videoId, attemptId: this.connectionManager.getConnectionStatus(videoId)?.attemptId }));
        await Promise.all(retirements.map(({ videoId, attemptId }) => attemptId === undefined ? undefined
            : this.disconnectFromYouTubeStream(videoId, 'confirmed stream end', { expectedAttemptId: attemptId })));
        return isCurrent() ? this.getDetectedStreamIds() : [];
    }

    private classifyStreamInfo(videoId: string, info: unknown): 'live' | 'ended' | 'upcoming' | 'unknown' {
        const basic = toUnknownMap(toUnknownMap(info).basic_info);
        if (!isYouTubeVideoId(videoId) || basic.id !== videoId) return 'unknown';
        for (const flag of ['is_live', 'is_upcoming', 'is_live_content', 'is_post_live_dvr']) {
            if (basic[flag] !== undefined && typeof basic[flag] !== 'boolean') return 'unknown';
        }
        const end = basic.end_timestamp;
        const start = basic.start_timestamp;
        if (end != null) {
            if (!(end instanceof Date) || !Number.isFinite(end.getTime()) || end.getTime() > this.now()
                || basic.is_live === true || basic.is_upcoming === true) return 'unknown';
            if (start != null && (!(start instanceof Date) || !Number.isFinite(start.getTime()) || start.getTime() > end.getTime())) return 'unknown';
            return 'ended';
        }
        if (basic.is_upcoming === true) return 'upcoming';
        if (basic.is_live !== true || basic.is_live_content === false || basic.is_post_live_dvr === true
            || (start != null && (!(start instanceof Date) || !Number.isFinite(start.getTime()) || start.getTime() > this.now()))
            || (basic.live_status !== undefined && (typeof basic.live_status !== 'string' || basic.live_status.toLowerCase() !== 'live'))) return 'unknown';
        return 'live';
    }

    private async confirmStream(videoId: string, signal: AbortSignal, channelId: unknown, requireOwnership: boolean): Promise<'live' | 'ended' | 'upcoming' | 'unknown'> {
        if (!this.metadataOwner || !/^[A-Za-z0-9_-]{11}$/.test(videoId) || signal.aborted) return 'unknown';
        try {
            return await this.metadataOwner.withMetadataOperation({ signal }, async client => {
                const info = await client.getInfo(videoId, { client: 'WEB' });
                signal.throwIfAborted();
                const basic = toUnknownMap(toUnknownMap(info).basic_info);
                if (requireOwnership && (!isChannelId(channelId) || basic.channel_id !== channelId)) return 'unknown';
                return this.classifyStreamInfo(videoId, info);
            });
        } catch {
            return 'unknown';
        }
    }

    private reportDiscoveryHealth(complete: boolean, diagnostic: {
        observationKind: 'complete' | 'partial' | 'unavailable'; reason: DiscoveryQualityReason; detectedStreams: number;
    }): void {
        if (complete) {
            if (this.lastDiscoveryWarningAt !== null) this.logger.info('YouTube stream discovery recovered', 'youtube');
            this.lastDiscoveryWarningAt = null;
            return;
        }
        const observedAt = this.monotonicNow();
        const reminderInterval = validateTimeout(this.config.fullCheckInterval, 300000, 'fullCheckInterval');
        if (this.lastDiscoveryWarningAt === null || observedAt - this.lastDiscoveryWarningAt >= reminderInterval) {
            this.logger.warn('YouTube stream discovery incomplete or unavailable; preserving last known streams', 'youtube', diagnostic);
            this.lastDiscoveryWarningAt = observedAt;
        } else {
            this.logger.debug('YouTube stream discovery remains degraded', 'youtube', diagnostic);
        }
    }


    async connectToYouTubeStream(videoId: string, options: StreamRefreshRequest = {}): Promise<boolean> {
        const hasExisting = this.connectionManager.hasConnection(videoId);
        
        if (hasExisting) {
            return true;
        }

        let admittedAttemptId: number | undefined;
        
        try {
            const success = await this.connectionManager.connectToStream(
                videoId, 
                (videoId: string, attemptId: number, context: YouTubeConnectionAttemptContext) => {
                    admittedAttemptId = attemptId;
                    return this._createYouTubeConnection(videoId, attemptId, context);
                },
                { reason: 'stream detected', ...options }
            );
            
            if (success) {
                if (admittedAttemptId !== undefined && !this.connectionManager.isCurrentAttempt(videoId, admittedAttemptId)) return false;
                const connectionId = `youtube-${videoId}`;
                const timestamp = getSystemTimestampISO();
                const chatConnectedEvent = this.eventFactory.createChatConnectedEvent({ videoId, connectionId, timestamp });
                const eventPlatform = chatConnectedEvent.platform;
                this.emit('platform:event', {
                    platform: eventPlatform,
                    type: PlatformEvents.CHAT_CONNECTED,
                    data: chatConnectedEvent
                });
            }
            
            return success;
            
        } catch (error) {
            this._handleConnectionErrorLogging(`Failed to connect to YouTube stream: ${getErrorMessage(error)}`, error, 'stream-connect');
            throw error;
        }
    }

    async _createYouTubeConnection(videoId: string, attemptId: number, context: YouTubeConnectionAttemptContext): Promise<{ [key: string]: unknown }> {
        const connection = await this._youtubeConnectionFactory.createConnection(videoId, context);
        if (!isYouTubeConnectionLike(connection)) {
            throw new Error('YouTube connection factory returned invalid connection');
        }
        await this._setupConnectionEventListeners(connection, videoId, attemptId);
        return connection;
    }
    
    async _setupConnectionEventListeners(connection: YouTubeConnectionLike, videoId: string, attemptId: number): Promise<void> {
        return await this._youtubeConnectionFactory.setupConnectionEventListeners(connection, videoId, attemptId);
	    }

    async handleChatMessage(chatItem: unknown, isCurrent?: () => boolean): Promise<void> {
        if (isCurrent && !isCurrent()) return;
        
        if (!chatItem) {
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
            return;
        }

        if (this._shouldSkipEvent(normalizedChatItem)) {
            return;
        }

        if (this._isIgnoredDuplicateEventType(resolvedEventType)) {
            return;
        }
        
        try {
            const routed = await this.eventRouter.routeEvent(normalizedChatItem, resolvedEventType);
            if (isCurrent && !isCurrent()) return;
            if (!routed) {
                this._handleMissingChatEvent(resolvedEventType, normalizedChatItem);
            }
        } catch (error) {
            if (isCurrent && !isCurrent()) return;
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
                ...author,
                ...parsed
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
                ...author,
                ...parsed
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
        const receivedTimestamp = getSystemTimestampISO();
        try {
            const parsed = this.monetizationParser.parseGiftMessageView(toUnknownMap(chatItem));
            const usedReceivedTimestamp = parsed.timestamp === undefined;
            const missingFields = collectMissingFields({
                userId: !!author.userId,
                amount: parsed.amount !== undefined
            });
            const hasMetadata = missingFields.length > 0 || usedReceivedTimestamp;
            const payload = this.eventFactory.createGiftEvent({
                ...author,
                ...parsed,
                timestamp: parsed.timestamp ?? receivedTimestamp,
                ...(hasMetadata
                    ? {
                        metadata: mergeMissingFieldsMetadata({}, missingFields, {
                            ...(usedReceivedTimestamp ? { timestampSource: 'received' } : {})
                        })
                    }
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
                ...author,
                ...parsed
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
                ...author,
                ...parsed
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
            return;
        }
        
        const normalizedDataWithVideoId = normalizedData as UnknownMap & { videoId?: unknown; username?: unknown; message?: { text?: unknown } };
        normalizedDataWithVideoId.videoId = chatItem.videoId;

        try {
            const eventData = this.eventFactory.createChatMessageEvent(normalizedData);
            this._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, eventData);
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

        const thumbnails = Array.isArray(author.thumbnails) ? author.thumbnails.filter(isRecord) : [];
        const avatarUrl = thumbnails
            .map((thumb) => (typeof thumb.url === 'string' ? thumb.url.trim() : ''))
            .find((url) => url.length > 0) || '';
        const badgeImages = extractYouTubeBadgeImages(author);

        return {
            platform: 'youtube',
            ...(userId ? { userId } : {}),
            username: username || UNKNOWN_CHAT_USERNAME,
            avatarUrl,
            message: degradedMessage,
            ...(typeof timestamp === 'string' && timestamp.trim().length > 0 ? { timestamp } : {}),
            isMod: author.is_moderator === true,
            isPaypiggy,
            isBroadcaster,
            ...(badgeImages.length > 0 ? { badgeImages } : {}),
            metadata: mergeMissingFieldsMetadata({
                uniqueId: messageData.id || null,
                isSuperChat: !!messageData.superchat,
                isSuperSticker: !!messageData.supersticker,
                isMembership: !!messageData.isMembership,
                authorPhoto: avatarUrl || null
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
            userId: author.id,
            ...(author.thumbnailUrl ? { avatarUrl: author.thumbnailUrl } : {})
        };
    }

    _resolveGiftMessageViewAuthor(chatItem: unknown): UnknownMap {
        const chatRecord = toUnknownMap(chatItem);
        const item = isRecord(chatRecord.item)
            ? chatRecord.item
            : {};
        const itemAuthor = toUnknownMap(item.author);
        const username = this._resolveChatItemAuthorName(chatItem);
        const rawUserId = typeof itemAuthor.id === 'string' ? itemAuthor.id.trim() : '';
        const authorAvatar = toUnknownMap(item.author_avatar ?? item.authorAvatar);
        const avatarImage = authorAvatar.image;
        const avatarSources = Array.isArray(avatarImage)
            ? avatarImage
            : (Array.isArray(toUnknownMap(avatarImage).sources) ? toUnknownMap(avatarImage).sources as unknown[] : []);
        const avatarUrl = avatarSources
            .map((source) => (typeof toUnknownMap(source).url === 'string' ? (toUnknownMap(source).url as string).trim() : ''))
            .find((url) => url.length > 0) || '';
        return {
            ...(username ? { username } : {}),
            ...(rawUserId ? { userId: rawUserId } : {}),
            ...(avatarUrl ? { avatarUrl } : {})
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

    async handleLowPriorityEvent(_chatItem: unknown, _eventType: string): Promise<void> {
        // Intentionally ignored; raw capture remains available when configured.
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
        const resolveName = (candidate: unknown): string => {
            if (typeof candidate === 'string') {
                return normalizeYouTubeUsername(candidate) || '';
            }
            const candidateRecord = toUnknownMap(candidate);
            const rawName = candidateRecord.content ?? candidateRecord.text ?? candidateRecord.simpleText;
            return normalizeYouTubeUsername(rawName) || '';
        };

        return resolveName(item.authorName) ||
            resolveName(item.author_name) ||
            resolveName(author.name);
    }

    _isIgnoredDuplicateEventType(eventType: unknown): eventType is string {
        if (typeof eventType !== 'string') {
            return false;
        }
        return IGNORED_DUPLICATE_EVENT_TYPES.has(eventType);
    }

    async getViewerCountObservation(): Promise<ViewerCountObservation> {
        const membership = this.getViewerMembershipSnapshot();
        const unavailable = (reason: Extract<ViewerCountObservation, { kind: 'unavailable' }>['reason']): ViewerCountObservation =>
            ({ kind: 'unavailable', membershipGeneration: membership.generation, reason });
        if (this.membershipLifetime.signal.aborted) return unavailable('retired');
        try {
            if (!this.viewerCountProvider?.getViewerCountObservation) return unavailable('capability_missing');
            const observation = await this.viewerCountProvider.getViewerCountObservation();
            if (this.membershipLifetime.signal.aborted) return unavailable('retired');
            if (this.membership.generation !== membership.generation || observation.membershipGeneration !== membership.generation) {
                return unavailable('membership_changed');
            }
            if (observation.kind === 'complete' && (!Number.isSafeInteger(observation.count) || observation.count < 0)) {
                return unavailable('extraction_unavailable');
            }
            return observation;
        } catch (error) {
            this._handleProcessingError('Error getting viewer count via provider', error, 'viewer-count');
            return unavailable('extraction_unavailable');
        }
    }

    async getViewerCount(): Promise<number | null> {
        const observation = await this.getViewerCountObservation();
        return observation.kind === 'complete' ? observation.count : null;
    }

    async logRawPlatformData(eventType: string, data: unknown): Promise<void> {
        return this.rawPlatformDataLoggingService.logRawPlatformData('youtube', eventType, data, this.config);
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
        const readyConnectionCount = this.connectionManager?.getReadyConnectionCount() ?? 0;

        if (this.config.enabled === true && readyConnectionCount === 0) {
            issues.push('Not connected');
        }

        return {
            isReady: this.config.enabled === true && readyConnectionCount > 0,
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
        const playabilityStatus = toUnknownMap(infoRecord.playability_status);
        const liveStatus = basicInfo.live_status;
        const isUpcoming = basicInfo.is_upcoming === true;
        // Playback admission is separate from current-broadcast identity/state.
        const isLive = this.classifyStreamInfo(videoId, info) === 'live'
            && (playabilityStatus.status === undefined || playabilityStatus.status === 'OK');
        if (isLive) {
            return { shouldConnect: true, isLive, isUpcoming, liveStatus, reason: 'Stream is live' };
        }
        if (isUpcoming) {
            return { shouldConnect: false, isLive, isUpcoming, liveStatus, reason: 'Stream is upcoming but not yet live' };
        }
        if (basicInfo.is_live === true && playabilityStatus.status !== undefined && playabilityStatus.status !== 'OK') {
            return { shouldConnect: false, isLive, isUpcoming, liveStatus,
                reason: 'Video playback is unavailable; live chat connection cannot be validated' };
        }
        return { shouldConnect: false, isLive, isUpcoming, liveStatus, reason: 'Video is not live content (replay/VOD)' };
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
        const errorDetails = error instanceof Error ? error
            : new Error(typeof error === 'string' ? error : `Non-Error YouTube failure (${error === null ? 'null' : typeof error})`);
        const message = this._generateErrorMessage(context, videoId);
        const normalizedContext = { operation: context };

        this._handleProcessingError(message, errorDetails, context, { videoId });

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
            return;
        }
        const handler = this.handlers?.[handlerName];

        if (typeof handler === 'function') {
            const reportFailure = (error: unknown): void => {
                try {
                    this._handleProcessingError(
                        `Error in YouTube platform handler: ${handlerName}`, error, type, { handlerName }
                    );
                } catch {
                    // The optional observer and its reporter must not interrupt publication.
                }
            };
            try {
                void Promise.resolve(handler(payload)).catch(reportFailure);
            } catch (error) {
                reportFailure(error);
            }
        }
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
            ensureLogDirectorySync(this.config.dataLoggingPath, { checkExists: false });
        } catch (error) {
            this.errorHandler?.handleDataLoggingError?.(error, 'dataLoggingPath');
            this.logger?.warn?.(
                `Failed to prepare data logging path '${this.config.dataLoggingPath}': ${getErrorMessage(error)}`,
                'youtube'
            );
        }
    }


    async cleanup(): Promise<void> {
        const lifetime = this.membershipLifetime;
        const detector = this.streamDetectionService;
        const connections = this.connectionManager;
        const viewer = this.viewerService;
        if (!lifetime.signal.aborted) {
            this.membershipRequest++;
            this.membership = { generation: this.membership.generation + 1, videoIds: [], availability: 'unknown', discoveryComplete: false };
            this.lastDiscoveryWarningAt = null;
        }
        this._clearMonitoringInterval();
        this.isInitialized = false;
        lifetime.abort(new Error('YouTube platform retired'));
        const failures: { error: unknown; resource: string }[] = [];
        const retire = (resource: string, cleanup: () => void | Promise<void>): Promise<void> => {
            try {
                return Promise.resolve(cleanup()).catch(error => { failures.push({ error, resource }); });
            } catch (error) {
                failures.push({ error, resource });
                return Promise.resolve();
            }
        };
        // Stop detector admission synchronously, before joining any consumer. The
        // borrowed root metadata owner separately owns physical transport joins.
        const detectionCleanup = retire('streamDetectionService', () => detector?.cleanup?.());
        const connectionCleanup = retire('disconnect', () => connections?.cleanupAllConnections());
        const viewerCleanup = retire('viewerService', () => viewer?.cleanup?.());
        let reportingFailure: unknown;
        let reportingFailed = false;
        await Promise.all([detectionCleanup, connectionCleanup, viewerCleanup]);
        for (const { error, resource } of failures) {
            try {
                const message = resource === 'disconnect'
                    ? `Error disconnecting from YouTube: ${getErrorMessage(error)}`
                    : `Error during cleanup: ${resource}`;
                this._handleCleanupErrorLogging(message, error, resource);
            } catch (error) {
                if (!reportingFailed) reportingFailure = error;
                reportingFailed = true;
            }
        }
        if (reportingFailed) throw reportingFailure;
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
