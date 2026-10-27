import * as axiosModule from 'axios';
import type { AxiosResponse } from 'axios';
import { EventEmitter } from 'node:events';
import * as WebSocketModule from 'ws';
import { secrets } from '../core/secrets';
import { RawPlatformDataLoggingService } from '../services/RawPlatformDataLoggingService';
import { validateLoggerInterface } from '../utils/dependency-validator';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { getSystemTimestampISO } from '../utils/timestamp';
import type { OperationDeadlineContext } from '../utils/timeout-wrapper';
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
    removeAllListeners: (eventName?: string) => void;
    terminate?: () => void;
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

    if (code === 'EVENTSUB_RETRY_AFTER_EXCEEDS_BUDGET') return false;
    if (hasAxiosResponseStatus(error, 401) || hasAxiosResponseStatus(error, 403)) {
        return false;
    }

    if (message.includes('auth-missing')) {
        return false;
    }

    return closeCode === 1006
        || closeCode === 4005
        || closeCode === 4006
        || ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
        || message.includes('socket hang up')
        || message.includes('connection timeout')
        || message.includes('deadline exceeded')
        || message.includes('silence timeout')
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
    private initialization: Promise<void> | null = null;
    private readonly lifetime = new AbortController();

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
            logError: (...args) => this._logEventSubError(...args),
            onSubscriptionCreated: () => this.wsLifecycle.subscriptionCreated(this)
        });

        this.wsLifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: this.WebSocketCtor,
            safeSetTimeout,
            safeDelay,
            validateTimeout
        });

        this._startPeriodicCleanup();
    }

    // Platform listeners observe state; their failures must not retire the transport or skip other listeners.
    override emit(eventName: string | symbol, ...args: unknown[]): boolean {
        const listeners = this.rawListeners(eventName);
        const report = (error: unknown) => {
            try { this._logEventSubError('EventSub observer failed', error, 'eventsub-observer'); }
            catch { /* An observer or reporting failure cannot change transport health. */ }
        };
        for (const listener of listeners) {
            try {
                const result: unknown = Reflect.apply(listener, this, args);
                if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
                    void Promise.resolve(result).catch(report);
                }
            } catch (error) { report(error); }
        }
        return listeners.length > 0;
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

    initialize(): Promise<void> {
        if (!this.initialization) this.initialization = this.initializeSession().finally(() => { this.initialization = null; });
        return this.initialization;
    }

    private async initializeSession(): Promise<void> {
        try {
            this.lifetime.signal.throwIfAborted();
            const validation = await this._validateConfig();
            this.lifetime.signal.throwIfAborted();
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
            this.lifetime.signal.throwIfAborted();
            await this._connectWebSocketWithInitialRetry();
            this.lifetime.signal.throwIfAborted();

            this.isInitialized = true;
            this.retryAttempts = 0;
            this.logger.info('Manual EventSub initialized successfully', 'twitch');

        } catch (error) {
            try {
                this._logEventSubError('Manual EventSub initialization failed', error, 'manual-init', {
                    stage: 'initialization',
                    stack: error instanceof Error ? error.stack : undefined
                });
            } catch { /* Preserve the initialization failure if diagnostics fail. */ }
            await this._cleanupAfterFailedInitialization(error);
            throw error;
        }
    }

    async _connectWebSocketWithInitialRetry(): Promise<void> {
        const maxAttempts = Math.max(1, Math.trunc(this.initialStartupMaxAttempts));

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            this.lifetime.signal.throwIfAborted();
            try {
                const generation = this.wsLifecycle.operationGeneration(this);
                await this._connectWebSocket();
                if (generation !== this.wsLifecycle.operationGeneration(this)) throw new Error('Subscription setup aborted: connection-lost');
                return;
            } catch (error) {
                this.lifetime.signal.throwIfAborted();
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
                    'twitchEventSub:initial-startup-retry',
                    this.lifetime.signal
                );
            }
        }
    }

    async _connectWebSocket(): Promise<void> {
        return this.wsLifecycle.connectWebSocket(this);
    }

    async handleWebSocketMessage(message: Record<string, unknown>): Promise<void> {
        if (this.lifetime.signal.aborted) return;
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
        const operationContext = this.wsLifecycle.operationContext(this);
        const targetSessionId = this.sessionId;
        const subscriptionState = await this.subscriptionManager.setupEventSubscriptions({
            requiredSubscriptions,
            userId: this.userId,
            broadcasterId: this.broadcasterId,
            sessionId: targetSessionId,
            operationContext,
            subscriptionDelay: this.subscriptionDelay,
            validationAlreadyDone
        });

        if (subscriptionState && !operationContext?.signal.aborted && !this.lifetime.signal.aborted && this.sessionId === targetSessionId) {
            this.subscriptionState = subscriptionState;
        }

        return subscriptionState;
    }

    _parseSubscriptionError(error: unknown, subscription: SubscriptionDefinition) {
        return this.subscriptionManager.parseSubscriptionError(error, subscription);
    }

    async _handleSubscriptionRevocation(subscription: SubscriptionRevocation | Record<string, unknown> | null | undefined): Promise<void> {
        if (!subscription?.type || this.lifetime.signal.aborted) return;
        const terminal = ['authorization_revoked', 'user_removed', 'version_removed'].includes(String(subscription.status));
        if (terminal) {
            this.lifetime.abort(new Error('EventSub subscription authorization/status revoked'));
            if (this.cleanupInterval) clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        if (terminal) this.wsLifecycle.revokeSubscriptions(this, true, subscription.status);
        else {
            if (typeof subscription.id === 'string') this.subscriptions.delete(subscription.id);
            await this.wsLifecycle.repairSubscriptions(this, subscription.status, async () => {
                const replacement = this.requiredSubscriptions.filter(required => required.type === subscription.type);
                if (!replacement.length) throw new Error('Unknown revoked subscription type');
                const result = await this._setupEventSubscriptions(true, replacement);
                if (result?.aborted || result?.failures?.length) {
                    const failure = (result?.failures?.[0] as { error?: { code?: string; status?: number | null } })?.error;
                    throw Object.assign(new Error('Revocation repair failed'), { code: failure?.code, response: { status: failure?.status } });
                }
            });
            if (this.wsLifecycle.isDisposed(this) && this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }
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
        this.wsLifecycle.dispose(this, this.lifetime.signal.aborted);
        this._handleInitializationError(error);
        if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
        this.welcomeTimer = null;
        if (options.clearCleanupInterval !== false && this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.sessionId = null;
        this.disconnectedSessionId = null;
        this.reconnectUrl = null;
        this.connectionStartTime = null;
        this.subscriptions.clear();
        if (failedSessionId && !this.lifetime.signal.aborted) {
            await this._deleteAllSubscriptions({ sessionId: failedSessionId });
        }
    }

    async cleanup(): Promise<void> {
        const sessionId = this.sessionId;
        this.lifetime.abort(new Error('EventSub disposed'));
        this.wsLifecycle.dispose(this);
        this.isInitialized = false;
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
        if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
        this.welcomeTimer = null;
        this.disconnectedSessionId = null;
        this.reconnectUrl = null;
        this.retryAttempts = 0;
        this.subscriptions.clear();
        this.connectionStartTime = null;
        // Local resources are already released; remote cleanup has an independent five-second cap.
        if (sessionId) await this.subscriptionManager.deleteAllSubscriptions({ sessionId });
    }

    async _cleanupAllWebSocketSubscriptions(): Promise<void> {
        await this.subscriptionManager.cleanupAllWebSocketSubscriptions({ sessionId: this.sessionId,
            operationContext: { signal: this.lifetime.signal, remainingBudgetMs: () => 5000 } });
    }

    async _deleteAllSubscriptions(options?: { sessionId?: string | null; operationContext?: OperationDeadlineContext }): Promise<void> {
        await this.subscriptionManager.deleteAllSubscriptions({ sessionId: options?.sessionId ?? this.sessionId,
            operationContext: options?.operationContext ?? { signal: this.lifetime.signal, remainingBudgetMs: () => 5000 } });
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
