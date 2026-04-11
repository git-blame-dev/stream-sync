
const EventEmitter = require('events');
const { getUnifiedLogger } = require('../core/logging');
const { ConnectionStateFactory } = require('../utils/platform-connection-state');
const { TwitchApiClient } = require('../utils/api-clients/twitch-api-client');
const { ViewerCountProviderFactory } = require('../utils/viewer-count-providers');
const { PlatformEvents } = require('../interfaces/PlatformEvents');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { validateNormalizedMessage, buildTwitchMessageParts } = require('../utils/message-normalization');
const { createMonetizationErrorPayload } = require('../utils/monetization-error-utils');
const { resolveTwitchTimestampISO } = require('../utils/platform-timestamp');
const { getSystemTimestampISO } = require('../utils/timestamp');
const { createTwitchEventFactory } = require('./twitch/events/event-factory');
const { createTwitchEventSubWiring } = require('./twitch/connections/wiring');
const { DEFAULT_AVATAR_URL } = require('../constants/avatar');
const { UNKNOWN_CHAT_MESSAGE, UNKNOWN_CHAT_USERNAME } = require('../constants/degraded-chat');
const { normalizeBadgeImages } = require('../utils/message-parts');
const { collectMissingFields, mergeMissingFieldsMetadata } = require('../utils/missing-fields');

class TwitchPlatform extends EventEmitter {
    constructor(config, dependencies = {}) {
        super(); // Call EventEmitter constructor first to ensure proper prototype chain

        // Inject dependencies with fallbacks to actual implementations
        // EventSub WebSocket implementation for all Twitch functionality
        this.TwitchEventSub = dependencies.TwitchEventSub || require('./twitch-eventsub');

        // Initialize unified logger (with dependency injection support for testing)
        this.logger = dependencies.logger || getUnifiedLogger();
        this.errorHandler = createPlatformErrorHandler(this.logger, 'twitch');
        this.dependencies = { ...dependencies };

        // Initialize connection state
        this.isConnected = false;
        this.isPlannedDisconnection = false;

        // Store configuration and app reference
        this.config = config;

        // Require TwitchAuth via dependency injection
        this.twitchAuth = dependencies.twitchAuth;
        if (!this.twitchAuth) {
            throw new Error('TwitchPlatform requires twitchAuth via dependency injection.');
        }

        // Initialize chat file logging service via dependency injection
        const { ChatFileLoggingService } = dependencies.ChatFileLoggingService
            ? { ChatFileLoggingService: dependencies.ChatFileLoggingService }
            : require('../services/ChatFileLoggingService.js');
        this.chatFileLoggingService = new ChatFileLoggingService({
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

        // Initialize modular components
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

        // Initialize connection state tracking
        this.isConnecting = false;

        // EventSub will be initialized later when TwitchAuth is ready

        this.eventFactory = createTwitchEventFactory({
            platformName: this.platformName
        });
    }

    async initializeEventSub(broadcasterId) {
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
                stack: error.stack
            });
            throw error;
        }
    }

    _clearEventSubWiringState() {
        this.eventSubWiring?.unbindAll?.();
        this.eventSubListeners.length = 0;
        this.eventSubWiring = null;
    }

    async initialize(handlers) {
        if (!this.config.enabled) {
            this.logger.info('Platform is disabled in config', 'twitch');
            return;
        }

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

            const TwitchApiClientClass = this.dependencies.TwitchApiClient || TwitchApiClient;
            this.apiClient = new TwitchApiClientClass(this.twitchAuth, this.config);
            this.viewerCountProvider = ViewerCountProviderFactory.createTwitchProvider(
                this.apiClient,
                ConnectionStateFactory,
                this.config,
                () => this.eventSub
            );
            this.logger.debug('Modular components initialized', 'twitch');

            const broadcasterId = await this.apiClient.getBroadcasterId(this.config.channel);
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
                chatMessage: (data) => this.onMessageHandler(data),
                follow: (data) => this.handleFollowEvent(data),
                paypiggy: (data) => this.handlePaypiggyEvent(data),
                paypiggyMessage: (data) => this.handlePaypiggyMessageEvent(data),
                paypiggyGift: (data) => this.handlePaypiggyGiftEvent(data),
                raid: (data) => this.handleRaidEvent(data),
                gift: (data) => this.handleGiftEvent(data),
                streamOnline: (data) => this.handleStreamOnlineEvent(data),
                streamOffline: (data) => this.handleStreamOfflineEvent(data),
                eventSubConnected: (details = {}) => this._handleEventSubConnectionChange(true, details),
                eventSubDisconnected: (details = {}) => this._handleEventSubConnectionChange(false, details)
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
            throw error;
        }
    }

    async onMessageHandler(event) {
        const isSelf = event?.broadcaster_user_id && event?.chatter_user_id
            ? event.broadcaster_user_id === event.chatter_user_id
            : false;

        // Check if message should be filtered using configurable service
        if (this.selfMessageDetectionService) {
            const messageData = {
                self: isSelf,
                username: event?.chatter_user_name
            };
            if (this.selfMessageDetectionService.shouldFilterMessage('twitch', messageData, this.config)) {
                return;
            }
        } else {
            // Fallback to original behavior if service not available
            if (isSelf) return;
        }

        // Log raw platform data if enabled
        try {
            await this._logRawEvent('chat', event);
        } catch (loggingError) {
            this.errorHandler.handleDataLoggingError(loggingError, 'chat');
        }

        try {
            const userId = typeof event?.chatter_user_id === 'string' ? event.chatter_user_id.trim() : '';
            const username = typeof event?.chatter_user_name === 'string' ? event.chatter_user_name.trim() : '';
            const normalizedMessage = typeof event?.message?.text === 'string' ? event.message.text.trim() : '';
            const messageParts = buildTwitchMessageParts(event?.message);
            const timestamp = event?.timestamp;
            const missingFields = collectMissingFields({
                userId: !!userId,
                username: !!username,
                message: !!normalizedMessage || messageParts.length > 0,
                timestamp: typeof timestamp === 'string' && timestamp.trim().length > 0
            });

            const badges = Array.isArray(event?.badges)
                ? event.badges.reduce((acc, badge) => {
                    const setId = typeof badge?.set_id === 'string' ? badge.set_id.trim() : '';
                    if (!setId) {
                        return acc;
                    }
                    acc[setId] = badge?.id;
                    return acc;
                }, {})
                : (event?.badges && typeof event.badges === 'object' ? event.badges : {});
            const hasBadge = (badgeName) => {
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

            const normalizedData = {
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
                    emotes: (event?.message?.emotes && typeof event.message.emotes === 'object')
                        ? event.message.emotes
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
                    originalEvent: event
                });
                // Continue processing with potentially incomplete data
            }

            // Emit chat message event instead of calling app directly
            try {
                const eventData = {
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
                this._logPlatformError(`Error emitting chat message event: ${messageError.message}`, messageError, 'chat-message-emission');
            }
        } catch (error) {
            this._logPlatformError(`Error processing chat message: ${error.message}`, error, 'chat-message-processing');
            // Don't rethrow to prevent chat processing pipeline from stopping
        }
    }

    _capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    _normalizeBadgeKeyList(event = {}) {
        if (Array.isArray(event.badges)) {
            return event.badges
                .filter((badge) => badge && typeof badge === 'object')
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

    _hasMixedCheermotes(cheermoteInfo = {}) {
        if (!cheermoteInfo || typeof cheermoteInfo !== 'object') {
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

    _resolveCheermoteTierImageUrl(tierData = {}) {
        const imageUrl = typeof tierData?.images?.dark?.animated?.['3'] === 'string'
            ? tierData.images.dark.animated['3'].trim()
            : '';
        return imageUrl;
    }

    _resolveCheermoteImageFromCatalog(cheermoteInfo = {}) {
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

        const catalog = Array.isArray(this.cheermoteCatalogCache.catalog)
            ? this.cheermoteCatalogCache.catalog
            : [];
        const cheermoteEntry = catalog.find((entry) => {
            const entryPrefix = typeof entry?.prefix === 'string' ? entry.prefix.trim().toLowerCase() : '';
            return entryPrefix === normalizedPrefix;
        });
        if (!cheermoteEntry || !Array.isArray(cheermoteEntry.tiers)) {
            return '';
        }

        const tierEntry = cheermoteEntry.tiers.find((tierEntryCandidate) => {
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

    async _resolveGiftCheermoteImageUrl(giftData = {}) {
        if (!giftData || typeof giftData !== 'object') {
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

        const cheermoteInfo = giftData.cheermoteInfo;
        if (!cheermoteInfo || typeof cheermoteInfo !== 'object' || this._hasMixedCheermotes(cheermoteInfo)) {
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

    async _enrichGiftPayload(giftData = {}) {
        if (!giftData || typeof giftData !== 'object') {
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

    _findBadgeVersion(catalog = [], setId = '', version = '') {
        if (!Array.isArray(catalog) || !setId || !version) {
            return null;
        }
        const set = catalog.find((entry) => entry?.set_id === setId);
        if (!set || !Array.isArray(set.versions)) {
            return null;
        }
        return set.versions.find((entry) => String(entry?.id) === version) || null;
    }

    async _resolveBadgeImages(event = {}) {
        const badgeKeys = this._normalizeBadgeKeyList(event);
        if (badgeKeys.length === 0) {
            return [];
        }

        try {
            await this._ensureBadgeCatalogs(event?.broadcaster_user_id);
            const resolveFromCache = () => {
                const resolved = [];
                const unresolved = [];

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
                await this._ensureBadgeCatalogs(event?.broadcaster_user_id, true);
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

    _getTimestamp(data) {
        return resolveTwitchTimestampISO(data);
    }

    _getAvatarCacheKey(userId) {
        const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
        if (!normalizedUserId) {
            return '';
        }
        return `twitch:${normalizedUserId}`;
    }

    _setCachedAvatarUrl(cacheKey, avatarUrl) {
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

    _setAvatarLookupMiss(cacheKey) {
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

    async _resolveAvatarUrl(data = {}) {
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
            return this.avatarUrlCache.get(cacheKey);
        }

        if (cacheKey && this.avatarLookupMissCache.has(cacheKey)) {
            return this.fallbackAvatarUrl;
        }

        if (userId && this.apiClient && typeof this.apiClient.getUserById === 'function') {
            try {
                const user = await this.apiClient.getUserById(userId);
                const resolvedAvatarUrl = typeof user?.profile_image_url === 'string'
                    ? user.profile_image_url.trim()
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

    _getErrorEnvelopeTimestamp() {
        return this.getErrorEnvelopeTimestampISO();
    }

    async _handleStandardEvent(eventType, data, options = {}) {
        const payloadTimestamp = this._getTimestamp(data);
        const errorNotificationType = eventType === 'gift'
            ? 'gift'
            : (eventType === 'paypiggy' || eventType === 'giftpaypiggy' ? eventType : null);
        const buildErrorOverrides = (avatarUrl) => {
            const baseOverrides = {
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
        const emitMonetizationError = async (errorEnvelopeTimestamp) => {
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

            // User validation (for events that require it)
            const allowAnonymous = data?.isAnonymous === true &&
                (eventType === 'gift' || eventType === 'giftpaypiggy');
            if (options.validateUser && !data.username && !allowAnonymous) {
                this.logger.warn(`Incomplete ${eventType} data received`, 'twitch', data);
                await emitMonetizationError(payloadTimestamp);
                return;
            }

            // Log raw event (allow override for specific log type names)
            const logEventType = options.logEventType || eventType;
            await this._logRawEvent(logEventType, data);

            // Build event using factory
            const factoryMethod = options.factoryMethod || `create${this._capitalize(eventType)}Event`;
            const normalizedPayload = { ...(data || {}), timestamp: payloadTimestamp };
            normalizedPayload.avatarUrl = await this._resolveAvatarUrl(normalizedPayload);
            const eventData = this.eventFactory[factoryMethod](normalizedPayload);

            // Emit standardized event (allow override for specific emit type names)
            const emitEventType = options.emitEventType || eventData.type || this._resolvePlatformEventType(eventType);
            this._emitPlatformEvent(emitEventType, eventData);
        } catch (error) {
            this.errorHandler.handleEventProcessingError(error, eventType, data);
            await emitMonetizationError(payloadTimestamp);
        }
    }

    async handleFollowEvent(followData) {
        return this._handleStandardEvent('follow', followData, {
            validateUser: true,
            emitEventType: PlatformEvents.FOLLOW
        });
    }

    async handlePaypiggyEvent(subData) {
        return this._handleStandardEvent('paypiggy', subData, {
            emitEventType: PlatformEvents.PAYPIGGY,
            factoryMethod: 'createPaypiggyEvent',
            logEventType: 'paypiggy'
        });
    }

    async handlePaypiggyMessageEvent(subData) {
        return this._handleStandardEvent('paypiggy', subData, {
            emitEventType: PlatformEvents.PAYPIGGY,
            factoryMethod: 'createPaypiggyMessageEvent',
            logEventType: 'paypiggy-message'
        });
    }

    async handlePaypiggyGiftEvent(giftData) {
        return this._handleStandardEvent('giftpaypiggy', giftData, {
            emitEventType: PlatformEvents.GIFTPAYPIGGY,
            factoryMethod: 'createGiftPaypiggyEvent',
            logEventType: 'paypiggy-gift'
        });
    }

    async handleRaidEvent(raidData) {
        return this._handleStandardEvent('raid', raidData, {
            validateUser: true,
            emitEventType: PlatformEvents.RAID
        });
    }

    async handleGiftEvent(giftData) {
        const enrichedGiftData = await this._enrichGiftPayload(giftData);
        return this._handleStandardEvent('gift', enrichedGiftData, {
            validateUser: true,
            emitEventType: PlatformEvents.GIFT
        });
    }

    _resolvePlatformEventType(eventType) {
        const mapping = {
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

    _getMonetizationMissingFields(eventType, data, payloadTimestamp) {
        const fieldPresence = {
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

    handleStreamOnlineEvent(data) {
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

    handleStreamOfflineEvent(data) {
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

    async sendMessage(message) {
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
            this.logger.debug('Message sent successfully via EventSub', 'twitch', { message });
        } catch (error) {
            this.errorHandler.handleMessageSendError(error, 'EventSub sendMessage');
            const reason = error?.message || 'message delivery failed';
            throw new Error(`Twitch chat is unavailable: ${reason}`);
        }
    }

    async cleanup() {
        // Mark this as a planned disconnection to prevent reconnection loops
        this.isPlannedDisconnection = true;

        try {
            this._clearEventSubWiringState();

            // Disconnect EventSub WebSocket
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
            this.handlers = {};
            this.logger.info('Twitch platform cleanup completed', 'twitch');
        } catch (error) {
            this.errorHandler.handleCleanupError(error, 'twitch resources');
        }
    }

    getConnectionState() {
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

    getStats() {
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

    isConfigured() {
        return !!(this.config.enabled && this.config.username && this.config.clientId);
    }

    getStatus() {
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
            isReady: this.config.enabled && isConnected && isActive,
            issues
        };
    }

    validateConfig() {
        return this.getStatus();
    }

    initializeViewerCountProvider() {
        if (this.viewerCountProvider && this.config.enabled) {
            if (typeof this.viewerCountProvider.startPolling === 'function') {
                this.viewerCountProvider.startPolling();
            } else {
                this.logger.debug('Viewer count provider missing startPolling(), skipping start', 'twitch');
            }
        }
    }

    async getViewerCount() {
        // Delegate to modular viewer count provider for DRY principle
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

    async _logRawEvent(eventType, data) {
        if (!this.config.dataLoggingEnabled) {
            return;
        }

        try {
            await this.logRawPlatformData(eventType, data);
        } catch (error) {
            this.errorHandler.handleDataLoggingError(error, eventType);
        }
    }

    async logRawPlatformData(eventType, data) {
        // Delegate to centralized service
        return this.chatFileLoggingService.logRawPlatformData('twitch', eventType, data, this.config);
    }

    async getConnectionStatus() {
        return {
            platform: 'twitch',
            status: this.isConnected ? 'connected' : 'disconnected',
            timestamp: getSystemTimestampISO()
        };
    }

    _emitPlatformEvent(type, payload) {
        const platform = payload?.platform || 'twitch';

        // Emit unified platform:event for local listeners
        this.emit('platform:event', { platform, type, data: payload });

        // Forward to injected handlers (e.g., EventBus via PlatformLifecycleService)
        const handlerMap = {
            [PlatformEvents.CHAT_MESSAGE]: 'onChat',
            [PlatformEvents.FOLLOW]: 'onFollow',
            [PlatformEvents.PAYPIGGY]: 'onPaypiggy',
            [PlatformEvents.GIFT]: 'onGift',
            [PlatformEvents.GIFTPAYPIGGY]: 'onGiftPaypiggy',
            [PlatformEvents.RAID]: 'onRaid',
            [PlatformEvents.STREAM_STATUS]: 'onStreamStatus'
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

    _handleEventSubConnectionChange(isConnected, details = {}) {
        const status = isConnected ? 'connected' : 'disconnected';
        const error = details.error || (details.reason ? { message: details.reason } : null);
        const payload = PlatformEvents.createConnectionEvent(this.platformName, status, error);
        payload.willReconnect = details.willReconnect ?? (!this.isPlannedDisconnection && this.config.enabled);

        this.isConnected = !!isConnected;
        this.isConnecting = false;

        this._emitPlatformEvent(PlatformEvents.PLATFORM_CONNECTION, payload);
    }

    _logPlatformError(message, error = null, eventType = 'twitch-platform', payload = null) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, payload, message);
        } else if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'twitch', payload || error);
        }
    }
}

// Export the class
module.exports = {
    TwitchPlatform
};
