
const { safeSetTimeout, safeSetInterval, validateTimeout, safeDelay } = require('../utils/timeout-validator');
const { EventEmitter } = require('events');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { secrets } = require('../core/secrets');
const { extractHttpErrorDetails } = require('../utils/http-error-utils');
const { createTwitchEventSubSubscriptions } = require('./twitch/connections/eventsub-subscriptions');
const { createTwitchEventSubEventRouter } = require('./twitch/events/event-router');
const { createTwitchEventSubSubscriptionManager } = require('./twitch/connections/eventsub-subscription-manager');
const { createTwitchEventSubWsLifecycle } = require('./twitch/connections/ws-lifecycle');
const { validateLoggerInterface } = require('../utils/dependency-validator');

class TwitchEventSub extends EventEmitter {
    constructor(config, dependencies = {}) {
        super();

        this.config = config;
        validateLoggerInterface(dependencies.logger);
        this.logger = dependencies.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'twitch-eventsub');
        this.twitchAuth = dependencies.twitchAuth;
        this.axios = dependencies.axios || require('axios');
        this.WebSocketCtor = dependencies.WebSocketCtor || require('ws');
        this.broadcasterId = this.config.broadcasterId;

        // WebSocket connection
        this.ws = null;
        this.sessionId = null;
        this.subscriptions = new Map();
        
        // State management
        this.isInitialized = false;
        this._isConnected = false;
        this.subscriptionsReady = false;
        this.retryAttempts = 0;
        this.reconnectTimeout = null;
        this.connectionStartTime = null;
        
        // Configuration
        this.maxRetryAttempts = 10; // Increased from 3 to handle network instability
        this.retryDelay = 5000;
        this.subscriptionDelay = 5000; // Delay between subscriptions to avoid rate limiting (increased to 5s for connection stability)
        
        // Required EventSub subscriptions
        // Optimized with consistent pattern structure and standardized configuration
        this.requiredSubscriptions = createTwitchEventSubSubscriptions();
        
        // Memory usage tracking for periodic cleanup
        this.memoryUsage = {
            lastCleanup: Date.now(),
            maxSubscriptions: 50,
            cleanupInterval: 5 * 60 * 1000 // 5 minutes
        };

        // EventSub dedupe + reconnect tracking
        this.reconnectUrl = null;
        this.recentMessageIds = new Map();
        this.messageIdTtlMs = 5 * 60 * 1000;
        this.maxMessageIds = 1000;
        
        try {
            this.logger.info('Manual EventSub initialized', 'twitch');
        } catch (error) {
            // Logger initialization error - continue with fallback
        }
        // Initialize shared logging service
        const ChatFileLoggingService = dependencies.ChatFileLoggingService || require('../services/ChatFileLoggingService');
        this.chatFileLoggingService = new ChatFileLoggingService({ logger: this.logger, config: this.config });

        this.eventRouter = createTwitchEventSubEventRouter({
            config: this.config,
            logger: this.logger,
            emit: (...args) => this.emit(...args),
            logRawPlatformData: (...args) => this.logRawPlatformData(...args),
            logError: (...args) => this._logEventSubError(...args)
        });

        this.subscriptionManager = createTwitchEventSubSubscriptionManager({
            logger: this.logger,
            twitchAuth: this.twitchAuth,
            config: this.config,
            subscriptions: this.subscriptions,
            axios: this.axios,
            getClientId: () => this._getAvailableClientId(),
            validateConnectionForSubscriptions: () => this._validateConnectionForSubscriptions(),
            logError: (...args) => this._logEventSubError(...args)
        });

        this.wsLifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: this.WebSocketCtor,
            safeSetTimeout,
            safeDelay,
            validateTimeout
        });

        // Start periodic cleanup for memory optimization
        this._startPeriodicCleanup();
    }

    _startPeriodicCleanup() {
        // Run cleanup every 5 minutes
        this.cleanupInterval = safeSetInterval(() => {
            this._performPeriodicCleanup();
        }, 5 * 60 * 1000);
    }

    _performPeriodicCleanup() {
        const now = Date.now();
        
        // Only run if enough time has passed since last cleanup
        if (now - this.memoryUsage.lastCleanup < 4 * 60 * 1000) {
            return;
        }
        
        this.logger.debug('Performing periodic EventSub memory cleanup', 'twitch');
        
        // Check subscription count and warn if too high
        if (this.subscriptions.size > this.memoryUsage.maxSubscriptions) {
            this.logger.warn(`High subscription count detected: ${this.subscriptions.size}/${this.memoryUsage.maxSubscriptions}`, 'twitch');
        }
        
        // Update cleanup timestamp
        this.memoryUsage.lastCleanup = now;
        
        // Force garbage collection if available (Node.js --expose-gc flag)
        if (global.gc) {
            global.gc();
            this.logger.debug('Forced garbage collection completed', 'twitch');
        }
    }

    _pruneMessageIds(now) {
        for (const [messageId, seenAt] of this.recentMessageIds.entries()) {
            if (now - seenAt > this.messageIdTtlMs) {
                this.recentMessageIds.delete(messageId);
            }
        }
    }

    _isDuplicateMessageId(metadata) {
        const messageId = metadata?.message_id;
        if (!messageId) {
            return false;
        }

        const now = Date.now();
        const lastSeen = this.recentMessageIds.get(messageId);
        if (lastSeen && now - lastSeen < this.messageIdTtlMs) {
            return true;
        }

        this.recentMessageIds.set(messageId, now);
        if (this.recentMessageIds.size > this.maxMessageIds) {
            this._pruneMessageIds(now);
        }

        return false;
    }

    async _validateConfig() {
        const validation = {
            valid: true,
            issues: [],
            warnings: [],
            components: {
                twitchAuth: this._validateTwitchAuth(),
                configuration: this._validateConfigurationFields()
            },
            validatedAt: new Date().toISOString()
        };
        
        // Collect all issues from component validations
        Object.values(validation.components).forEach(component => {
            if (component.issues) {
                validation.issues.push(...component.issues);
            }
            if (component.warnings) {
                validation.warnings.push(...component.warnings);
            }
        });
        
        validation.valid = validation.issues.length === 0;
        
        return validation;
    }

    _validateTwitchAuth() {
        const issues = [];
        const details = {};
        
        if (!this.twitchAuth) {
            throw new Error('TwitchAuth is required but not provided');
        } else {
            details.present = true;
            details.ready = Boolean(this.twitchAuth.isReady?.());
            
            if (!details.ready) {
                throw new Error('TwitchAuth is not ready');
            }
        }
        
        return {
            valid: issues.length === 0,
            issues,
            details
        };
    }

    _validateConfigurationFields() {
        const issues = [];
        const warnings = [];
        const details = {};
        const clientIdSource = this._getAvailableClientId();
        this.broadcasterId = this.config.broadcasterId;
        details.broadcasterId = { value: this.broadcasterId, required: true };

        if (!this.broadcasterId) {
            issues.push('broadcasterId must be resolved from channel before EventSub init');
            details.broadcasterId.valid = false;
        } else {
            details.broadcasterId.valid = true;
        }

        if (!secrets.twitch.accessToken) {
            details.accessToken = { value: null, required: true };
            issues.push('Access token is required for EventSub authentication');
            details.accessToken.valid = false;
        } else {
            details.accessToken = {
                value: 'present',
                required: true,
                valid: true,
                source: 'secrets'
            };
        }

        // Client ID validation
        details.clientId = {
            value: clientIdSource,
            required: true,
            valid: !!clientIdSource,
            source: 'config'
        };

        if (!clientIdSource) {
            issues.push('Twitch Client ID is required for EventSub API access');
            details.clientId.valid = false;
        }

        // Optional fields
        const optionalFields = {
            dataLoggingEnabled: { type: 'boolean', default: false }
        };

        Object.entries(optionalFields).forEach(([field, config]) => {
            const value = this.config[field];
            details[field] = { value, required: false, default: config.default };
            
            if (value !== undefined && config.type && typeof value !== config.type) {
                warnings.push(`${field} should be of type ${config.type}, got ${typeof value}`);
                details[field].valid = false;
            } else {
                details[field].valid = true;
            }
        });
        
        return {
            valid: issues.length === 0,
            issues,
            warnings,
            details
        };
    }

    _isCentralizedAuthReady() {
        return Boolean(this.twitchAuth?.isReady?.());
    }

    _getAvailableClientId() {
        return this.config.clientId || null;
    }

    async initialize() {
        try {
        this.logger.debug('[EVENTSUB-DEBUG] Starting EventSub initialization...', 'twitch');
        this.logger.debug('[EVENTSUB-DEBUG] Current state:', 'twitch', {
            isInitialized: this.isInitialized,
            hasTwitchAuth: !!this.twitchAuth,
            authReady: this.twitchAuth?.isReady?.(),
            hasConfig: !!this.config,
            hasAccessToken: !!secrets.twitch.accessToken,
            hasClientId: !!this.config.clientId
        });
        
        this.logger.debug('[EVENTSUB-DEBUG] Validating configuration...', 'twitch');
        const validation = await this._validateConfig();
        if (!validation.valid) {
            throw new Error(`EventSub validation failed: ${validation.issues.join(', ')}`);
        }
            
            this.logger.info('EventSub configuration validation passed', 'twitch');
        
            if (this.isInitialized) {
                this.logger.debug('EventSub already initialized', 'twitch');
                return;
            }
            
            this.logger.info('Initializing Manual EventSub WebSocket connection', 'twitch');
            
            // Get user ID from auth manager
            this.logger.debug('[EVENTSUB-DEBUG] Getting user ID from auth manager...', 'twitch');
            const userIdRaw = this.twitchAuth.getUserId();
            this.logger.debug('[EVENTSUB-DEBUG] User ID result:', 'twitch', { userIdRaw, type: typeof userIdRaw });
            if (!userIdRaw) {
                throw new Error('No user ID available from AuthManager');
            }
            
            this.userId = userIdRaw.toString(); // Keep as string for API calls
            this.logger.debug(`Using user ID: ${this.userId}`, 'twitch');
            
            this.logger.debug('[EVENTSUB-DEBUG] Cleaning up existing subscriptions...', 'twitch');
            await this._cleanupAllWebSocketSubscriptions();
            this.logger.debug('[EVENTSUB-DEBUG] Cleanup complete', 'twitch');

            this.logger.debug('[EVENTSUB-DEBUG] Connecting to WebSocket...', 'twitch');
            await this._connectWebSocket();
            this.logger.debug('[EVENTSUB-DEBUG] WebSocket connection established', 'twitch');
            
            this.isInitialized = true;
            this.retryAttempts = 0;
            this.logger.info('Manual EventSub initialized successfully', 'twitch');
            
        } catch (error) {
            this._logEventSubError('Manual EventSub initialization failed', error, 'manual-init', {
                stage: 'initialization',
                stack: error.stack
            });
            this._handleInitializationError(error);
        }
    }

    async _connectWebSocket() {
        return this.wsLifecycle.connectWebSocket(this);
    }

    async handleWebSocketMessage(message) {
        const { metadata, payload } = message;
        
        this.logger.info(`EventSub message received: ${metadata.message_type}`, 'twitch');
        
        switch (metadata.message_type) {
            case 'session_welcome':
                this.logger.info('EventSub welcome message received!', 'twitch', {
                    sessionId: payload.session.id,
                    keepaliveTimeout: payload.session.keepalive_timeout_seconds,
                    status: payload.session.status,
                    connectedAt: payload.session.connected_at
                });
                break;
                
            case 'session_keepalive':
                this.logger.debug('EventSub keepalive received', 'twitch');
                break;
                
            case 'notification':
                if (this._isDuplicateMessageId(metadata)) {
                    this.logger.debug(`Duplicate EventSub notification ignored: ${metadata.message_id}`, 'twitch');
                    break;
                }
                this.handleNotificationEvent(payload.subscription.type, payload.event, metadata);
                break;
            
            case 'session_reconnect':
                this.logger.warn('EventSub reconnect requested', 'twitch', payload);
                this._handleReconnectRequest(payload);
                break;
                
            case 'revocation':
                this.logger.warn('EventSub subscription revoked', 'twitch', {
                    subscriptionId: payload.subscription.id,
                    type: payload.subscription.type,
                    status: payload.subscription.status
                });
                await this._handleSubscriptionRevocation(payload?.subscription);
                break;
                
            default:
                this.logger.debug(`Unknown EventSub message type: ${metadata.message_type}`, 'twitch', message);
        }
    }

    async _setupEventSubscriptions(validationAlreadyDone = false) {
        const subscriptionState = await this.subscriptionManager.setupEventSubscriptions({
            requiredSubscriptions: this.requiredSubscriptions,
            userId: this.userId,
            broadcasterId: this.broadcasterId,
            sessionId: this.sessionId,
            subscriptionDelay: this.subscriptionDelay,
            isConnected: this._isConnected,
            validationAlreadyDone
        });

        if (subscriptionState) {
            this.subscriptionState = subscriptionState;
        }

        return subscriptionState;
    }

    _parseSubscriptionError(error, subscription) {
        return this.subscriptionManager.parseSubscriptionError(error, subscription);
    }

    async _handleSubscriptionRevocation(subscription) {
        if (!subscription?.type || !this.isInitialized) {
            return;
        }

        this.subscriptionsReady = false;
        const context = {
            subscriptionType: subscription.type,
            subscriptionId: subscription.id,
            status: subscription.status,
            sessionId: this.sessionId
        };

        this._logEventSubError('EventSub subscription revoked', null, 'subscription-revoked', context);

        try {
            const result = await this._setupEventSubscriptions(true);
            const failures = result?.failures || [];
            if (failures.length > 0) {
                this._logEventSubError('EventSub resubscribe failed after revocation', null, 'subscription-resubscribe-failed', {
                    ...context,
                    failures
                });
                return;
            }

            this.subscriptionsReady = true;
        } catch (error) {
            this._logEventSubError('EventSub resubscribe threw after revocation', error, 'subscription-resubscribe-error', context);
        }
    }

    isActive() {
        return !!(this.isInitialized && this._isConnected && this.subscriptionsReady);
    }

    isConnected() {
        return this._isConnected && this.ws && this.ws.readyState === 1;
    }

    _validateConnectionForSubscriptions() {
        // Check session ID
        if (!this.sessionId || this.sessionId.trim() === '') {
            this._logEventSubError('Cannot set up subscriptions: no session ID', null, 'subscription-setup');
            return false;
        }
        
        // Check connection flag
        if (!this._isConnected) {
            this._logEventSubError('Cannot set up subscriptions: WebSocket not connected', null, 'subscription-setup');
            return false;
        }
        
        // Check WebSocket state
        if (!this.ws || this.ws.readyState !== 1) { // 1 = OPEN
            this._logEventSubError('Cannot set up subscriptions: WebSocket not in OPEN state', null, 'subscription-setup', {
                readyState: this.ws?.readyState,
                hasWebSocket: !!this.ws,
                sessionId: this.sessionId ? 'present' : 'missing'
            });
            return false;
        }
        
        // Check initialization state
        if (!this.isInitialized) {
            this._logEventSubError('Cannot set up subscriptions: EventSub not initialized', null, 'subscription-setup');
            return false;
        }
        
        // Validate auth manager state
        if (!this.twitchAuth || !this.twitchAuth.isReady?.()) {
            this._logEventSubError('Cannot set up subscriptions: Twitch auth not ready', null, 'subscription-setup', {
                hasTwitchAuth: !!this.twitchAuth,
                authReady: this.twitchAuth?.isReady?.() || false
            });
            return false;
        }

        const clientId = this._getAvailableClientId();
        if (!secrets.twitch.accessToken || !clientId) {
            this._logEventSubError('Cannot set up subscriptions: missing authentication tokens', null, 'subscription-setup', {
                hasAccessToken: !!secrets.twitch.accessToken,
                hasClientId: !!clientId
            });
            return false;
        }
        
        this.logger.debug('Connection validation passed for subscription setup', 'twitch', {
            sessionId: this.sessionId.substring(0, 8) + '...',
            isConnected: this._isConnected,
            wsState: this.ws?.readyState,
            isInitialized: this.isInitialized,
            authReady: this.twitchAuth?.isReady?.()
        });
        
        return true;
    }

    handleNotificationEvent(subscriptionType, event, metadata) {
        this.eventRouter.handleNotificationEvent(subscriptionType, event, metadata);
    }

    _handleChatMessageEvent(event) {
        this.eventRouter.handleChatMessageEvent(event);
    }
    
    _handleFollowEvent(event) {
        this.eventRouter.handleFollowEvent(event);
    }
    
    _handlePaypiggyEvent(event) {
        this.eventRouter.handlePaypiggyEvent(event);
    }
    
    _handleRaidEvent(event) {
        this.eventRouter.handleRaidEvent(event);
    }
    
    _handleBitsUseEvent(event) {
        this.eventRouter.handleBitsUseEvent(event);
    }
    
    _handlePaypiggyGiftEvent(event) {
        this.eventRouter.handlePaypiggyGiftEvent(event);
    }
    
    _handlePaypiggyMessageEvent(event) {
        this.eventRouter.handlePaypiggyMessageEvent(event);
    }

    async sendMessage(message) {
        const trimmedMessage = typeof message === 'string' ? message.trim() : '';
        if (!trimmedMessage) {
            throw new Error('EventSub chat send requires a non-empty message');
        }

        if (!this.twitchAuth) {
            throw new Error('EventSub chat send requires Twitch auth');
        }

        const userIdRaw = this.twitchAuth.getUserId?.();
        if (!userIdRaw) {
            throw new Error('EventSub chat send requires a valid user ID');
        }

        const broadcasterId = this.config.broadcasterId.toString();
        const senderId = userIdRaw.toString();
        const payload = {
            broadcaster_id: broadcasterId,
            sender_id: senderId,
            message: trimmedMessage
        };
        const clientId = this._getAvailableClientId();
        if (!clientId) {
            throw new Error('EventSub chat send requires a clientId from config');
        }

        const postMessage = async () => {
            const token = secrets.twitch.accessToken;
            if (!token) {
                throw new Error('EventSub chat send requires an access token');
            }
            await this.axios.post('https://api.twitch.tv/helix/chat/messages', payload, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Client-Id': clientId,
                    'Content-Type': 'application/json'
                }
            });
        };

        try {
            await postMessage();

            this.logger.info('EventSub chat message sent', 'twitch', {
                broadcasterId,
                senderId
            });

            return {
                success: true,
                platform: 'twitch',
                broadcasterId,
                senderId
            };
        } catch (error) {
            if (error?.response?.status === 401) {
                const refreshed = await this.twitchAuth.refreshTokens();
                if (refreshed) {
                    try {
                        await postMessage();
                        this.logger.info('EventSub chat message sent after refresh', 'twitch', {
                            broadcasterId,
                            senderId
                        });
                        return {
                            success: true,
                            platform: 'twitch',
                            broadcasterId,
                            senderId
                        };
                    } catch (retryError) {
                        this._logEventSubError('Failed to send EventSub chat message after refresh', retryError, 'eventsub-chat-send', {
                            broadcasterId,
                            senderId
                        });
                        throw new Error('EventSub chat send failed');
                    }
                }
            }
            this._logEventSubError('Failed to send EventSub chat message', error, 'eventsub-chat-send', {
                broadcasterId,
                senderId
            });
            throw new Error('EventSub chat send failed');
        }
    }

    _handleStreamOnlineEvent(event) {
        this.eventRouter.handleStreamOnlineEvent(event);
    }

    _handleStreamOfflineEvent(event) {
        this.eventRouter.handleStreamOfflineEvent(event);
    }

    _handleReconnectRequest(payload) {
        this.wsLifecycle.handleReconnectRequest(this, payload);
    }

    _scheduleReconnect() {
        this.wsLifecycle.scheduleReconnect(this);
    }

    async _reconnect() {
        await this.wsLifecycle.reconnect(this);
    }
    
    _handleInitializationError(error) {
        this.isInitialized = false;
        this._isConnected = false;
        this.subscriptionsReady = false;
        
        this.retryAttempts++;
        
        if (this.retryAttempts <= this.maxRetryAttempts) {
            this.logger.warn('EventSub initialization failed - retrying', 'twitch', {
                attempt: this.retryAttempts,
                maxAttempts: this.maxRetryAttempts,
                retryDelay: this.retryDelay,
                error: error.message
            });
            
            this.reconnectTimeout = safeSetTimeout(() => {
                this.initialize();
            }, validateTimeout(this.retryDelay, 5000));
        } else {
            this._logEventSubError('EventSub initialization failed after all retries', null, 'eventsub-init-retry', {
                finalError: error.message
            });
        }
    }
    
    async cleanup() {
        this.logger.info('Starting EventSub cleanup...', 'twitch');
        
        // Clear any pending timers first
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        
        if (this.welcomeTimer) {
            clearTimeout(this.welcomeTimer);
            this.welcomeTimer = null;
        }
        
        // Clear the periodic cleanup interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        
        // Step 1: Delete all subscriptions via API (as per docs)
        await this._deleteAllSubscriptions();
        
        // Step 2: Close WebSocket connection properly
        if (this.ws) {
            try {
                // Remove WebSocket listeners before closing
                this.ws.removeAllListeners();
                // Close with normal closure code as per WebSocket spec
                this.ws.close(1000, 'Normal cleanup');
                this.logger.info('EventSub WebSocket closed normally', 'twitch');
            } catch (error) {
                this._logEventSubError('Error closing EventSub WebSocket', error, 'ws-close');
            }
            this.ws = null;
        }
        
        // Step 3: Reset internal state
        this.isInitialized = false;
        this._isConnected = false;
        this.subscriptionsReady = false;
        this.sessionId = null;
        this.retryAttempts = 0;
        this.subscriptions.clear();
        this.connectionStartTime = null;
        
        this.logger.info('EventSub cleanup completed', 'twitch');
    }

    async _cleanupAllWebSocketSubscriptions() {
        await this.subscriptionManager.cleanupAllWebSocketSubscriptions({ sessionId: this.sessionId });
    }

    async _deleteAllSubscriptions() {
        await this.subscriptionManager.deleteAllSubscriptions({ sessionId: this.sessionId });
    }

    async logRawPlatformData(eventType, data) {
        return this.chatFileLoggingService.logRawPlatformData('twitch', eventType, data, this.config);
    }

    _logEventSubError(message, error = null, eventType = 'twitch-eventsub', payload = null) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, payload, message);
        } else if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'twitch', payload || error);
        }
    }
}

module.exports = TwitchEventSub;
