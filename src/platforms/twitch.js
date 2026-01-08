
const EventEmitter = require('events');
const { getUnifiedLogger } = require('../core/logging');
const { ConnectionStateFactory } = require('../utils/platform-connection-state');
const { TwitchApiClient } = require('../utils/api-clients/twitch-api-client');
const { ViewerCountProviderFactory } = require('../utils/viewer-count-providers');
const { PlatformEvents } = require('../interfaces/PlatformEvents');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { normalizeTwitchMessage, validateNormalizedMessage } = require('../utils/message-normalization');
const { createMonetizationErrorPayload } = require('../utils/monetization-error-utils');
const {
    normalizeTwitchPlatformConfig,
    validateTwitchPlatformConfig
} = require('./twitch/config/twitch-config');
const { createTwitchEventFactory } = require('./twitch/events/twitch-event-factory');
const { createTwitchEventSubWiring } = require('./twitch/eventsub/twitch-eventsub-wiring');

class TwitchPlatform extends EventEmitter {
    constructor(config, dependencies = {}) {
        super(); // Call EventEmitter constructor first to ensure proper prototype chain

        // Inject dependencies with fallbacks to actual implementations
        // EventSub WebSocket implementation for all Twitch functionality
        this.TwitchEventSub = dependencies.TwitchEventSub || require('./twitch-eventsub');

        // Initialize unified logger (with dependency injection support for testing)
        this.logger = dependencies.logger || getUnifiedLogger();
        this.errorHandler = createPlatformErrorHandler(this.logger, 'twitch');

        // Initialize connection state
        this.isConnected = false;
        this.isPlannedDisconnection = false;

        // Store configuration and app reference
        this.config = normalizeTwitchPlatformConfig(config);
        this.timestampService = dependencies.timestampService || null;
        
        // Require auth manager via dependency injection
        this.authManager = dependencies.authManager;
        if (!this.authManager) {
            throw new Error('TwitchPlatform requires authManager via dependency injection. Please update your initialization code to use TwitchAuthFactory.');
        }

        // Initialize chat file logging service via dependency injection
        const ChatFileLoggingService = dependencies.ChatFileLoggingService || require('../services/ChatFileLoggingService');
        this.chatFileLoggingService = new ChatFileLoggingService({
            logger: this.logger,
            config: this.config
        });
        
        // Initialize self-message detection service via dependency injection
        this.selfMessageDetectionService = dependencies.selfMessageDetectionService || null;
        
        // Internal state
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

    async initializeEventSub() {
        this.logger.debug('initializeEventSub called', 'twitch', {
            eventsub_enabled: this.config.eventsub_enabled,
            authState: this.authManager?.getState?.(),
            hasAuthManager: !!this.authManager
        });
        
        if (!this.config.eventsub_enabled) {
            this.logger.debug('EventSub is disabled in config', 'twitch');
            return;
        }

        // Ensure authentication is ready before creating EventSub
        if (this.authManager.getState() !== 'READY') {
            this.logger.warn('Cannot initialize EventSub - Authentication not ready', 'twitch', {
                authState: this.authManager?.getState?.(),
                authManagerExists: !!this.authManager
            });
            return;
        }

        try {
            this.logger.debug('Creating TwitchEventSub instance...', 'twitch');
            this.eventSub = new this.TwitchEventSub(this.config, {
                logger: this.logger,
                authManager: this.authManager // Pass centralized auth manager
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
            this.logger.debug('Using centralized auth manager...', 'twitch', {
                authState: this.authManager?.getState?.(),
                hasAuthManager: !!this.authManager
            });
            // Auth manager should already be initialized by token validator
            if (this.authManager.getState() !== 'READY') {
                this.logger.debug('Auth manager not ready, initializing...', 'twitch');
                await this.authManager.initialize();
            }
            this.logger.debug('Auth manager ready', 'twitch', {
                finalAuthState: this.authManager?.getState?.()
            });

            // Initialize modular components
            this.apiClient = new TwitchApiClient(this.authManager, this.config);
            this.viewerCountProvider = ViewerCountProviderFactory.createTwitchProvider(
                this.apiClient,
                ConnectionStateFactory,
                this.config,
                () => this.eventSub // Function to get current EventSub instance
            );
            this.logger.debug('Modular components initialized', 'twitch');

            // Then initialize EventSub with ready authentication
            this.logger.debug('Initializing EventSub with centralized auth...', 'twitch');
            await this.initializeEventSub();
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
                    message: (data) => this.onMessageHandler(data.channel, data.context, data.message, data.self),
                    follow: (data) => this.handleFollowEvent(data),
                    paypiggy: (data) => this.handlePaypiggyEvent(data),
                    paypiggyMessage: (data) => this.handlePaypiggyMessageEvent(data),
                    paypiggyGift: (data) => this.handlePaypiggyGiftEvent(data),
                    raid: (data) => this.handleRaidEvent(data),
                    cheer: (data) => this.handleCheerEvent(data),
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

    async onMessageHandler(target, context, msg, self) {
        // Check if message should be filtered using configurable service
        if (this.selfMessageDetectionService) {
            const messageData = { self, context, username: context['username'] };
            if (this.selfMessageDetectionService.shouldFilterMessage('twitch', messageData, this.config)) {
                return;
            }
        } else {
            // Fallback to original behavior if service not available
            if (self) return;
        }

        // Log raw platform data if enabled
        try {
            await this._logRawEvent('chat', { target, context, msg, self });
        } catch (loggingError) {
            this.errorHandler.handleDataLoggingError(loggingError, 'chat');
        }

        try {
            const message = msg.trim();
            const user = {
                username: context['username'],
                userId: context['user-id'],
                isMod: context.mod,
                isSubscriber: context.subscriber,
                isBroadcaster: context.username === (this.config.channel ? this.config.channel.toLowerCase() : '')
            };

            // Normalize message data using standardized utility
            const normalizedData = normalizeTwitchMessage(user, message, context, this.platformName, this.timestampService);

            // Validate normalized data
            const validation = validateNormalizedMessage(normalizedData);
            
            if (!validation.isValid) {
                this.logger.warn('Message normalization validation failed', 'twitch', {
                    issues: validation.issues,
                    originalUser: user,
                    originalMessage: message
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
                this._emitPlatformEvent('chat', eventData);
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

    async _handleStandardEvent(eventType, data, options = {}) {
        try {
            // User validation (for events that require it)
            if (options.validateUser && !data.username) {
                this.logger.warn(`Incomplete ${eventType} data received`, 'twitch', data);
                const errorNotificationType = eventType === 'cheer'
                    ? 'gift'
                    : (eventType === 'paypiggy' || eventType === 'giftpaypiggy' ? eventType : null);
                if (errorNotificationType) {
                    const baseOverrides = {
                        username: data?.username,
                        userId: data?.userId
                    };
                    if (errorNotificationType === 'gift' && Number.isFinite(data?.bits)) {
                        baseOverrides.giftType = 'bits';
                        baseOverrides.giftCount = 1;
                        baseOverrides.amount = data.bits;
                        baseOverrides.currency = 'bits';
                    }
                    if (errorNotificationType === 'giftpaypiggy') {
                        baseOverrides.giftCount = data?.giftCount;
                        baseOverrides.tier = data?.tier;
                    }
                    if (errorNotificationType === 'paypiggy') {
                        baseOverrides.months = data?.months;
                    }
                    const errorPayload = createMonetizationErrorPayload({
                        notificationType: errorNotificationType,
                        platform: this.platformName,
                        timestamp: data?.timestamp,
                        id: data?.id,
                        ...baseOverrides
                    });
                    this._emitPlatformEvent(eventType, errorPayload);
                }
                return;
            }

            // Log raw event (allow override for specific log type names)
            const logEventType = options.logEventType || eventType;
            await this._logRawEvent(logEventType, data);

            // Build event using factory
            const factoryMethod = options.factoryMethod || `create${this._capitalize(eventType)}Event`;
            const eventData = this.eventFactory[factoryMethod](data);

            // Emit standardized event (allow override for specific emit type names)
            const emitEventType = options.emitEventType || eventType;
            this._emitPlatformEvent(emitEventType, eventData);
        } catch (error) {
            this.errorHandler.handleEventProcessingError(error, eventType, data);
            const errorNotificationType = eventType === 'cheer'
                ? 'gift'
                : (eventType === 'paypiggy' || eventType === 'giftpaypiggy' ? eventType : null);
            if (errorNotificationType) {
                const baseOverrides = {
                    username: data?.username,
                    userId: data?.userId
                };
                if (errorNotificationType === 'gift' && Number.isFinite(data?.bits)) {
                    baseOverrides.giftType = 'bits';
                    baseOverrides.giftCount = 1;
                    baseOverrides.amount = data.bits;
                    baseOverrides.currency = 'bits';
                }
                if (errorNotificationType === 'giftpaypiggy') {
                    baseOverrides.giftCount = data?.giftCount;
                    baseOverrides.tier = data?.tier;
                }
                if (errorNotificationType === 'paypiggy') {
                    baseOverrides.months = data?.months;
                }
                const errorPayload = createMonetizationErrorPayload({
                    notificationType: errorNotificationType,
                    platform: this.platformName,
                    timestamp: data?.timestamp,
                    id: data?.id,
                    ...baseOverrides
                });
                this._emitPlatformEvent(eventType, errorPayload);
            }
        }
    }

    async handleFollowEvent(followData) {
        return this._handleStandardEvent('follow', followData, { validateUser: true });
    }

    async handlePaypiggyEvent(subData) {
        return this._handleStandardEvent('paypiggy', subData, {
            emitEventType: 'paypiggy',
            factoryMethod: 'createPaypiggyEvent',
            logEventType: 'paypiggy'
        });
    }

    async handlePaypiggyMessageEvent(subData) {
        return this._handleStandardEvent('paypiggy', subData, {
            emitEventType: 'paypiggy',
            factoryMethod: 'createPaypiggyMessageEvent',
            logEventType: 'paypiggy-message'
        });
    }

    async handlePaypiggyGiftEvent(giftData) {
        return this._handleStandardEvent('giftpaypiggy', giftData, {
            emitEventType: 'giftpaypiggy',
            factoryMethod: 'createGiftPaypiggyEvent',
            logEventType: 'paypiggy-gift'
        });
    }

    async handleRaidEvent(raidData) {
        return this._handleStandardEvent('raid', raidData, { validateUser: true });
    }

    async handleCheerEvent(cheerData) {
        return this._handleStandardEvent('cheer', cheerData, { validateUser: true });
    }

    handleStreamOnlineEvent(data) {
        this.logger.info('Stream went online, starting viewer count polling', 'twitch');

        this._logRawEvent('stream-online', data);

        const eventData = this.eventFactory.createStreamOnlineEvent(data);
        this._emitPlatformEvent('stream-status', eventData);

        this.initializeViewerCountProvider();
    }

    handleStreamOfflineEvent(data) {
        this.logger.info('Stream went offline, stopping viewer count polling', 'twitch');

        this._logRawEvent('stream-offline', data);

        const eventData = this.eventFactory.createStreamOfflineEvent(data);
        this._emitPlatformEvent('stream-status', eventData);

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
            authManager: this.authManager
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
            timestamp: new Date().toISOString()
        };
    }

    _emitPlatformEvent(type, payload) {
        const platform = payload?.platform || 'twitch';

        // Emit unified platform:event for local listeners
        this.emit('platform:event', { platform, type, data: payload });

        // Forward to injected handlers (e.g., EventBus via PlatformLifecycleService)
        const handlerMap = {
            'chat': 'onChat',
            'follow': 'onFollow',
            'paypiggy': 'onPaypiggy',
            'gift': 'onGift',
            'giftpaypiggy': 'onGiftPaypiggy',
            'cheer': 'onCheer',
            'raid': 'onRaid',
            'stream-status': 'onStreamStatus'
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
        const payload = {
            platform: this.platformName,
            isLive: !!isConnected,
            connectionId: details.connectionId || PlatformEvents._generateCorrelationId(),
            timestamp: new Date().toISOString(),
            reason: details.reason,
            willReconnect: details.willReconnect ?? (!this.isPlannedDisconnection && this.config.enabled),
            metadata: details.metadata || {}
        };

        this.isConnected = !!isConnected;
        this.isConnecting = false;

        this._emitPlatformEvent('stream-status', payload);
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
