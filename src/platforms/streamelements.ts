import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

import { STREAMELEMENTS } from '../core/endpoints';
import { getUnifiedLogger } from '../core/logging';
import { secrets } from '../core/secrets';
import { PlatformEvents } from '../interfaces/PlatformEvents';
import type { PlatformInitializationOutcome } from '../interfaces/PlatformLifecycle';
import { RawEventLogWriter } from '../services/RawEventLogWriter';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { createRetrySystem } from '../utils/retry-system';
import { getSystemTimestampISO } from '../utils/timestamp';
import { safeSetInterval, safeSetTimeout } from '../utils/timeout-validator';

type StreamElementsConfig = {
    enabled?: boolean;
    youtubeChannelId?: string;
    twitchChannelId?: string;
    jwtToken?: string;
    dataLoggingEnabled?: boolean;
    dataLoggingPath?: string;
};

interface ResolvedStreamElementsConfig {
    enabled: boolean | undefined;
    youtubeChannelId: string | undefined;
    twitchChannelId: string | undefined;
    jwtToken: string | undefined;
    dataLoggingEnabled: boolean | undefined;
    dataLoggingPath: string | undefined;
}

interface StreamElementsLogger {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
}

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

type StreamElementsMessageData = {
    platform?: string;
    displayName?: string;
    userId?: string;
};

type StreamElementsMessage = {
    type?: string;
    success?: boolean;
    error?: string;
    data?: StreamElementsMessageData;
};

type StreamElementsEventPayload = {
    platform?: string;
    username?: string;
    userId?: string | null;
    timestamp?: string;
    source?: string;
    sourceType?: string;
};

const nodeRequire = createRequire(__filename);
const wsModule = nodeRequire('ws') as unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
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
    private readonly platformLogger: ResolvedStreamElementsLogger;
    private readonly eventBus: StreamElementsEventBus | null;
    private readonly rawEventLogWriter: Pick<RawEventLogWriter, 'writeRawEvent'>;
    private readonly WebSocketCtor: StreamElementsWebSocketConstructor;
    private readonly incrementRetryCount: (platform: string) => number;
    private readonly resetRetryCount: (platform: string) => void;
    private readonly retryHandleConnectionSuccess:
        | RetrySystemLike['handleConnectionSuccess']
        | ReturnType<typeof createRetrySystem>['handleConnectionSuccess']
        | undefined;
    private readonly config: ResolvedStreamElementsConfig;
    private connection: StreamElementsConnection | null;
    private isConnecting: boolean;
    private isReady: boolean;
    private connectionTime: number | null;
    private pingInterval: ReturnType<typeof safeSetInterval> | null;
    private reconnectTimeout: ReturnType<typeof safeSetTimeout> | null;
    private connectionTimeout: ReturnType<typeof safeSetTimeout> | null;
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
        this.platformLogger = logger;
        this.eventBus = dependencies.eventBus || null;
        this.rawEventLogWriter = dependencies.rawEventLogWriter || new RawEventLogWriter();
        this.WebSocketCtor = dependencies.WebSocketCtor || resolveWebSocketConstructor(wsModule);
        this.incrementRetryCount = retrySystem.incrementRetryCount.bind(retrySystem);
        this.resetRetryCount = retrySystem.resetRetryCount.bind(retrySystem);
        this.retryHandleConnectionSuccess = retrySystem.handleConnectionSuccess?.bind(retrySystem);
        
        this.config = {
            enabled: config.enabled,
            youtubeChannelId: config.youtubeChannelId,
            twitchChannelId: config.twitchChannelId,
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
        this.pingInterval = null;
        this.reconnectTimeout = null;
        this.connectionTimeout = null;
        this.rejectConnectionAttempt = null;
        this.recoveryGeneration = 0;
        this.recoveryEnabled = this.config.enabled === true;
        this.handlers = this._createDefaultHandlers();
        this.lastConnectionError = null;
        
        if (this.config.enabled) {
            this.logger.warn('StreamElementsPlatform is deprecated and will be removed in a future version.', 'StreamElements');
            this.logger.info('Keep the standalone [streamelements] config only if you still need StreamElements follow events.', 'StreamElements');
        }
        
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
            this.logger.warn('[StreamElements] JWT token not configured - follow notifications will not work');
            return false;
        }
        
        if (!this.config.youtubeChannelId && !this.config.twitchChannelId) {
            this.logger.warn('[StreamElements] No channel IDs configured - follow notifications will not work');
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
            this.logger.info('[StreamElements] Connecting to StreamElements for real-time follow notifications');
            
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
        const wsUrl = STREAMELEMENTS.WEBSOCKET;
        
        const connection = new this.WebSocketCtor(wsUrl);
        this.connection = connection;
        this.setupEventListeners(connection);
        if (!connection) {
            throw new Error('StreamElements connection missing after WebSocket setup');
        }
        
        return new Promise((resolve, reject) => {
            this.rejectConnectionAttempt = reject;
            let timeout: ReturnType<typeof safeSetTimeout> | null = null;
            const clearConnectionAttempt = () => {
                if (timeout) {
                    clearTimeout(timeout);
                    if (this.connectionTimeout === timeout) {
                        this.connectionTimeout = null;
                    }
                    timeout = null;
                }
                if (this.rejectConnectionAttempt === reject) {
                    this.rejectConnectionAttempt = null;
                }
            };
            const removeAttemptListeners = () => {
                if (typeof connection.off === 'function') {
                    connection.off('open', handleOpen);
                    connection.off('error', handleError);
                } else if (typeof connection.removeListener === 'function') {
                    connection.removeListener('open', handleOpen);
                    connection.removeListener('error', handleError);
                }
            };
            const disposeFailedConnection = () => {
                if (this.connection !== connection) {
                    return;
                }
                try {
                    connection.removeAllListeners();
                } finally {
                    this.connection = null;
                }
                try {
                    connection.close();
                } catch (cleanupError) {
                    this.logger.debug('[StreamElements] Error closing failed connection:', 'streamelements', getErrorLogValue(cleanupError));
                }
            };
            const handleOpen = () => {
                clearConnectionAttempt();
                removeAttemptListeners();
                resolve();
            };
            const handleError = (err: unknown) => {
                clearConnectionAttempt();
                disposeFailedConnection();
                reject(err);
            };

            timeout = safeSetTimeout(() => {
                clearConnectionAttempt();
                disposeFailedConnection();
                reject(new Error('StreamElements connection timeout'));
            }, 15000);
            this.connectionTimeout = timeout;
            
            connection.once('open', handleOpen);
            connection.once('error', handleError);
        });
    }

    setupEventListeners(connection = this.connection): void {
        if (!connection) {
            const error = new Error('StreamElements connection missing connection object');
            this.errorHandler.handleConnectionError(error, 'connection', error.message);
            throw error;
        }
        if (typeof connection.on !== 'function') {
            const error = new Error('StreamElements connection missing event emitter interface (on/removeAllListeners)');
            this.errorHandler.handleConnectionError(
                error,
                'connection',
                'StreamElements connection is missing required event emitter methods'
            );
            throw error;
        }

        const ifCurrentConnection = (handler: (...args: unknown[]) => void) => (...args: unknown[]) => {
            if (this.connection === connection) {
                handler(...args);
            }
        };

        connection.on('open', ifCurrentConnection(() => this.handleConnectionOpen()));
        connection.on('message', ifCurrentConnection((data: unknown) => this.handleMessage(data)));
        connection.on('close', ifCurrentConnection((code: unknown, reason: unknown) => this.handleConnectionClose(Number(code), reason)));
        connection.on('error', ifCurrentConnection((err: unknown) => this.handleConnectionError(err)));
        connection.on('pong', ifCurrentConnection(() => this.handlePong()));
    }

    handleConnectionOpen(): void {

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        
        this.authenticate();
        
        this.startKeepAlive();
        
        this.connectionTime = Date.now();
        this.isConnecting = false;
        this.isReady = true;
        
        this.resetRetryCount('StreamElements');
        this.emitConnectionStatus('connected', false);
    }

    authenticate(): void {
        const authMessage = {
            type: 'auth',
            token: this.config.jwtToken
        };
        
        this.sendMessage(authMessage);
    }

    subscribeToFollowEvents(): void {
        if (this.config.youtubeChannelId) {
            const youtubeSubscription = {
                type: 'subscribe',
                topic: `channel.follow.${this.config.youtubeChannelId}`
            };
            this.sendMessage(youtubeSubscription);
        }
        
        if (this.config.twitchChannelId) {
            const twitchSubscription = {
                type: 'subscribe',
                topic: `channel.follow.${this.config.twitchChannelId}`
            };
            this.sendMessage(twitchSubscription);
        }
    }

    handleMessage(data: unknown): void {
        let message: StreamElementsMessage | undefined;
        try {
            const messageText = data !== null && data !== undefined && typeof data.toString === 'function'
                ? data.toString()
                : String(data);
            message = JSON.parse(messageText) as StreamElementsMessage;
            
            switch (message.type) {
                case 'auth':
                    this.handleAuthResponse(message);
                    break;
                case 'event':
                    this.handleFollowEvent(message);
                    break;
                case 'ping':
                    this.handlePing();
                    break;
                default:
                    this.logger.debug('[StreamElements] Unknown message type', 'streamelements', {
                        hasType: typeof message.type === 'string',
                        hasData: !!message.data
                    });
            }
        } catch (err) {
            this.errorHandler.handleEventProcessingError(err, 'message', message);
        }
    }

    handleAuthResponse(message: StreamElementsMessage): void {
        if (message.success) {
            this.logger.info('[StreamElements] Authentication confirmed', 'streamelements');
            this.subscribeToFollowEvents();
        } else {
            this.errorHandler.handleAuthenticationError('failed');
            this.disconnect();
        }
    }

    async handleFollowEvent(message: StreamElementsMessage): Promise<void> {
        if (this.config.dataLoggingEnabled) {
                this.logRawPlatformData('follow', message).catch((err: unknown) => {
                    this.errorHandler.handleDataLoggingError(err, 'follow');
                });
        }
        
        try {
            const eventData = message.data || {};
            const platform = this.mapStreamElementsPlatform(eventData.platform);
            
            if (!platform) {
                this.logger.debug('[StreamElements] Unknown platform in follow event', 'streamelements', {
                    hasPlatform: typeof eventData.platform === 'string' && eventData.platform.trim().length > 0
                });
                return;
            }
            
            const username = typeof eventData.displayName === 'string' ? eventData.displayName.trim() : '';
            const userId = typeof eventData.userId === 'string' ? eventData.userId.trim() : null;
            if (!username) {
                this.logger.warn('[StreamElements] Follow event missing username; skipping', 'streamelements', {
                    platform,
                    hasDisplayName: typeof eventData.displayName === 'string',
                    hasUserId: typeof eventData.userId === 'string'
                });
                return;
            }

            const followData = {
                username,
                platform: platform,
                timestamp: Date.now(),
                source: 'StreamElements'
            };

            this._emitPlatformEvent(PlatformEvents.FOLLOW, {
                platform,
                username: followData.username,
                userId,
                timestamp: new Date(followData.timestamp).toISOString(),
                source: 'streamelements',
                sourceType: 'streamelements:follow'
            });
            
            this.platformLogger.info('New follower from StreamElements', platform, {
                platform,
                hasUsername: true,
                hasUserId: !!userId
            });

        } catch (error) {
            this.errorHandler.handleEventProcessingError(error, 'follow', message?.data);
        }
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

    mapStreamElementsPlatform(sePlatform: string | undefined): string | null {
        const platformMap: Record<string, string> = {
            'youtube': 'youtube',
            'twitch': 'twitch'
        };

        return sePlatform ? (platformMap[sePlatform.toLowerCase()] || null) : null;
    }

    handlePing(): void {
        this.sendMessage({ type: 'pong' });
    }

    handlePong(): void {
    }

    startKeepAlive(): void {
        this.pingInterval = safeSetInterval(() => {
            if (this.isConnected()) {
                this.sendMessage({ type: 'ping' });
            }
        }, 30000);
    }

    stopKeepAlive(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    sendMessage(message: Record<string, unknown>): void {
        if (this.connection && this.connection.readyState === this.WebSocketCtor.OPEN) {
            this.connection.send(JSON.stringify(message));
        } else {
            this.logger.debug('[StreamElements] Cannot send message - WebSocket not connected', 'streamelements');
        }
    }

    handleConnectionClose(code: number, reason: unknown): void {
        this.logger.info('[StreamElements] Connection closed', 'streamelements', {
            code,
            hasReason: reason !== null && reason !== undefined && String(reason).length > 0
        });
        
        this.isConnecting = false;
        this.isReady = false;
        this.stopKeepAlive();
        this.cleanup(false);
        this.emitConnectionStatus(this.recoveryEnabled ? 'reconnecting' : 'disconnected', this.recoveryEnabled);
        this.scheduleReconnection();
    }

    handleConnectionError(err: unknown, recoveryGeneration = this.recoveryGeneration): void {
        const connectionError = err as { message?: string; toString?: () => string };
        const errorMessage = connectionError?.message || connectionError?.toString?.() || 'Unknown error';
        this.errorHandler.handleConnectionError(err, 'connection', errorMessage);

        if (recoveryGeneration !== this.recoveryGeneration) {
            return;
        }

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

    cleanup(cancelRecovery = true): void {
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
        rejectConnectionAttempt?.(new Error('StreamElements connection attempt cancelled'));

        this.isConnecting = false;
        this.isReady = false;
        this.stopKeepAlive();

        if (this.connection) {
            const connection = this.connection;
            try {
                connection.removeAllListeners();
            } catch (cleanupError) {
                this.logger.debug('[StreamElements] Error removing listeners during cleanup:', 'streamelements', getErrorLogValue(cleanupError));
            }
            this.connection = null;
            try {
                connection.close();
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
        youtubeChannelId: string;
        twitchChannelId: string;
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
            youtubeChannelId: this.config.youtubeChannelId || 'not configured',
            twitchChannelId: this.config.twitchChannelId || 'not configured',
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
