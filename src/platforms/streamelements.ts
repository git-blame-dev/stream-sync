import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import { STREAMELEMENTS } from '../core/endpoints';
import type { AppLogger } from '../core/logger/types';
import { getUnifiedLogger } from '../core/logging';
import { secrets } from '../core/secrets';
import { PlatformEvents } from '../interfaces/PlatformEvents';
import type { PlatformInitializationOutcome } from '../interfaces/PlatformLifecycle';
import { RawEventLogWriter } from '../services/RawEventLogWriter';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { createRetrySystem } from '../utils/retry-system';
import { getSystemTimestampISO } from '../utils/timestamp';
import { safeSetTimeout } from '../utils/timeout-validator';

type StreamElementsConfig = {
    enabled?: boolean;
    jwtToken?: string;
    dataLoggingEnabled?: boolean;
    dataLoggingPath?: string;
};

interface ResolvedStreamElementsConfig {
    enabled: boolean | undefined;
    jwtToken: string | undefined;
    dataLoggingEnabled: boolean | undefined;
    dataLoggingPath: string | undefined;
}

type StreamElementsLogger = Pick<AppLogger, 'debug' | 'info' | 'warn' | 'error'>;

type ResolvedStreamElementsLogger = StreamElementsLogger | ReturnType<typeof getUnifiedLogger>;

interface StreamElementsEventBus {
    emit: (eventName: string, payload: unknown) => void;
}

interface StreamElementsConnection {
    readyState: number;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    once: (event: string, listener: (...args: unknown[]) => void) => void;
    off?: (event: string, listener: (...args: unknown[]) => void) => void;
    removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    send: (payload: string) => void;
    close: () => void;
    terminate?: () => void;
    removeAllListeners: () => void;
}

interface StreamElementsWebSocketConstructor {
    OPEN: number;
    new(url: string): StreamElementsConnection;
}

interface StreamElementsHandlers {
    onFollow?: (data: StreamElementsEventPayload) => void;
    onConnection?: (data: StreamElementsConnectionEvent) => void;
}

type StreamElementsConnectionEvent = {
    platform: 'streamelements';
    status: 'connected' | 'reconnecting' | 'disconnected';
    timestamp: string;
    willReconnect: boolean;
    error?: unknown;
};

interface RetrySystemLike {
    incrementRetryCount: (platform: string) => number;
    resetRetryCount: (platform: string) => void;
    handleConnectionSuccess?: (platform: string) => void;
}

type StreamElementsDependencies = {
    logger?: StreamElementsLogger;
    retrySystem?: RetrySystemLike;
    eventBus?: StreamElementsEventBus | null;
    rawEventLogWriter?: Pick<RawEventLogWriter, 'writeRawEvent'>;
    WebSocketCtor?: StreamElementsWebSocketConstructor;
};

type StreamElementsEventPayload = {
    platform?: string;
    username?: string;
    userId?: string | null;
    timestamp?: string;
    source?: string;
    sourceType?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWebSocketConstructor(value: unknown): value is StreamElementsWebSocketConstructor {
    return typeof value === 'function';
}

function createUnavailableWebSocketConstructor(): StreamElementsWebSocketConstructor {
    return class StreamElementsUnavailableWebSocket implements StreamElementsConnection {
        static OPEN = 1;
        readyState = 0;

        constructor(_url: string) {
            throw new Error('StreamElements WebSocket module did not expose a compatible constructor');
        }

        on() {}
        once() {}
        send() {}
        close() {}
        removeAllListeners() {}
    };
}

function resolveWebSocketConstructor(moduleValue: unknown): StreamElementsWebSocketConstructor {
    if (isRecord(moduleValue)) {
        if (isWebSocketConstructor(moduleValue.WebSocket)) {
            return moduleValue.WebSocket;
        }

        if (isWebSocketConstructor(moduleValue.default)) {
            return moduleValue.default;
        }
    }

    if (isWebSocketConstructor(moduleValue)) {
        return moduleValue;
    }

    return createUnavailableWebSocketConstructor();
}

function getErrorLogValue(error: unknown): unknown {
    return error instanceof Error && error.message ? error.message : error;
}


class StreamElementsPlatform extends EventEmitter {
    private readonly errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    private readonly logger: ResolvedStreamElementsLogger;
    private readonly eventBus: StreamElementsEventBus | null;
    private readonly rawEventLogWriter: Pick<RawEventLogWriter, 'writeRawEvent'>;
    private readonly WebSocketCtor: StreamElementsWebSocketConstructor;
    private readonly incrementRetryCount: (platform: string) => number;
    private readonly resetRetryCount: (platform: string) => void;
    private readonly config: ResolvedStreamElementsConfig;
    private connection: StreamElementsConnection | null;
    private isConnecting: boolean;
    private isReady: boolean;
    private connectionTime: number | null;
    private reconnectTimeout: ReturnType<typeof safeSetTimeout> | null;
    private connectionTimeout: ReturnType<typeof safeSetTimeout> | null;
    private subscriptionNonce: string | null = null;
    private resolveConnectionAttempt: (() => void) | null = null;
    private rejectConnectionAttempt: ((error: Error) => void) | null;
    private recoveryGeneration: number;
    private recoveryEnabled: boolean;
    private handlers: StreamElementsHandlers;
    private lastConnectionError: unknown;

    constructor(config: StreamElementsConfig = {}, dependencies: StreamElementsDependencies = {}) {
        super();
        
        const logger = dependencies.logger || getUnifiedLogger();
        const retrySystem = dependencies.retrySystem || createRetrySystem({ logger });
        
        this.errorHandler = createPlatformErrorHandler(logger, 'streamelements');
        this.logger = logger;
        this.eventBus = dependencies.eventBus || null;
        this.rawEventLogWriter = dependencies.rawEventLogWriter || new RawEventLogWriter();
        this.WebSocketCtor = dependencies.WebSocketCtor || resolveWebSocketConstructor(createRequire(__filename)('ws') as unknown);
        this.incrementRetryCount = retrySystem.incrementRetryCount.bind(retrySystem);
        this.resetRetryCount = retrySystem.resetRetryCount.bind(retrySystem);
        
        this.config = {
            enabled: config.enabled,
            jwtToken: config.jwtToken === undefined
                ? (secrets.streamelements.jwtToken ?? undefined)
                : config.jwtToken,
            dataLoggingEnabled: config.dataLoggingEnabled,
            dataLoggingPath: config.dataLoggingPath
        };
        
        this.connection = null;
        this.isConnecting = false;
        this.isReady = false;
        this.connectionTime = null;
        this.reconnectTimeout = null;
        this.connectionTimeout = null;
        this.rejectConnectionAttempt = null;
        this.recoveryGeneration = 0;
        this.recoveryEnabled = this.config.enabled === true;
        this.handlers = this._createDefaultHandlers();
        this.lastConnectionError = null;
        
    }
    async initialize(handlers: StreamElementsHandlers = {}): Promise<PlatformInitializationOutcome> {
        this.handlers = {
            ...this.handlers,
            ...(handlers || {})
        };
        
        if (!this.config.enabled) {
            return { state: 'monitoring' };
        }

        this.recoveryEnabled = true;
        this.recoveryGeneration += 1;

        if (!this.checkConnectionPrerequisites()) {
            throw new Error('StreamElements initialization failed: invalid configuration');
        }

        if (this.isConnected()) {
            return { state: 'ready' };
        }

        const connected = await this.connect();
        if (!connected && !this.isConnected()) {
            const error = this.lastConnectionError
                ?? new Error('StreamElements initialization failed: unable to establish connection');
            if (!this.isRetryableStartupError(error)) {
                throw error;
            }
            return { state: 'recovering', error };
        }

        return { state: 'ready' };
    }

    private isRetryableStartupError(error: unknown): boolean {
        const record = isRecord(error) ? error : {};
        const code = typeof record.code === 'string' ? record.code.toUpperCase() : '';
        const message = error instanceof Error ? error.message : String(error);
        return ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
            || /connection (?:timed out|timeout|failed|closed)|unable to establish connection|socket hang up|network unavailable|getaddrinfo/i.test(message);
    }

    checkConnectionPrerequisites(): boolean {
        if (!this.config.enabled) {
            return false;
        }
        
        if (!this.config.jwtToken) {
            this.logger.warn('StreamElements JWT is not configured; subscriber alerts are unavailable', 'streamelements');
            return false;
        }
        
        return true;
    }

    isConnected(): boolean {
        return !!(this.connection && this.connection.readyState === this.WebSocketCtor.OPEN && this.isReady);
    }

    async connect(): Promise<boolean> {
        if (this.isConnecting || this.isConnected()) {
            return false;
        }

        if (!this.checkConnectionPrerequisites()) {
            return false;
        }

        this.isConnecting = true;
        const recoveryGeneration = this.recoveryGeneration;
        
        try {
            this.logger.debug('Connecting to StreamElements subscriber stream', 'streamelements');
            
            await this.connectToWebSocket();
            this.lastConnectionError = null;
            return true;
            
        } catch (err) {
            this.lastConnectionError = err;
            this.isConnecting = false;
            if (!this.reconnectTimeout) {
                this.handleConnectionError(err, recoveryGeneration);
            }
            return false;
        }
    }

    async connectToWebSocket(): Promise<void> {
        const connection = new this.WebSocketCtor(STREAMELEMENTS.WEBSOCKET);
        this.connection = connection;
        return new Promise((resolve, reject) => {
            this.resolveConnectionAttempt = resolve;
            this.rejectConnectionAttempt = reject;
            this.connectionTimeout = safeSetTimeout(() => {
                this.failConnection(new Error('StreamElements connection timeout'));
            }, 15000);
            connection.on('open', () => {
                if (this.connection !== connection) return;
                this.subscriptionNonce = randomUUID();
                try {
                    connection.send(JSON.stringify({
                        type: 'subscribe',
                        nonce: this.subscriptionNonce,
                        data: { topic: 'channel.activities', token: this.config.jwtToken, token_type: 'jwt' }
                    }));
                } catch {
                    this.failConnection(new Error('StreamElements connection failed while sending subscription'));
                }
            });
            connection.on('message', (data) => {
                if (this.connection === connection) this.handleMessage(data);
            });
            connection.on('close', (code, reason) => {
                if (this.connection === connection) this.handleConnectionClose(Number(code), reason);
            });
            connection.on('error', (error) => {
                if (this.connection === connection) this.failConnection(error);
            });
        });
    }

    private failConnection(error: unknown): void {
        const pending = this.rejectConnectionAttempt !== null;
        this.cleanup(false, error instanceof Error ? error : new Error('StreamElements connection failed'));
        // The pending connect() owns its failure and recovery; ready connections have no awaiting caller.
        if (!pending) this.handleConnectionError(error);
    }

    handleMessage(data: unknown): void {
        let message: unknown;
        try {
            message = JSON.parse(String(data)) as unknown;
        } catch {
            // JSON parser diagnostics can contain provider payload text.
            this.errorHandler.handleEventProcessingError(new Error('Invalid StreamElements JSON frame'), 'message');
            return;
        }
        try {
            this.handleParsedMessage(message);
        } catch {
            this.errorHandler.handleEventProcessingError(new Error('StreamElements message processing failed'), 'message');
        }
    }

    private handleParsedMessage(message: unknown): void {
        if (!isRecord(message)) return;
        if (message.type === 'response' && this.subscriptionNonce && (message.nonce === this.subscriptionNonce
            || (message.nonce === undefined && message.error === 'rate_limit_exceeded'))) {
            if (message.error !== undefined && message.error !== null) {
                const retryable = ['err_deadline_exceeded', 'err_internal_error', 'rate_limit_exceeded'].includes(String(message.error));
                if (!retryable) {
                    this.recoveryEnabled = false;
                    this.errorHandler.handleAuthenticationError('or subscription failed');
                }
                this.failConnection(new Error(retryable
                    ? 'StreamElements connection failed: subscription temporarily unavailable'
                    : 'StreamElements authentication or subscription failed'));
            } else if (message.error === null || (message.error === undefined && isRecord(message.data)
                && message.data.topic === 'channel.activities'
                && typeof message.data.message === 'string'
                && message.data.message.toLowerCase() === 'successfully subscribed to topic')) {
                const resolve = this.resolveConnectionAttempt;
                this.resolveConnectionAttempt = null;
                this.rejectConnectionAttempt = null;
                this.subscriptionNonce = null;
                if (this.connectionTimeout) clearTimeout(this.connectionTimeout);
                this.connectionTimeout = null;
                if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
                this.reconnectTimeout = null;
                this.connectionTime = Date.now();
                this.isConnecting = false;
                this.isReady = true;
                this.resetRetryCount('StreamElements');
                this.logger.info('YouTube subscriber stream ready', 'streamelements');
                resolve?.();
                this.emitConnectionStatus('connected', false);
            }
            return;
        }
        if (!this.isReady || message.type !== 'message' || message.topic !== 'channel.activities'
            || !isRecord(message.data) || message.data.type !== 'follow'
            || typeof message.data.provider !== 'string' || message.data.provider.toLowerCase() !== 'youtube'
            || !isRecord(message.data.data)) return;

        const activity = message.data;
        const identity = message.data.data;
        const usernameValue = identity.displayName || identity.username || '';
        const username = typeof usernameValue === 'string' ? usernameValue.trim() : '';
        if (!username) {
            this.logger.warn('[StreamElements] Subscriber event missing username; skipping', 'streamelements', {
                hasDisplayName: typeof identity.displayName === 'string',
                hasUserId: typeof identity.providerId === 'string' || typeof identity.userId === 'string'
            });
            return;
        }
        const userIdValue = identity.providerId || identity.userId || username;
        const userId = typeof userIdValue === 'string' ? userIdValue.trim() : username;
        if (this.config.dataLoggingEnabled) void this.logRawPlatformData('follow', message);
        this._emitPlatformEvent(PlatformEvents.FOLLOW, {
            platform: 'youtube', username, userId,
            timestamp: typeof activity.createdAt === 'string' && activity.createdAt ? activity.createdAt : getSystemTimestampISO(),
            source: 'streamelements', sourceType: 'streamelements:follow'
        });
    }

    _createDefaultHandlers(): { onFollow: (data: StreamElementsEventPayload) => void } {
        const emitToBus = (type: string, data: StreamElementsEventPayload): void => this._emitToEventBus(type, data);
        return {
            onFollow: (data: StreamElementsEventPayload) => emitToBus(PlatformEvents.FOLLOW, data)
        };
    }

    _emitPlatformEvent(type: string, payload: StreamElementsEventPayload): void {
        const platform = payload?.platform || 'streamelements';
        this.emit('platform:event', { platform, type, data: payload });

        const handlerMap: Partial<Record<string, 'onFollow'>> = {
            [PlatformEvents.FOLLOW]: 'onFollow'
        };

        const handlerName = handlerMap[type];
        const handler = handlerName ? this.handlers?.[handlerName] : undefined;
        if (typeof handler === 'function') {
            handler(payload);
        }
    }

    _emitToEventBus(type: string, data: StreamElementsEventPayload): void {
        if (!this.eventBus || typeof this.eventBus.emit !== 'function') {
            return;
        }

        this.eventBus.emit('platform:event', {
            platform: data?.platform || 'streamelements',
            type,
            data
        });
    }

    handleConnectionClose(code: number, reason: unknown): void {
        this.logger.info('[StreamElements] Connection closed', 'streamelements', {
            code,
            hasReason: reason !== null && reason !== undefined && String(reason).length > 0
        });
        
        this.failConnection(new Error('StreamElements connection closed'));
    }

    handleConnectionError(err: unknown, recoveryGeneration = this.recoveryGeneration): void {
        const connectionError = err as { message?: string; toString?: () => string };
        const errorMessage = connectionError?.message || connectionError?.toString?.() || 'Unknown error';
        if (recoveryGeneration !== this.recoveryGeneration) {
            return;
        }

        this.errorHandler.handleConnectionError(err, 'connection', errorMessage);
        this.emitConnectionStatus(this.recoveryEnabled ? 'reconnecting' : 'disconnected', this.recoveryEnabled, err);
        this.scheduleReconnection(recoveryGeneration);
    }

    private emitConnectionStatus(
        status: StreamElementsConnectionEvent['status'],
        willReconnect: boolean,
        error?: unknown
    ): void {
        this.handlers.onConnection?.({
            platform: 'streamelements',
            status,
            timestamp: getSystemTimestampISO(),
            willReconnect,
            ...(error === undefined ? {} : { error })
        });
    }

    scheduleReconnection(recoveryGeneration = this.recoveryGeneration): void {
        if (!this.recoveryEnabled || recoveryGeneration !== this.recoveryGeneration || this.reconnectTimeout) {
            return;
        }
        
        const delay = this.incrementRetryCount('StreamElements');
        
        this.logger.debug(`[StreamElements] Scheduling reconnection in ${delay}ms`, 'streamelements');
        
        this.reconnectTimeout = safeSetTimeout(() => {
            this.reconnectTimeout = null;
            if (this.recoveryEnabled && recoveryGeneration === this.recoveryGeneration
                && !this.isConnected() && this.config.enabled) {
                void this.connect();
            }
        }, delay);
    }

    async disconnect(): Promise<void> {
        this.cleanup();
    }

    cleanup(cancelRecovery = true, failure = new Error('StreamElements connection attempt cancelled')): void {
        if (cancelRecovery) {
            this.recoveryEnabled = false;
            this.recoveryGeneration += 1;
        }
        if (cancelRecovery && this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
        const rejectConnectionAttempt = this.rejectConnectionAttempt;
        this.rejectConnectionAttempt = null;
        this.resolveConnectionAttempt = null;
        this.subscriptionNonce = null;
        rejectConnectionAttempt?.(failure);

        this.isConnecting = false;
        this.isReady = false;

        if (this.connection) {
            const connection = this.connection;
            try {
                connection.removeAllListeners();
            } catch (cleanupError) {
                this.logger.debug('[StreamElements] Error removing listeners during cleanup:', 'streamelements', getErrorLogValue(cleanupError));
            }
            this.connection = null;
            try {
                // ws emits an asynchronous error when an opening handshake is aborted.
                // Keep it handled until close, without retaining the adapter's listeners.
                connection.on('error', () => {});
                connection.once('close', () => connection.removeAllListeners());
                if (connection.readyState !== 0 && connection.terminate) connection.terminate();
                else connection.close();
            } catch (cleanupError) {
                this.logger.debug('[StreamElements] Error closing connection during cleanup:', 'streamelements', getErrorLogValue(cleanupError));
            }
        }
        this.connectionTime = null;
    }

    async logRawPlatformData(eventType: string, data: unknown): Promise<void> {
        if (!this.config.dataLoggingEnabled) {
            return;
        }

        try {
            if (!this.config.dataLoggingPath) {
                this.errorHandler.handleDataLoggingError(new Error('Data logging path is not configured'), 'platform');
                return;
            }

            await this.rawEventLogWriter.writeRawEvent({
                dataLoggingPath: this.config.dataLoggingPath,
                platform: 'streamelements',
                eventType,
                payload: data
            });

        } catch (error) {
            this.errorHandler.handleDataLoggingError(error, 'platform');
        }
    }

    getStatus(): {
        platform: string;
        enabled: boolean | undefined;
        hasJwtToken: boolean;
        isConnecting: boolean;
        isReady: boolean;
        isConnected: boolean;
        connectionTime: number | null;
        hasConnection: boolean;
    } {
        return {
            platform: 'StreamElements',
            enabled: this.config.enabled,
            hasJwtToken: !!this.config.jwtToken,
            isConnecting: this.isConnecting,
            isReady: this.isReady,
            isConnected: this.isConnected(),
            connectionTime: this.connectionTime,
            hasConnection: !!this.connection
        };
    }
}

export { StreamElementsPlatform };
