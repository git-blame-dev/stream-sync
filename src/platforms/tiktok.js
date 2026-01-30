
const { EventEmitter } = require('events');
const { getLazyLogger, getLazyUnifiedLogger } = require('../utils/logger-utils');
const { PlatformInitializationManager } = require('../utils/platform-initialization-manager');
const { IntervalManager } = require('../utils/interval-manager');
const { InitializationStatistics } = require('../utils/initialization-statistics');
const { ConnectionStateManager } = require('../utils/connection-state-manager');
const { PlatformConnectionFactory } = require('../utils/platform-connection-factory');
const { PlatformEvents } = require('../interfaces/PlatformEvents');
const { safeSetTimeout } = require('../utils/timeout-validator');
const { resolveTikTokTimestampMs } = require('../utils/tiktok-timestamp');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { createMonetizationErrorPayload } = require('../utils/monetization-error-utils');
const { createRetrySystem } = require('../utils/retry-system');
const TimestampExtractionService = require('../services/TimestampExtractionService');
const { getSystemTimestampISO } = require('../utils/validation');
const { extractTikTokUserData, formatCoinAmount } = require('../utils/tiktok-data-extraction');
const { validateNotificationManagerInterface } = require('../utils/dependency-validator');
const { normalizeTikTokChatEvent, normalizeTikTokGiftEvent } = require('./tiktok/events/event-normalizer');
const { normalizeTikTokPlatformConfig, validateTikTokPlatformConfig } = require('./tiktok/config/tiktok-config');
const { createTikTokConnectionOrchestrator } = require('./tiktok/connections/tiktok-connection-orchestrator');
const { cleanupTikTokEventListeners, setupTikTokEventListeners } = require('./tiktok/events/event-router');
const { createTikTokGiftAggregator } = require('./tiktok/monetization/gift-aggregator');
const { createTikTokEventFactory } = require('./tiktok/events/event-factory');

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
        
        this.initializationManager = dependencies.initializationManager || new PlatformInitializationManager('tiktok', this.logger);
        this.intervalManager = dependencies.intervalManager || new IntervalManager('tiktok', this.logger);
        this.initializationStats = dependencies.initializationStats || new InitializationStatistics('tiktok', this.logger);
        this.listenersConfigured = false;
        this.recentPlatformMessageIds = new Map();
        this.deduplicationConfig = {
            maxCacheSize: dependencies.deduplicationMaxCacheSize ?? 2000,
            ttlMs: dependencies.deduplicationTtlMs ?? 2 * 60 * 1000
        };

        this.config = normalizeTikTokPlatformConfig(config);

        this.TikTokWebSocketClient = dependencies.TikTokWebSocketClient;
        this.WebcastEvent = dependencies.WebcastEvent;
        this.ControlEvent = dependencies.ControlEvent;
        this.retrySystem = dependencies.retrySystem || createRetrySystem({ logger: this.logger });
        this.timestampService = dependencies.timestampService
            || new TimestampExtractionService({ logger: this.logger });
        this._validateDependencies(dependencies, this.config);
        
        this.platformName = 'tiktok';
        this.eventFactory = createTikTokEventFactory({
            platformName: this.platformName,
            getTimestamp: (data) => this._getTimestamp(data),
            normalizeUserData: (data) => this._normalizeUserData(data),
            getPlatformMessageId: (data) => this._getPlatformMessageId(data),
            buildEventMetadata: (metadata) => this._buildEventMetadata(metadata),
            normalizeChatEvent: (data) => normalizeTikTokChatEvent(data, {
                platformName: this.platformName,
                timestampService: this.timestampService
            }),
            timestampService: this.timestampService
        });

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
        this.connectionOrchestrator = createTikTokConnectionOrchestrator({ platform: this });

    }

    _validateDependencies(dependencies = {}, config = {}) {
        if (!config.enabled) {
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
        return !!(this.connection && this.connection.isConnected);
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
            connected: !!(this.connection && this.connection.isConnected),
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
        const errorMessage = error?.message || error?.toString() || 'Unknown error';
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

        return { errorCategory, username };
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
        const errorMessage = err?.message || err?.toString() || 'Unknown error';

        if (!this.retrySystem) {
            this.logger.warn(`No retry system available for TikTok user '${username}', connection will not be retried`, 'tiktok');
            return { action: 'skipped', reason: 'no-retry-system' };
        }

        const isRecoverableError = this._isRecoverableError(errorMessage);

        if (!isRecoverableError) {
            this.logger.warn(`Non-recoverable error for TikTok user '${username}', skipping retry: ${errorMessage}`, 'tiktok');
            return { action: 'skipped', reason: 'non-recoverable' };
        }

        this.logger.debug(`Attempting retry for TikTok user '${username}' after error: ${errorMessage}`, 'tiktok');
        this.queueRetry(err);
        return { action: 'retry-queued' };
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
                this.queueRetry(err);
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
    
    async handleConnectionIssue(issue, isError = false) {
        // Prevent double-handling when both DISCONNECTED and STREAM_END fire (e.g., 4404)
        if (this._disconnectionInProgress) {
            return { issueType: 'skipped', retryResult: null, reason: 'disconnection-in-progress' };
        }
        this._disconnectionInProgress = true;

        try {
            const username = this.config.username;
            const normalizedIssue = this._normalizeConnectionIssue(issue);
            const message = normalizedIssue.message;
            const isStreamNotLive = this._isStreamNotLive(normalizedIssue);

            let issueType;
            if (isStreamNotLive) {
                this.logger.warn(this._formatStreamNotLiveMessage(username, normalizedIssue), 'tiktok');
                this._recordNotLiveWarning();
                issueType = 'stream-not-live';
            } else if (isError) {
                this.errorHandler.handleConnectionError(issue, 'connection issue', `Connection issue: ${message}`);
                issueType = 'error';
            } else {
                this.logger.warn(`Connection issue: ${message}`, 'tiktok');
                issueType = 'disconnection';
            }

            // Compute willReconnect BEFORE cleanup (which sets isPlannedDisconnection)
            const willReconnect = !this.isPlannedDisconnection && this.config.enabled;

            this.connectionActive = false;
            await this.cleanup();
            this.connection = null;
            this.listenersConfigured = false;

            const disconnectionMessage = isStreamNotLive ? 'Stream is not live' : message;
            await this._handleDisconnection(disconnectionMessage, willReconnect);

            let retryResult = null;
            if (this.retrySystem && willReconnect) {
                const errorForRetry = isError ? issue : new Error(`TikTok disconnected: ${disconnectionMessage}`);
                retryResult = this.queueRetry(errorForRetry);
            } else if (!willReconnect) {
                this.logger.debug('Skipping retry: planned disconnection or platform disabled', 'tiktok');
                retryResult = { queued: false, reason: 'no-retry-needed' };
            } else {
                this.logger.warn('No retry system available, connection will not be retried', 'tiktok');
                retryResult = { queued: false, reason: 'no-retry-system' };
            }

            return { issueType, retryResult };
        } finally {
            this._disconnectionInProgress = false;
        }
    }
    
    getStatus() {
        return {
            platform: 'TikTok',
            enabled: this.config.enabled,
            username: this.config.username,
            isConnecting: this.connection ? this.connection.isConnecting : false,
            isConnected: !!(this.connection && this.connection.isConnected),
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
            const normalizedGift = normalizeTikTokGiftEvent(data, {
                platformName: this.platformName,
                timestampService: this.timestampService,
                getTimestamp: (payload) => this._getTimestamp(payload),
                getPlatformMessageId: (payload) => this._getPlatformMessageId(payload)
            });
            const {
                userId,
                username,
                giftType,
                giftCount,
                amount,
                currency,
                unitAmount,
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
            if (error?.message && error.message.includes('repeatCount')) {
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

    async handleOfficialGift(gift, options = {}) {
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

        const giftPayload = {
            platform: gift.platform || 'tiktok',
            userId: gift.userId,
            username,
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

    async handleStandardGift(gift) {
        return this.giftAggregator.handleStandardGift(gift);
    }


    cleanupGiftAggregation() {
        this.giftAggregator.cleanupGiftAggregation();
    }

    static resolveEventTimestampMs(data) {
        return resolveTikTokTimestampMs(data);
    }

    static resolveEventTimestampISO(data) {
        const millis = TikTokPlatform.resolveEventTimestampMs(data);
        return millis ? new Date(millis).toISOString() : null;
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
        if (this.timestampService && typeof this.timestampService.extractTimestamp === 'function') {
            return this.timestampService.extractTimestamp('tiktok', data);
        }
        return TikTokPlatform.resolveEventTimestampISO(data);
    }

    _buildGiftErrorOverrides(data) {
        if (!data || typeof data !== 'object') {
            return {};
        }

        const normalizeString = (value) => {
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

        const user = (data.user && typeof data.user === 'object') ? data.user : null;
        const userId = normalizeString(user?.userId ?? data.userId);
        const username = normalizeString(user?.uniqueId ?? data.username);
        const giftDetails = (data.giftDetails && typeof data.giftDetails === 'object') ? data.giftDetails : null;
        const giftType = normalizeString(giftDetails?.giftName);

        const giftCountValue = Number(data.repeatCount);
        const giftCount = Number.isFinite(giftCountValue) && giftCountValue > 0 ? giftCountValue : null;

        const amountValue = Number(data.giftCoins ?? data.amount);
        const amount = Number.isFinite(amountValue) && amountValue > 0 ? amountValue : null;
        const currency = normalizeString(data.currency);

        const overrides = {};
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

    _createMonetizationErrorPayload(notificationType, data, overrides = {}) {
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
        return createMonetizationErrorPayload({
            notificationType,
            platform: 'tiktok',
            timestamp,
            id: id || undefined,
            ...overrides
        });
    }

    _getPlatformMessageId(data) {
        if (!data || typeof data !== 'object') {
            return null;
        }

        const msgId = data.common?.msgId;
        if (msgId == null) {
            return null;
        }

        const normalized = String(msgId).trim();
        return normalized || null;
    }

    _shouldSkipDuplicatePlatformMessage(data, ttlMs = this.deduplicationConfig?.ttlMs ?? 2 * 60 * 1000) {
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
            cleanupPerformed = true;
        }

        return { isDuplicate: false, cleanupPerformed };
    }

    _handleEventProcessingError(emitType, data, error) {
        this.errorHandler.handleEventProcessingError(error, emitType, data);

        const monetizationTypes = new Set([
            PlatformEvents.GIFT,
            PlatformEvents.PAYPIGGY,
            PlatformEvents.GIFTPAYPIGGY,
            PlatformEvents.ENVELOPE
        ]);

        if (!monetizationTypes.has(emitType)) {
            return { payloadEmitted: false, reason: 'non-monetization' };
        }

        let errorOverrides = {};
        const hasCanonicalIdentity = data
            && data.userId !== undefined
            && data.userId !== null
            && data.username !== undefined
            && data.username !== null;

        if (hasCanonicalIdentity) {
            const normalizedUserId = String(data.userId).trim();
            const normalizedUsername = String(data.username).trim();
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
            } catch (extractError) {
                errorOverrides = {};
            }
        }

        if (emitType === PlatformEvents.GIFT) {
            const amount = Number(data?.giftCoins ?? data?.amount);
            if (Number.isFinite(amount)) {
                errorOverrides.amount = amount;
            }
            const repeatCount = Number(data?.giftCount ?? data?.repeatCount);
            if (Number.isFinite(repeatCount)) {
                errorOverrides.giftCount = repeatCount;
            }
            if (typeof data?.currency === 'string' && data.currency.trim()) {
                errorOverrides.currency = data.currency.trim();
            }
        }

        if (emitType === PlatformEvents.ENVELOPE) {
            const amount = Number(data?.giftCoins ?? data?.amount);
            if (Number.isFinite(amount)) {
                errorOverrides.amount = amount;
            }
            if (typeof data?.currency === 'string' && data.currency.trim()) {
                errorOverrides.currency = data.currency.trim();
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

    async _handleStandardEvent(eventType, data, options = {}) {
        const factoryMethod = options.factoryMethod || `create${this._capitalize(eventType)}`;
        const emitType = options.emitType || eventType;
        try {
            await this._logRawEvent?.(options.logEventType || emitType, data);
            const eventData = this.eventFactory[factoryMethod](data, options);
            this._emitPlatformEvent(emitType, eventData);
            return { success: true };
        } catch (error) {
            return this._handleEventProcessingError(emitType, data, error);
        }
    }

    _capitalize(str = '') {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }


    async _handleChatMessage(data, normalizedData = null) {
        return this._handleStandardEvent('chatMessage', data, {
            factoryMethod: 'createChatMessage',
            emitType: PlatformEvents.CHAT_MESSAGE,
            normalizedData
        });
    }

    async _handleGift(data) {
        return this._handleStandardEvent('gift', data, {
            factoryMethod: 'createGift',
            emitType: PlatformEvents.GIFT
        });
    }

    async _handleFollow(data) {
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

    async _handleShare(data) {
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

            const eventData = this.eventFactory.createShare({
                username,
                userId,
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

    async _handleDisconnection(reason, willReconnect = null) {
        try {
            const reconnectFlag = willReconnect !== null ? willReconnect : (!this.isPlannedDisconnection && this.config.enabled);
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

    async _handleStreamEnd() {
        // Prevent double-handling when both DISCONNECTED and STREAM_END fire (e.g., 4404)
        if (this._disconnectionInProgress) {
            this.logger.debug('Skipping stream-end handling: disconnection already in progress', 'tiktok');
            return;
        }
        this._disconnectionInProgress = true;

        try {
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
        } finally {
            this._disconnectionInProgress = false;
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
                type: PlatformEvents.ERROR,
                data: eventData
            });

            const connectionOperations = ['handleConnection', 'handleDisconnection'];
            const isConnectionError = connectionOperations.includes(context?.operation);

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

    _emitPlatformEvent(type, payload) {
        const platform = payload?.platform || 'tiktok';

        // Emit unified platform:event for local listeners
        this.emit('platform:event', { platform, type, data: payload });

        // Route event through injected handler to event bus
        const handlerMap = {
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

        const handlerName = handlerMap[type];
        const handler = this.handlers?.[handlerName];

        if (typeof handler === 'function') {
            handler(payload);
        }
    }

    _createDefaultHandlers() {
        const emitToBus = (type, data) => this._emitToEventBus(type, data);
        return {
            onChat: (data) => emitToBus(PlatformEvents.CHAT_MESSAGE, data),
            onViewerCount: (data) => emitToBus(PlatformEvents.VIEWER_COUNT, data),
            onGift: (data) => emitToBus(PlatformEvents.GIFT, data),
            onPaypiggy: (data) => emitToBus(PlatformEvents.PAYPIGGY, data),
            onFollow: (data) => emitToBus(PlatformEvents.FOLLOW, data),
            onShare: (data) => emitToBus(PlatformEvents.SHARE, data),
            onRaid: (data) => emitToBus(PlatformEvents.RAID, data),
            onEnvelope: (data) => emitToBus(PlatformEvents.ENVELOPE, data),
            onStreamStatus: (data) => emitToBus(PlatformEvents.STREAM_STATUS, data)
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
