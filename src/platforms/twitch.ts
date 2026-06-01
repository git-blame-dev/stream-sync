import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { DEFAULT_AVATAR_URL } from '../constants/avatar';
import { RawPlatformDataLoggingService } from '../services/RawPlatformDataLoggingService';
import { ConnectionStateFactory } from '../utils/platform-connection-state';
import { createTwitchEventFactory } from './twitch/events/event-factory';
import { createTwitchEventSubWiring } from './twitch/connections/wiring';
import { getUnifiedLogger } from '../core/logging';
import { UNKNOWN_CHAT_MESSAGE, UNKNOWN_CHAT_USERNAME } from '../constants/degraded-chat';
import { collectMissingFields, mergeMissingFieldsMetadata } from '../utils/missing-fields';
import { buildTwitchMessageParts, validateNormalizedMessage } from '../utils/message-normalization';
import { normalizeBadgeImages } from '../utils/message-parts';
import { createMonetizationErrorPayload } from '../utils/monetization-error-utils';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { resolveTwitchTimestampISO } from '../utils/platform-timestamp';
import { createRetrySystem } from '../utils/retry-system';
import { getSystemTimestampISO } from '../utils/timestamp';
import { TwitchApiClient } from '../utils/api-clients/twitch-api-client';
import { ViewerCountProviderFactory } from '../utils/viewer-count-providers';
import { TwitchEventSub } from './twitch-eventsub';

const PlatformEvents = {
CHAT_MESSAGE: 'platform:chat-message',
FOLLOW: 'platform:follow',
PAYPIGGY: 'platform:paypiggy',
GIFT: 'platform:gift',
GIFTPAYPIGGY: 'platform:giftpaypiggy',
RAID: 'platform:raid',
STREAM_STATUS: 'platform:stream-status',
PLATFORM_CONNECTION: 'platform:connection',
_generateCorrelationId: () => crypto.randomUUID(),
createConnectionEvent: (
platform: string,
status: 'connected' | 'disconnected',
error: Record<string, unknown> | Error | null = null
) => ({
type: 'platform:connection',
platform,
status,
isConnected: status === 'connected',
error,
timestamp: getSystemTimestampISO()
})
} as const;

type TwitchConfig = Record<string, unknown> & {
    enabled?: boolean;
    username?: string;
    channel?: string;
    clientId?: string;
    debug?: unknown;
    dataLoggingEnabled?: boolean;
};

type LoggerLike = {
    debug: (message: string, scope?: string, payload?: unknown) => void;
    info: (message: string, scope?: string, payload?: unknown) => void;
    warn: (message: string, scope?: string, payload?: unknown) => void;
    error: (message: string, scope?: string, payload?: unknown) => void;
};

type PlatformErrorHandlerLike = {
    handleDataLoggingError: (error: unknown, context: string) => void;
    handleEventProcessingError: (error: unknown, eventType: string, payload?: unknown, message?: string) => void;
    handleCleanupError: (error: unknown, context: string) => void;
    handleMessageSendError: (error: unknown, context: string) => void;
    handleConnectionError: (error: unknown, context: string, message?: string) => void;
    logOperationalError: (message: string, platform: string, payload?: unknown) => void;
};

type TwitchAuthLike = {
    isReady: () => boolean;
    refreshTokens?: () => Promise<boolean>;
};

type TwitchEventSubLike = {
    initialize: () => Promise<void>;
    on?: (eventName: string, handler: (...args: unknown[]) => void) => void;
    off?: (eventName: string, handler: (...args: unknown[]) => void) => void;
    removeListener?: (eventName: string, handler: (...args: unknown[]) => void) => void;
    removeAllListeners?: () => void;
    isConnected?: () => boolean;
    isActive?: () => boolean;
    sendMessage: (message: string) => Promise<void>;
    cleanup?: () => Promise<void> | void;
    disconnect?: () => Promise<void> | void;
};

type TwitchEventSubConstructor = new (
    config: Record<string, unknown>,
    dependencies: Record<string, unknown>
) => TwitchEventSubLike;

type TwitchApiClientLike = {
    getBroadcasterId: (channel: string) => Promise<string>;
    getStreamInfo: TwitchApiClient['getStreamInfo'];
    getGlobalChatBadges: () => Promise<unknown[]>;
    getChannelChatBadges: (broadcasterId: unknown) => Promise<unknown[]>;
    getCheermotes?: (broadcasterId: unknown) => Promise<unknown[]>;
    getUserById?: (userId: string) => Promise<unknown | null>;
    getViewerCount?: () => Promise<number>;
};

type TwitchApiClientConstructor = new (twitchAuth: TwitchAuthLike, config: TwitchConfig) => TwitchApiClientLike;

type ViewerCountProviderLike = {
    startPolling?: () => void;
    stopPolling?: () => void;
    getViewerCount: () => Promise<number>;
};

type RawPlatformDataLoggingServiceLike = {
    logRawPlatformData: (platform: string, eventType: string, data: unknown, config: TwitchConfig) => Promise<void>;
};

type RawPlatformDataLoggingServiceConstructor = new (options: {
    logger: LoggerLike;
    config: TwitchConfig;
}) => RawPlatformDataLoggingServiceLike;

type SelfMessageDetectionServiceLike = {
    shouldFilterMessage: (platform: string, messageData: Record<string, unknown>, config: TwitchConfig) => boolean;
};

type ValidationResult = {
    isValid: boolean;
    errors?: unknown;
};

type RetrySystemLike = {
    isConnected?: (platform: string) => boolean;
    handleConnectionError: (
        platform: string,
        error: Error,
        reconnect: () => Promise<void>,
        cleanup: () => Promise<void>,
        updateState: (platform: string, isConnected: boolean, connection: unknown, isConnecting: boolean) => void
    ) => void;
    handleConnectionSuccess?: (platform: string, connection: unknown, context: string) => void;
};

type EventSubListener = {
    eventName: string;
    handler: (...args: unknown[]) => void;
};

type EventSubWiringLike = {
    bindAll: (handlersByEventName: Record<string, unknown>) => void;
    unbindAll?: () => void;
};

type TwitchEventFactory = ReturnType<typeof createTwitchEventFactory>;
type TwitchFactoryMethod = keyof TwitchEventFactory;
type TwitchStandardEventType = 'follow' | 'paypiggy' | 'giftpaypiggy' | 'raid' | 'gift';

type TwitchPlatformDependencies = Record<string, unknown> & {
    TwitchEventSub?: TwitchEventSubConstructor;
    logger?: LoggerLike;
    twitchAuth?: TwitchAuthLike;
    retrySystem?: RetrySystemLike;
    RawPlatformDataLoggingService?: RawPlatformDataLoggingServiceConstructor;
    selfMessageDetectionService?: SelfMessageDetectionServiceLike | null;
    validateNormalizedMessage?: (data: Record<string, unknown>) => ValidationResult;
    getErrorEnvelopeTimestampISO?: () => string;
    TwitchApiClient?: TwitchApiClientConstructor;
    avatarCacheMaxSize?: number;
    axios?: unknown;
    WebSocketCtor?: unknown;
};

type PlatformHandlers = Record<string, ((payload: unknown) => void) | undefined>;

type BadgeCatalogCache = {
    broadcasterId: string;
    global: unknown[];
    channel: unknown[];
    loaded: boolean;
};

type CheermoteCatalogCache = {
    broadcasterId: string;
    catalog: unknown[];
    loaded: boolean;
};

type ChatMessagePayload = Record<string, unknown> & {
    message: Record<string, unknown>;
};

type StandardEventOptions = {
    validateUser?: boolean;
    emitEventType?: string;
    factoryMethod?: TwitchFactoryMethod;
    logEventType?: string;
};

type TwitchBadgeSet = Record<string, unknown> & {
    set_id?: unknown;
    versions?: unknown;
};

type TwitchBadgeVersion = Record<string, unknown> & {
    id?: unknown;
    image_url_4x?: unknown;
    title?: unknown;
};

type CheermoteTier = Record<string, unknown> & {
    id?: unknown;
    images?: unknown;
};

type CheermoteEntry = Record<string, unknown> & {
    prefix?: unknown;
    tiers?: unknown;
};

type CheermoteInfo = Record<string, unknown> & {
    cleanPrefix?: unknown;
    prefix?: unknown;
    tier?: unknown;
    isMixed?: unknown;
    types?: unknown;
};

type GiftEventData = Record<string, unknown> & {
    giftImageUrl?: unknown;
    currency?: unknown;
    cheermoteInfo?: unknown;
};

type ConnectionEventPayload = Record<string, unknown> & ReturnType<typeof PlatformEvents.createConnectionEvent> & {
    willReconnect?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object';

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const asRecord = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};

class TwitchPlatform extends EventEmitter {
    TwitchEventSub: TwitchEventSubConstructor;
    logger: LoggerLike;
    errorHandler: PlatformErrorHandlerLike;
    dependencies: TwitchPlatformDependencies;
    retrySystem: RetrySystemLike | null;
    isConnected: boolean;
    isPlannedDisconnection: boolean;
    recoveryInFlight: boolean;
    config: TwitchConfig;
    twitchAuth: TwitchAuthLike;
    rawPlatformDataLoggingService: RawPlatformDataLoggingServiceLike;
    selfMessageDetectionService: SelfMessageDetectionServiceLike | null;
    validateNormalizedMessage: (data: Record<string, unknown>) => ValidationResult;
    getErrorEnvelopeTimestampISO: () => string;
    platformName: 'twitch';
    eventSub: TwitchEventSubLike | null;
    eventSubListeners: EventSubListener[];
    eventSubWiring: EventSubWiringLike | null;
    handlers: PlatformHandlers;
    apiClient: TwitchApiClientLike | null;
    viewerCountProvider: ViewerCountProviderLike | null;
    avatarUrlCache: Map<string, string>;
    avatarLookupMissCache: Set<string>;
    badgeCatalogCache: BadgeCatalogCache;
    broadcasterId: string;
    cheermoteCatalogCache: CheermoteCatalogCache;
    avatarCacheMaxSize: number;
    fallbackAvatarUrl: string;
    isConnecting: boolean;
    eventFactory: TwitchEventFactory;

    constructor(config: TwitchConfig, dependencies: TwitchPlatformDependencies = {}) {
        super();

        this.TwitchEventSub = dependencies.TwitchEventSub || (TwitchEventSub as unknown as TwitchEventSubConstructor);

        this.logger = dependencies.logger || getUnifiedLogger();
        this.errorHandler = createPlatformErrorHandler(this.logger, 'twitch');
        this.dependencies = { ...dependencies };
        this.retrySystem = dependencies.retrySystem || (createRetrySystem({ logger: this.logger }) as unknown as RetrySystemLike);

        this.isConnected = false;
        this.isPlannedDisconnection = false;
        this.recoveryInFlight = false;

        this.config = config;

        const twitchAuth = dependencies.twitchAuth;
        if (!twitchAuth) {
            throw new Error('TwitchPlatform requires twitchAuth via dependency injection.');
        }
        this.twitchAuth = twitchAuth;

        const RawPlatformDataLoggingServiceClass = dependencies.RawPlatformDataLoggingService || (RawPlatformDataLoggingService as unknown as RawPlatformDataLoggingServiceConstructor);
        this.rawPlatformDataLoggingService = new RawPlatformDataLoggingServiceClass({
            logger: this.logger,
            config: this.config
        });

        this.selfMessageDetectionService = dependencies.selfMessageDetectionService || null;

        this.validateNormalizedMessage = dependencies.validateNormalizedMessage || validateNormalizedMessage;
        this.getErrorEnvelopeTimestampISO = typeof dependencies.getErrorEnvelopeTimestampISO === 'function'
            ? dependencies.getErrorEnvelopeTimestampISO
            : getSystemTimestampISO;

        this.platformName = 'twitch';
        this.eventSub = null;
        this.eventSubListeners = [];
        this.eventSubWiring = null;
        this.handlers = {};

        this.apiClient = null;
        this.viewerCountProvider = null;
        this.avatarUrlCache = new Map();
        this.avatarLookupMissCache = new Set();
        this.badgeCatalogCache = {
            broadcasterId: '',
            global: [],
            channel: [],
            loaded: false
        };
        this.broadcasterId = '';
        this.cheermoteCatalogCache = {
            broadcasterId: '',
            catalog: [],
            loaded: false
        };
        this.avatarCacheMaxSize = Number.isFinite(Number(dependencies.avatarCacheMaxSize)) && Number(dependencies.avatarCacheMaxSize) > 0
            ? Number(dependencies.avatarCacheMaxSize)
            : 2000;
        this.fallbackAvatarUrl = DEFAULT_AVATAR_URL;

        this.isConnecting = false;

        if (this.retrySystem && typeof this.retrySystem === 'object') {
            this.retrySystem.isConnected = (platform: string) => {
                if (platform !== this.platformName) {
                    return false;
                }

                return !!(this.eventSub?.isActive?.() || this.isConnected);
            };
        }

        this.eventFactory = createTwitchEventFactory({
            platformName: this.platformName
        });
    }

    async initializeEventSub(broadcasterId: string): Promise<void> {
        this.logger.debug('initializeEventSub called', 'twitch', {
            authReady: this.twitchAuth?.isReady?.(),
            hasTwitchAuth: !!this.twitchAuth,
            broadcasterId
        });

        if (!this.twitchAuth.isReady()) {
            throw new Error('Twitch authentication is not ready');
        }

        try {
            this.logger.debug('Creating TwitchEventSub instance...', 'twitch');
            this.eventSub = new this.TwitchEventSub({ ...this.config, broadcasterId }, {
                logger: this.logger,
                twitchAuth: this.twitchAuth,
                axios: this.dependencies?.axios,
                WebSocketCtor: this.dependencies?.WebSocketCtor
            });
            this.logger.debug('TwitchEventSub instance created, calling initialize()...', 'twitch');
            await this.eventSub.initialize();
            this.logger.debug('TwitchEventSub initialize() completed', 'twitch');
        } catch (error) {
            this.eventSub = null;
            this._logPlatformError('Failed to initialize EventSub', error, 'eventsub-init', {
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }

    _clearEventSubWiringState(): void {
        this.eventSubWiring?.unbindAll?.();
        this.eventSubListeners.length = 0;
        this.eventSubWiring = null;
    }

    async initialize(handlers: Record<string, ((payload: unknown) => void) | undefined> = {}) {
        if (!this.config.enabled) {
            this.logger.info('Platform is disabled in config', 'twitch');
            return;
        }

        this.isPlannedDisconnection = false;
        this.handlers = handlers || {};
        this.isConnecting = true;

        this._clearEventSubWiringState();

        try {
            this.logger.debug('Using centralized Twitch auth...', 'twitch', {
                authReady: this.twitchAuth?.isReady?.(),
                hasTwitchAuth: !!this.twitchAuth
            });
            if (!this.twitchAuth.isReady()) {
                throw new Error('Twitch authentication is not ready');
            }

            const TwitchApiClientClass = this.dependencies.TwitchApiClient || (TwitchApiClient as unknown as TwitchApiClientConstructor);
            this.apiClient = new TwitchApiClientClass(this.twitchAuth, this.config);
            this.viewerCountProvider = ViewerCountProviderFactory.createTwitchProvider(
                this.apiClient,
                ConnectionStateFactory,
                this.config,
                () => this.eventSub
            ) as unknown as ViewerCountProviderLike;
            this.logger.debug('Modular components initialized', 'twitch');

            const broadcasterId = await this.apiClient.getBroadcasterId(this.config.channel || '');
            this.broadcasterId = broadcasterId;

            this.logger.debug('Initializing EventSub with centralized auth...', 'twitch');
            await this.initializeEventSub(broadcasterId);
            this.logger.debug('EventSub initialization completed', 'twitch', {
                eventSubExists: !!this.eventSub,
                eventSubConnected: this.eventSub?.isConnected?.(),
                eventSubActive: this.eventSub?.isActive?.()
            });

            if (!this.eventSub) {
                const error = new Error('Twitch EventSub initialization failed: connection not established');
                this._logPlatformError('EventSub unavailable after initialization', error, 'platform-init');
                throw error;
            }

            if (typeof this.eventSub.on !== 'function') {
                const error = new Error('Twitch EventSub connection missing event emitter interface (on)');
                this._logPlatformError('EventSub missing event emitter methods', error, 'platform-init');
                throw error;
            }

            if (typeof this.eventSub.isConnected !== 'function') {
                const error = new Error('Twitch EventSub connection missing isConnected()');
                this._logPlatformError('EventSub missing connectivity method', error, 'platform-init');
                throw error;
            }

            if (typeof this.eventSub.isActive !== 'function') {
                const error = new Error('Twitch EventSub connection missing isActive()');
                this._logPlatformError('EventSub missing active-state method', error, 'platform-init');
                throw error;
            }

            if (!this.eventSub.isConnected()) {
                const error = new Error('Twitch EventSub initialization failed: connection is not active');
                this._logPlatformError('EventSub not active after initialization', error, 'platform-init');
                throw error;
            }

            if (!this.eventSub.isActive()) {
                const error = new Error('Twitch EventSub initialization failed: subscriptions are not active');
                this._logPlatformError('EventSub subscriptions not active after initialization', error, 'platform-init');
                throw error;
            }

            this.eventSubWiring = createTwitchEventSubWiring({
                eventSub: this.eventSub,
                eventSubListeners: this.eventSubListeners,
                logger: this.logger
            });
            this.eventSubWiring.bindAll({
                chatMessage: (data: unknown) => this.onMessageHandler(isRecord(data) ? data : {}),
                follow: (data: unknown) => this.handleFollowEvent(isRecord(data) ? data : {}),
                paypiggy: (data: unknown) => this.handlePaypiggyEvent(isRecord(data) ? data : {}),
                paypiggyMessage: (data: unknown) => this.handlePaypiggyMessageEvent(isRecord(data) ? data : {}),
                paypiggyGift: (data: unknown) => this.handlePaypiggyGiftEvent(isRecord(data) ? data : {}),
                raid: (data: unknown) => this.handleRaidEvent(isRecord(data) ? data : {}),
                gift: (data: unknown) => this.handleGiftEvent(isRecord(data) ? data : {}),
                streamOnline: (data: unknown) => this.handleStreamOnlineEvent(isRecord(data) ? data : {}),
                streamOffline: (data: unknown) => this.handleStreamOfflineEvent(isRecord(data) ? data : {}),
                eventSubConnected: (details: unknown = {}) => this._handleEventSubConnectionChange(true, isRecord(details) ? details : {}),
                eventSubDisconnected: (details: unknown = {}) => this._handleEventSubConnectionChange(false, isRecord(details) ? details : {})
            });

            this.logger.debug('Using EventSub for chat messages', 'twitch', {
                username: this.config.username,
                channel: this.config.channel
            });

            this.logger.info('Twitch platform initialized with EventSub WebSocket', 'twitch');
            this.isConnected = this.eventSub?.isActive?.() || false;
            this.isConnecting = false;

        } catch (error) {
            this._logPlatformError('Failed to initialize Twitch platform', error, 'platform-init');
            this._clearEventSubWiringState();
            this.eventSub = null;
            this.isConnected = false;
            this.isConnecting = false;
            this.recoveryInFlight = false;
            throw error;
        }
    }

    async onMessageHandler(event: Record<string, unknown>): Promise<void> {
        const isSelf = event?.broadcaster_user_id && event?.chatter_user_id
            ? event.broadcaster_user_id === event.chatter_user_id
            : false;

        if (this.selfMessageDetectionService) {
            const messageData = {
                self: isSelf,
                username: event?.chatter_user_name
            };
            if (this.selfMessageDetectionService.shouldFilterMessage('twitch', messageData, this.config)) {
                return;
            }
        } else {
            if (isSelf) return;
        }

        try {
            await this._logRawEvent('chat', event);
        } catch (loggingError) {
            this.errorHandler.handleDataLoggingError(loggingError, 'chat');
        }

        try {
            const userId = typeof event?.chatter_user_id === 'string' ? event.chatter_user_id.trim() : '';
            const username = typeof event?.chatter_user_name === 'string' ? event.chatter_user_name.trim() : '';
            const eventMessage = isRecord(event.message) ? event.message : {};
            const normalizedMessage = typeof eventMessage.text === 'string' ? eventMessage.text.trim() : '';
            const messageParts = buildTwitchMessageParts(eventMessage);
            const timestamp = event?.timestamp;
            const missingFields = collectMissingFields({
                userId: !!userId,
                username: !!username,
                message: !!normalizedMessage || messageParts.length > 0,
                timestamp: typeof timestamp === 'string' && timestamp.trim().length > 0
            });

            const badges: Record<string, unknown> = Array.isArray(event?.badges)
                ? event.badges.reduce<Record<string, unknown>>((acc, badge) => {
                    const badgeRecord = isRecord(badge) ? badge : {};
                    const setId = typeof badgeRecord.set_id === 'string' ? badgeRecord.set_id.trim() : '';
                    if (!setId) {
                        return acc;
                    }
                    acc[setId] = badgeRecord.id;
                    return acc;
                }, {})
                : (isRecord(event?.badges) ? event.badges : {});
            const hasBadge = (badgeName: string): boolean => {
                if (!Object.prototype.hasOwnProperty.call(badges, badgeName)) {
                    return false;
                }

                const badgeValue = badges[badgeName];
                if (badgeValue === true || badgeValue === 1 || badgeValue === '1') {
                    return true;
                }

                if (typeof badgeValue === 'string') {
                    const normalizedBadgeValue = badgeValue.trim();
                    return normalizedBadgeValue.length > 0 && normalizedBadgeValue !== '0';
                }

                return false;
            };
            const isMod = hasBadge('moderator');
            const hasSubscriberBadge = Object.prototype.hasOwnProperty.call(badges, 'subscriber');
            const hasFounderBadge = Object.prototype.hasOwnProperty.call(badges, 'founder');
            const isPaypiggy = hasSubscriberBadge || hasFounderBadge;

            const normalizedData: Record<string, unknown> & {
                platform: 'twitch';
                username: string;
                message: string;
                userId?: string;
                timestamp?: string;
                isMod: boolean;
                isPaypiggy: boolean;
                isBroadcaster: boolean;
                badgeImages?: unknown[];
                avatarUrl?: string;
            } = {
                platform: this.platformName,
                ...(userId ? { userId } : {}),
                username: username || UNKNOWN_CHAT_USERNAME,
                message: normalizedMessage || (messageParts.length > 0 ? '' : UNKNOWN_CHAT_MESSAGE),
                ...(typeof timestamp === 'string' && timestamp.trim().length > 0 ? { timestamp } : {}),
                isMod,
                isPaypiggy,
                isBroadcaster: isSelf,
                metadata: mergeMissingFieldsMetadata({
                    badges,
                    color: event?.color ?? null,
                    emotes: isRecord(eventMessage.emotes)
                        ? eventMessage.emotes
                        : {},
                    roomId: event?.broadcaster_user_id ?? null
                }, missingFields, {
                    ...(typeof timestamp === 'string' && timestamp.trim().length > 0 ? { sourceTimestamp: timestamp } : {})
                }),
                rawData: { event }
            };
            normalizedData.badgeImages = await this._resolveBadgeImages(event);
            normalizedData.avatarUrl = await this._resolveAvatarUrl(normalizedData);

            const validation = this.validateNormalizedMessage(normalizedData);

            if (!validation.isValid) {
                this.logger.warn('Message normalization validation failed', 'twitch', {
                    issues: validation.errors,
                    eventKeys: event && typeof event === 'object' ? Object.keys(event).sort() : [],
                    hasMessage: typeof normalizedData.message === 'string' && normalizedData.message.length > 0
                });
            }

            try {
                const eventData: ChatMessagePayload = {
                    type: PlatformEvents.CHAT_MESSAGE,
                    platform: this.platformName,
                    username: normalizedData.username,
                    ...(normalizedData.userId ? { userId: normalizedData.userId } : {}),
                    avatarUrl: normalizedData.avatarUrl,
                    message: {
                        text: normalizedData.message
                    },
                    ...(normalizedData.timestamp ? { timestamp: normalizedData.timestamp } : {}),
                    isMod: normalizedData.isMod,
                    isPaypiggy: normalizedData.isPaypiggy,
                    isBroadcaster: normalizedData.isBroadcaster,
                    badgeImages: Array.isArray(normalizedData.badgeImages) ? normalizedData.badgeImages : [],
                    metadata: mergeMissingFieldsMetadata({
                        platform: this.platformName,
                        isMod: normalizedData.isMod,
                        isPaypiggy: normalizedData.isPaypiggy,
                        isBroadcaster: normalizedData.isBroadcaster,
                        correlationId: PlatformEvents._generateCorrelationId()
                    }, missingFields, {
                        ...(normalizedData.timestamp ? { sourceTimestamp: normalizedData.timestamp } : {})
                    })
                };
                if (messageParts.length > 0) {
                    eventData.message.parts = messageParts;
                }
                this._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, eventData);
            } catch (messageError) {
                this._logPlatformError(`Error emitting chat message event: ${getErrorMessage(messageError)}`, messageError, 'chat-message-emission');
            }
        } catch (error) {
            this._logPlatformError(`Error processing chat message: ${getErrorMessage(error)}`, error, 'chat-message-processing');
        }
    }

    _capitalize(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    _normalizeBadgeKeyList(event: Record<string, unknown> = {}): Array<{ setId: string; version: string; info: string }> {
        if (Array.isArray(event.badges)) {
            return event.badges
                .filter(isRecord)
                .map((badge) => ({
                    setId: typeof badge.set_id === 'string' ? badge.set_id.trim() : '',
                    version: badge.id === undefined || badge.id === null ? '' : String(badge.id).trim(),
                    info: badge.info === undefined || badge.info === null ? '' : String(badge.info).trim()
                }))
                .filter((badge) => badge.setId && badge.version);
        }

        if (event.badges && typeof event.badges === 'object') {
            return Object.entries(event.badges)
                .map(([setId, version]) => ({
                    setId: typeof setId === 'string' ? setId.trim() : '',
                    version: version === undefined || version === null ? '' : String(version).trim(),
                    info: ''
                }))
                .filter((badge) => badge.setId && badge.version);
        }

        return [];
    }

    async _ensureBadgeCatalogs(broadcasterUserId = '', forceReload = false) {
        if (!this.apiClient) {
            return;
        }

        const broadcasterId = typeof broadcasterUserId === 'string' ? broadcasterUserId.trim() : '';
        if (!forceReload && this.badgeCatalogCache.loaded && this.badgeCatalogCache.broadcasterId === broadcasterId) {
            return;
        }

        this.badgeCatalogCache.global = await this.apiClient.getGlobalChatBadges();
        this.badgeCatalogCache.channel = broadcasterId
            ? await this.apiClient.getChannelChatBadges(broadcasterId)
            : [];
        this.badgeCatalogCache.broadcasterId = broadcasterId;
        this.badgeCatalogCache.loaded = true;
    }

    async _ensureCheermoteCatalog(forceReload = false) {
        if (!this.apiClient || typeof this.apiClient.getCheermotes !== 'function') {
            return;
        }

        const broadcasterId = typeof this.broadcasterId === 'string' ? this.broadcasterId.trim() : '';
        if (!forceReload
            && this.cheermoteCatalogCache.loaded
            && this.cheermoteCatalogCache.broadcasterId === broadcasterId) {
            return;
        }

        this.cheermoteCatalogCache.catalog = await this.apiClient.getCheermotes(broadcasterId);
        this.cheermoteCatalogCache.broadcasterId = broadcasterId;
        this.cheermoteCatalogCache.loaded = true;
    }

    _hasMixedCheermotes(cheermoteInfo: unknown = {}): boolean {
        if (!isRecord(cheermoteInfo)) {
            return false;
        }
        if (cheermoteInfo.isMixed === true) {
            return true;
        }
        if (Array.isArray(cheermoteInfo.types) && cheermoteInfo.types.length > 1) {
            return true;
        }
        return false;
    }

    _resolveCheermoteTierImageUrl(tierData: CheermoteTier = {}): string {
        const images = asRecord(tierData.images);
        const darkImages = asRecord(images.dark);
        const animatedImages = asRecord(darkImages.animated);
        const imageUrl = typeof animatedImages['3'] === 'string'
            ? animatedImages['3'].trim()
            : '';
        return imageUrl;
    }

    _resolveCheermoteImageFromCatalog(cheermoteInfo: CheermoteInfo = {}): string {
        const prefixValue = typeof cheermoteInfo.cleanPrefix === 'string' && cheermoteInfo.cleanPrefix.trim()
            ? cheermoteInfo.cleanPrefix.trim()
            : (typeof cheermoteInfo.prefix === 'string' ? cheermoteInfo.prefix.trim() : '');
        const normalizedPrefix = prefixValue.toLowerCase();
        if (!normalizedPrefix) {
            return '';
        }

        const parsedTier = Number(cheermoteInfo.tier);
        if (!Number.isFinite(parsedTier) || parsedTier <= 0) {
            return '';
        }
        const normalizedTier = String(parsedTier);

        const catalog: CheermoteEntry[] = Array.isArray(this.cheermoteCatalogCache.catalog)
            ? this.cheermoteCatalogCache.catalog.filter(isRecord)
            : [];
        const cheermoteEntry = catalog.find((entry) => {
            const entryPrefix = typeof entry?.prefix === 'string' ? entry.prefix.trim().toLowerCase() : '';
            return entryPrefix === normalizedPrefix;
        });
        if (!cheermoteEntry || !Array.isArray(cheermoteEntry.tiers)) {
            return '';
        }

        const tiers = cheermoteEntry.tiers.filter(isRecord) as CheermoteTier[];
        const tierEntry = tiers.find((tierEntryCandidate) => {
            const tierId = tierEntryCandidate?.id === undefined || tierEntryCandidate?.id === null
                ? ''
                : String(tierEntryCandidate.id).trim();
            return tierId === normalizedTier;
        });
        if (!tierEntry) {
            return '';
        }

        return this._resolveCheermoteTierImageUrl(tierEntry);
    }

    async _resolveGiftCheermoteImageUrl(giftData: GiftEventData = {}): Promise<string> {
        if (!isRecord(giftData)) {
            return '';
        }

        const existingGiftImageUrl = typeof giftData.giftImageUrl === 'string'
            ? giftData.giftImageUrl.trim()
            : '';
        if (existingGiftImageUrl) {
            return existingGiftImageUrl;
        }

        const currency = typeof giftData.currency === 'string' ? giftData.currency.trim().toLowerCase() : '';
        if (currency !== 'bits') {
            return '';
        }

        const cheermoteInfo = isRecord(giftData.cheermoteInfo) ? giftData.cheermoteInfo as CheermoteInfo : null;
        if (!cheermoteInfo || this._hasMixedCheermotes(cheermoteInfo)) {
            return '';
        }

        try {
            await this._ensureCheermoteCatalog(false);
            let imageUrl = this._resolveCheermoteImageFromCatalog(cheermoteInfo);
            if (!imageUrl) {
                await this._ensureCheermoteCatalog(true);
                imageUrl = this._resolveCheermoteImageFromCatalog(cheermoteInfo);
            }
            return imageUrl;
        } catch (error) {
            this.errorHandler.handleEventProcessingError(
                error,
                'cheermote-image-resolution',
                giftData,
                'Failed to resolve Twitch cheermote image URL, continuing without inline image'
            );
            return '';
        }
    }

    async _enrichGiftPayload(giftData: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        if (!isRecord(giftData)) {
            return giftData;
        }

        const giftImageUrl = await this._resolveGiftCheermoteImageUrl(giftData);
        if (!giftImageUrl) {
            return giftData;
        }

        return {
            ...giftData,
            giftImageUrl
        };
    }

    _findBadgeVersion(catalog: unknown[] = [], setId = '', version = ''): TwitchBadgeVersion | null {
        if (!Array.isArray(catalog) || !setId || !version) {
            return null;
        }
        const set = catalog.filter(isRecord).find((entry): entry is TwitchBadgeSet => entry.set_id === setId);
        if (!set || !Array.isArray(set.versions)) {
            return null;
        }
        return set.versions.filter(isRecord).find((entry): entry is TwitchBadgeVersion => String(entry.id) === version) || null;
    }

    async _resolveBadgeImages(event: Record<string, unknown> = {}): Promise<unknown[]> {
        const badgeKeys = this._normalizeBadgeKeyList(event);
        if (badgeKeys.length === 0) {
            return [];
        }

        try {
            const broadcasterUserId = typeof event.broadcaster_user_id === 'string' ? event.broadcaster_user_id : '';
            await this._ensureBadgeCatalogs(broadcasterUserId);
            const resolveFromCache = () => {
                const resolved: Array<Record<string, unknown>> = [];
                const unresolved: Array<{ setId: string; version: string; info: string }> = [];

                for (const badge of badgeKeys) {
                    const fromChannel = this._findBadgeVersion(this.badgeCatalogCache.channel, badge.setId, badge.version);
                    const fromGlobal = this._findBadgeVersion(this.badgeCatalogCache.global, badge.setId, badge.version);
                    const version = fromChannel || fromGlobal;
                    const imageUrl = typeof version?.image_url_4x === 'string' ? version.image_url_4x.trim() : '';
                    if (!imageUrl) {
                        unresolved.push(badge);
                        continue;
                    }
                    resolved.push({
                        imageUrl,
                        source: 'twitch',
                        label: typeof version?.title === 'string' ? version.title : `${badge.setId}:${badge.version}`
                    });
                }

                return { resolved, unresolved };
            };

            let { resolved, unresolved } = resolveFromCache();
            if (unresolved.length > 0) {
                await this._ensureBadgeCatalogs(broadcasterUserId, true);
                ({ resolved } = resolveFromCache());
            }

            return normalizeBadgeImages(resolved);
        } catch (error) {
            this.errorHandler.handleEventProcessingError(
                error,
                'badge-resolution',
                event,
                'Failed to resolve Twitch chat badge images, continuing without badge images'
            );
            return [];
        }
    }

    _getTimestamp(data: Record<string, unknown>): ReturnType<typeof resolveTwitchTimestampISO> {
        return resolveTwitchTimestampISO(data);
    }

    _getAvatarCacheKey(userId: unknown): string {
        const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
        if (!normalizedUserId) {
            return '';
        }
        return `twitch:${normalizedUserId}`;
    }

    _setCachedAvatarUrl(cacheKey: string, avatarUrl: string): void {
        if (!cacheKey || !avatarUrl) {
            return;
        }

        this.avatarUrlCache.set(cacheKey, avatarUrl);
        while (this.avatarUrlCache.size > this.avatarCacheMaxSize) {
            const oldestKey = this.avatarUrlCache.keys().next().value;
            if (!oldestKey) {
                break;
            }
            this.avatarUrlCache.delete(oldestKey);
        }
    }

    _setAvatarLookupMiss(cacheKey: string): void {
        if (!cacheKey) {
            return;
        }

        this.avatarLookupMissCache.add(cacheKey);
        while (this.avatarLookupMissCache.size > this.avatarCacheMaxSize) {
            const oldestKey = this.avatarLookupMissCache.values().next().value;
            if (!oldestKey) {
                break;
            }
            this.avatarLookupMissCache.delete(oldestKey);
        }
    }

    async _resolveAvatarUrl(data: Record<string, unknown> = {}): Promise<string> {
        const payloadAvatarUrl = typeof data?.avatarUrl === 'string' ? data.avatarUrl.trim() : '';
        const userId = typeof data?.userId === 'string'
            ? data.userId.trim()
            : (typeof data?.chatter_user_id === 'string' ? data.chatter_user_id.trim() : '');
        const cacheKey = this._getAvatarCacheKey(userId);

        if (payloadAvatarUrl) {
            if (cacheKey) {
                this._setCachedAvatarUrl(cacheKey, payloadAvatarUrl);
                this.avatarLookupMissCache.delete(cacheKey);
            }
            return payloadAvatarUrl;
        }

        if (cacheKey && this.avatarUrlCache.has(cacheKey)) {
            return this.avatarUrlCache.get(cacheKey) || this.fallbackAvatarUrl;
        }

        if (cacheKey && this.avatarLookupMissCache.has(cacheKey)) {
            return this.fallbackAvatarUrl;
        }

        if (userId && this.apiClient && typeof this.apiClient.getUserById === 'function') {
            try {
                const user = await this.apiClient.getUserById(userId);
                const userRecord = asRecord(user);
                const resolvedAvatarUrl = typeof userRecord.profile_image_url === 'string'
                    ? userRecord.profile_image_url.trim()
                    : '';
                if (resolvedAvatarUrl) {
                    if (cacheKey) {
                        this._setCachedAvatarUrl(cacheKey, resolvedAvatarUrl);
                        this.avatarLookupMissCache.delete(cacheKey);
                    }
                    return resolvedAvatarUrl;
                }
                if (cacheKey) {
                    this._setAvatarLookupMiss(cacheKey);
                }
            } catch (error) {
                this.errorHandler.handleEventProcessingError(
                    error,
                    'avatar-lookup',
                    data,
                    'Failed to resolve Twitch avatar, using fallback'
                );
                if (cacheKey) {
                    this._setAvatarLookupMiss(cacheKey);
                }
            }
        }

        return this.fallbackAvatarUrl;
    }

    _getErrorEnvelopeTimestamp(): string {
        return this.getErrorEnvelopeTimestampISO();
    }

    _resolveFactoryMethod(eventType: TwitchStandardEventType): TwitchFactoryMethod {
        const mapping: Record<TwitchStandardEventType, TwitchFactoryMethod> = {
            follow: 'createFollowEvent',
            paypiggy: 'createPaypiggyEvent',
            giftpaypiggy: 'createGiftPaypiggyEvent',
            raid: 'createRaidEvent',
            gift: 'createGiftEvent'
        };

        return mapping[eventType];
    }

    async _handleStandardEvent(eventType: TwitchStandardEventType, data: Record<string, unknown>, options: StandardEventOptions = {}): Promise<void> {
        const payloadTimestamp = this._getTimestamp(data);
        const errorNotificationType = eventType === 'gift'
            ? 'gift'
            : (eventType === 'paypiggy' || eventType === 'giftpaypiggy' ? eventType : null);
        const buildErrorOverrides = (avatarUrl: string): Record<string, unknown> => {
            const baseOverrides: Record<string, unknown> = {
                username: data?.username,
                userId: data?.userId,
                avatarUrl,
                missingFields: this._getMonetizationMissingFields(eventType, data, payloadTimestamp),
                sourceTimestamp: payloadTimestamp
            };
            if (errorNotificationType === 'gift') {
                if (typeof data?.giftType === 'string' && data.giftType.trim()) {
                    baseOverrides.giftType = data.giftType;
                }
                if (Number.isFinite(Number(data?.giftCount))) {
                    baseOverrides.giftCount = Number(data.giftCount);
                }
                if (Number.isFinite(Number(data?.amount))) {
                    baseOverrides.amount = Number(data.amount);
                }
                if (typeof data?.currency === 'string' && data.currency.trim()) {
                    baseOverrides.currency = data.currency;
                }
            }
            if (errorNotificationType === 'giftpaypiggy') {
                if (Number.isFinite(Number(data?.giftCount))) {
                    baseOverrides.giftCount = Number(data.giftCount);
                }
                if (typeof data?.tier === 'string' && data.tier.trim()) {
                    baseOverrides.tier = data.tier;
                }
            }
            if (errorNotificationType === 'paypiggy') {
                if (Number.isFinite(Number(data?.months))) {
                    baseOverrides.months = Number(data.months);
                }
            }
            return baseOverrides;
        };
        const emitMonetizationError = async (errorEnvelopeTimestamp: string): Promise<void> => {
            if (!errorNotificationType) {
                return;
            }
            const avatarUrl = await this._resolveAvatarUrl(data);
            const errorPayload = createMonetizationErrorPayload({
                notificationType: errorNotificationType,
                platform: this.platformName,
                timestamp: errorEnvelopeTimestamp,
                id: data?.id,
                ...buildErrorOverrides(avatarUrl)
            });
            this._emitPlatformEvent(this._resolvePlatformEventType(eventType), errorPayload);
        };

        if (!payloadTimestamp) {
            if (errorNotificationType) {
                const errorEnvelopeTimestamp = this._getErrorEnvelopeTimestamp();
                const error = new Error(`Missing Twitch timestamp for ${eventType}`);
                this.errorHandler.handleEventProcessingError(
                    error,
                    eventType,
                    data,
                    `Missing timestamp for ${eventType}, emitting degraded monetization error envelope`
                );
                await emitMonetizationError(errorEnvelopeTimestamp);
            } else {
                this.errorHandler.handleEventProcessingError(
                    new Error(`Missing Twitch timestamp for ${eventType}`),
                    eventType,
                    data
                );
            }
            return;
        }

        try {

            const allowAnonymous = data?.isAnonymous === true &&
                (eventType === 'gift' || eventType === 'giftpaypiggy');
            if (options.validateUser && !data.username && !allowAnonymous) {
                this.logger.warn(`Incomplete ${eventType} data received`, 'twitch', {
                    eventType,
                    hasUsername: typeof data.username === 'string' && data.username.length > 0,
                    eventKeys: Object.keys(data).sort()
                });
                await emitMonetizationError(payloadTimestamp);
                return;
            }

            const logEventType = options.logEventType || eventType;
            await this._logRawEvent(logEventType, data);

            const factoryMethod = options.factoryMethod || this._resolveFactoryMethod(eventType);
            const normalizedPayload: Record<string, unknown> = { ...(data || {}), timestamp: payloadTimestamp };
            normalizedPayload.avatarUrl = await this._resolveAvatarUrl(normalizedPayload);
            const eventData: Record<string, unknown> = this.eventFactory[factoryMethod](normalizedPayload);

            const emitEventType = options.emitEventType || (typeof eventData.type === 'string' ? eventData.type : '') || this._resolvePlatformEventType(eventType);
            this._emitPlatformEvent(emitEventType, eventData);
        } catch (error) {
            this.errorHandler.handleEventProcessingError(error, eventType, data);
            await emitMonetizationError(payloadTimestamp);
        }
    }

    async handleFollowEvent(followData: Record<string, unknown>): Promise<void> {
        return this._handleStandardEvent('follow', followData, {
            validateUser: true,
            emitEventType: PlatformEvents.FOLLOW
        });
    }

    async handlePaypiggyEvent(subData: Record<string, unknown>): Promise<void> {
        return this._handleStandardEvent('paypiggy', subData, {
            emitEventType: PlatformEvents.PAYPIGGY,
            factoryMethod: 'createPaypiggyEvent',
            logEventType: 'paypiggy'
        });
    }

    async handlePaypiggyMessageEvent(subData: Record<string, unknown>): Promise<void> {
        return this._handleStandardEvent('paypiggy', subData, {
            emitEventType: PlatformEvents.PAYPIGGY,
            factoryMethod: 'createPaypiggyMessageEvent',
            logEventType: 'paypiggy-message'
        });
    }

    async handlePaypiggyGiftEvent(giftData: Record<string, unknown>): Promise<void> {
        return this._handleStandardEvent('giftpaypiggy', giftData, {
            emitEventType: PlatformEvents.GIFTPAYPIGGY,
            factoryMethod: 'createGiftPaypiggyEvent',
            logEventType: 'paypiggy-gift'
        });
    }

    async handleRaidEvent(raidData: Record<string, unknown>): Promise<void> {
        return this._handleStandardEvent('raid', raidData, {
            validateUser: true,
            emitEventType: PlatformEvents.RAID
        });
    }

    async handleGiftEvent(giftData: Record<string, unknown>): Promise<void> {
        const enrichedGiftData = await this._enrichGiftPayload(giftData);
        return this._handleStandardEvent('gift', enrichedGiftData, {
            validateUser: true,
            emitEventType: PlatformEvents.GIFT
        });
    }

    _resolvePlatformEventType(eventType: string): string {
        const mapping: Record<string, string> = {
            chat: PlatformEvents.CHAT_MESSAGE,
            follow: PlatformEvents.FOLLOW,
            paypiggy: PlatformEvents.PAYPIGGY,
            gift: PlatformEvents.GIFT,
            giftpaypiggy: PlatformEvents.GIFTPAYPIGGY,
            raid: PlatformEvents.RAID,
            'stream-status': PlatformEvents.STREAM_STATUS
        };

        return mapping[eventType] || eventType;
    }

    _getMonetizationMissingFields(eventType: string, data: Record<string, unknown>, payloadTimestamp: string | null): string[] {
        const fieldPresence: Record<string, boolean> = {
            timestamp: !!payloadTimestamp,
            username: typeof data?.username === 'string' && data.username.trim().length > 0,
            userId: typeof data?.userId === 'string' && data.userId.trim().length > 0
        };

        if (eventType === 'gift') {
            fieldPresence.giftType = typeof data?.giftType === 'string' && data.giftType.trim().length > 0;
            fieldPresence.giftCount = Number.isFinite(Number(data?.giftCount)) && Number(data.giftCount) > 0;
            fieldPresence.amount = Number.isFinite(Number(data?.amount)) && Number(data.amount) > 0;
            fieldPresence.currency = typeof data?.currency === 'string' && data.currency.trim().length > 0;
        }

        if (eventType === 'giftpaypiggy') {
            fieldPresence.giftCount = Number.isFinite(Number(data?.giftCount)) && Number(data.giftCount) > 0;
            if (this.platformName === 'twitch') {
                fieldPresence.tier = typeof data?.tier === 'string' && data.tier.trim().length > 0;
            }
        }

        return collectMissingFields(fieldPresence);
    }

    handleStreamOnlineEvent(data: Record<string, unknown>): void {
        this.logger.info('Stream went online, starting viewer count polling', 'twitch');

        this._logRawEvent('stream-online', data);

        if (!data?.started_at) {
            this.errorHandler.handleEventProcessingError(
                new Error('Stream online event requires started_at'),
                'stream-online',
                data
            );
            return;
        }

        const eventData = this.eventFactory.createStreamOnlineEvent({
            ...(data || {}),
            timestamp: data.started_at
        });
        this._emitPlatformEvent(PlatformEvents.STREAM_STATUS, eventData);

        this.initializeViewerCountProvider();
    }

    handleStreamOfflineEvent(data: Record<string, unknown>): void {
        this.logger.info('Stream went offline, stopping viewer count polling', 'twitch');

        this._logRawEvent('stream-offline', data);

        if (!data?.timestamp) {
            this.errorHandler.handleEventProcessingError(
                new Error('Stream offline event requires timestamp'),
                'stream-offline',
                data
            );
            return;
        }

        const eventData = this.eventFactory.createStreamOfflineEvent({
            ...(data || {}),
            timestamp: data.timestamp
        });
        this._emitPlatformEvent(PlatformEvents.STREAM_STATUS, eventData);

        if (this.viewerCountProvider && typeof this.viewerCountProvider.stopPolling === 'function') {
            try {
                this.viewerCountProvider.stopPolling();
            } catch (error) {
                this.errorHandler.handleCleanupError(error, 'twitch viewer count stop');
            }
        }
    }

    async sendMessage(message: string): Promise<void> {
        if (!this.eventSub) {
            const userFriendlyError = new Error('Twitch chat is unavailable: EventSub connection is not initialized');
            this.errorHandler.handleMessageSendError(userFriendlyError, 'eventsub-not-initialized');
            throw userFriendlyError;
        }

        const isConnected = typeof this.eventSub.isConnected === 'function' ? this.eventSub.isConnected() : this.isConnected;
        const isActive = typeof this.eventSub.isActive === 'function' ? this.eventSub.isActive() : false;
        if (!isConnected || isActive === false) {
            const userFriendlyError = new Error('Twitch chat is unavailable: EventSub connection is not active');
            this.errorHandler.handleMessageSendError(userFriendlyError, 'eventsub-not-connected');
            throw userFriendlyError;
        }

        try {
            await this.eventSub.sendMessage(message);
            this.logger.debug('Message sent successfully via EventSub', 'twitch', {
                messageLength: message.length,
                hasMessage: message.length > 0
            });
        } catch (error) {
            this.errorHandler.handleMessageSendError(error, 'EventSub sendMessage');
            const reason = error instanceof Error && error.message ? error.message : 'message delivery failed';
            throw new Error(`Twitch chat is unavailable: ${reason}`);
        }
    }

    async cleanup(): Promise<void> {
        this.isPlannedDisconnection = true;

        try {
            this._clearEventSubWiringState();

            if (this.eventSub) {
                if (typeof this.eventSub.removeAllListeners === 'function') {
                    this.eventSub.removeAllListeners();
                }
                if (this.eventSub.cleanup) {
                    await this.eventSub.cleanup();
                }
                if (this.eventSub.disconnect) {
                    await this.eventSub.disconnect();
                }
                this.eventSub = null;
            }
            if (this.viewerCountProvider && typeof this.viewerCountProvider.stopPolling === 'function') {
                try {
                    this.viewerCountProvider.stopPolling();
                } catch (error) {
                    this.errorHandler.handleCleanupError(error, 'twitch viewer count stop');
                }
            }
            this.avatarUrlCache.clear();
            this.avatarLookupMissCache.clear();
            this.broadcasterId = '';
            this.badgeCatalogCache = {
                broadcasterId: '',
                global: [],
                channel: [],
                loaded: false
            };
            this.cheermoteCatalogCache = {
                broadcasterId: '',
                catalog: [],
                loaded: false
            };
            this.isConnected = false;
            this.isConnecting = false;
            this.handlers = {};
            this.logger.info('Twitch platform cleanup completed', 'twitch');
        } catch (error) {
            this.errorHandler.handleCleanupError(error, 'twitch resources');
        }
    }

    _queuePlatformRecovery(error: Error): void {
        if (this.recoveryInFlight || !this.retrySystem) {
            return;
        }

        const handlers = { ...this.handlers };
        this.recoveryInFlight = true;

        this.retrySystem.handleConnectionError(
            this.platformName,
            error,
            async () => {
                this.isPlannedDisconnection = false;
                await this.initialize(handlers);
            },
            async () => {
                await this.cleanup();
            },
            (platform, isConnected, _connection, isConnecting) => {
                if (platform !== this.platformName) {
                    return;
                }

                this.isConnected = !!isConnected;
                this.isConnecting = !!isConnecting;
            }
        );
    }

    getConnectionState(): {
        platform: string;
        status: 'connected' | 'connecting' | 'disconnected';
        isConnected: boolean;
        channel: unknown;
        username: unknown;
        eventSubActive: boolean;
        platformEnabled: unknown;
    } {
        const active = this.eventSub?.isActive?.() || false;
        const connecting = this.isConnecting || false;
        const status = active ? 'connected' : (connecting ? 'connecting' : 'disconnected');

        return {
            platform: this.platformName,
            status: status,
            isConnected: active,
            channel: this.config.channel,
            username: this.config.username,
            eventSubActive: active,
            platformEnabled: this.config.enabled
        };
    }

    getStats(): {
        platform: string;
        enabled: unknown;
        connected: boolean;
        channel: unknown;
        eventsub: boolean;
        config: {
            enabled: unknown;
            debug: unknown;
        };
    } {
        const state = this.getConnectionState();
        return {
            platform: this.platformName,
            enabled: this.config.enabled,
            connected: state.isConnected,
            channel: state.channel,
            eventsub: state.eventSubActive,
            config: {
                enabled: state.platformEnabled,
                debug: this.config.debug
            }
        };
    }

    isConfigured(): boolean {
        return !!(this.config.enabled && this.config.username && this.config.clientId);
    }

    getStatus(): { isReady: boolean; issues: string[] } {
        const issues = [];
        const isConnected = this.eventSub?.isConnected?.() || false;
        const isActive = this.eventSub?.isActive?.() || false;

        if (this.config.enabled && !isConnected) {
            issues.push('Not connected');
        }
        if (this.config.enabled && isConnected && !isActive) {
            issues.push('EventSub not active');
        }

        return {
            isReady: !!(this.config.enabled && isConnected && isActive),
            issues
        };
    }

    validateConfig(): { isReady: boolean; issues: string[] } {
        return this.getStatus();
    }

    initializeViewerCountProvider(): void {
        if (this.viewerCountProvider && this.config.enabled) {
            if (typeof this.viewerCountProvider.startPolling === 'function') {
                this.viewerCountProvider.startPolling();
            } else {
                this.logger.debug('Viewer count provider missing startPolling(), skipping start', 'twitch');
            }
        }
    }

    async getViewerCount(): Promise<number> {
        if (!this.viewerCountProvider) {
            this.logger.debug('Viewer count provider not initialized, returning 0', 'twitch');
            return 0;
        }

        try {
            return await this.viewerCountProvider.getViewerCount();
        } catch (error) {
            this._logPlatformError('Error getting viewer count', error, 'viewer-count');
            return 0;
        }
    }

    async _logRawEvent(eventType: string, data: unknown): Promise<void> {
        if (!this.config.dataLoggingEnabled) {
            return;
        }

        try {
            await this.logRawPlatformData(eventType, data);
        } catch (error) {
            this.errorHandler.handleDataLoggingError(error, eventType);
        }
    }

    async logRawPlatformData(eventType: string, data: unknown): Promise<void> {
        return this.rawPlatformDataLoggingService.logRawPlatformData('twitch', eventType, data, this.config);
    }

    async getConnectionStatus(): Promise<{ platform: 'twitch'; status: 'connected' | 'disconnected'; timestamp: string }> {
        return {
            platform: 'twitch',
            status: this.isConnected ? 'connected' : 'disconnected',
            timestamp: getSystemTimestampISO()
        };
    }

    _emitPlatformEvent(type: string, payload: Record<string, unknown>): void {
        const platform = payload?.platform || 'twitch';

        this.emit('platform:event', { platform, type, data: payload });

        const handlerMap: Record<string, string> = {
            [PlatformEvents.CHAT_MESSAGE]: 'onChat',
            [PlatformEvents.FOLLOW]: 'onFollow',
            [PlatformEvents.PAYPIGGY]: 'onPaypiggy',
            [PlatformEvents.GIFT]: 'onGift',
            [PlatformEvents.GIFTPAYPIGGY]: 'onGiftPaypiggy',
            [PlatformEvents.RAID]: 'onRaid',
            [PlatformEvents.STREAM_STATUS]: 'onStreamStatus',
            [PlatformEvents.PLATFORM_CONNECTION]: 'onConnection'
        };

        const handlerName = handlerMap[type];
        const handler = handlerName ? this.handlers?.[handlerName] : null;

        if (typeof handler === 'function') {
            try {
                handler(payload);
            } catch (error) {
                this.errorHandler.handleEventProcessingError(error, type, payload);
            }
        } else {
            this.logger.debug(`No handler for twitch event type: ${type}`, 'twitch', { payloadType: handlerName });
        }
    }

    _handleEventSubConnectionChange(isConnected: boolean, details: Record<string, unknown> = {}): void {
        const status = isConnected ? 'connected' : 'disconnected';
        const detailError = details.error;
        const detailReason = typeof details.reason === 'string' ? details.reason : '';
        const error: Error | Record<string, unknown> | null = detailError instanceof Error || isRecord(detailError)
            ? detailError
            : (detailReason ? { message: detailReason } : null);
        const payload: ConnectionEventPayload = PlatformEvents.createConnectionEvent(this.platformName, status, error);
        payload.willReconnect = typeof details.willReconnect === 'boolean'
            ? details.willReconnect
            : (!this.isPlannedDisconnection && !!this.config.enabled);

        this.isConnected = !!isConnected;
        this.isConnecting = false;

        if (isConnected) {
            this.isPlannedDisconnection = false;
            this.recoveryInFlight = false;
            this.retrySystem?.handleConnectionSuccess?.(this.platformName, this.eventSub, 'Twitch EventSub');
        } else if (!payload.willReconnect && !this.isPlannedDisconnection && this.config.enabled) {
            const recoveryError = error instanceof Error
                ? error
                : new Error((error && typeof error.message === 'string' ? error.message : '') || detailReason || 'EventSub disconnected');
            this._queuePlatformRecovery(recoveryError);
            payload.willReconnect = true;
        }

        this._emitPlatformEvent(PlatformEvents.PLATFORM_CONNECTION, payload);
    }

    _logPlatformError(
        message: string,
        error: unknown = null,
        eventType = 'twitch-platform',
        payload: Record<string, unknown> | null = null
    ): void {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, payload, message);
        } else if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'twitch', payload || error);
        }
    }
}

export { TwitchPlatform };
