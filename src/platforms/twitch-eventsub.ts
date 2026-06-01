import * as axiosModule from 'axios';
import type { AxiosResponse } from 'axios';
import { EventEmitter } from 'node:events';
import * as WebSocketModule from 'ws';
import { secrets } from '../core/secrets';
import { RawPlatformDataLoggingService } from '../services/RawPlatformDataLoggingService';
import { validateLoggerInterface } from '../utils/dependency-validator';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { getSystemTimestampISO } from '../utils/timestamp';
import { safeDelay, safeSetInterval, safeSetTimeout, validateTimeout } from '../utils/timeout-validator';
import { createTwitchEventSubSubscriptionManager } from './twitch/connections/eventsub-subscription-manager';
import { createTwitchEventSubSubscriptions } from './twitch/connections/eventsub-subscriptions';
import { createTwitchEventSubWsLifecycle } from './twitch/connections/ws-lifecycle';
import { createTwitchEventSubEventRouter } from './twitch/events/event-router';

type LoggerLike = {
    info: (message: string, scope?: string, payload?: unknown) => void;
    warn: (message: string, scope?: string, payload?: unknown) => void;
    debug: (message: string, scope?: string, payload?: unknown) => void;
};

type ErrorHandlerLike = {
    handleEventProcessingError?: (error: Error, eventType: string, payload?: unknown, message?: string) => void;
    logOperationalError?: (message: string, source: string, context?: unknown) => void;
};

type TwitchAuthLike = {
    isReady?: () => boolean;
    getUserId: () => { toString: () => string } | string | number | null | undefined;
    refreshTokens: () => Promise<boolean>;
};

type AxiosLike = {
    post: <T = unknown>(url: string, data?: unknown, config?: unknown) => Promise<AxiosResponse<T>>;
    get: <T = unknown>(url: string, config?: unknown) => Promise<AxiosResponse<T>>;
    delete: <T = unknown>(url: string, config?: unknown) => Promise<AxiosResponse<T>>;
};

type WebSocketLike = {
    readyState: number;
    on: (eventName: string, handler: (...args: unknown[]) => void) => void;
    close: (code?: number, reason?: string) => void;
    removeAllListeners: () => void;
};

type WebSocketCtorLike = new (url: string) => WebSocketLike;

type RawPlatformDataLoggingServiceLike = {
    logRawPlatformData: (platform: string, eventType: string, data: unknown, platformConfig?: unknown) => Promise<void>;
};

type RawPlatformDataLoggingServiceCtor = new (dependencies: { logger: unknown; config: Record<string, unknown> }) => RawPlatformDataLoggingServiceLike;

type SubscriptionDefinition = {
    name: string;
    type: string;
    version: string;
    getCondition: (input: { userId: string; broadcasterId: string }) => Record<string, unknown>;
};

type SubscriptionState = {
    failures?: unknown[];
    aborted?: boolean;
    abortReason?: string;
};

type ValidationComponent = {
    valid: boolean;
    issues: string[];
    warnings?: string[];
    details: Record<string, unknown>;
};

type ValidationResult = {
    valid: boolean;
    issues: string[];
    warnings: string[];
    components: {
        twitchAuth: ValidationComponent;
        configuration: ValidationComponent;
    };
    validatedAt: string;
};

type ValidationFieldDetails = Record<string, Record<string, unknown>>;

type SubscriptionRevocation = {
    type?: string;
    id?: string;
    status?: string;
};

const getRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' ? value as Record<string, unknown> : null;

const getString = (value: unknown): string | null => typeof value === 'string' ? value : null;

const hasAxiosResponseStatus = (error: unknown, status: number): boolean => {
    const response = getRecord(error)?.response;
    return getRecord(response)?.status === status;
};

const isTransientStartupError = (error: unknown): boolean => {
    const record = getRecord(error);
    const code = typeof record?.code === 'string' ? record.code.toUpperCase() : '';
    const closeCode = typeof record?.closeCode === 'number' ? record.closeCode : null;
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    if (hasAxiosResponseStatus(error, 401) || hasAxiosResponseStatus(error, 403)) {
        return false;
    }

    if (message.includes('auth-missing')) {
        return false;
    }

    return closeCode === 1006
        || closeCode === 4005
        || closeCode === 4006
        || ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE'].includes(code)
        || message.includes('socket hang up')
        || message.includes('connection timeout')
        || message.includes('connection closed abnormally')
        || message.includes('websocket session has already disconnected')
        || message.includes('subscription setup aborted: connection-lost');
};

const getWebSocketCtor = (moduleValue: unknown): WebSocketCtorLike => {
    const moduleRecord = getRecord(moduleValue);
    const candidates = [moduleRecord?.WebSocket, moduleRecord?.default, moduleValue];
    const ctor = candidates.find((candidate): candidate is WebSocketCtorLike => typeof candidate === 'function');
    if (!ctor) {
        throw new Error('WebSocket constructor is unavailable');
    }
    return ctor;
};

class TwitchEventSub extends EventEmitter {
    config: Record<string, unknown>;
    logger: LoggerLike;
    errorHandler: ErrorHandlerLike;
    twitchAuth: TwitchAuthLike;
    axios: AxiosLike;
    WebSocketCtor: WebSocketCtorLike;
    broadcasterId: string;
    userId = '';
    ws: WebSocketLike | null;
    sessionId: string | null;
    subscriptions: Map<string, Record<string, unknown>>;
    isInitialized: boolean;
    _isConnected: boolean;
    subscriptionsReady: boolean;
    retryAttempts: number;
    reconnectTimeout: ReturnType<typeof setTimeout> | null;
    welcomeTimer: ReturnType<typeof setTimeout> | null = null;
    cleanupInterval: ReturnType<typeof setInterval> | null = null;
    connectionStartTime: number | null;
    disconnectedSessionId: string | null;
    maxRetryAttempts: number;
    retryDelay: number;
    initialStartupMaxAttempts: number;
    initialStartupRetryDelay: number;
    subscriptionDelay: number;
    requiredSubscriptions: SubscriptionDefinition[];
    memoryUsage: { lastCleanup: number; maxSubscriptions: number; cleanupInterval: number };
    reconnectUrl: string | null;
    recentMessageIds: Map<string, number>;
    messageIdTtlMs: number;
    maxMessageIds: number;
    rawPlatformDataLoggingService: RawPlatformDataLoggingServiceLike;
    eventRouter: ReturnType<typeof createTwitchEventSubEventRouter>;
    subscriptionManager: ReturnType<typeof createTwitchEventSubSubscriptionManager>;
    wsLifecycle: ReturnType<typeof createTwitchEventSubWsLifecycle>;
    subscriptionState?: SubscriptionState;

    constructor(config: Record<string, unknown>, dependencies: Record<string, unknown> = {}) {
        super();

        this.config = config;
        validateLoggerInterface(dependencies.logger);
        this.logger = dependencies.logger as LoggerLike;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'twitch-eventsub');
        this.twitchAuth = dependencies.twitchAuth as TwitchAuthLike;
        this.axios = (dependencies.axios || axiosModule.default || axiosModule) as AxiosLike;
        this.WebSocketCtor = typeof dependencies.WebSocketCtor === 'function'
            ? dependencies.WebSocketCtor as WebSocketCtorLike
            : getWebSocketCtor(WebSocketModule);
        this.broadcasterId = getString(this.config.broadcasterId) || '';

        this.ws = null;
        this.sessionId = null;
        this.subscriptions = new Map();

        this.isInitialized = false;
        this._isConnected = false;
        this.subscriptionsReady = false;
        this.retryAttempts = 0;
        this.reconnectTimeout = null;
        this.connectionStartTime = null;
        this.disconnectedSessionId = null;

        this.maxRetryAttempts = 10;
        this.retryDelay = 5000;
        this.initialStartupMaxAttempts = 3;
        this.initialStartupRetryDelay = 1000;
        this.subscriptionDelay = 0;

        this.requiredSubscriptions = createTwitchEventSubSubscriptions();

        this.memoryUsage = {
            lastCleanup: Date.now(),
            maxSubscriptions: 50,
            cleanupInterval: 5 * 60 * 1000
        };

        this.reconnectUrl = null;
        this.recentMessageIds = new Map();
        this.messageIdTtlMs = 5 * 60 * 1000;
        this.maxMessageIds = 1000;

        try {
            this.logger.info('Manual EventSub initialized', 'twitch');
        } catch (_error) {
            // Logger failures are non-fatal during EventSub construction.
        }
        const RawPlatformDataLoggingServiceClass: RawPlatformDataLoggingServiceCtor = typeof dependencies.RawPlatformDataLoggingService === 'function'
            ? dependencies.RawPlatformDataLoggingService as RawPlatformDataLoggingServiceCtor
            : RawPlatformDataLoggingService as unknown as RawPlatformDataLoggingServiceCtor;
        this.rawPlatformDataLoggingService = new RawPlatformDataLoggingServiceClass({ logger: this.logger, config: this.config });

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

        this._startPeriodicCleanup();
    }

  _startPeriodicCleanup(): void {
        this.cleanupInterval = safeSetInterval(() => {
            this._performPeriodicCleanup();
        }, 5 * 60 * 1000);
    }

  _performPeriodicCleanup(): void {
        const now = Date.now();

        if (now - this.memoryUsage.lastCleanup < 4 * 60 * 1000) {
            return;
        }

        this.logger.debug('Performing periodic EventSub memory cleanup', 'twitch');

        if (this.subscriptions.size > this.memoryUsage.maxSubscriptions) {
            this.logger.warn(`High subscription count detected: ${this.subscriptions.size}/${this.memoryUsage.maxSubscriptions}`, 'twitch');
        }

        this.memoryUsage.lastCleanup = now;

        if (global.gc) {
            global.gc();
            this.logger.debug('Forced garbage collection completed', 'twitch');
        }
    }

  _pruneMessageIds(now: number): void {
        for (const [messageId, seenAt] of this.recentMessageIds.entries()) {
            if (now - seenAt > this.messageIdTtlMs) {
                this.recentMessageIds.delete(messageId);
            }
        }
    }

  _isDuplicateMessageId(metadata: Record<string, unknown> | null | undefined): boolean {
    const messageId = typeof metadata?.message_id === 'string' ? metadata.message_id : '';
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

    async _validateConfig(): Promise<ValidationResult> {
        const validation: ValidationResult = {
            valid: true,
            issues: [],
            warnings: [],
            components: {
                twitchAuth: this._validateTwitchAuth(),
                configuration: this._validateConfigurationFields()
            },
            validatedAt: getSystemTimestampISO()
        };

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

  _validateTwitchAuth(): { valid: boolean; issues: string[]; details: Record<string, unknown> } {
        const issues: string[] = [];
        const details: Record<string, unknown> = {};

        if (!this.twitchAuth) {
            throw new Error('TwitchAuth is required but not provided');
        } else {
            details.present = true;
            details.ready = !!this.twitchAuth.isReady?.();

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

  _validateConfigurationFields(): { valid: boolean; issues: string[]; warnings: string[]; details: Record<string, unknown> } {
        const issues: string[] = [];
        const warnings: string[] = [];
        const details: ValidationFieldDetails = {};
        const clientIdSource = this._getAvailableClientId();
        this.broadcasterId = getString(this.config.broadcasterId) || '';
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

  _isCentralizedAuthReady(): boolean {
        return !!this.twitchAuth?.isReady?.();
    }

  _getAvailableClientId(): string | null {
    return typeof this.config.clientId === 'string' ? this.config.clientId : null;
  }

    async initialize(): Promise<void> {
        try {
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

            const userIdRaw = this.twitchAuth.getUserId();
            if (!userIdRaw) {
                throw new Error('No user ID available from AuthManager');
            }

            this.userId = userIdRaw.toString();
            this.logger.debug(`Using user ID: ${this.userId}`, 'twitch');

            await this._cleanupAllWebSocketSubscriptions();

            await this._connectWebSocketWithInitialRetry();

            this.isInitialized = true;
            this.retryAttempts = 0;
            this.logger.info('Manual EventSub initialized successfully', 'twitch');

        } catch (error) {
            this._logEventSubError('Manual EventSub initialization failed', error, 'manual-init', {
                stage: 'initialization',
                stack: error instanceof Error ? error.stack : undefined
            });
            await this._cleanupAfterFailedInitialization(error);
            throw error;
        }
    }

    async _connectWebSocketWithInitialRetry(): Promise<void> {
        const maxAttempts = Math.max(1, Math.trunc(this.initialStartupMaxAttempts));

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await this._connectWebSocket();
                return;
            } catch (error) {
                const willRetry = attempt < maxAttempts && isTransientStartupError(error);
                if (!willRetry) {
                    throw error;
                }

                this._logEventSubError('EventSub initialization failed - retrying', null, 'initial-startup-retry', {
                    attempt,
                    maxAttempts,
                    retryDelay: this.initialStartupRetryDelay,
                    error: error instanceof Error ? error.message : String(error)
                });

                await this._cleanupAfterFailedInitialization(error, { clearCleanupInterval: false });
                await safeDelay(
                    validateTimeout(this.initialStartupRetryDelay, 1),
                    1,
                    'twitchEventSub:initial-startup-retry'
                );
            }
        }
    }

    async _connectWebSocket(): Promise<void> {
        return this.wsLifecycle.connectWebSocket(this);
    }

    async handleWebSocketMessage(message: Record<string, unknown>): Promise<void> {
        const metadata = getRecord(message.metadata);
        const payload = getRecord(message.payload);
        if (!metadata || !payload) {
            throw new Error('EventSub message requires metadata and payload objects');
        }

        this.logger.info(`EventSub message received: ${metadata.message_type}`, 'twitch');

        switch (metadata.message_type) {
            case 'session_welcome':
                this.logger.info('EventSub welcome message received!', 'twitch', {
                    hasSessionId: typeof getRecord(payload.session)?.id === 'string' && String(getRecord(payload.session)?.id).length > 0,
                    keepaliveTimeout: getRecord(payload.session)?.keepalive_timeout_seconds,
                    status: getRecord(payload.session)?.status,
                    connectedAt: getRecord(payload.session)?.connected_at
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
                this.handleNotificationEvent(String(getRecord(payload.subscription)?.type || ''), getRecord(payload.event), metadata);
                break;

            case 'session_reconnect':
                this.logger.warn('EventSub reconnect requested', 'twitch', {
                    hasReconnectUrl: typeof getRecord(payload.session)?.reconnect_url === 'string' && String(getRecord(payload.session)?.reconnect_url).length > 0
                });
                this._handleReconnectRequest(payload);
                break;

            case 'revocation':
                this.logger.warn('EventSub subscription revoked', 'twitch', {
                    subscriptionId: getRecord(payload.subscription)?.id,
                    type: getRecord(payload.subscription)?.type,
                    status: getRecord(payload.subscription)?.status
                });
                await this._handleSubscriptionRevocation(getRecord(payload.subscription));
                break;

            default:
                this.logger.debug('Unknown EventSub message type', 'twitch', {
                    messageType: metadata.message_type,
                    metadataKeys: metadata && typeof metadata === 'object' ? Object.keys(metadata).sort() : [],
                    hasPayload: !!payload
                });
        }
    }

    async _setupEventSubscriptions(
        validationAlreadyDone = false,
        requiredSubscriptions: SubscriptionDefinition[] = this.requiredSubscriptions
    ): Promise<SubscriptionState | null> {
        const subscriptionState = await this.subscriptionManager.setupEventSubscriptions({
            requiredSubscriptions,
            userId: this.userId,
            broadcasterId: this.broadcasterId,
            sessionId: this.sessionId,
            subscriptionDelay: this.subscriptionDelay,
            validationAlreadyDone
        });

        if (subscriptionState) {
            this.subscriptionState = subscriptionState;
        }

        return subscriptionState;
    }

    _parseSubscriptionError(error: unknown, subscription: SubscriptionDefinition) {
        return this.subscriptionManager.parseSubscriptionError(error, subscription);
    }

    async _handleSubscriptionRevocation(subscription: SubscriptionRevocation | Record<string, unknown> | null | undefined): Promise<void> {
        if (!subscription?.type || !this.isInitialized) {
            return;
        }

        const context = {
            subscriptionType: subscription.type,
            subscriptionId: subscription.id,
            status: subscription.status,
            sessionId: this.sessionId
        };

        this._logEventSubError('EventSub subscription revoked', null, 'subscription-revoked', context);

        const replacementSubscriptions = this.requiredSubscriptions.filter((requiredSubscription) => requiredSubscription.type === subscription.type);
        if (replacementSubscriptions.length === 0) {
            this._logEventSubError('EventSub resubscribe skipped for unknown revoked subscription type', null, 'subscription-resubscribe-unknown-type', context);
            return;
        }

        try {
            const result = await this._setupEventSubscriptions(true, replacementSubscriptions);
            if (result?.aborted) {
                this.subscriptionsReady = false;
                this._logEventSubError('EventSub resubscribe aborted after revocation', null, 'subscription-resubscribe-aborted', {
                    ...context,
                    abortReason: result.abortReason
                });
                return;
            }
            const failures = result?.failures || [];
            if (failures.length > 0) {
                this.subscriptionsReady = false;
                this._logEventSubError('EventSub resubscribe failed after revocation', null, 'subscription-resubscribe-failed', {
                    ...context,
                    failures
                });
                return;
            }

            this.subscriptionsReady = true;
        } catch (error) {
            this.subscriptionsReady = false;
            this._logEventSubError('EventSub resubscribe threw after revocation', error, 'subscription-resubscribe-error', context);
        }
    }

  isActive(): boolean {
        return !!(this.isInitialized && this._isConnected && this.subscriptionsReady);
    }

  isConnected(): boolean {
        return !!(this._isConnected && this.ws?.readyState === 1);
    }

  _validateConnectionForSubscriptions(): boolean {
        if (!this.sessionId || this.sessionId.trim() === '') {
            this._logEventSubError('Cannot set up subscriptions: no session ID', null, 'subscription-setup');
            return false;
        }

        if (!this._isConnected) {
            this._logEventSubError('Cannot set up subscriptions: WebSocket not connected', null, 'subscription-setup');
            return false;
        }

        if (!this.ws || this.ws.readyState !== 1) { // 1 = OPEN
            this._logEventSubError('Cannot set up subscriptions: WebSocket not in OPEN state', null, 'subscription-setup', {
                readyState: this.ws?.readyState,
                hasWebSocket: !!this.ws,
                sessionId: this.sessionId ? 'present' : 'missing'
            });
            return false;
        }

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

  handleNotificationEvent(
    subscriptionType: string,
    event: Record<string, unknown> | null | undefined,
    metadata: Record<string, unknown> | null | undefined
  ): void {
        this.eventRouter.handleNotificationEvent(subscriptionType, event, metadata);
    }

    _handleChatMessageEvent(event: Record<string, unknown> | null | undefined): void {
        this.eventRouter.handleChatMessageEvent(event);
    }

    _handleFollowEvent(event: Record<string, unknown> | null | undefined): void {
        this.eventRouter.handleFollowEvent(event);
    }

    _handlePaypiggyEvent(event: Record<string, unknown> | null | undefined): void {
        this.eventRouter.handlePaypiggyEvent(event);
    }

    _handleRaidEvent(event: Record<string, unknown> | null | undefined): void {
        this.eventRouter.handleRaidEvent(event);
    }

    _handleBitsUseEvent(event: Record<string, unknown> | null | undefined): void {
        this.eventRouter.handleBitsUseEvent(event);
    }

    _handlePaypiggyGiftEvent(event: Record<string, unknown> | null | undefined): void {
        this.eventRouter.handlePaypiggyGiftEvent(event);
    }

    _handlePaypiggyMessageEvent(event: Record<string, unknown> | null | undefined): void {
        this.eventRouter.handlePaypiggyMessageEvent(event);
    }

    async sendMessage(message: string): Promise<{ success: true; platform: 'twitch'; broadcasterId: string; senderId: string }> {
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

        const broadcasterId = this.config.broadcasterId?.toString();
        if (!broadcasterId) {
            throw new Error('EventSub chat send requires a broadcasterId from config');
        }
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
            if (hasAxiosResponseStatus(error, 401)) {
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

    _handleStreamOnlineEvent(event: Record<string, unknown> | null | undefined): void {
        this.eventRouter.handleStreamOnlineEvent(event);
    }

    _handleStreamOfflineEvent(event: Record<string, unknown> | null | undefined): void {
        this.eventRouter.handleStreamOfflineEvent(event);
    }

  _handleReconnectRequest(payload: Record<string, unknown> | null | undefined): void {
        this.wsLifecycle.handleReconnectRequest(this, payload);
    }

  _scheduleReconnect(): void {
        this.wsLifecycle.scheduleReconnect(this);
    }

    async _reconnect(): Promise<void> {
        await this.wsLifecycle.reconnect(this);
    }

  _handleInitializationError(_error: unknown): void {
        this.isInitialized = false;
        this._isConnected = false;
        this.subscriptionsReady = false;
        this.retryAttempts = 0;

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }

    async _cleanupAfterFailedInitialization(
        error: unknown,
        options: { clearCleanupInterval?: boolean } = {}
    ): Promise<void> {
        const failedSessionId = this.sessionId;

        this._handleInitializationError(error);

        if (this.welcomeTimer) {
            clearTimeout(this.welcomeTimer);
            this.welcomeTimer = null;
        }

        if (options.clearCleanupInterval !== false && this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        if (failedSessionId) {
            try {
                await this._deleteAllSubscriptions({ sessionId: failedSessionId });
            } catch (cleanupError) {
                this._logEventSubError('Failed to clean up subscriptions after EventSub initialization failure', cleanupError, 'initialization-cleanup', {
                    sessionId: failedSessionId
                });
            }
        }

        if (this.ws) {
            try {
                this.ws.removeAllListeners();
                this.ws.close(1000, 'Initialization failed');
            } catch (closeError) {
                this._logEventSubError('Error closing EventSub WebSocket after initialization failure', closeError, 'ws-close');
            }
            this.ws = null;
        }

        this.sessionId = null;
        this.disconnectedSessionId = null;
        this.reconnectUrl = null;
        this.connectionStartTime = null;
        this.subscriptions.clear();
    }

    async cleanup(): Promise<void> {
        this.logger.info('Starting EventSub cleanup...', 'twitch');

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.welcomeTimer) {
            clearTimeout(this.welcomeTimer);
            this.welcomeTimer = null;
        }

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        // Twitch recommends deleting EventSub subscriptions before closing the WebSocket session.
        await this._deleteAllSubscriptions();

        if (this.ws) {
            try {
                this.ws.removeAllListeners();
                this.ws.close(1000, 'Normal cleanup');
                this.logger.info('EventSub WebSocket closed normally', 'twitch');
            } catch (error) {
                this._logEventSubError('Error closing EventSub WebSocket', error, 'ws-close');
            }
            this.ws = null;
        }

        this.isInitialized = false;
        this._isConnected = false;
        this.subscriptionsReady = false;
        this.sessionId = null;
        this.disconnectedSessionId = null;
        this.retryAttempts = 0;
        this.subscriptions.clear();
        this.connectionStartTime = null;

        this.logger.info('EventSub cleanup completed', 'twitch');
    }

    async _cleanupAllWebSocketSubscriptions(): Promise<void> {
        await this.subscriptionManager.cleanupAllWebSocketSubscriptions({ sessionId: this.sessionId });
    }

    async _deleteAllSubscriptions(options?: { sessionId?: string | null }): Promise<void> {
        await this.subscriptionManager.deleteAllSubscriptions({ sessionId: options?.sessionId ?? this.sessionId });
    }

    async logRawPlatformData(eventType: string, data: unknown): Promise<void> {
        return this.rawPlatformDataLoggingService.logRawPlatformData('twitch', eventType, data, this.config);
    }

    _logEventSubError(
        message: string,
        error: unknown = null,
        eventType = 'twitch-eventsub',
        payload: Record<string, unknown> | null = null
    ): void {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError?.(error, eventType, payload, message);
        } else if (this.errorHandler) {
            this.errorHandler.logOperationalError?.(message, 'twitch', payload || error);
        }
    }
}

export { TwitchEventSub };
