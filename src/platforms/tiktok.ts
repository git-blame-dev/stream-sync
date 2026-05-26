import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { getLazyLogger, getLazyUnifiedLogger } from '../utils/logger-utils';
import { PlatformInitializationManager } from '../utils/platform-initialization-manager';
import { IntervalManager } from '../utils/interval-manager';
import { InitializationStatistics } from '../utils/initialization-statistics';
import { ConnectionStateManager } from '../utils/connection-state-manager';
import { PlatformConnectionFactory } from '../utils/platform-connection-factory';
import { safeSetTimeout } from '../utils/timeout-validator';
import { resolveTikTokTimestampMs, resolveTikTokTimestampISO } from '../utils/platform-timestamp';
import { getSystemTimestampISO } from '../utils/timestamp';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { createMonetizationErrorPayload } from '../utils/monetization-error-utils';
import { createRetrySystem } from '../utils/retry-system';
import { extractTikTokUserData, extractTikTokAvatarUrl, formatCoinAmount } from '../utils/tiktok-data-extraction';
import { validateNotificationManagerInterface } from '../utils/dependency-validator';
import { normalizeTikTokChatEvent, normalizeTikTokGiftEvent } from './tiktok/events/event-normalizer';
import { createTikTokConnectionOrchestrator } from './tiktok/connections/tiktok-connection-orchestrator';
import { cleanupTikTokEventListeners, setupTikTokEventListeners } from './tiktok/events/event-router';
import { createTikTokGiftAggregator } from './tiktok/monetization/gift-aggregator';
import { createTikTokEventFactory } from './tiktok/events/event-factory';
import { DEFAULT_AVATAR_URL } from '../constants/avatar';
import { ChatFileLoggingService } from '../services/ChatFileLoggingService';

const PlatformEvents = {
    CHAT_MESSAGE: 'platform:chat-message',
    GIFT: 'platform:gift',
    FOLLOW: 'platform:follow',
    SHARE: 'platform:share',
    PAYPIGGY: 'platform:paypiggy',
    GIFTPAYPIGGY: 'platform:giftpaypiggy',
    ENVELOPE: 'platform:envelope',
    RAID: 'platform:raid',
    STREAM_STATUS: 'platform:stream-status',
    VIEWER_COUNT: 'platform:viewer-count',
    CHAT_CONNECTED: 'platform:chat-connected',
    CHAT_DISCONNECTED: 'platform:chat-disconnected',
    ERROR: 'platform:error',
    _generateCorrelationId: () => crypto.randomUUID()
} as const;

type TikTokErrorContext = Record<string, unknown>;

type TikTokPayload = Record<string, unknown>;

type ChatFileLoggingOptions = NonNullable<ConstructorParameters<typeof ChatFileLoggingService>[0]>;
type ChatFileLogger = NonNullable<ChatFileLoggingOptions['logger']>;

type TikTokRawEvent = TikTokPayload & {
    common?: TikTokPayload & { msgId?: unknown };
    user?: TikTokPayload;
    displayText?: TikTokPayload;
    displayType?: unknown;
    actionType?: unknown;
    type?: unknown;
    label?: unknown;
    avatarUrl?: unknown;
};

type TikTokConfig = Record<string, unknown> & {
    enabled?: boolean;
    username?: string;
    viewerCountEnabled?: boolean;
    greetingsEnabled?: boolean;
    dataLoggingEnabled?: boolean;
    giftAggregationEnabled?: boolean;
};

type TikTokEventType = typeof PlatformEvents[keyof Omit<typeof PlatformEvents, '_generateCorrelationId'>];

type TikTokLogger = {
    debug: (message: string, source?: string, details?: unknown) => void;
    info: (message: string, source?: string, details?: unknown) => void;
    warn: (message: string, source?: string, details?: unknown) => void;
    error?: (message: string, source?: string, details?: unknown) => void;
};

type TikTokErrorHandler = {
    handleConnectionError: (error: unknown, context?: string, message?: string) => void;
    handleEventProcessingError: (error: unknown, context: string, payload?: unknown, message?: string) => void;
    handleCleanupError: (error: unknown, context?: string, message?: string) => void;
};

type TikTokEventBus = {
    emit: (eventName: string, payload: unknown) => void;
};

type TikTokNotificationManager = unknown;

type SelfMessageDetectionService = {
    shouldFilterMessage: (
        platform: string,
        messageData: { username?: string; userId?: string; isBroadcaster?: boolean },
        config: unknown
    ) => boolean;
};

type TikTokConnection = {
    isConnecting?: boolean;
    isConnected?: boolean;
    connectionId?: string;
    connect: () => Promise<unknown>;
    disconnect: () => Promise<unknown>;
    on: (eventName: string, handler: (payload: unknown) => void | Promise<void>) => void;
    removeAllListeners?: (eventName?: string) => void;
    [key: string]: unknown;
};

type TikTokHandlers = Record<string, (payload: unknown) => unknown>;

type TikTokWebcastEventMap = {
    CHAT: string;
    GIFT: string;
    FOLLOW: string;
    SOCIAL: string;
    ROOM_USER: string;
    ENVELOPE?: string;
    SUBSCRIBE?: string;
    SUPER_FAN?: string;
    ERROR: string;
    DISCONNECT: string;
    STREAM_END?: string;
};

type TikTokControlEventMap = {
    CONNECTED?: string;
    DISCONNECTED?: string;
    ERROR?: string;
};

type RetrySystem = {
    isConnected?: (platform: string) => boolean | undefined;
    resetRetryCount: (platform: string) => void;
    handleConnectionError: (
        platform: string,
        error: unknown,
        reconnect: () => Promise<void>,
        cleanup: () => Promise<void>
    ) => void;
};

type ConnectionFactoryLike = {
    createConnection: (platform: string, config: unknown, dependencies: unknown) => unknown;
};

type TikTokDependencies = {
    logger?: TikTokLogger;
    eventBus?: TikTokEventBus;
    notificationManager?: TikTokNotificationManager;
    initializationManager?: PlatformInitializationManager;
    intervalManager?: IntervalManager;
    initializationStats?: InitializationStatistics;
    deduplicationMaxCacheSize?: number;
    deduplicationTtlMs?: number;
    TikTokWebSocketClient?: unknown;
    WebcastEvent?: TikTokWebcastEventMap;
    ControlEvent?: TikTokControlEventMap;
    retrySystem?: RetrySystem;
    connectionFactory?: ConnectionFactoryLike;
    ChatFileLoggingService?: new (options: ChatFileLoggingOptions) => ChatFileLoggingService;
    selfMessageDetectionService?: SelfMessageDetectionService | null;
    viewerCountProvider?: {
        getViewerCount: () => number;
        isReady: () => boolean;
    };
};

type EventFactory = ReturnType<typeof createTikTokEventFactory>;

type DynamicEventFactoryMethod = (payload: TikTokPayload, options?: TikTokPayload) => TikTokPayload;

type TikTokGiftAggregator = ReturnType<typeof createTikTokGiftAggregator>;

type TikTokConnectionOrchestrator = ReturnType<typeof createTikTokConnectionOrchestrator>;

type DeduplicationConfig = {
    maxCacheSize: number;
    ttlMs: number;
};

type NormalizedErrorDetails = {
    message: string;
    info?: unknown;
    code?: unknown;
    url?: unknown;
    responseStatus?: unknown;
    responseBody?: string;
    causes?: NormalizedErrorDetails[];
    remainingCauses?: number;
};

type NormalizedConnectionIssue = {
    message: string;
    code?: number;
};

type ReconnectPolicyInput = {
    message?: string;
    code?: unknown;
    isError?: boolean;
    source?: string;
};

type ReconnectDecision = {
    issueType: string;
    isStreamNotLive: boolean;
    isTerminalError: boolean;
    willReconnect: boolean;
    shouldDeferReconnect: boolean;
    shouldImmediateRetry: boolean;
    skipReason: string | null;
};

type TikTokGiftAggregationState = {
    platform: unknown;
    userId: string;
    username: string;
    giftType: string;
    avatarUrl: string;
    giftImageUrl: string;
    currency: string;
    totalCount: number;
    timer: ReturnType<typeof setTimeout> | number | null;
    unitAmount: number;
    lastGift: TikTokPayload;
    lastId: string;
    lastTimestamp: string;
    sourceType?: string;
    messageHighWaterCounts: Map<string, number>;
    comboGroupHighWaterCounts: Map<string, number>;
};

type TikTokGiftPayload = TikTokPayload & {
    platform?: unknown;
    userId?: unknown;
    username?: unknown;
    avatarUrl?: unknown;
    giftImageUrl?: unknown;
    giftType?: unknown;
    giftCount?: unknown;
    repeatCount?: unknown;
    amount?: unknown;
    currency?: unknown;
    unitAmount?: unknown;
    id?: unknown;
    timestamp?: unknown;
    isAggregated?: boolean;
    sourceType?: unknown;
    rawData?: unknown;
};

type GiftErrorOverrides = Partial<{
    userId: string;
    username: string;
    giftType: string;
    giftCount: number;
    amount: number;
    currency: string;
    avatarUrl: string;
}>;

type StandardEventOptions = TikTokPayload & {
    factoryMethod?: string;
    emitType?: string;
    logEventType?: string;
    normalizedData?: TikTokPayload | null;
};

type DefaultHandlerName =
    | 'onChat'
    | 'onViewerCount'
    | 'onGift'
    | 'onPaypiggy'
    | 'onFollow'
    | 'onRaid'
    | 'onShare'
    | 'onEnvelope'
    | 'onStreamStatus';

const isRecord = (value: unknown): value is TikTokPayload => (
    !!value && typeof value === 'object' && !Array.isArray(value)
);

const asRecord = (value: unknown): TikTokPayload => (isRecord(value) ? value : {});

const isTikTokLogger = (value: unknown): value is TikTokLogger => {
    const candidate = asRecord(value);
    return typeof candidate.debug === 'function'
        && typeof candidate.info === 'function'
        && typeof candidate.warn === 'function';
};

const isChatFileLogger = (value: unknown): value is ChatFileLogger => {
    const candidate = asRecord(value);
    return typeof candidate.debug === 'function'
        && typeof candidate.info === 'function'
        && typeof candidate.warn === 'function'
        && typeof candidate.error === 'function';
};

const isTikTokConnection = (value: unknown): value is TikTokConnection => {
    const candidate = asRecord(value);
    return typeof candidate.connect === 'function'
        && typeof candidate.disconnect === 'function'
        && typeof candidate.on === 'function';
};

const isSelfMessageDetectionService = (value: unknown): value is SelfMessageDetectionService => (
    typeof asRecord(value).shouldFilterMessage === 'function'
);

const resolveLogger = (candidate: unknown): TikTokLogger => {
    if (isTikTokLogger(candidate)) {
        return candidate;
    }
    throw new Error('TikTok logger dependency does not implement debug/info/warn');
};

const getOptionalString = (value: unknown): string | undefined => (
    typeof value === 'string' && value.trim() ? value.trim() : undefined
);

const getErrorObject = (error: unknown): Error => (
    error instanceof Error ? error : new Error(getErrorMessage(error))
);

const createConnectionFactoryAdapter = (factory: PlatformConnectionFactory): ConnectionFactoryLike => ({
    createConnection: (platform: string, config: unknown, dependencies: unknown): unknown => (
        factory.createConnection(platform, asRecord(config), asRecord(dependencies))
    )
});

const getDynamicFactoryMethod = (factory: EventFactory, methodName: string): DynamicEventFactoryMethod | null => {
    const method = asRecord(factory)[methodName];
    return typeof method === 'function'
        ? (method as DynamicEventFactoryMethod)
        : null;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }

  return String(error ?? 'Unknown error');
};

class TikTokPlatform extends EventEmitter {
    declare logger: TikTokLogger;
    declare errorHandler: TikTokErrorHandler;
    declare eventBus: TikTokEventBus | null;
    declare notificationManager: TikTokNotificationManager;
    declare initializationManager: PlatformInitializationManager;
    declare intervalManager: IntervalManager;
    declare initializationStats: InitializationStatistics;
    declare listenersConfigured: boolean;
    declare recentPlatformMessageIds: Map<string, number>;
    declare recentShareActors: Set<string>;
    declare deduplicationConfig: DeduplicationConfig;
    declare fallbackAvatarUrl: string;
    declare config: TikTokConfig;
    declare TikTokWebSocketClient: unknown;
    declare WebcastEvent: TikTokWebcastEventMap;
    declare ControlEvent: TikTokControlEventMap;
    declare retrySystem: RetrySystem | null;
    declare platformName: 'tiktok';
    declare eventFactory: EventFactory;
    declare isPlannedDisconnection: boolean;
    declare connectionFactory: ConnectionFactoryLike;
    declare connectionStateManager: ConnectionStateManager;
    declare chatFileLoggingService: ChatFileLoggingService;
    declare selfMessageDetectionService: SelfMessageDetectionService | null;
    declare viewerCountProvider: { getViewerCount: () => number; isReady: () => boolean };
    declare connection: TikTokConnection | null;
    declare handlers: TikTokHandlers;
    declare connectionActive: boolean;
    declare connectionTime: number;
    declare connectingPromise: Promise<unknown> | null;
    declare retryLock: boolean;
    declare _disconnectionInProgress: boolean;
    declare giftAggregation: Record<string, TikTokGiftAggregationState>;
    declare giftAggregationDelay: number;
    declare giftAggregator: TikTokGiftAggregator;
    declare cachedViewerCount: number;
    declare connectionOrchestrator: TikTokConnectionOrchestrator;
    declare _lastNotLiveWarningAt: number | undefined;

    constructor(config: TikTokConfig = {}, dependencies: TikTokDependencies = {}) {
        super(); // Call EventEmitter constructor first to ensure proper prototype chain

        // Initialize logger with dependency injection support
        if (dependencies.logger) {
            this.logger = dependencies.logger;
        } else {
            const unifiedLogger = getLazyUnifiedLogger();
            this.logger = unifiedLogger ? resolveLogger(unifiedLogger) : resolveLogger(getLazyLogger());
        }
        const errorHandlerLogger = {
            ...this.logger,
            error: this.logger.error ?? this.logger.warn
        };
        const platformErrorHandler = createPlatformErrorHandler(errorHandlerLogger, 'tiktok');
        this.errorHandler = {
            handleConnectionError: platformErrorHandler.handleConnectionError.bind(platformErrorHandler),
            handleEventProcessingError: platformErrorHandler.handleEventProcessingError.bind(platformErrorHandler),
            handleCleanupError: (error, context, message) => {
                platformErrorHandler.handleCleanupError(error, context ?? 'cleanup', message ?? null);
            }
        };
        this.eventBus = dependencies.eventBus || null;
        this.notificationManager = dependencies.notificationManager;
        
        this.initializationManager = dependencies.initializationManager || new PlatformInitializationManager('tiktok', this.logger);
        this.intervalManager = dependencies.intervalManager || new IntervalManager('tiktok', this.logger);
        this.initializationStats = dependencies.initializationStats || new InitializationStatistics('tiktok', this.logger);
        this.listenersConfigured = false;
        this.recentPlatformMessageIds = new Map();
        this.recentShareActors = new Set();
        this.deduplicationConfig = {
            maxCacheSize: dependencies.deduplicationMaxCacheSize ?? 2000,
            ttlMs: dependencies.deduplicationTtlMs ?? 2 * 60 * 1000
        };
        this.fallbackAvatarUrl = DEFAULT_AVATAR_URL;

        this.config = config;

        this.TikTokWebSocketClient = dependencies.TikTokWebSocketClient;
        this.WebcastEvent = dependencies.WebcastEvent ?? {
            CHAT: 'chat',
            GIFT: 'gift',
            FOLLOW: 'follow',
            SOCIAL: 'social',
            ROOM_USER: 'roomUser',
            ERROR: 'error',
            DISCONNECT: 'disconnect'
        };
        this.ControlEvent = dependencies.ControlEvent ?? {};
        if (dependencies.retrySystem) {
            this.retrySystem = dependencies.retrySystem;
        } else {
            const retrySystem = createRetrySystem({ logger: this.logger });
            this.retrySystem = {
                resetRetryCount: retrySystem.resetRetryCount.bind(retrySystem),
                handleConnectionError: retrySystem.handleConnectionError.bind(retrySystem)
            };
        }
        this._validateDependencies(dependencies, this.config);
        
        this.platformName = 'tiktok';
        this.eventFactory = createTikTokEventFactory({
            platformName: this.platformName,
            getTimestamp: (data) => this._getTimestamp(data),
            normalizeUserData: (data) => this._normalizeUserData(data),
            getPlatformMessageId: (data) => this._getPlatformMessageId(data),
            buildEventMetadata: (metadata) => this._buildEventMetadata(metadata),
            normalizeChatEvent: (data) => normalizeTikTokChatEvent(data, {
                platformName: this.platformName
            })
        });

        // Track planned vs unexpected disconnections
        this.isPlannedDisconnection = false;
        
        // Setup connection state interface for retry system using WebSocket state
        if (this.retrySystem && typeof this.retrySystem === 'object') {
            this.retrySystem.isConnected = (platform) => {
                if (platform !== 'tiktok') return false;
                // Use connection's built-in state management
                return this.connection ? !!this.connection.isConnected : false;
            };
        }
        
        this.connectionFactory = dependencies.connectionFactory || createConnectionFactoryAdapter(new PlatformConnectionFactory(this.logger));
        this.connectionStateManager = new ConnectionStateManager('tiktok', this.connectionFactory);
        this.connectionStateManager.initialize(this.config, { ...dependencies, logger: this.logger });
        
        // Initialize chat file logging service via dependency injection
        const ChatFileLoggingServiceClass = dependencies.ChatFileLoggingService || ChatFileLoggingService;
        const chatFileLoggingOptions: ChatFileLoggingOptions = {
            config: {
                ...(typeof this.config.dataLoggingPath === 'string' ? { dataLoggingPath: this.config.dataLoggingPath } : {}),
                ...(typeof this.config.dataLoggingVerbose === 'boolean' ? { dataLoggingVerbose: this.config.dataLoggingVerbose } : {})
            }
        };
        if (isChatFileLogger(this.logger)) {
            chatFileLoggingOptions.logger = this.logger;
        }
        this.chatFileLoggingService = new ChatFileLoggingServiceClass({
            ...chatFileLoggingOptions
        });
        
        // Initialize self-message detection service via dependency injection
        this.selfMessageDetectionService = isSelfMessageDetectionService(dependencies.selfMessageDetectionService)
            ? dependencies.selfMessageDetectionService
            : null;

        this.viewerCountProvider = dependencies.viewerCountProvider || {
            getViewerCount: () => 0,
            isReady: () => false
        };

        this.connection = null;
        this.handlers = this._createDefaultHandlers();
        this.connectionActive = false;
        this.connectionTime = 0;
        this.connectingPromise = null;
        this.retryLock = false;
        this._disconnectionInProgress = false;

        // Gift aggregation system
        this.giftAggregation = {}; // Track gift aggregation by user and gift name
        this.giftAggregationDelay = 2000; // 2-second delay for gift aggregation
        this.giftAggregator = createTikTokGiftAggregator({ platform: this, safeSetTimeout });

        // Viewer count cache
        this.cachedViewerCount = 0;
        this.connectionOrchestrator = createTikTokConnectionOrchestrator({ platform: this._createOrchestratorPlatform() });

    }

    _createOrchestratorPlatform() {
        const platform = this;
        return {
            get logger() { return platform.logger; },
            get config() { return { username: platform.config.username ?? '' }; },
            get connection() { return platform.connection; },
            set connection(connection: TikTokConnection | null) { platform.connection = connection; },
            get connectionActive() { return platform.connectionActive; },
            set connectionActive(connectionActive: boolean) { platform.connectionActive = connectionActive; },
            get retryLock() { return platform.retryLock; },
            set retryLock(retryLock: boolean) { platform.retryLock = retryLock; },
            get listenersConfigured() { return platform.listenersConfigured; },
            set listenersConfigured(listenersConfigured: boolean) { platform.listenersConfigured = listenersConfigured; },
            get connectingPromise() { return platform.connectingPromise; },
            set connectingPromise(connectingPromise: Promise<unknown> | null) { platform.connectingPromise = connectingPromise; },
            get connectionStateManager() {
                return {
                    markDisconnected: () => platform.connectionStateManager.markDisconnected(),
                    markConnecting: () => platform.connectionStateManager.markConnecting(),
                    markError: (error: unknown) => platform.connectionStateManager.markError(error),
                    ensureConnection: () => {
                        const connection = platform.connectionStateManager.ensureConnection();
                        if (!isTikTokConnection(connection)) {
                            throw new Error('TikTok connection is missing required methods');
                        }
                        return connection;
                    }
                };
            },
            get errorHandler() { return platform.errorHandler; },
            cleanupEventListeners: () => platform.cleanupEventListeners(),
            checkConnectionPrerequisites: () => platform.checkConnectionPrerequisites(),
            setupEventListeners: () => platform.setupEventListeners(),
            handleConnectionSuccess: () => platform.handleConnectionSuccess(),
            handleConnectionError: (error: unknown) => platform.handleConnectionError(error),
            cleanup: () => platform.cleanup()
        };
    }

    _createEventRouterPlatformAdapter() {
        const platform = this;
        return {
            get listenersConfigured() { return platform.listenersConfigured; },
            set listenersConfigured(listenersConfigured: boolean) { platform.listenersConfigured = listenersConfigured; },
            get connection() { return platform.connection; },
            set connection(connection: TikTokConnection | null) { platform.connection = connection; },
            get WebcastEvent() { return platform.WebcastEvent; },
            get ControlEvent() { return platform.ControlEvent; },
            get platformName() { return platform.platformName; },
            get selfMessageDetectionService() { return platform.selfMessageDetectionService; },
            get config() { return platform.config; },
            get logger() { return platform.logger; },
            get errorHandler() { return platform.errorHandler; },
            constructor: {
                resolveEventTimestampMs: (data: TikTokRawEvent) => TikTokPlatform.resolveEventTimestampMs(data)
            },
            _logIncomingEvent: (eventType: string, data: unknown) => platform._logIncomingEvent(eventType, data),
            _emitPlatformEvent: (type: string, payload: TikTokPayload) => platform._emitPlatformEvent(type, payload),
            _handleStandardEvent: (eventType: string, data: TikTokRawEvent, options?: Record<string, unknown>) => platform._handleStandardEvent(eventType, data, options),
            _handleStreamEnd: (data?: TikTokRawEvent) => platform._handleStreamEnd(data),
            handleConnectionIssue: (issue: unknown, isError?: boolean) => platform.handleConnectionIssue(issue, isError),
            handleConnectionError: (error: unknown) => platform.handleConnectionError(error),
            handleRetry: (error: unknown) => platform.handleRetry(error),
            handleTikTokGift: (data: TikTokRawEvent) => platform.handleTikTokGift(data),
            handleTikTokFollow: (data: TikTokRawEvent) => platform.handleTikTokFollow(data),
            handleTikTokSocial: (data: TikTokRawEvent) => platform.handleTikTokSocial(data),
            get connectionActive() { return platform.connectionActive; },
            set connectionActive(connectionActive: boolean) { platform.connectionActive = connectionActive; },
            get cachedViewerCount() { return platform.cachedViewerCount; },
            set cachedViewerCount(cachedViewerCount: number) { platform.cachedViewerCount = cachedViewerCount; },
            get connectionTime() { return platform.connectionTime; },
            set connectionTime(connectionTime: number) { platform.connectionTime = connectionTime; },
            _getTimestamp: (data: TikTokRawEvent) => platform._getTimestamp(data),
            _getPlatformMessageId: (data: TikTokRawEvent) => platform._getPlatformMessageId(data),
            _handleChatMessage: async (rawData: TikTokRawEvent, normalizedData: TikTokPayload) => {
                await platform._handleChatMessage(rawData, normalizedData);
            }
        };
    }

    _validateDependencies(dependencies: TikTokDependencies = {}, config: TikTokConfig = {}): void {
        if (!config.enabled) {
            return;
        }

        const missing: string[] = [];

        if (!dependencies.TikTokWebSocketClient) {
            missing.push('TikTokWebSocketClient');
        }
        if (!dependencies.WebcastEvent) {
            missing.push('WebcastEvent');
        }
        if (!dependencies.ControlEvent) {
            missing.push('ControlEvent');
        }

        if (missing.length) {
            throw new Error(`Missing required TikTok dependencies: ${missing.join(', ')}`);
        }

        if (dependencies.notificationManager) {
            validateNotificationManagerInterface(dependencies.notificationManager);
        }
    }

    checkConnectionPrerequisites(): { canConnect: boolean; reasons: string[]; reason?: string } {
        const reasons: string[] = [];
        
        if (!this.config.enabled) {
            reasons.push('Platform disabled in configuration');
        }
        
        if (this.connection && this.connection.isConnecting) {
            reasons.push('Already connecting');
        }
        
        if (this.connection && this.connection.isConnected) {
            reasons.push('Already connected');
        }
        
        return {
            canConnect: reasons.length === 0,
            reasons,
            ...(reasons[0] ? { reason: reasons[0] } : {})
        };
    }
    
    get connectionStatus(): boolean {
        return !!(this.connection && this.connection.isConnected);
    }

    get isConnecting(): boolean {
        return this.connection ? !!this.connection.isConnecting : false;
    }

    getConnectionState(): TikTokPayload {
        return {
            isConnected: this.connection ? !!this.connection.isConnected : false,
            isConnecting: this.connection ? !!this.connection.isConnecting : false,
            hasConnection: !!this.connection,
            connectionId: this.connection?.connectionId || 'N/A',
            connectionTime: this.connectionTime
        };
    }

    getStats(): TikTokPayload {
        return {
            platform: 'tiktok',
            enabled: this.config.enabled,
            connected: !!(this.connection && this.connection.isConnected),
            connecting: this.connection ? !!this.connection.isConnecting : false,
            config: {
                username: this.config.username,
                viewerCountEnabled: this.config.viewerCountEnabled,
                greetingsEnabled: this.config.greetingsEnabled
            }
        };
    }

    isConfigured(): boolean {
        return !!(this.config.enabled && this.config.username);
    }

    validateConfig(): { isReady: boolean; issues: string[] } {
        return this.getStatus();
    }
    
    async initialize(handlers: TikTokHandlers = {}): Promise<void> {
        // Check if initialization should proceed
        if (!this.initializationManager.beginInitialization()) {
            return; // Reinitialization prevented
        }
        
        const attemptId = this.initializationStats.startInitializationAttempt({
            handlersProvided: Object.keys(handlers || {})
        });
        
        try {
            // Store event handlers first
            const incomingHandlers = handlers || {};
            this.handlers = { ...this.handlers, ...incomingHandlers };
            this.logger.debug(`Platform initialized with event handlers: ${Object.keys(incomingHandlers).join(', ')}`, 'tiktok');
            this.logger.debug(`Event handlers available: ${Object.keys(this.handlers).join(', ')}`, 'tiktok');
            this.logger.debug(`onViewerCount handler present: ${!!this.handlers.onViewerCount}`, 'tiktok');
            
            // Reset retry count on initialization
            if (this.retrySystem) {
                this.retrySystem.resetRetryCount('tiktok');
            }
            
            const startTime = Date.now();
            await this._connect(this.handlers);
            const connectionTime = Date.now() - startTime;
            
            // Mark initialization as successful
            this.initializationManager.markInitializationSuccess({
                handlersCount: Object.keys(this.handlers).length,
                connectionTime
            });
            
            this.initializationStats.recordSuccess(attemptId, {
                connectionTime
            });
            
        } catch (error) {
            // Mark initialization as failed
            this.initializationManager.markInitializationFailure(error, {
                handlersCount: Object.keys(this.handlers).length
            });
            
            this.initializationStats.recordFailure(attemptId, error, {
                stage: 'connection',
                handlersCount: Object.keys(this.handlers).length
            });
            
            // Handle connection error with retry logic
            if (this.retrySystem) {
                this.handleRetry(error);
            } else {
                this.errorHandler.handleConnectionError(
                    error,
                    'connection',
                    `Connection failed: ${getErrorMessage(error)}`
                );
            }

            // Propagate initialization failure so lifecycle managers can reflect accurate state
            throw error;
        }
    }

    async _connect(handlers: TikTokHandlers): Promise<unknown> {
        return this.connectionOrchestrator.connect(handlers);
    }


    _handleConnectionError(error: unknown): { errorCategory: string; username?: string } {
        const username = this.config.username;
        const errorMessage = getErrorMessage(error);
        this.errorHandler.handleConnectionError(
            error,
            'connection',
            `TikTok connection error for user '${username}': ${errorMessage}`
        );

        let errorCategory = 'unknown';

        if (errorMessage.includes('fetchIsLive')) {
            errorCategory = 'stream-status';
            this.logger.warn(`Stream status check failed for TikTok user '${username}' - may be a temporary API issue or user may not exist`, 'tiktok');
        } else if (errorMessage.includes('waitUntilLive')) {
            errorCategory = 'stream-wait';
            this.logger.warn(`Stream wait operation failed for TikTok user '${username}' - stream may have gone offline or user may not be streaming`, 'tiktok');
        } else if (errorMessage.includes('TLS') || errorMessage.includes('socket disconnected')) {
            errorCategory = 'network';
            this.logger.warn(`TLS/Network connection failed for TikTok user '${username}' - check firewall settings and network connectivity`, 'tiktok');
        } else if (errorMessage.includes('connect')) {
            errorCategory = 'connection-establishment';
            this.logger.warn(`Connection establishment failed for TikTok user '${username}' - may need retry or user may have ended stream`, 'tiktok');
        } else if (errorMessage.includes('room info') || errorMessage.includes('Failed to retrieve')) {
            errorCategory = 'room-info';
            this.logger.warn(`Room info retrieval failed for TikTok user '${username}' - verify username is correct and user exists on TikTok`, 'tiktok');
        }

        return {
            errorCategory,
            ...(username ? { username } : {})
        };
    }

    setupEventListeners() {
        setupTikTokEventListeners(this._createEventRouterPlatformAdapter());
    }

    async _logIncomingEvent(eventType: string, data: unknown): Promise<void> {
        if (!this.config.dataLoggingEnabled) {
            return;
        }
        try {
            await this.logRawPlatformData(eventType, data);
        } catch (error) {
            this.logger.warn(`Failed to log TikTok event '${eventType}': ${getErrorMessage(error)}`, 'tiktok');
        }
    }

    async _logRawEvent(eventType: string, data: unknown): Promise<void> {
        return this._logIncomingEvent(eventType, data);
    }
    
    async handleConnectionSuccess() {
        if (this.connectionActive) {
            return;
        }

        const username = this.config.username;
        this.connectionActive = true;
        this.connectionTime = Date.now(); // Record the time of connection
        this.connectionStateManager.markConnected();
        this.intervalManager.clearInterval('tiktok-stream-reconnect');
        
        // Reset planned disconnection flag - this is now a live connection
        this.isPlannedDisconnection = false;
        this.logger.info(`Connection successful for TikTok user '${username}'`, 'tiktok');
        
        // Emit connection event instead of direct app call
        await this._handleConnection();
        
        // Let retry system know
        if (this.retrySystem) {
            this.retrySystem.resetRetryCount('tiktok');
        }
    }
    
    handleConnectionError(err: unknown): void {
        const username = this.config.username;
        const details = this._normalizeErrorDetails(err);
        const errorMessage = details.message;
        const isStreamNotLive = this._isStreamNotLive(details);
        if (isStreamNotLive) {
            this._resetShareActorTracking('stream-not-live');
            if (!this._wasRecentlyNotLiveLogged()) {
                this.logger.warn(this._formatStreamNotLiveMessage(username, details), 'tiktok');
                this._recordNotLiveWarning();
            } else {
                this._recordNotLiveWarning();
            }
        } else {
            this.errorHandler.handleConnectionError(
                err,
                'connection',
                `Connection failed for TikTok user '${username}': ${errorMessage}`
            );
        }
        
        // Update connection state manager (Solution C pattern)
        this.connectionStateManager.markError(err);
        this.cleanupEventListeners();
        this.listenersConfigured = false;
        this.connection = null;
        this.connectionActive = false;

        // Provide specific guidance for different error types
        if (!isStreamNotLive) {
            if (errorMessage.includes('TLS') || errorMessage.includes('socket disconnected')) {
                this.logger.warn(`TLS/Network connection failed for TikTok user '${username}' - check firewall settings and network connectivity`, 'tiktok');
            } else if (errorMessage.includes('room info') || errorMessage.includes('Failed to retrieve')) {
                this.logger.warn(`Room info retrieval failed for TikTok user '${username}' - verify username exists, is not private, and is currently live`, 'tiktok');
            } else if (errorMessage.includes('timeout')) {
                this.logger.warn(`Connection timeout for TikTok user '${username}' - may be network issues or TikTok API temporarily unavailable`, 'tiktok');
            }
        }

        // Automatically trigger retry logic
        this.handleRetry(err);
    }

  handleRetry(err: unknown): { action: string; reason?: string } {
    const username = this.config.username;
    const errorMessage = getErrorMessage(err);
    const decision = this._classifyReconnectPolicy({
      message: errorMessage,
      source: 'retry',
    });

    if (decision.shouldDeferReconnect) {
      this.isPlannedDisconnection = false;
      const deferredReconnect = this._ensureDeferredReconnectChecks('stream-not-live');
      if (deferredReconnect.scheduled) {
        this.logger.debug(
          `Scheduled deferred reconnect checks for TikTok user '${username}' after not-live signal`,
          'tiktok',
        );
        return { action: 'deferred-reconnect-scheduled' };
      }

      return { action: 'deferred-reconnect-active', reason: deferredReconnect.reason };
    }

    if (decision.skipReason === 'terminal-error') {
      this.logger.warn(`Non-recoverable error for TikTok user '${username}', skipping retry: ${errorMessage}`, 'tiktok');
      return { action: 'skipped', reason: 'non-recoverable' };
    }

    if (!this.retrySystem) {
      this.logger.warn(`No retry system available for TikTok user '${username}', connection will not be retried`, 'tiktok');
      return { action: 'skipped', reason: 'no-retry-system' };
    }

        this.logger.debug(`Attempting retry for TikTok user '${username}' after error: ${errorMessage}`, 'tiktok');
        this.queueRetry(err);
        return { action: 'retry-queued' };
    }
    
    _normalizeErrorDetails(err: unknown): NormalizedErrorDetails {
        const mapError = (source: unknown): NormalizedErrorDetails => {
            if (!source) {
                return { message: 'Unknown error' };
            }

            const sourceRecord = asRecord(source);
            const exceptionRecord = asRecord(sourceRecord.exception);
            const response = sourceRecord.response ?? exceptionRecord.response;
            const requestUrl = sourceRecord.requestUrl
                ?? exceptionRecord.requestUrl
                ?? sourceRecord.url
                ?? exceptionRecord.url
                ?? asRecord(exceptionRecord.config).url;
            const code = sourceRecord.code
                ?? exceptionRecord.code
                ?? exceptionRecord.statusCode
                ?? sourceRecord.status
                ?? sourceRecord.statusCode;

            const baseMessage = sourceRecord.message || sourceRecord.info || String(source) || 'Unknown error';
            const responseRecord = asRecord(response);
            const responseBody = typeof responseRecord.body === 'string'
                ? responseRecord.body.slice(0, 512)
                : (typeof responseRecord.data === 'string' ? responseRecord.data.slice(0, 512) : undefined);

            return {
                message: String(baseMessage),
                info: sourceRecord.info,
                code,
                url: requestUrl,
                responseStatus: responseRecord.status || sourceRecord.statusCode,
                ...(responseBody !== undefined ? { responseBody } : {})
            };
        };

        const details = mapError(err);
        const errRecord = asRecord(err);

        // Capture nested connector errors array (e.g., fetchRoomId fallbacks)
        if (Array.isArray(errRecord.errors) && errRecord.errors.length) {
            details.causes = errRecord.errors.slice(0, 3).map((nestedErr: unknown) => mapError(nestedErr));
            if (errRecord.errors.length > 3) {
                details.remainingCauses = errRecord.errors.length - details.causes.length;
            }
        }

        return details;
    }

    _normalizeConnectionIssue(issue: unknown): NormalizedConnectionIssue {
        if (!issue) {
            return { message: 'Unknown disconnect reason' };
        }

        if (issue instanceof Error) {
            return { message: issue.message || 'Unknown disconnect reason' };
        }

        if (typeof issue === 'string') {
            return { message: issue };
        }

        if (typeof issue === 'object') {
            const issueRecord = asRecord(issue);
            const message = issueRecord.reason || issueRecord.message;
            const code = typeof issueRecord.code === 'number' ? issueRecord.code : undefined;
            return {
                message: String(message || 'Unknown disconnect reason'),
                ...(code !== undefined ? { code } : {})
            };
        }

        return { message: String(issue) };
    }

    _isStreamNotLive(detailsOrMessage: string | { message?: unknown; reason?: unknown; code?: unknown }): boolean {
        const message = typeof detailsOrMessage === 'string'
            ? detailsOrMessage
            : detailsOrMessage?.message || detailsOrMessage?.reason;
        const code = typeof detailsOrMessage === 'object'
            ? detailsOrMessage?.code
            : undefined;
        if (code === 4404) {
            return true;
        }
        if (!message) {
            return false;
        }
        return String(message).toLowerCase().includes('not live');
    }

    _formatStreamNotLiveMessage(username: string | undefined, details: { code?: unknown }): string {
        const codeSuffix = details?.code ? ` (code ${details.code})` : '';
        return `Stream is not live for TikTok user '${username}'${codeSuffix}`;
    }

    _recordNotLiveWarning(): void {
        this._lastNotLiveWarningAt = Date.now();
    }

  _wasRecentlyNotLiveLogged(): boolean {
    if (!this._lastNotLiveWarningAt) {
      return false;
    }
    return Date.now() - this._lastNotLiveWarningAt < 2000;
  }

  _ensureDeferredReconnectChecks(context = 'offline'): { scheduled: boolean; reason: string } {
    if (!this.config.enabled) {
      return { scheduled: false, reason: 'platform-disabled' };
    }

    if (this.intervalManager.hasInterval('tiktok-stream-reconnect')) {
      return { scheduled: false, reason: 'already-active' };
    }

    this.intervalManager.createInterval(
      'tiktok-stream-reconnect',
      async () => {
        try {
          await this._connect(this.handlers);
        } catch (err) {
          this.logger.debug(
            `Deferred reconnect check failed (${context}): ${getErrorMessage(err)}`,
            'tiktok',
          );
        }
      },
      60000,
      'reconnect',
    );

    return { scheduled: true, reason: 'scheduled' };
  }

  _classifyReconnectPolicy({ message = 'Unknown error', code, isError = false, source = 'connection-issue' }: ReconnectPolicyInput = {}): ReconnectDecision {
    const isStreamNotLive = this._isStreamNotLive({ message, code });
    const isTerminalError = !isStreamNotLive && !this._isRecoverableError(message);
    const reconnectAllowed = !!(!this.isPlannedDisconnection && this.config.enabled);
    const willReconnect = reconnectAllowed && !isTerminalError;

    const issueType = isStreamNotLive
      ? 'stream-not-live'
      : (isError ? 'error' : 'disconnection');

    if (!willReconnect) {
      return {
        issueType,
        isStreamNotLive,
        isTerminalError,
        willReconnect,
        shouldDeferReconnect: false,
        shouldImmediateRetry: false,
        skipReason: isTerminalError ? 'terminal-error' : 'no-retry-needed',
      };
    }

    if (isStreamNotLive || source === 'stream-end') {
      return {
        issueType,
        isStreamNotLive,
        isTerminalError,
        willReconnect,
        shouldDeferReconnect: true,
        shouldImmediateRetry: false,
        skipReason: null,
      };
    }

    return {
      issueType,
      isStreamNotLive,
      isTerminalError,
      willReconnect,
      shouldDeferReconnect: false,
      shouldImmediateRetry: true,
      skipReason: null,
    };
  }

    _isRecoverableError(errorMessage: string): boolean {
        // Non-recoverable errors (likely configuration issues)
    const nonRecoverablePatterns = [
      'username is required',
      'invalid username',
      'user not found',
      'private account',
      'banned account'
    ];
        
        for (const pattern of nonRecoverablePatterns) {
            if (errorMessage.toLowerCase().includes(pattern)) {
                return false;
            }
        }
        
        // Recoverable errors (likely temporary network/API issues)
        const recoverablePatterns = [
            'timeout',
            'network',
            'connection',
            'tls',
            'socket',
            'room info',
            'failed to retrieve',
            'api',
            'temporary'
        ];
        
        for (const pattern of recoverablePatterns) {
            if (errorMessage.toLowerCase().includes(pattern)) {
                return true;
            }
        }
        
        // Default to recoverable for unknown errors (conservative approach)
        return true;
    }
    
  queueRetry(error: unknown): { queued: boolean; reason?: string } {
        if (!this.retrySystem) {
            return { queued: false, reason: 'no-retry-system' };
        }
        if (this.retryLock) {
            return { queued: false, reason: 'locked' };
        }

        this.retryLock = true;

        const reconnectFn = async () => {
            this.retryLock = false;
            try {
                await this._connect(this.handlers);
            } catch (err) {
                this.handleRetry(err);
            }
        };

        this.retrySystem.handleConnectionError(
            'tiktok',
            error,
            reconnectFn,
            () => this.cleanup()
        );

        return { queued: true };
    }
    
    async handleConnectionIssue(issue: unknown, isError = false) {
        // Prevent double-handling when both DISCONNECTED and STREAM_END fire (e.g., 4404)
        if (this._disconnectionInProgress) {
            return { issueType: 'skipped', retryResult: null, reason: 'disconnection-in-progress' };
        }
        this._disconnectionInProgress = true;

    try {
      const username = this.config.username;
      const normalizedIssue = this._normalizeConnectionIssue(issue);
      const message = normalizedIssue.message;
      const decision = this._classifyReconnectPolicy({
        message,
        code: normalizedIssue.code,
        isError,
        source: 'connection-issue',
      });

      if (decision.isStreamNotLive) {
        this._resetShareActorTracking('stream-not-live');
        this.logger.warn(this._formatStreamNotLiveMessage(username, normalizedIssue), 'tiktok');
        this._recordNotLiveWarning();
      } else if (isError) {
        this.errorHandler.handleConnectionError(issue, 'connection issue', `Connection issue: ${message}`);
      } else {
        this.logger.warn(`Connection issue: ${message}`, 'tiktok');
      }

      this.connectionActive = false;
      await this.cleanup();
      this.connection = null;
      this.listenersConfigured = false;

      const disconnectionMessage = decision.isStreamNotLive ? 'Stream is not live' : message;
      await this._handleDisconnection(disconnectionMessage, decision.willReconnect);

      let retryResult = null;
      if (decision.shouldDeferReconnect) {
        this.isPlannedDisconnection = false;
        const deferredReconnect = this._ensureDeferredReconnectChecks('stream-not-live-disconnect');
        retryResult = {
          queued: false,
          reason: deferredReconnect.scheduled
            ? 'deferred-reconnect-scheduled'
            : 'deferred-reconnect-already-active',
        };
      } else if (decision.shouldImmediateRetry && this.retrySystem) {
        const errorForRetry = isError ? issue : new Error(`TikTok disconnected: ${disconnectionMessage}`);
        retryResult = this.queueRetry(errorForRetry);
      } else if (decision.skipReason) {
        this.logger.debug(`Skipping retry: ${decision.skipReason}`, 'tiktok');
        retryResult = { queued: false, reason: decision.skipReason };
      } else {
        this.logger.warn('No retry system available, connection will not be retried', 'tiktok');
        retryResult = { queued: false, reason: 'no-retry-system' };
      }

      return { issueType: decision.issueType, retryResult };
        } finally {
            this._disconnectionInProgress = false;
        }
    }
    
    getStatus(): { isReady: boolean; issues: string[] } {
        const issues: string[] = [];
        const isConnected = !!(this.connection && this.connection.isConnected);

        if (this.config.enabled && !isConnected) {
            issues.push('Not connected');
        }

        return {
            isReady: !!(this.config.enabled && isConnected),
            issues
        };
    }

    async handleTikTokGift(data: unknown) {
        // Fast path for invalid data - skip expensive processing
        if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
            this.logger.warn('handleTikTokGift called with empty or invalid data', 'tiktok', { data });
            return;
        }
        try {
            const normalizedGift = normalizeTikTokGiftEvent(asRecord(data), {
                platformName: this.platformName,
                getTimestamp: (payload) => this._getTimestamp(payload),
                getPlatformMessageId: (payload) => this._getPlatformMessageId(payload)
            });
            const {
                userId,
                giftType,
                giftCount,
                amount,
                currency,
                comboType,
                repeatEnd
            } = normalizedGift;
            const identityKey = userId;

            this.logger.debug(`[TikTok Gift] Processing gift: ${identityKey} sent ${giftCount}x ${giftType} (${amount} ${currency}, comboType: ${comboType}, repeatEnd: ${repeatEnd})`, 'tiktok');

            // OFFICIAL TIKTOK PATTERN: Process gifts based on giftType and repeatEnd
            // - giftType: 1 = combo-enabled (only process when repeatEnd: true)
            // - giftType: 0 or undefined = non-combo (process immediately)
            
            if (comboType === 1 && !repeatEnd) {
                // Streak in progress - do NOT process yet, just log
                this.logger.debug(`[TikTok Gift] Streak in progress: ${identityKey} sending ${giftType} x${giftCount} (waiting for repeatEnd: true)`, 'tiktok');
                return; // Wait for final event with repeatEnd: true
            }
            
            // Process gift in these cases:
            // 1. giftType !== 1 (non-combo gift)
            // 2. giftType === 1 AND repeatEnd === true (combo streak completed)
            
            const isStreakCompleted = (comboType === 1 && repeatEnd === true);
            
            if (isStreakCompleted) {
                this.logger.debug(`[TikTok Gift] Streak completed: ${identityKey} finished combo of ${giftCount}x ${giftType}`, 'tiktok');
            } else {
                this.logger.debug(`[TikTok Gift] Non-combo gift: ${identityKey} sent ${giftCount}x ${giftType}`, 'tiktok');
            }

            // Check if gift aggregation is disabled - if so, send immediately
            if (!this.config.giftAggregationEnabled) {
                this.logger.debug('[TikTok Gift] Aggregation disabled, sending gift immediately', 'tiktok');
                await this.handleOfficialGift(normalizedGift, { isStreakCompleted });
                return; // Exit early, no aggregation needed
            }

            // Use standard aggregation for all processable gifts
            await this.handleStandardGift(normalizedGift);

        } catch (error) {
            const errorOverrides = this._buildGiftErrorOverrides(data);
            const errorMessage = getErrorMessage(error);
            if (errorMessage.includes('repeatCount')) {
                await this._handleError(error, {
                    reason: 'gift-count-invalid',
                    recoverable: true,
                    data
                });
                const errorPayload = this._createMonetizationErrorPayload('gift', data, errorOverrides);
                if (!errorPayload) {
                    return;
                }
                this._emitPlatformEvent(PlatformEvents.GIFT, errorPayload);
                return;
            }
            this.errorHandler.handleEventProcessingError(
                error,
                'gift-processing',
                data,
                'Error processing gift'
            );
            const errorPayload = this._createMonetizationErrorPayload('gift', data, errorOverrides);
            if (!errorPayload) {
                return;
            }
            this._emitPlatformEvent(PlatformEvents.GIFT, errorPayload);
        }
    }

    async handleOfficialGift(gift: TikTokGiftPayload, options: { isStreakCompleted?: boolean } = {}) {
        const isStreakCompleted = options.isStreakCompleted === true;
        const username = gift.username;
        const giftType = gift.giftType;
        const giftCount = gift.giftCount;
        const amount = gift.amount;
        const currency = gift.currency;

        let giftMessage = isStreakCompleted
            ? `${username} completed a streak of ${giftCount}x ${giftType}`
            : `${username} sent ${giftCount}x ${giftType}`;
        giftMessage += formatCoinAmount(amount, currency);
        this.logger.info(`[Gift] ${giftMessage}`, 'tiktok');

        const enhancedGiftData = {
            username,
            userId: gift.userId,
            giftType,
            giftCount,
            amount,
            currency,
            isAggregated: false,
            isStreakCompleted,
            originalData: gift.rawData
        };

        const giftPayload: TikTokGiftPayload = {
            platform: gift.platform || 'tiktok',
            userId: gift.userId,
            username,
            avatarUrl: gift.avatarUrl,
            giftImageUrl: gift.giftImageUrl,
            giftType,
            giftCount,
            repeatCount: Number.isFinite(Number(gift.repeatCount)) ? Number(gift.repeatCount) : giftCount,
            amount,
            currency,
            unitAmount: gift.unitAmount,
            id: gift.id,
            timestamp: gift.timestamp,
            isAggregated: false,
            enhancedGiftData
        };

        if (typeof gift.sourceType === 'string') {
            giftPayload.sourceType = gift.sourceType;
        }

        try {
            await this._handleGift(giftPayload);
        } catch (error) {
            this.errorHandler.handleEventProcessingError(
                error,
                'gift-notification',
                enhancedGiftData,
                `Error handling immediate gift notification for ${username}`
            );
        }
    }

    async handleStandardGift(gift: TikTokGiftPayload) {
        return this.giftAggregator.handleStandardGift(gift);
    }


    cleanupGiftAggregation() {
        this.giftAggregator.cleanupGiftAggregation();
    }

    static resolveEventTimestampMs(data: unknown) {
        return resolveTikTokTimestampMs(data);
    }

    static resolveEventTimestampISO(data: unknown) {
        return resolveTikTokTimestampISO(data);
    }

    async handleTikTokFollow(data: unknown) {
        try {
            const { username, userId } = extractTikTokUserData(data);

            if (!userId || !username) {
                this.logger.warn('[TikTok Follow] Missing canonical identity in follow/share event data', 'tiktok', { data });
                return;
            }

            const dataRecord = asRecord(data);
            const inferredActionType = String(dataRecord.displayType || dataRecord.actionType || dataRecord.type || 'follow').toLowerCase();
            const actionType = this._inferSocialActionType(data, inferredActionType);

            if (this._shouldSkipDuplicatePlatformMessage(data).isDuplicate) {
                return;
            }

            if (actionType === 'share') {
                this.logger.debug(`[TikTok Share] ${username} shared`, 'tiktok');
                await this._handleShare(data);
                return;
            }

            this.logger.debug(`[TikTok Follow] ${username} followed`, 'tiktok');
            await this._handleFollow(data);
        } catch (err) {
            this.errorHandler.handleEventProcessingError(
                err,
                'follow-processing',
                data,
                `[TikTok Follow] Error processing follow event: ${getErrorMessage(err)}`
            );
        }
    }

    async handleTikTokSocial(data: unknown) {
        try {
            // Validate data structure
            if (!data || typeof data !== 'object') {
                this.logger.warn('Received invalid social data', 'tiktok', { data });
                return;
            }

            const dataRecord = asRecord(data);
            const { username, userId } = extractTikTokUserData(dataRecord);
            const inferredActionType = String(dataRecord.displayType || dataRecord.actionType || dataRecord.type || 'social').toLowerCase();
            const actionType = this._inferSocialActionType(data, inferredActionType);

            if (!userId || !username) {
                this.logger.warn('Received social event without canonical identity', 'tiktok', { data, actionType });
                return;
            }

            if (actionType !== 'share' && actionType !== 'follow') {
                this.logger.debug('[TikTok Social] Ignoring unsupported social action', 'tiktok', {
                    actionType,
                    userId,
                    username
                });
                return;
            }

            if (this._shouldSkipDuplicatePlatformMessage(data).isDuplicate) {
                return;
            }

            this.logger.debug(`[TikTok Social] ${username} performed ${actionType} action`, 'tiktok');

            if (actionType === 'share') {
                await this._handleShare(data);
                return;
            }

            await this._handleFollow(data);
        } catch (err) {
            this.errorHandler.handleEventProcessingError(
                err,
                'social-processing',
                data,
                `[TikTok Social] Error processing social event: ${getErrorMessage(err)}`
            );
        }
    }

    _inferSocialActionType(data: unknown, baseType = 'social'): string {
        const dataRecord = asRecord(data);
        const normalizedBaseType = String(baseType || 'social').toLowerCase();

        const common = asRecord(dataRecord.common);
        const displayText = asRecord(dataRecord.displayText || common.displayText);
        const defaultPattern = String(displayText.defaultPattern || dataRecord.label || '').toLowerCase();
        const displayType = String(displayText.displayType || dataRecord.displayType || '').toLowerCase();

        if (
            defaultPattern.includes('repost')
            || defaultPattern.includes('shared')
            || displayType.includes('repost')
            || displayType.includes('share')
        ) {
            return 'share';
        }

        if (defaultPattern.includes('follow') || displayType.includes('follow')) {
            return 'follow';
        }

        if (normalizedBaseType.includes('repost') || normalizedBaseType.includes('share')) {
            return 'share';
        }

        if (normalizedBaseType.includes('follow')) {
            return 'follow';
        }

        return normalizedBaseType;
    }

    getViewerCount(): number {
        return this.cachedViewerCount || 0;
    }

    async logRawPlatformData(eventType: string, data: unknown): Promise<unknown> {
        // Delegate to centralized service
        return this.chatFileLoggingService.logRawPlatformData('tiktok', eventType, data, this.config);
    }

    cleanupEventListeners() {
        cleanupTikTokEventListeners(this._createEventRouterPlatformAdapter());
    }

    async cleanup() {
        // Mark this as a planned disconnection to prevent unnecessary reconnection attempts
        this.isPlannedDisconnection = true;

        const connection = this.connection;
        if (connection && typeof connection.disconnect === 'function') {
            const hasStateFlags = ('isConnected' in connection) || ('isConnecting' in connection);
            const shouldDisconnect = hasStateFlags
                ? !!(connection.isConnected || connection.isConnecting)
                : true;
            if (shouldDisconnect) {
                try {
                    await connection.disconnect();
                } catch (error) {
                    this.errorHandler.handleCleanupError(
                        error,
                        'connection disconnect',
                    `Error disconnecting TikTok connection: ${getErrorMessage(error)}`
                    );
                }
            }
        }
        
        // Enhanced: Use IntervalManager for comprehensive cleanup
        try {
            const clearedIntervals = this.intervalManager.clearAllIntervals();
            if (clearedIntervals > 0) {
                this.logger.debug(`Cleared ${clearedIntervals} intervals during cleanup`, 'tiktok');
            }
        } catch (error) {
            this.errorHandler.handleCleanupError(
                error,
                'interval cleanup',
                `Error clearing intervals during cleanup: ${getErrorMessage(error)}`
            );
        }

        // Clean up event listeners BEFORE resetting connection
        this.cleanupEventListeners();
        this.listenersConfigured = false;

        // Use connection state manager for cleanup (Solution C pattern)
        this.connectionStateManager.cleanup();
        this.connectionStateManager.markDisconnected();
        
        // Clean up gift aggregation timers
        this.cleanupGiftAggregation();
        
        // Reset all connection-related state
        this.connection = null;
        this.connectionActive = false;
        this.connectionTime = 0;
        this.retryLock = false;
        this.initializationManager?.reset();
        this.initializationStats?.reset();
    }

    _normalizeUserData(data: unknown = {}): { userId: string; username: string } {
        const dataRecord = asRecord(data);
        const userId = typeof dataRecord.userId === 'string'
            ? dataRecord.userId.trim()
            : (typeof dataRecord.userId === 'number' ? String(dataRecord.userId) : null);
        const username = typeof dataRecord.username === 'string'
            ? dataRecord.username.trim()
            : (typeof dataRecord.username === 'number' ? String(dataRecord.username) : null);

        if (!userId) {
            throw new Error('Missing TikTok userId');
        }
        if (!username) {
            throw new Error('Missing TikTok username');
        }

        return {
            userId,
            username
        };
    }

    _buildEventMetadata(additionalMetadata: TikTokPayload = {}): TikTokPayload {
        return {
            platform: 'tiktok',
            correlationId: PlatformEvents._generateCorrelationId(),
            ...additionalMetadata
        };
    }

    _getTimestamp(data: unknown): string | null {
        return resolveTikTokTimestampISO(data);
    }

    _resolveAvatarUrl(data: unknown = {}): string {
        const dataRecord = asRecord(data);
        const payloadAvatarUrl = typeof dataRecord.avatarUrl === 'string' ? dataRecord.avatarUrl.trim() : '';
        if (payloadAvatarUrl) {
            return payloadAvatarUrl;
        }

        const extractedAvatarUrl = extractTikTokAvatarUrl(data);
        if (extractedAvatarUrl) {
            return extractedAvatarUrl;
        }

        return this.fallbackAvatarUrl;
    }

    _buildGiftErrorOverrides(data: unknown): GiftErrorOverrides {
        if (!data || typeof data !== 'object') {
            return {};
        }

        const dataRecord = asRecord(data);

        const normalizeString = (value: unknown): string | null => {
            if (typeof value === 'string') {
                const trimmed = value.trim();
                return trimmed ? trimmed : null;
            }
            if (typeof value === 'number') {
                const normalized = String(value).trim();
                return normalized ? normalized : null;
            }
            return null;
        };

        const user = asRecord(dataRecord.user);
        const userId = normalizeString(user.userId ?? dataRecord.userId);
        const username = normalizeString(user.uniqueId ?? dataRecord.username);
        const giftDetails = asRecord(dataRecord.giftDetails);
        const giftType = normalizeString(giftDetails?.giftName);

        const giftCountValue = Number(dataRecord.repeatCount);
        const giftCount = Number.isFinite(giftCountValue) && giftCountValue > 0 ? giftCountValue : null;

        const amountValue = Number(dataRecord.giftCoins ?? dataRecord.amount);
        const amount = Number.isFinite(amountValue) && amountValue > 0 ? amountValue : null;
        const currency = normalizeString(dataRecord.currency);

        const overrides: GiftErrorOverrides = {};
        if (userId) {
            overrides.userId = userId;
        }
        if (username) {
            overrides.username = username;
        }
        if (giftType) {
            overrides.giftType = giftType;
        }
        if (giftCount !== null) {
            overrides.giftCount = giftCount;
        }
        if (amount !== null) {
            overrides.amount = amount;
        }
        if (currency) {
            overrides.currency = currency;
        }

        return overrides;
    }

    _createMonetizationErrorPayload(notificationType: string, data: unknown, overrides: GiftErrorOverrides = {}) {
        const id = this._getPlatformMessageId(data);
        let timestamp = this._getTimestamp(data);
        if (!timestamp) {
            const error = new Error('Missing TikTok timestamp for monetization error payload');
            this.errorHandler.handleEventProcessingError(
                error,
                'monetization-timestamp',
                data,
                'Missing TikTok timestamp for monetization error payload, using fallback'
            );
            timestamp = getSystemTimestampISO();
        }
        const payloadOptions: TikTokPayload & { avatarUrl?: string } = {
            notificationType,
            platform: 'tiktok',
            timestamp,
            id: id || undefined,
            ...overrides
        };
        payloadOptions.avatarUrl = this._resolveAvatarUrl({
            ...(data || {}),
            avatarUrl: payloadOptions.avatarUrl
        });
        return createMonetizationErrorPayload(payloadOptions);
    }

    _getPlatformMessageId(data: unknown): string | null {
        if (!data || typeof data !== 'object') {
            return null;
        }

        const dataRecord = asRecord(data);
        const common = asRecord(dataRecord.common);
        const msgId = common.msgId;
        if (msgId == null) {
            return null;
        }

        const normalized = String(msgId).trim();
        return normalized || null;
    }

    _shouldSkipDuplicatePlatformMessage(data: unknown, ttlMs = this.deduplicationConfig?.ttlMs ?? 2 * 60 * 1000): { isDuplicate: boolean; cleanupPerformed: boolean } {
        const messageId = this._getPlatformMessageId(data);
        if (!messageId) {
            return { isDuplicate: false, cleanupPerformed: false };
        }

        const now = Date.now();
        const lastSeen = this.recentPlatformMessageIds.get(messageId);
        if (lastSeen && (now - lastSeen) < ttlMs) {
            return { isDuplicate: true, cleanupPerformed: false };
        }

        this.recentPlatformMessageIds.set(messageId, now);

        let cleanupPerformed = false;
        const maxCacheSize = this.deduplicationConfig?.maxCacheSize ?? 2000;
        if (this.recentPlatformMessageIds.size > maxCacheSize) {
            const cutoff = now - ttlMs;
            for (const [id, seenAt] of this.recentPlatformMessageIds.entries()) {
                if (seenAt < cutoff) {
                    this.recentPlatformMessageIds.delete(id);
                }
            }

            while (this.recentPlatformMessageIds.size > maxCacheSize) {
                const oldestKey = this.recentPlatformMessageIds.keys().next().value;
                if (!oldestKey) {
                    break;
                }
                this.recentPlatformMessageIds.delete(oldestKey);
            }
            cleanupPerformed = true;
        }

        return { isDuplicate: false, cleanupPerformed };
    }

    _shouldSkipDuplicateShareActor(userId: unknown): boolean {
        const normalizedUserId = typeof userId === 'string'
            ? userId.trim()
            : (typeof userId === 'number' ? String(userId).trim() : '');
        if (!normalizedUserId) {
            return false;
        }

        if (this.recentShareActors.has(normalizedUserId)) {
            return true;
        }

        this.recentShareActors.add(normalizedUserId);
        return false;
    }

    _resetShareActorTracking(reason: string): void {
        const trackedCount = this.recentShareActors.size;
        if (trackedCount === 0) {
            return;
        }

        this.recentShareActors.clear();
        this.logger.debug('[TikTok Share] Cleared tracked share actors', 'tiktok', {
            reason,
            trackedCount
        });
    }

    _handleEventProcessingError(emitType: string, data: unknown, error: unknown) {
        this.errorHandler.handleEventProcessingError(error, emitType, data);

        const monetizationTypes = new Set<string>([
            PlatformEvents.GIFT,
            PlatformEvents.PAYPIGGY,
            PlatformEvents.GIFTPAYPIGGY,
            PlatformEvents.ENVELOPE
        ]);

        if (!monetizationTypes.has(emitType)) {
            return { payloadEmitted: false, reason: 'non-monetization' };
        }

        let errorOverrides: GiftErrorOverrides = {};
        const dataRecord = asRecord(data);
        const hasCanonicalIdentity = dataRecord.userId !== undefined
            && dataRecord.userId !== null
            && dataRecord.username !== undefined
            && dataRecord.username !== null;

        if (hasCanonicalIdentity) {
            const normalizedUserId = String(dataRecord.userId).trim();
            const normalizedUsername = String(dataRecord.username).trim();
            if (normalizedUserId && normalizedUsername) {
                errorOverrides = {
                    username: normalizedUsername,
                    userId: normalizedUserId
                };
            }
        }

        if (!errorOverrides.userId) {
            try {
                const identity = extractTikTokUserData(data);
                errorOverrides = {
                    username: identity.username,
                    userId: identity.userId
                };
            } catch (_extractError) {
                errorOverrides = {};
            }
        }

        if (emitType === PlatformEvents.GIFT) {
            const amount = Number(dataRecord.giftCoins ?? dataRecord.amount);
            if (Number.isFinite(amount)) {
                errorOverrides.amount = amount;
            }
            const repeatCount = Number(dataRecord.giftCount ?? dataRecord.repeatCount);
            if (Number.isFinite(repeatCount)) {
                errorOverrides.giftCount = repeatCount;
            }
            if (typeof dataRecord.currency === 'string' && dataRecord.currency.trim()) {
                errorOverrides.currency = dataRecord.currency.trim();
            }
        }

        if (emitType === PlatformEvents.ENVELOPE) {
            const amount = Number(dataRecord.giftCoins ?? dataRecord.amount);
            if (Number.isFinite(amount)) {
                errorOverrides.amount = amount;
            }
            if (typeof dataRecord.currency === 'string' && dataRecord.currency.trim()) {
                errorOverrides.currency = dataRecord.currency.trim();
            }
        }

        const notificationType = typeof emitType === 'string' && emitType.startsWith('platform:')
            ? emitType.replace('platform:', '')
            : emitType;
        const errorPayload = this._createMonetizationErrorPayload(notificationType, data, errorOverrides);

        if (!errorPayload) {
            return { payloadEmitted: false, reason: 'invalid-payload' };
        }

        this._emitPlatformEvent(emitType, errorPayload);
        return { payloadEmitted: true };
    }

    async _handleStandardEvent(eventType: string, data: unknown, options: StandardEventOptions = {}) {
        const factoryMethod = options.factoryMethod || `create${this._capitalize(eventType)}`;
        const emitType = options.emitType || eventType;
        try {
            await this._logRawEvent(options.logEventType || emitType, data);
            const normalizedInput = {
                ...asRecord(data),
                avatarUrl: this._resolveAvatarUrl(data)
            };
            const eventFactoryMethod = getDynamicFactoryMethod(this.eventFactory, factoryMethod);
            if (!eventFactoryMethod) {
                throw new Error(`Missing TikTok event factory method: ${factoryMethod}`);
            }
            const eventData = eventFactoryMethod(normalizedInput, options);
            this._emitPlatformEvent(emitType, eventData);
            return { success: true };
        } catch (error) {
            return this._handleEventProcessingError(emitType, data, error);
        }
    }

    _capitalize(str = ''): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }


    async _handleChatMessage(data: unknown, normalizedData: TikTokPayload | null = null) {
        return this._handleStandardEvent('chatMessage', data, {
            factoryMethod: 'createChatMessage',
            emitType: PlatformEvents.CHAT_MESSAGE,
            normalizedData
        });
    }

    async _handleGift(data: TikTokGiftPayload) {
        return this._handleStandardEvent('gift', data, {
            factoryMethod: 'createGift',
            emitType: PlatformEvents.GIFT
        });
    }

    async _handleFollow(data: unknown) {
        try {
            const { username, userId } = extractTikTokUserData(data);

            if (!userId || !username) {
                this.logger.warn('[TikTok Follow] Missing canonical identity in follow event', 'tiktok', { data });
                return;
            }
            
            const timestamp = this._getTimestamp(data);
            if (!timestamp) {
                this.logger.warn('[TikTok Follow] Missing timestamp in follow event data', 'tiktok', { data });
                return;
            }

            const eventData = this.eventFactory.createFollow({
                username,
                userId,
                avatarUrl: this._resolveAvatarUrl(data),
                timestamp,
                metadata: {
                    platform: 'tiktok'
                }
            });

            this._emitPlatformEvent(PlatformEvents.FOLLOW, eventData);
        } catch (error) {
            this._handleError(error, { operation: 'handleFollow', data });
        }
    }

    async _handleShare(data: unknown) {
        try {
            const { username, userId } = extractTikTokUserData(data);

            if (!userId || !username) {
                this.logger.warn('[TikTok Share] Missing canonical identity in share event', 'tiktok', { data });
                return;
            }

            const timestamp = this._getTimestamp(data);
            if (!timestamp) {
                this.logger.warn('[TikTok Share] Missing timestamp in share event data', 'tiktok', { data });
                return;
            }

            if (this._shouldSkipDuplicateShareActor(userId)) {
                this.logger.debug('[TikTok Share] Suppressed duplicate share actor in current stream', 'tiktok', {
                    userId,
                    username
                });
                return;
            }

            const eventData = this.eventFactory.createShare({
                username,
                userId,
                avatarUrl: this._resolveAvatarUrl(data),
                timestamp,
                metadata: {
                    platform: 'tiktok'
                }
            });

            this._emitPlatformEvent(PlatformEvents.SHARE, eventData);
        } catch (error) {
            this._handleError(error, { operation: 'handleShare', data });
        }
    }

    async _handleConnection() {
        try {
            const eventData = this.eventFactory.createConnection();
            const eventPlatform = eventData.platform;
            this.emit('platform:event', {
                platform: eventPlatform,
                type: PlatformEvents.CHAT_CONNECTED,
                data: eventData
            });
            this._emitPlatformEvent(PlatformEvents.STREAM_STATUS, {
                platform: 'tiktok',
                isLive: true,
                timestamp: eventData.timestamp,
                metadata: eventData.metadata
            });
        } catch (error) {
            this._handleError(error, { operation: 'handleConnection' });
        }
    }

    async _handleDisconnection(reason: string, willReconnect: boolean | null = null) {
        try {
            const reconnectFlag = willReconnect !== null ? willReconnect : !!(!this.isPlannedDisconnection && this.config.enabled);
            const eventData = this.eventFactory.createDisconnection(reason, reconnectFlag);
            const eventPlatform = eventData.platform;
            this.emit('platform:event', {
                platform: eventPlatform,
                type: PlatformEvents.CHAT_DISCONNECTED,
                data: eventData
            });
            this._emitPlatformEvent(PlatformEvents.STREAM_STATUS, {
                platform: 'tiktok',
                isLive: false,
                reason,
                willReconnect: reconnectFlag,
                timestamp: eventData.timestamp,
                metadata: eventData.metadata
            });
        } catch (error) {
            this._handleError(error, { operation: 'handleDisconnection', reason });
        }
    }

  async _handleStreamEnd(payload: unknown = null) {
        // Prevent double-handling when both DISCONNECTED and STREAM_END fire (e.g., 4404)
        if (this._disconnectionInProgress) {
            this.logger.debug('Skipping stream-end handling: disconnection already in progress', 'tiktok');
            return;
        }
        this._disconnectionInProgress = true;

    try {
      const normalizedPayload = this._normalizeConnectionIssue(payload);
      const decision = this._classifyReconnectPolicy({
        message: normalizedPayload.message,
        code: normalizedPayload.code,
        source: 'stream-end',
      });
      const deferredContext = decision.isStreamNotLive ? 'stream-not-live-end' : 'stream-end';

      if (decision.shouldDeferReconnect) {
        this.isPlannedDisconnection = false;
        const deferredReconnect = this._ensureDeferredReconnectChecks(deferredContext);
        if (decision.isStreamNotLive && !deferredReconnect.scheduled && deferredReconnect.reason === 'already-active') {
          this.logger.debug('Deferred reconnect checks remain active after offline disconnect cycle', 'tiktok');
          return;
        }
      }

      if (decision.isStreamNotLive) {
        this._resetShareActorTracking('stream-not-live');
      } else {
        this.logger.info('TikTok stream ended; scheduling reconnect checks', 'tiktok');
        this._resetShareActorTracking('stream-end');
      }

      this.isPlannedDisconnection = false;
      this.connectionActive = false;
      this.connectionStateManager.markDisconnected();
      this.cleanupEventListeners();
      this.connection = null;
      const disconnectionReason = decision.isStreamNotLive ? 'Stream is not live' : 'stream-end';
      await this._handleDisconnection(disconnectionReason, decision.willReconnect);
        } finally {
            this._disconnectionInProgress = false;
        }
    }

    async _handleError(error: unknown, context: TikTokErrorContext): Promise<void> {
        try {
            const errorMessage = getErrorMessage(error);
            const eventData = this.eventFactory.createError(getErrorObject(error), {
                ...context,
                platform: 'tiktok',
                recoverable: !errorMessage.includes('fatal')
            });

            const eventPlatform = eventData.platform;
            this.emit('platform:event', {
                platform: eventPlatform,
                type: PlatformEvents.ERROR,
                data: eventData
            });

            const connectionOperations = ['handleConnection', 'handleDisconnection'];
            const isConnectionError = connectionOperations.includes(getOptionalString(context.operation) ?? '');

            if (isConnectionError) {
                this._emitPlatformEvent(PlatformEvents.STREAM_STATUS, {
                    platform: 'tiktok',
                    isLive: false,
                    error,
                    timestamp: eventData.timestamp,
                    metadata: eventData.metadata
                });
            }
        } catch (emitError) {
            this.errorHandler.handleEventProcessingError(
                emitError,
                'platform-error-event',
                null,
                'Error emitting platform error event:'
            );
        }
    }

    _emitPlatformEvent(type: string, payload: TikTokPayload): void {
        const platform = typeof payload.platform === 'string' ? payload.platform : 'tiktok';

        // Emit unified platform:event for local listeners
        this.emit('platform:event', { platform, type, data: payload });

        // Route event through injected handler to event bus
        const handlerMap: Partial<Record<TikTokEventType, DefaultHandlerName>> = {
            [PlatformEvents.CHAT_MESSAGE]: 'onChat',
            [PlatformEvents.GIFT]: 'onGift',
            [PlatformEvents.FOLLOW]: 'onFollow',
            [PlatformEvents.PAYPIGGY]: 'onPaypiggy',
            [PlatformEvents.RAID]: 'onRaid',
            [PlatformEvents.SHARE]: 'onShare',
            [PlatformEvents.ENVELOPE]: 'onEnvelope',
            [PlatformEvents.STREAM_STATUS]: 'onStreamStatus',
            [PlatformEvents.VIEWER_COUNT]: 'onViewerCount'
        };

        const handlerName = handlerMap[type as TikTokEventType];
        if (!handlerName) {
            return;
        }
        const handler = this.handlers?.[handlerName];

        if (typeof handler === 'function') {
            handler(payload);
        }
    }

    _createDefaultHandlers(): TikTokHandlers {
        const emitToBus = (type: string, data: unknown) => this._emitToEventBus(type, data);
        return {
            onChat: (data: unknown) => emitToBus(PlatformEvents.CHAT_MESSAGE, data),
            onViewerCount: (data: unknown) => emitToBus(PlatformEvents.VIEWER_COUNT, data),
            onGift: (data: unknown) => emitToBus(PlatformEvents.GIFT, data),
            onPaypiggy: (data: unknown) => emitToBus(PlatformEvents.PAYPIGGY, data),
            onFollow: (data: unknown) => emitToBus(PlatformEvents.FOLLOW, data),
            onShare: (data: unknown) => emitToBus(PlatformEvents.SHARE, data),
            onRaid: (data: unknown) => emitToBus(PlatformEvents.RAID, data),
            onEnvelope: (data: unknown) => emitToBus(PlatformEvents.ENVELOPE, data),
            onStreamStatus: (data: unknown) => emitToBus(PlatformEvents.STREAM_STATUS, data)
        };
    }

    _emitToEventBus(type: string, data: unknown): void {
        if (!this.eventBus || typeof this.eventBus.emit !== 'function') {
            return;
        }
        this.eventBus.emit('platform:event', {
            platform: 'tiktok',
            type,
            data
        });
    }
}

export { TikTokPlatform };
