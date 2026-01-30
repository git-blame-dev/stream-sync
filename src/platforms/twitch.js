
const EventEmitter = require('events');
const { getUnifiedLogger } = require('../core/logging');
const { ConnectionStateFactory } = require('../utils/platform-connection-state');
const { TwitchApiClient } = require('../utils/api-clients/twitch-api-client');
const { ViewerCountProviderFactory } = require('../utils/viewer-count-providers');
const { PlatformEvents } = require('../interfaces/PlatformEvents');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { validateNormalizedMessage } = require('../utils/message-normalization');
const { createMonetizationErrorPayload } = require('../utils/monetization-error-utils');
const { getSystemTimestampISO } = require('../utils/validation');
const TimestampExtractionService = require('../services/TimestampExtractionService');
const {
    normalizeTwitchPlatformConfig,
    validateTwitchPlatformConfig
} = require('./twitch/config/twitch-config');
const { createTwitchEventFactory } = require('./twitch/events/event-factory');
const { createTwitchEventSubWiring } = require('./twitch/connections/wiring');

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
        this.config = normalizeTwitchPlatformConfig(config);
        this.timestampService = dependencies.timestampService
            || new TimestampExtractionService({ logger: this.logger });
        
        // Require TwitchAuth via dependency injection
        this.twitchAuth = dependencies.twitchAuth;
        if (!this.twitchAuth) {
            throw new Error('TwitchPlatform requires twitchAuth via dependency injection.');
        }

        // Initialize chat file logging service via dependency injection
        const ChatFileLoggingService = dependencies.ChatFileLoggingService || require('../services/ChatFileLoggingService');
        this.chatFileLoggingService = new ChatFileLoggingService({
            logger: this.logger,
            config: this.config
        });
        
        this.selfMessageDetectionService = dependencies.selfMessageDetectionService || null;

        this.validateNormalizedMessage = dependencies.validateNormalizedMessage || validateNormalizedMessage;

        this.platformName = 'twitch';
        this.eventSub = null;
        this.eventSubListeners = [];
        this.eventSubWiring = null;
        this.handlers = {};
        
        // Initialize modular components
        this.apiClient = null;
        this.viewerCountProvider = null;
        
        // Initialize connection state tracking
        this.isConnecting = false;

        // EventSub will be initialized later when TwitchAuth is ready

        this.eventFactory = createTwitchEventFactory({
            platformName: this.platformName
        });
    }

    async initializeEventSub(broadcasterId) {
        this.logger.debug('initializeEventSub called', 'twitch', {
            eventsub_enabled: this.config.eventsub_enabled,
            authReady: this.twitchAuth?.isReady?.(),
            hasTwitchAuth: !!this.twitchAuth,
            broadcasterId
        });

        if (!this.config.eventsub_enabled) {
            this.logger.debug('EventSub is disabled in config', 'twitch');
            return;
        }

        // Ensure authentication is ready before creating EventSub
        if (!this.twitchAuth.isReady()) {
            this.logger.warn('Cannot initialize EventSub - Twitch authentication not ready', 'twitch', {
                authReady: this.twitchAuth?.isReady?.(),
                hasTwitchAuth: !!this.twitchAuth
            });
            return;
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
            this._logPlatformError('Failed to initialize EventSub', error, 'eventsub-init', {
                stack: error.stack
            });
        }
    }
    
    async initialize(handlers) {
        if (!this.config.enabled) {
            this.logger.info('Platform is disabled in config', 'twitch');
            return;
        }

        this.handlers = handlers || {};
        this.isConnecting = true;

        this.eventSubWiring?.unbindAll?.();
        this.eventSubListeners.length = 0;

        try {
            // Initialize authentication via injected auth manager
            this.logger.debug('Using centralized Twitch auth...', 'twitch', {
                authReady: this.twitchAuth?.isReady?.(),
                hasTwitchAuth: !!this.twitchAuth
            });
            if (!this.twitchAuth.isReady()) {
                throw new Error('Twitch authentication is not ready');
            }

            // Initialize modular components
            const TwitchApiClientClass = this.dependencies.TwitchApiClient || TwitchApiClient;
            this.apiClient = new TwitchApiClientClass(this.twitchAuth, this.config);
            this.viewerCountProvider = ViewerCountProviderFactory.createTwitchProvider(
                this.apiClient,
                ConnectionStateFactory,
                this.config,
                () => this.eventSub // Function to get current EventSub instance
            );
            this.logger.debug('Modular components initialized', 'twitch');

            const broadcasterId = await this.apiClient.getBroadcasterId(this.config.channel);

            // Then initialize EventSub with ready authentication
            this.logger.debug('Initializing EventSub with centralized auth...', 'twitch');
            await this.initializeEventSub(broadcasterId);
            this.logger.debug('EventSub initialization completed', 'twitch', {
                eventSubExists: !!this.eventSub,
                eventSubConnected: this.eventSub?.isConnected?.()
            });

            if (this.eventSub && typeof this.eventSub.on !== 'function') {
                const error = new Error('Twitch EventSub connection missing event emitter interface (on/off)');
                this._logPlatformError('EventSub missing event emitter methods', error, 'platform-init');
                throw error;
            }

            // Set up EventSub event listeners
            if (this.eventSub) {
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
            }

            // Using EventSub WebSocket for all chat and event handling
            this.logger.debug('Using EventSub for chat messages', 'twitch', { 
                username: this.config.username, 
                channel: this.config.channel 
            });

            this.logger.info('Twitch platform initialized with EventSub WebSocket', 'twitch');
            this.isConnected = this.eventSub?.isConnected?.() || false;
            this.isConnecting = false;

        } catch (error) {
            this._logPlatformError('Failed to initialize Twitch platform', error, 'platform-init');
            this.isConnecting = false;
            throw error; // Re-throw to trigger retry logic
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
            if (!userId) {
                throw new Error('Missing Twitch userId');
            }
            if (!username) {
                throw new Error('Missing Twitch username');
            }

            const normalizedMessage = typeof event?.message?.text === 'string' ? event.message.text.trim() : '';
            if (!normalizedMessage) {
                throw new Error('Missing Twitch message text');
            }

            const timestamp = event?.timestamp;
            if (!timestamp || typeof timestamp !== 'string') {
                throw new Error('Missing Twitch timestamp');
            }

            const badges = event?.badges && typeof event.badges === 'object' ? event.badges : {};
            const isMod = badges?.moderator === '1' || badges?.moderator === 1 || badges?.moderator === true;
            const isSubscriber = badges?.subscriber === '1' || badges?.subscriber === 1 || badges?.subscriber === true;

            const normalizedData = {
                platform: this.platformName,
                userId,
                username,
                message: normalizedMessage,
                timestamp,
                isMod,
                isSubscriber,
                isBroadcaster: isSelf,
                metadata: {
                    badges,
                    color: event?.color ?? null,
                    emotes: (event?.message?.emotes && typeof event.message.emotes === 'object')
                        ? event.message.emotes
                        : {},
                    roomId: event?.broadcaster_user_id ?? null
                },
                rawData: { event }
            };

            const validation = this.validateNormalizedMessage(normalizedData);

            if (!validation.isValid) {
                this.logger.warn('Message normalization validation failed', 'twitch', {
                    issues: validation.issues,
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
                    userId: normalizedData.userId,
                    message: {
                        text: normalizedData.message
                    },
                    timestamp: normalizedData.timestamp,
                    metadata: {
                        platform: this.platformName,
                        isMod: normalizedData.isMod,
                        isSubscriber: normalizedData.isSubscriber,
                        isBroadcaster: normalizedData.isBroadcaster,
                        correlationId: PlatformEvents._generateCorrelationId()
                    }
                };
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

    _getTimestamp(data) {
        if (this.timestampService && typeof this.timestampService.extractTimestamp === 'function') {
            return this.timestampService.extractTimestamp('twitch', data);
        }

        if (typeof data?.timestamp === 'string') {
            return data.timestamp;
        }

        return null;
    }

    async _handleStandardEvent(eventType, data, options = {}) {
        const payloadTimestamp = this._getTimestamp(data);
        const errorNotificationType = eventType === 'gift'
            ? 'gift'
            : (eventType === 'paypiggy' || eventType === 'giftpaypiggy' ? eventType : null);
        const buildErrorOverrides = () => {
            const baseOverrides = {
                username: data?.username,
                userId: data?.userId
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
        const emitMonetizationError = (timestamp) => {
            if (!errorNotificationType) {
                return;
            }
            const errorPayload = createMonetizationErrorPayload({
                notificationType: errorNotificationType,
                platform: this.platformName,
                timestamp,
                id: data?.id,
                ...buildErrorOverrides()
            });
            this._emitPlatformEvent(this._resolvePlatformEventType(eventType), errorPayload);
        };

        if (!payloadTimestamp) {
            if (errorNotificationType) {
                const fallbackTimestamp = getSystemTimestampISO();
                const error = new Error(`Missing Twitch timestamp for ${eventType}`);
                this.errorHandler.handleEventProcessingError(
                    error,
                    eventType,
                    data,
                    `Missing timestamp for ${eventType}, using fallback`
                );
                emitMonetizationError(fallbackTimestamp);
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
                emitMonetizationError(payloadTimestamp);
                return;
            }

            // Log raw event (allow override for specific log type names)
            const logEventType = options.logEventType || eventType;
            await this._logRawEvent(logEventType, data);

            // Build event using factory
            const factoryMethod = options.factoryMethod || `create${this._capitalize(eventType)}Event`;
            const normalizedPayload = { ...(data || {}), timestamp: payloadTimestamp };
            const eventData = this.eventFactory[factoryMethod](normalizedPayload);

            // Emit standardized event (allow override for specific emit type names)
            const emitEventType = options.emitEventType || eventData.type || this._resolvePlatformEventType(eventType);
            this._emitPlatformEvent(emitEventType, eventData);
        } catch (error) {
            this.errorHandler.handleEventProcessingError(error, eventType, data);
            emitMonetizationError(payloadTimestamp);
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
        return this._handleStandardEvent('gift', giftData, {
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
        const isActive = typeof this.eventSub.isActive === 'function' ? this.eventSub.isActive() : isConnected;
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
            this.eventSubWiring?.unbindAll?.();

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
            this.eventSubWiring = null;
            if (this.viewerCountProvider && typeof this.viewerCountProvider.stopPolling === 'function') {
                try {
                    this.viewerCountProvider.stopPolling();
                } catch (error) {
                    this.errorHandler.handleCleanupError(error, 'twitch viewer count stop');
                }
            }
            this.isConnected = false;
            this.handlers = {};
            this.logger.info('Twitch platform cleanup completed', 'twitch');
        } catch (error) {
            this.errorHandler.handleCleanupError(error, 'twitch resources');
        }
    }

    getConnectionState() {
        const connected = this.eventSub?.isConnected() || false;
        const connecting = this.isConnecting || false;
        const status = connected ? 'connected' : (connecting ? 'connecting' : 'disconnected');
        
        return {
            platform: this.platformName,
            status: status,
            isConnected: connected,
            channel: this.config.channel,
            username: this.config.username,
            eventSubActive: this.eventSub ? (this.eventSub.isActive ? this.eventSub.isActive() : connected) : false,
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
        const validation = this.validateConfig();
        return validation.isValid;
    }
    
    validateConfig() {
        return validateTwitchPlatformConfig({
            config: this.config,
            twitchAuth: this.twitchAuth
        });
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
