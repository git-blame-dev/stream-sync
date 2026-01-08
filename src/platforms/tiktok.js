
const { EventEmitter } = require('events');
const { getLazyLogger, getLazyUnifiedLogger } = require('../utils/logger-utils');
const { PlatformInitializationManager } = require('../utils/platform-initialization-manager');
const { ConfigValidator } = require('../utils/config-validator');
const { IntervalManager } = require('../utils/interval-manager');
const { InitializationStatistics } = require('../utils/initialization-statistics');
const { ConnectionStateManager } = require('../utils/connection-state-manager');
const { PlatformConnectionFactory } = require('../utils/platform-connection-factory');
const { PlatformEvents } = require('../interfaces/PlatformEvents');
const { safeSetTimeout } = require('../utils/timeout-validator');
const { resolveTikTokTimestampMs, resolveTikTokTimestampISO } = require('../utils/tiktok-timestamp');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { createMonetizationErrorPayload } = require('../utils/monetization-error-utils');
const { createRetrySystem } = require('../utils/retry-system');
const { extractTikTokUserData, extractTikTokGiftData, logTikTokGiftData, formatCoinAmount } = require('../utils/tiktok-data-extraction');
const { validateNotificationManagerInterface } = require('../utils/dependency-validator');
const { normalizeTikTokMessage } = require('../utils/message-normalization');
const { normalizeTikTokPlatformConfig, validateTikTokPlatformConfig } = require('./tiktok/config/tiktok-config');
const { createTikTokConnectionOrchestrator } = require('./tiktok/connection/tiktok-connection-orchestrator');
const { cleanupTikTokEventListeners, setupTikTokEventListeners } = require('./tiktok/events/tiktok-event-router');
const { createTikTokGiftAggregator } = require('./tiktok/gifts/tiktok-gift-aggregator');

class TikTokPlatform extends EventEmitter {
    constructor(config = {}, dependencies = {}) {
        super(); // Call EventEmitter constructor first to ensure proper prototype chain

        this.handlers = this._createDefaultHandlers();
        // Initialize logger with dependency injection support
        if (dependencies.logger) {
            this.logger = dependencies.logger;
        } else {
            this.logger = getLazyUnifiedLogger();
            if (!this.logger) {
                this.logger = getLazyLogger();
            }
        }
        this.errorHandler = createPlatformErrorHandler(this.logger, 'tiktok');
        this.eventBus = dependencies.eventBus || null;
        this.notificationManager = dependencies.notificationManager;
        
        // Initialize extracted services (conditionally for test environments)
        this.initializationManager = dependencies.initializationManager || new PlatformInitializationManager('tiktok', this.logger);
        this.configValidator = dependencies.configValidator || new ConfigValidator(this.logger);
        this.intervalManager = dependencies.intervalManager || new IntervalManager('tiktok', this.logger);
        this.initializationStats = dependencies.initializationStats || new InitializationStatistics('tiktok', this.logger);
        this.listenersConfigured = false;
        this.recentPlatformMessageIds = new Map();

        this.config = normalizeTikTokPlatformConfig(config, this.configValidator);

        this.TikTokWebSocketClient = dependencies.TikTokWebSocketClient;
        this.WebcastEvent = dependencies.WebcastEvent;
        this.ControlEvent = dependencies.ControlEvent;
        this.retrySystem = dependencies.retrySystem || createRetrySystem({ logger: this.logger });
        this.timestampService = dependencies.timestampService || null;
        this._validateDependencies(dependencies, this.config);
        
        // Initialize event factories for standardized event creation (with safe fallbacks for tests)
        // Use simple factory that spreads params for consistent structure
        this.eventFactory = {
            createChatMessage: (data = {}, options = {}) => {
                const normalized = options.normalizedData || normalizeTikTokMessage(data, this.platformName, this.timestampService);
                const identity = this._normalizeUserData({
                    userId: normalized?.userId,
                    username: normalized?.username
                });

                if (!normalized?.message) {
                    throw new Error('Missing TikTok message text');
                }
                if (!normalized?.timestamp) {
                    throw new Error('Missing TikTok message timestamp');
                }
                const messageText = normalized.message;
                const timestamp = normalized.timestamp;

                return {
                    type: 'platform:chat-message',
                    platform: 'tiktok',
                    username: identity.username,
                    userId: identity.userId,
                    message: {
                        text: messageText
                    },
                    timestamp,
                    metadata: this._buildEventMetadata(normalized?.metadata)
                };
            },
            createGift: (data = {}) => {
                const { username, userId } = extractTikTokUserData(data);
                const metadataExtras = {};
                if (data.enhancedGiftData) {
                    metadataExtras.isAggregated = data.enhancedGiftData.isAggregated;
                    metadataExtras.aggregatedCount = data.aggregatedCount ?? data.enhancedGiftData.giftCount;
                    metadataExtras.enhancedGiftData = data.enhancedGiftData;
                }

                if (typeof data.giftType !== 'string' || !data.giftType.trim()) {
                    throw new Error('TikTok gift requires giftType');
                }
                if (typeof data.giftCount !== 'number' || !Number.isFinite(data.giftCount) || data.giftCount <= 0) {
                    throw new Error('TikTok gift requires giftCount');
                }
                if (typeof data.amount !== 'number' || !Number.isFinite(data.amount) || data.amount <= 0) {
                    throw new Error('TikTok gift requires amount');
                }
                if (typeof data.currency !== 'string' || !data.currency.trim()) {
                    throw new Error('TikTok gift requires currency');
                }
                if (data.timestamp === undefined || data.timestamp === null) {
                    throw new Error('TikTok gift requires timestamp');
                }
                const giftType = data.giftType.trim();
                const giftCount = data.giftCount;
                const repeatCount = Number.isFinite(Number(data.repeatCount))
                    ? Number(data.repeatCount)
                    : undefined;
                const resolvedGiftDetails = data.giftDetails || {};
                const unitAmountRaw = data.unitAmount;
                if (typeof unitAmountRaw !== 'number' || !Number.isFinite(unitAmountRaw)) {
                    throw new Error('TikTok gift requires unitAmount');
                }
                const unitAmount = unitAmountRaw;
                const resolvedAmount = data.amount;
                const currency = data.currency.trim();
                const identity = this._normalizeUserData({
                    userId,
                    username
                });
                const platformMessageId = this._getPlatformMessageId(data);
                if (!platformMessageId) {
                    throw new Error('TikTok gift requires msgId');
                }
                const isAggregated = (metadataExtras.isAggregated !== undefined)
                    ? metadataExtras.isAggregated
                    : (data.metadata?.isAggregated !== undefined
                        ? data.metadata.isAggregated
                        : Boolean(data.aggregatedCount || this.config.giftAggregationEnabled));
                const aggregatedCountValue = metadataExtras.aggregatedCount
                    || data.metadata?.aggregatedCount
                    || data.aggregatedCount
                    || giftCount;

                return {
                    type: 'platform:gift',
                    platform: 'tiktok',
                    username: identity.username,
                    userId: identity.userId,
                    giftType,
                    giftCount,
                    amount: resolvedAmount,
                    currency,
                    ...(repeatCount !== undefined ? { repeatCount } : {}),
                    id: platformMessageId,
                    timestamp: data.timestamp,
                    metadata: this._buildEventMetadata({
                        giftId: resolvedGiftDetails.giftId,
                        isAggregated,
                        aggregatedCount: aggregatedCountValue,
                        ...metadataExtras,
                        ...(data.metadata || {})
                    })
                };
            },
            createFollow: (params) => {
                const identity = this._normalizeUserData({
                    userId: params.userId,
                    username: params.username
                });

                return {
                    type: 'platform:follow',
                    platform: 'tiktok',
                    username: identity.username,
                    userId: identity.userId,
                    timestamp: params.timestamp,
                    metadata: this._buildEventMetadata(params.metadata)
                };
            },
            createShare: (params = {}) => {
                const identity = this._normalizeUserData({
                    userId: params.userId,
                    username: params.username
                });

                return {
                    type: 'platform:share',
                    platform: 'tiktok',
                    username: identity.username,
                    userId: identity.userId,
                    timestamp: params.timestamp,
                    metadata: this._buildEventMetadata({
                        interactionType: 'share',
                        ...(params.metadata || {})
                    })
                };
            },
            createEnvelope: (data = {}) => {
                const { userId, username } = extractTikTokUserData(data);
                const identity = this._normalizeUserData({ userId, username });
                const messageId = this._getPlatformMessageId(data);
                if (!messageId) {
                    throw new Error('Missing TikTok envelope message id');
                }

                const amount = Number(data?.giftCoins ?? data?.amount);
                if (!Number.isFinite(amount)) {
                    throw new Error('Missing TikTok envelope gift amount');
                }
                const currency = typeof data?.currency === 'string' ? data.currency.trim() : '';
                if (!currency) {
                    throw new Error('TikTok envelope requires currency');
                }

                return {
                    type: 'platform:envelope',
                    platform: 'tiktok',
                    username: identity.username,
                    userId: identity.userId,
                    giftType: 'Treasure Chest',
                    giftCount: 1,
                    repeatCount: 1,
                    amount,
                    currency,
                    id: messageId,
                    timestamp: this._getTimestamp(data),
                    metadata: this._buildEventMetadata({
                        originalData: data
                    })
                };
            },
            createSubscription: (data = {}) => {
                const { userId, username } = extractTikTokUserData(data);
                const identity = this._normalizeUserData({ userId, username });
                const tier = typeof data?.tier === 'string' ? data.tier.trim() : '';
                const message = typeof data?.message === 'string' ? data.message.trim() : '';
                const months = Number(data?.months);

                const payload = {
                    type: PlatformEvents.PAYPIGGY,
                    platform: 'tiktok',
                    ...identity,
                    metadata: this._buildEventMetadata({
                        originalData: data
                    }),
                    timestamp: this._getTimestamp(data)
                };
                if (tier) {
                    payload.tier = tier;
                }
                if (Number.isFinite(months) && months > 0) {
                    payload.months = months;
                }
                if (message) {
                    payload.message = message;
                }
                return payload;
            },
            createSuperfan: (data = {}) => {
                const { userId, username } = extractTikTokUserData(data);
                const identity = this._normalizeUserData({ userId, username });
                const tier = typeof data?.tier === 'string' ? data.tier.trim() : '';
                const message = typeof data?.message === 'string' ? data.message.trim() : '';
                const months = Number(data?.months);

                const payload = {
                    type: PlatformEvents.PAYPIGGY,
                    platform: 'tiktok',
                    ...identity,
                    tier: 'superfan',
                    metadata: this._buildEventMetadata({
                        originalData: data
                    }),
                    timestamp: this._getTimestamp(data)
                };
                if (Number.isFinite(months) && months > 0) {
                    payload.months = months;
                }
                if (message) {
                    payload.message = message;
                }
                return payload;
            },
            createConnection: (connectionId = PlatformEvents._generateCorrelationId()) => {
                const correlationId = PlatformEvents._generateCorrelationId();
                const timestamp = new Date().toISOString();
                return {
                    type: PlatformEvents.CHAT_CONNECTED,
                    platform: 'tiktok',
                    connectionId,
                    timestamp,
                    metadata: {
                        platform: 'tiktok',
                        correlationId
                    }
                };
            },
            createDisconnection: (reason, willReconnect) => {
                const correlationId = PlatformEvents._generateCorrelationId();
                const timestamp = new Date().toISOString();
                return {
                    type: PlatformEvents.CHAT_DISCONNECTED,
                    platform: 'tiktok',
                    reason,
                    willReconnect,
                    timestamp,
                    metadata: {
                        platform: 'tiktok',
                        correlationId
                    }
                };
            },
            createError: (error, context) => {
                const correlationId = PlatformEvents._generateCorrelationId();
                const timestamp = new Date().toISOString();
                return {
                    type: PlatformEvents.ERROR,
                    platform: 'tiktok',
                    error: {
                        message: error.message,
                        name: error.name
                    },
                    context: {
                        ...(context || {}),
                        correlationId
                    },
                    recoverable: context?.recoverable !== undefined ? context.recoverable : true,
                    metadata: {
                        platform: 'tiktok',
                        correlationId,
                        timestamp
                    }
                };
            }
        };
        
        // Track planned vs unexpected disconnections
        this.isPlannedDisconnection = false;
        
        // Setup connection state interface for retry system using WebSocket state
        if (this.retrySystem && typeof this.retrySystem === 'object') {
            this.retrySystem.isConnected = (platform) => {
                if (platform !== 'tiktok') return false;
                // Use connection's built-in state management
                return this.connection && this.connection.isConnected;
            };
        }
        
        // Initialize connection state management (Solution C: Factory + State Manager pattern)
        this.connectionFactory = dependencies.connectionFactory || new PlatformConnectionFactory();
        this.connectionStateManager = new ConnectionStateManager('tiktok', this.connectionFactory);
        this.connectionStateManager.initialize(this.config, { ...dependencies, logger: this.logger });
        
        // Initialize chat file logging service via dependency injection
        const ChatFileLoggingService = dependencies.ChatFileLoggingService || require('../services/ChatFileLoggingService');
        this.chatFileLoggingService = new ChatFileLoggingService({
            logger: this.logger,
            config: this.config
        });
        
        // Initialize self-message detection service via dependency injection
        this.selfMessageDetectionService = dependencies.selfMessageDetectionService || null;

        this.viewerCountProvider = dependencies.viewerCountProvider || {
            getViewerCount: () => 0,
            isReady: () => false
        };

        this.connection = null;
        this.platformName = 'tiktok';
        this.handlers = this._createDefaultHandlers();
        this.connectionActive = false;
        this.connectionTime = 0;
        this.connectingPromise = null;
        this.retryLock = false;

        // Gift aggregation system
        this.giftAggregation = {}; // Track gift aggregation by user and gift name
        this.giftAggregationDelay = 2000; // 2-second delay for gift aggregation
        this.giftAggregator = createTikTokGiftAggregator({ platform: this, safeSetTimeout });

        // Viewer count cache
        this.cachedViewerCount = 0;
        this.connectionOrchestrator = createTikTokConnectionOrchestrator({ platform: this });

    }

    _validateDependencies(dependencies = {}, config = {}) {
        const isEnabled = this.configValidator
            ? this.configValidator.parseBoolean(config.enabled, false)
            : Boolean(config?.enabled);

        if (!isEnabled) {
            return;
        }

        const missing = [];

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

    checkConnectionPrerequisites() {
        const reasons = [];
        
        if (!this.config.enabled) {
            reasons.push('Platform disabled in configuration');
        }
        
        if (!this.config.username) {
            reasons.push('Username is required');
        }
        
        if (this.connection && this.connection.isConnecting) {
            reasons.push('Already connecting');
        }
        
        if (this.connection && this.connection.isConnected) {
            reasons.push('Already connected');
        }
        
        return {
            canConnect: reasons.length === 0,
            reasons: reasons,
            reason: reasons[0] // Backward compatibility
        };
    }
    
    get connectionStatus() {
        return Boolean(this.connection && (this.connection.connected || this.connection.isConnected));
    }

    get isConnecting() {
        return this.connection ? this.connection.isConnecting : false;
    }

    getConnectionState() {
        return {
            isConnected: this.connection ? this.connection.isConnected : false,
            isConnecting: this.connection ? this.connection.isConnecting : false,
            hasConnection: !!this.connection,
            connectionId: this.connection?.connectionId || 'N/A',
            connectionTime: this.connectionTime
        };
    }

    getStats() {
        return {
            platform: 'tiktok',
            enabled: this.config.enabled,
            connected: Boolean(this.connection && (this.connection.connected || this.connection.isConnected)),
            connecting: this.connection ? this.connection.isConnecting : false,
            config: {
                username: this.config.username,
                viewerCountEnabled: this.config.viewerCountEnabled,
                greetingsEnabled: this.config.greetingsEnabled
            }
        };
    }

    isConfigured() {
        return !!(this.config.enabled && this.config.username);
    }

    validateConfig() {
        return validateTikTokPlatformConfig(this.config);
    }
    
    async initialize(handlers) {
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
                connectionTime,
                handlersCount: Object.keys(this.handlers).length
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
                this.queueRetry(error);
            } else {
                this.errorHandler.handleConnectionError(
                    error,
                    'connection',
                    `Connection failed: ${error?.message || error}`
                );
            }

            // Propagate initialization failure so lifecycle managers can reflect accurate state
            throw error;
        }
    }

    async _connect(handlers) {
        return this.connectionOrchestrator.connect(handlers);
    }


    _handleConnectionError(error) {
        const username = this.config.username;
        // Safely extract error message
        const errorMessage = error?.message || error?.toString() || 'Unknown error';
        this.errorHandler.handleConnectionError(
            error,
            'connection',
            `TikTok connection error for user '${username}': ${errorMessage}`
        );
        
        // Check for specific error types and provide contextual guidance
        if (errorMessage.includes('fetchIsLive')) {
            this.logger.warn(`Stream status check failed for TikTok user '${username}' - may be a temporary API issue or user may not exist`, 'tiktok');
        } else if (errorMessage.includes('waitUntilLive')) {
            this.logger.warn(`Stream wait operation failed for TikTok user '${username}' - stream may have gone offline or user may not be streaming`, 'tiktok');
        } else if (errorMessage.includes('connect')) {
            this.logger.warn(`Connection establishment failed for TikTok user '${username}' - may need retry or user may have ended stream`, 'tiktok');
        } else if (errorMessage.includes('TLS') || errorMessage.includes('socket disconnected')) {
            this.logger.warn(`TLS/Network connection failed for TikTok user '${username}' - check firewall settings and network connectivity`, 'tiktok');
        } else if (errorMessage.includes('room info') || errorMessage.includes('Failed to retrieve')) {
            this.logger.warn(`Room info retrieval failed for TikTok user '${username}' - verify username is correct and user exists on TikTok`, 'tiktok');
        }
    }

    setupEventListeners() {
        setupTikTokEventListeners(this);
    }

    async _logIncomingEvent(eventType, data) {
        if (!this.config.dataLoggingEnabled) {
            return;
        }
        try {
            await this.logRawPlatformData(eventType, data);
        } catch (error) {
            this.logger.warn(`Failed to log TikTok event '${eventType}': ${error?.message || error}`, 'tiktok');
        }
    }

    async _logRawEvent(eventType, data) {
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
    
    handleConnectionError(err) {
        const username = this.config.username;
        const details = this._normalizeErrorDetails(err);
        const errorMessage = details.message;
        const isStreamNotLive = this._isStreamNotLive(details);
        if (isStreamNotLive) {
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

    handleRetry(err) {
        const username = this.config.username;
        
        if (this.retrySystem) {
            // Check if error is recoverable
            const errorMessage = err?.message || err?.toString() || 'Unknown error';
            const isRecoverableError = this._isRecoverableError(errorMessage);
            
            if (!isRecoverableError) {
                this.logger.warn(`Non-recoverable error for TikTok user '${username}', skipping retry: ${errorMessage}`, 'tiktok');
                return;
            }
            
            this.logger.debug(`Attempting retry for TikTok user '${username}' after error: ${errorMessage}`, 'tiktok');
            this.queueRetry(err);
        } else {
            this.logger.warn(`No retry system available for TikTok user '${username}', connection will not be retried`, 'tiktok');
        }
    }
    
    _normalizeErrorDetails(err) {
        const mapError = (source) => {
            if (!source) {
                return { message: 'Unknown error' };
            }

            if (!source.response && source.exception && typeof source.exception === 'object') {
                source.response = source.exception.response || source.response;
                source.requestUrl = source.exception.requestUrl
                    || source.requestUrl
                    || source.exception.url
                    || source.exception.config?.url;
                source.code = source.code || source.exception.code || source.exception.statusCode;
            }

            const baseMessage = source.message || source.info || source.toString() || 'Unknown error';
            const responseBody = typeof source.response?.body === 'string'
                ? source.response.body.slice(0, 512)
                : (typeof source.response?.data === 'string' ? source.response.data.slice(0, 512) : undefined);

            return {
                message: baseMessage,
                info: source.info,
                code: source.code || source.status || source.statusCode,
                url: source.url || source.requestUrl,
                responseStatus: source.response?.status || source.statusCode,
                responseBody
            };
        };

        const details = mapError(err);

        // Capture nested connector errors array (e.g., fetchRoomId fallbacks)
        if (Array.isArray(err?.errors) && err.errors.length) {
            details.causes = err.errors.slice(0, 3).map((nestedErr) => mapError(nestedErr));
            if (err.errors.length > 3) {
                details.remainingCauses = err.errors.length - details.causes.length;
            }
        }

        return details;
    }

    _normalizeConnectionIssue(issue) {
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
            const message = issue.reason || issue.message;
            const code = typeof issue.code === 'number' ? issue.code : undefined;
            return {
                message: message || 'Unknown disconnect reason',
                code
            };
        }

        return { message: String(issue) };
    }

    _isStreamNotLive(detailsOrMessage) {
        const message = typeof detailsOrMessage === 'string'
            ? detailsOrMessage
            : detailsOrMessage?.message;
        const code = typeof detailsOrMessage === 'object'
            ? detailsOrMessage?.code
            : undefined;
        if (code === 4404) {
            return true;
        }
        if (!message) {
            return false;
        }
        return message.toLowerCase().includes('not live');
    }

    _formatStreamNotLiveMessage(username, details) {
        const codeSuffix = details?.code ? ` (code ${details.code})` : '';
        return `Stream is not live for TikTok user '${username}'${codeSuffix}`;
    }

    _recordNotLiveWarning() {
        this._lastNotLiveWarningAt = Date.now();
    }

    _wasRecentlyNotLiveLogged() {
        if (!this._lastNotLiveWarningAt) {
            return false;
        }
        return Date.now() - this._lastNotLiveWarningAt < 2000;
    }

    _isRecoverableError(errorMessage) {
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
    
    queueRetry(error) {
        if (!this.retrySystem) {
            return;
        }
        if (this.retryLock) {
            return;
        }

        this.retryLock = true;

        const reconnectFn = async () => {
            // Unlock before attempting so a subsequent failure can schedule again
            this.retryLock = false;
            try {
                await this._connect(this.handlers);
            } catch (err) {
                // Re-queue on failure (lock will be re-acquired)
                this.queueRetry(err);
            }
        };

        this.retrySystem.handleConnectionError(
            'tiktok',
            error,
            reconnectFn,
            () => this.cleanup()
        );
    }
    
    async handleConnectionIssue(issue, isError = false) {
        const username = this.config.username;
        const normalizedIssue = this._normalizeConnectionIssue(issue);
        const message = normalizedIssue.message;
        const isStreamNotLive = this._isStreamNotLive(normalizedIssue);
        if (isStreamNotLive) {
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
        
        // Emit disconnection event
        const disconnectionMessage = isStreamNotLive ? 'Stream is not live' : message;
        await this._handleDisconnection(disconnectionMessage);
        
        // Trigger reconnection attempt for both errors and disconnections
        // Stream restarts should automatically reconnect
        if (this.retrySystem) {
            // Create an error object for the retry system if we have a simple disconnect reason
            const errorForRetry = isError ? issue : new Error(`TikTok disconnected: ${disconnectionMessage}`);
            this.queueRetry(errorForRetry);
        } else {
            this.logger.warn('No retry system available, connection will not be retried', 'tiktok');
        }
    }
    
    getStatus() {
        return {
            platform: 'TikTok',
            enabled: this.config.enabled,
            username: this.config.username,
            isConnecting: this.connection ? this.connection.isConnecting : false,
            isConnected: Boolean(this.connection && (this.connection.connected || this.connection.isConnected)),
            connectionStatus: this.connectionStatus,
            hasConnection: !!this.connection,
            connectionId: this.connection?.connectionId || 'N/A'
        };
    }

    async handleTikTokGift(data) {
        // Fast path for invalid data - skip expensive processing
        if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
            this.logger.warn('handleTikTokGift called with empty or invalid data', 'tiktok', { data });
            return;
        }
        try {
            // Use robust extraction utilities (from src/utils/tiktok-data-extraction.js)
            const { userId, username } = extractTikTokUserData(data);
            const { giftType, giftCount, amount, currency, unitAmount, comboType, repeatEnd } = extractTikTokGiftData(data);
            const identityKey = userId;

            // Validate required fields
            if (!userId || !username || !giftType) {
                this.logger.warn('Gift event missing required fields', 'tiktok', { data, userId, username, giftType });
                const fieldError = new Error('TikTok gift payload missing required fields');
                this.errorHandler.handleEventProcessingError(
                    fieldError,
                    'gift-missing-fields',
                    { data, userId, username, giftType }
                );
                const errorPayload = this._createMonetizationErrorPayload('gift', data, {
                    username,
                    userId,
                    giftType
                });
                this._emitPlatformEvent('gift', errorPayload);
                return;
            }

            // CRITICAL: Validate gift count - 0 means TikTok data is malformed
            if (giftCount === 0) {
                const countError = new Error('[TikTok Gift] INVALID COUNT - repeatCount missing from TikTok API');
                const context = {
                    userId,
                    username,
                    giftType,
                    amount,
                    currency,
                    hasRepeatCount: 'repeatCount' in data,
                    repeatCountValue: data.repeatCount,
                    rawDataKeys: Object.keys(data),
                    timestamp: new Date().toISOString(),
                    reason: 'gift-count-invalid',
                    recoverable: true
                };

                this.errorHandler.handleEventProcessingError(
                    countError,
                    'gift-count-invalid',
                    context,
                    'Invalid TikTok gift count payload'
                );

                await this._handleError(countError, context);

                const errorPayload = this._createMonetizationErrorPayload('gift', data, {
                    username,
                    userId,
                    giftType,
                    giftCount,
                    amount,
                    currency
                });
                this._emitPlatformEvent('gift', errorPayload);
                return;
            }

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
                await this.handleOfficialGift(identityKey, username, giftType, giftCount, unitAmount, amount, currency, isStreakCompleted, data);
                return; // Exit early, no aggregation needed
            }

            // Use standard aggregation for all processable gifts
            await this.handleStandardGift(identityKey, username, giftType, giftCount, unitAmount, currency, data);

        } catch (error) {
            if (error?.message && error.message.includes('repeatCount')) {
                await this._handleError(error, {
                    reason: 'gift-count-invalid',
                    recoverable: true,
                    data
                });
                const fallbackGiftType = typeof data?.giftDetails?.giftName === 'string'
                    ? data.giftDetails.giftName
                    : undefined;
                let fallbackIdentity = {};
                try {
                    fallbackIdentity = extractTikTokUserData(data);
                } catch {
                    fallbackIdentity = {};
                }
                const errorPayload = this._createMonetizationErrorPayload('gift', data, {
                    username: fallbackIdentity.username,
                    userId: fallbackIdentity.userId,
                    giftType: fallbackGiftType
                });
                this._emitPlatformEvent('gift', errorPayload);
                return;
            }
            this.errorHandler.handleEventProcessingError(
                error,
                'gift-processing',
                data,
                'Error processing gift'
            );
            const fallbackGiftType = typeof data?.giftDetails?.giftName === 'string'
                ? data.giftDetails.giftName
                : undefined;
            let fallbackIdentity = {};
            try {
                fallbackIdentity = extractTikTokUserData(data);
            } catch {
                fallbackIdentity = {};
            }
            const errorPayload = this._createMonetizationErrorPayload('gift', data, {
                username: fallbackIdentity.username,
                userId: fallbackIdentity.userId,
                giftType: fallbackGiftType
            });
            this._emitPlatformEvent('gift', errorPayload);
        }
    }

    async handleOfficialGift(identityKey, username, giftType, giftCount, unitAmount, amount, currency, isStreakCompleted, originalData) {
        // Log gift data for analysis
        const processedData = {
            username,
            giftType: giftType,
            giftCount: giftCount,
            amount,
            currency
        };
        await logTikTokGiftData(originalData, processedData, `${identityKey}-${giftType}`, {
            logger: this.logger,
            errorHandler: this.errorHandler
        });

        // Create gift message with streak indication
        let giftMessage = isStreakCompleted 
            ? `${username} completed a streak of ${giftCount}x ${giftType}`
            : `${username} sent ${giftCount}x ${giftType}`;
        giftMessage += formatCoinAmount(amount, currency);
        this.logger.info(`[Gift] ${giftMessage}`, 'tiktok');

        // Create enhanced gift data for notification
        const extractedIdentity = extractTikTokUserData(originalData);
        const enhancedGiftData = {
            username,
            userId: extractedIdentity.userId,
            giftType: giftType,
            giftCount: giftCount,
            amount,
            currency,
            isAggregated: false,
            isStreakCompleted: isStreakCompleted,
            originalData: originalData
        };


        const giftPayload = {
            ...(originalData || {}),
            user: (originalData?.user && typeof originalData.user === 'object')
                ? originalData.user
                : { userId: extractedIdentity.userId, uniqueId: username },
            repeatCount: originalData?.repeatCount ?? giftCount,
            giftDetails: originalData?.giftDetails || {
                giftName: giftType,
                diamondCount: Number.isFinite(Number(unitAmount)) ? Number(unitAmount) : 0
            },
            aggregatedCount: giftCount,
            giftType,
            giftCount,
            amount,
            currency,
            unitAmount,
            timestamp: resolveTikTokTimestampISO(originalData),
            enhancedGiftData
        };
        delete giftPayload.userId;
        delete giftPayload.uniqueId;
        delete giftPayload.nickname;

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

    async handleStandardGift(identityKey, username, giftType, giftCount, unitAmount, currency, originalData) {
        return this.giftAggregator.handleStandardGift(identityKey, username, giftType, giftCount, unitAmount, currency, originalData);
    }


    cleanupGiftAggregation() {
        this.giftAggregator.cleanupGiftAggregation();
    }

    static resolveEventTimestampMs(data) {
        return resolveTikTokTimestampMs(data);
    }

    static resolveEventTimestampISO(data) {
        const millis = TikTokPlatform.resolveEventTimestampMs(data);
        return millis ? new Date(millis).toISOString() : new Date().toISOString();
    }

    async handleTikTokFollow(data) {
        try {
            const { username, userId } = extractTikTokUserData(data);

            if (!userId || !username) {
                this.logger.warn('[TikTok Follow] Missing canonical identity in follow/share event data', 'tiktok', { data });
                return;
            }

            const inferredActionType = (data?.displayType || data?.actionType || data?.type || 'follow').toLowerCase();
            const actionType = this._inferSocialActionType(data, inferredActionType);

            if (this._shouldSkipDuplicatePlatformMessage(data)) {
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
                `[TikTok Follow] Error processing follow event: ${err.message}`
            );
        }
    }

    async handleTikTokSocial(data) {
        try {
            // Validate data structure
            if (!data || typeof data !== 'object') {
                this.logger.warn('Received invalid social data', 'tiktok', { data });
                return;
            }

            const { username, userId } = extractTikTokUserData(data);
            const inferredActionType = (data.displayType || data.actionType || data.type || 'social').toLowerCase();
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

            if (this._shouldSkipDuplicatePlatformMessage(data)) {
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
                `[TikTok Social] Error processing social event: ${err.message}`
            );
        }
    }

    _inferSocialActionType(data, baseType = 'social') {
        const normalizedBaseType = String(baseType || 'social').toLowerCase();

        const displayText = data?.displayText || data?.common?.displayText || {};
        const defaultPattern = String(displayText.defaultPattern || data?.label || '').toLowerCase();
        const displayType = String(displayText.displayType || data?.displayType || '').toLowerCase();

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

    getViewerCount() {
        return this.cachedViewerCount || 0;
    }

    async logRawPlatformData(eventType, data) {
        // Delegate to centralized service
        return this.chatFileLoggingService.logRawPlatformData('tiktok', eventType, data, this.config);
    }

    cleanupEventListeners() {
        cleanupTikTokEventListeners(this);
    }

    async cleanup() {
        // Mark this as a planned disconnection to prevent unnecessary reconnection attempts
        this.isPlannedDisconnection = true;

        const connection = this.connection;
        if (connection && typeof connection.disconnect === 'function') {
            const hasStateFlags = ('isConnected' in connection) || ('isConnecting' in connection) || ('connected' in connection);
            const shouldDisconnect = hasStateFlags
                ? Boolean(connection.isConnected || connection.isConnecting || connection.connected)
                : true;
            if (shouldDisconnect) {
                try {
                    await connection.disconnect();
                } catch (error) {
                    this.errorHandler.handleCleanupError(
                        error,
                        'connection disconnect',
                        `Error disconnecting TikTok connection: ${error?.message || error}`
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
                `Error clearing intervals during cleanup: ${error?.message || error}`
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

    _normalizeUserData(data = {}) {
        const userId = typeof data.userId === 'string'
            ? data.userId.trim()
            : (typeof data.userId === 'number' ? String(data.userId) : null);
        const username = typeof data.username === 'string'
            ? data.username.trim()
            : (typeof data.username === 'number' ? String(data.username) : null);

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

    _buildEventMetadata(additionalMetadata = {}) {
        return {
            platform: 'tiktok',
            correlationId: PlatformEvents._generateCorrelationId(),
            ...additionalMetadata
        };
    }

    _getTimestamp(data) {
        return TikTokPlatform.resolveEventTimestampISO(data);
    }

    _createMonetizationErrorPayload(notificationType, data, overrides = {}) {
        const id = this._getPlatformMessageId(data);
        return createMonetizationErrorPayload({
            notificationType,
            platform: 'tiktok',
            timestamp: TikTokPlatform.resolveEventTimestampISO(data),
            id: id || undefined,
            ...overrides
        });
    }

    _getPlatformMessageId(data) {
        if (!data || typeof data !== 'object') {
            return null;
        }

        const msgId = data.msgId;
        if (msgId === undefined || msgId === null) {
            return null;
        }

        const normalized = String(msgId).trim();
        return normalized ? normalized : null;
    }

    _shouldSkipDuplicatePlatformMessage(data, ttlMs = 2 * 60 * 1000) {
        const messageId = this._getPlatformMessageId(data);
        if (!messageId) {
            return false;
        }

        const now = Date.now();
        const lastSeen = this.recentPlatformMessageIds.get(messageId);
        if (lastSeen && (now - lastSeen) < ttlMs) {
            return true;
        }

        this.recentPlatformMessageIds.set(messageId, now);

        if (this.recentPlatformMessageIds.size > 2000) {
            const cutoff = now - ttlMs;
            for (const [id, seenAt] of this.recentPlatformMessageIds.entries()) {
                if (seenAt < cutoff) {
                    this.recentPlatformMessageIds.delete(id);
                }
            }
        }

        return false;
    }

    async _handleStandardEvent(eventType, data, options = {}) {
        const factoryMethod = options.factoryMethod || `create${this._capitalize(eventType)}`;
        const emitType = options.emitType || eventType;
        try {
            await this._logRawEvent?.(options.logEventType || emitType, data);
            const eventData = this.eventFactory[factoryMethod](data, options);
            this._emitPlatformEvent(emitType, eventData);
        } catch (error) {
            this.errorHandler.handleEventProcessingError(error, emitType, data);
            if (emitType === 'gift' || emitType === 'paypiggy' || emitType === 'envelope') {
                let errorOverrides = {};
                try {
                    const identity = extractTikTokUserData(data);
                    errorOverrides = {
                        username: identity.username,
                        userId: identity.userId
                    };
                } catch (extractError) {
                    errorOverrides = {};
                }
                if (emitType === 'gift') {
                    const giftType = typeof data?.giftDetails?.giftName === 'string'
                        ? data.giftDetails.giftName
                        : undefined;
                    if (giftType) {
                        errorOverrides.giftType = giftType;
                    }
                    if (!errorOverrides.giftType) {
                        errorOverrides.giftType = 'Unknown gift';
                    }
                    const amount = Number(data?.giftCoins ?? data?.amount ?? 0);
                    errorOverrides.amount = Number.isFinite(amount) ? amount : 0;
                    const repeatCount = Number(data?.giftCount ?? data?.repeatCount ?? 0);
                    errorOverrides.giftCount = Number.isFinite(repeatCount) ? repeatCount : 0;
                    if (typeof data?.currency === 'string' && data.currency.trim()) {
                        errorOverrides.currency = data.currency.trim();
                    } else if (!errorOverrides.currency) {
                        errorOverrides.currency = 'unknown';
                    }
                }
                if (emitType === 'envelope') {
                    errorOverrides.giftType = 'Treasure Chest';
                    const amount = Number(data?.giftCoins ?? data?.amount);
                    if (Number.isFinite(amount)) {
                        errorOverrides.amount = amount;
                    }
                    if (typeof data?.currency === 'string' && data.currency.trim()) {
                        errorOverrides.currency = data.currency.trim();
                    } else {
                        errorOverrides.currency = 'unknown';
                    }
                }
                const errorPayload = this._createMonetizationErrorPayload(emitType, data, errorOverrides);
                this._emitPlatformEvent(emitType, errorPayload);
            }
        }
    }

    _capitalize(str = '') {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }


    async _handleChatMessage(data, normalizedData = null) {
        return this._handleStandardEvent('chatMessage', data, {
            factoryMethod: 'createChatMessage',
            emitType: 'chat',
            normalizedData
        });
    }

    async _handleGift(data) {
        return this._handleStandardEvent('gift', data, {
            factoryMethod: 'createGift',
            emitType: 'gift'
        });
    }

    async _handleFollow(data) {
        try {
            const { username, userId } = extractTikTokUserData(data);

            if (!userId || !username) {
                this.logger.warn('[TikTok Follow] Missing canonical identity in follow event', 'tiktok', { data });
                return;
            }
            
            const eventData = this.eventFactory.createFollow({
                username,
                userId,
                timestamp: TikTokPlatform.resolveEventTimestampISO(data),
                metadata: {
                    platform: 'tiktok'
                }
            });

            this._emitPlatformEvent('follow', eventData);
        } catch (error) {
            this._handleError(error, { operation: 'handleFollow', data });
        }
    }

    async _handleShare(data) {
        try {
            const { username, userId } = extractTikTokUserData(data);

            if (!userId || !username) {
                this.logger.warn('[TikTok Share] Missing canonical identity in share event', 'tiktok', { data });
                return;
            }

            const eventData = this.eventFactory.createShare({
                username,
                userId,
                timestamp: TikTokPlatform.resolveEventTimestampISO(data),
                metadata: {
                    platform: 'tiktok'
                }
            });

            this._emitPlatformEvent('share', eventData);
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
                type: 'chat-connected',
                data: eventData
            });
            this._emitPlatformEvent('stream-status', {
                platform: 'tiktok',
                isLive: true,
                timestamp: eventData.timestamp,
                metadata: eventData.metadata
            });
        } catch (error) {
            this._handleError(error, { operation: 'handleConnection' });
        }
    }

    async _handleDisconnection(reason) {
        try {
            const willReconnect = !this.isPlannedDisconnection && this.config.enabled;
            const eventData = this.eventFactory.createDisconnection(reason, willReconnect);
            const eventPlatform = eventData.platform;
            this.emit('platform:event', {
                platform: eventPlatform,
                type: 'chat-disconnected',
                data: eventData
            });
            this._emitPlatformEvent('stream-status', {
                platform: 'tiktok',
                isLive: false,
                reason,
                willReconnect,
                timestamp: eventData.timestamp,
                metadata: eventData.metadata
            });
        } catch (error) {
            this._handleError(error, { operation: 'handleDisconnection', reason });
        }
    }

    async _handleStreamEnd() {
        this.logger.info('TikTok stream ended; scheduling reconnect checks', 'tiktok');
        this.isPlannedDisconnection = false;
        this.connectionActive = false;
        this.connectionStateManager.markDisconnected();
        this.cleanupEventListeners();
        this.connection = null;
        await this._handleDisconnection('stream-end');
        if (!this.intervalManager.hasInterval('tiktok-stream-reconnect')) {
            this.intervalManager.createInterval(
                'tiktok-stream-reconnect',
                async () => {
                    try {
                        await this._connect(this.handlers);
                    } catch (err) {
                        this.logger.debug(`Reconnect attempt after stream end failed: ${err?.message || err}`, 'tiktok');
                    }
                },
                60000,
                'reconnect'
            );
        }
    }

    async _handleError(error, context) {
        try {
            const eventData = this.eventFactory.createError(error, {
                ...context,
                platform: 'tiktok',
                recoverable: !error.message.includes('fatal')
            });

            const eventPlatform = eventData.platform;
            this.emit('platform:event', {
                platform: eventPlatform,
                type: 'error',
                data: eventData
            });
            this._emitPlatformEvent('stream-status', {
                platform: 'tiktok',
                isLive: false,
                error,
                timestamp: eventData.timestamp,
                metadata: eventData.metadata
            });
        } catch (emitError) {
            this.errorHandler.handleEventProcessingError(
                emitError,
                'platform-error-event',
                null,
                'Error emitting platform error event:'
            );
        }
    }

    _emitPlatformEvent(type, payload) {
        const platform = payload?.platform || 'tiktok';

        // Emit unified platform:event for local listeners
        this.emit('platform:event', { platform, type, data: payload });

        // Route event through injected handler to event bus
        const handlerMap = {
            'chat': 'onChat',
            'gift': 'onGift',
            'follow': 'onFollow',
            'paypiggy': 'onPaypiggy',
            'raid': 'onRaid',
            'share': 'onShare',
            'envelope': 'onEnvelope',
            'stream-status': 'onStreamStatus',
            'viewer-count': 'onViewerCount',
            'interaction': 'onInteraction'
        };

        const handlerName = handlerMap[type];
        const handler = this.handlers?.[handlerName];

        if (typeof handler === 'function') {
            handler(payload);
        }
    }

    _createDefaultHandlers() {
        const emitToBus = (type, data) => this._emitToEventBus(type, data);
        return {
            onChat: (data) => emitToBus('chat', data),
            onViewerCount: (data) => emitToBus('viewer-count', data),
            onGift: (data) => emitToBus('gift', data),
            onPaypiggy: (data) => emitToBus('paypiggy', data),
            onFollow: (data) => emitToBus('follow', data),
            onShare: (data) => emitToBus('share', data),
            onRaid: (data) => emitToBus('raid', data),
            onEnvelope: (data) => emitToBus('envelope', data),
            onStreamStatus: (data) => emitToBus('stream-status', data),
            onInteraction: (data) => emitToBus('interaction', data)
        };
    }

    _emitToEventBus(type, data) {
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

// Export the class
module.exports = {
    TikTokPlatform
};
