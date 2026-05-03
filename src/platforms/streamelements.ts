import { EventEmitter } from 'node:events';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import * as wsModule from 'ws';

import { STREAMELEMENTS } from '../core/endpoints';
import { getUnifiedLogger } from '../core/logging';
import { secrets } from '../core/secrets';
import { PlatformEvents } from '../interfaces/PlatformEvents';
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

type StreamElementsDependencies = {
    logger?: {
        debug: (...args: unknown[]) => void;
        info: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
    };
    retrySystem?: {
        incrementRetryCount: (platform: string) => number;
        resetRetryCount: (platform: string) => void;
        handleConnectionSuccess?: (platform: string) => void;
        handleConnectionError: (
            platform: string,
            error: unknown,
            reconnect: () => Promise<boolean>,
            cleanup: () => void,
        ) => void;
    };
    eventBus?: {
        emit: (eventName: string, payload: unknown) => void;
    } | null;
    WebSocketCtor?: {
        OPEN: number;
        new(url: string): {
            readyState: number;
            on: (event: string, listener: (...args: unknown[]) => void) => void;
            once: (event: string, listener: (...args: unknown[]) => void) => void;
            send: (payload: string) => void;
            close: () => void;
            removeAllListeners: () => void;
        };
    };
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


class StreamElementsPlatform extends EventEmitter {
    constructor(config: StreamElementsConfig = {}, dependencies: StreamElementsDependencies = {}) {
        super();
        
        // Extract dependencies with fallbacks
        const logger = dependencies.logger || getUnifiedLogger();
        const retrySystem = dependencies.retrySystem || createRetrySystem({ logger });
        
        // Store injected dependencies
        this.errorHandler = createPlatformErrorHandler(logger, 'streamelements');
        // debugLog function removed - using logger.debug directly
        this.logger = logger;
        this.platformLogger = logger;
        this.eventBus = dependencies.eventBus || null;
        this.WebSocketCtor = dependencies.WebSocketCtor || wsModule.WebSocket || wsModule.default || wsModule;
        this.incrementRetryCount = retrySystem.incrementRetryCount.bind(retrySystem);
        this.resetRetryCount = retrySystem.resetRetryCount.bind(retrySystem);
        this.retryHandleConnectionError = retrySystem.handleConnectionError.bind(retrySystem);
        this.retryHandleConnectionSuccess = retrySystem.handleConnectionSuccess.bind(retrySystem);
        
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
        this.handlers = this._createDefaultHandlers();
        
        // Emit deprecation warnings
        this.logger.warn('StreamElementsPlatform is deprecated and will be removed in a future version. Use YouTube platform with StreamElements service instead.', 'StreamElements');
        this.logger.info('To migrate: Move StreamElements config to YouTube platform section and enable streamelements service.', 'StreamElements');
        
    }
    async initialize(handlers: { onFollow?: (data: StreamElementsEventPayload) => void } = {}): Promise<boolean> {
        this.handlers = {
            ...this.handlers,
            ...(handlers || {})
        };
        
        if (!this.config.enabled) {
            this.logger.debug('[StreamElements] Platform disabled in configuration', 'streamelements');
            return false;
        }

        if (this.isConnected()) {
            return true;
        }

        const connected = await this.connect();
        if (!connected && !this.isConnected()) {
            throw new Error('StreamElements initialization failed: unable to establish connection');
        }

        return true;
    }

    checkConnectionPrerequisites(): boolean {
        if (!this.config.enabled) {
            this.logger.debug('[StreamElements] Platform disabled, skipping connection', 'streamelements');
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
        if (this.isConnecting) {
            this.logger.debug('[StreamElements] Connection already in progress', 'streamelements');
            return false;
        }

        if (!this.checkConnectionPrerequisites()) {
            return false;
        }

        this.isConnecting = true;
        
        try {
            this.logger.debug('[StreamElements] Connecting to StreamElements WebSocket...', 'streamelements');
            this.logger.info('[StreamElements] Connecting to StreamElements for real-time follow notifications');
            
            await this.connectToWebSocket();
            return true;
            
        } catch (err) {
            this.handleConnectionError(err);
            return false;
        }
    }

    async connectToWebSocket(): Promise<void> {
        const wsUrl = STREAMELEMENTS.WEBSOCKET;
        
        this.connection = new this.WebSocketCtor(wsUrl);
        this.setupEventListeners();
        
        // Wait for connection to be established
        return new Promise((resolve, reject) => {
            const timeout = safeSetTimeout(() => {
                reject(new Error('StreamElements connection timeout'));
            }, 15000);
            
            this.connection.once('open', () => {
                clearTimeout(timeout);
                resolve();
            });
            
            this.connection.once('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }

    setupEventListeners(): void {
        if (!this.connection) {
            const error = new Error('StreamElements connection missing connection object');
            this.errorHandler.handleConnectionError(error, 'connection', error.message);
            throw error;
        }
        if (typeof this.connection.on !== 'function') {
            const error = new Error('StreamElements connection missing event emitter interface (on/removeAllListeners)');
            this.errorHandler.handleConnectionError(
                error,
                'connection',
                'StreamElements connection is missing required event emitter methods'
            );
            throw error;
        }
        
        this.connection.on('open', () => this.handleConnectionOpen());
        this.connection.on('message', (data) => this.handleMessage(data));
        this.connection.on('close', (code, reason) => this.handleConnectionClose(code, reason));
        this.connection.on('error', (err) => this.handleConnectionError(err));
        this.connection.on('pong', () => this.handlePong());
        
        this.logger.debug('[StreamElements] WebSocket event listeners configured', 'streamelements');
    }

    handleConnectionOpen(): void {
        this.logger.debug('[StreamElements] WebSocket connection opened', 'streamelements');
        
        // Authenticate with JWT token
        this.authenticate();
        
        // Start ping/pong keep-alive
        this.startKeepAlive();
        
        this.connectionTime = Date.now();
        this.isConnecting = false;
        this.isReady = true;
        
        this.resetRetryCount('StreamElements');
        this.logger.info('[StreamElements] Successfully connected to StreamElements WebSocket');
    }

    authenticate(): void {
        const authMessage = {
            type: 'auth',
            token: this.config.jwtToken
        };
        
        this.sendMessage(authMessage);
        this.logger.debug('[StreamElements] Authentication message sent', 'streamelements');
    }

    subscribeToFollowEvents(): void {
        // Subscribe to YouTube follows if channel ID configured
        if (this.config.youtubeChannelId) {
            const youtubeSubscription = {
                type: 'subscribe',
                topic: `channel.follow.${this.config.youtubeChannelId}`
            };
            this.sendMessage(youtubeSubscription);
            this.logger.debug(`[StreamElements] Subscribed to YouTube follows for channel: ${this.config.youtubeChannelId}`, 'streamelements');
        }
        
        // Subscribe to Twitch follows if channel ID configured
        if (this.config.twitchChannelId) {
            const twitchSubscription = {
                type: 'subscribe',
                topic: `channel.follow.${this.config.twitchChannelId}`
            };
            this.sendMessage(twitchSubscription);
            this.logger.debug(`[StreamElements] Subscribed to Twitch follows for channel: ${this.config.twitchChannelId}`, 'streamelements');
        }
    }

    handleMessage(data: wsModule.RawData): void {
        let message: StreamElementsMessage | undefined;
        try {
            message = JSON.parse(data.toString()) as StreamElementsMessage;
            this.logger.debug(`[StreamElements] Received message:`, 'streamelements', message);
            
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
                    this.logger.debug(`[StreamElements] Unknown message type: ${message.type}`, 'streamelements');
            }
        } catch (err) {
            this.errorHandler.handleEventProcessingError(err, 'message', message);
        }
    }

    handleAuthResponse(message: StreamElementsMessage): void {
        if (message.success) {
            this.logger.debug('[StreamElements] Authentication successful', 'streamelements');
            this.subscribeToFollowEvents();
        } else {
            this.errorHandler.handleAuthenticationError(`failed: ${message.error || 'Unknown error'}`);
            this.disconnect();
        }
    }

    async handleFollowEvent(message: StreamElementsMessage): Promise<void> {
        // Log raw platform data if enabled
        if (this.config.dataLoggingEnabled) {
                this.logRawPlatformData('follow', message).catch(err => {
                    this.errorHandler.handleDataLoggingError(err, 'follow');
                });
        }
        
        try {
            const eventData = message.data || {};
            const platform = this.mapStreamElementsPlatform(eventData.platform);
            
            if (!platform) {
                this.logger.debug(`[StreamElements] Unknown platform in follow event: ${eventData.platform}`, 'streamelements');
                return;
            }
            
            const username = typeof eventData.displayName === 'string' ? eventData.displayName.trim() : '';
            const userId = typeof eventData.userId === 'string' ? eventData.userId.trim() : null;
            if (!username) {
                this.logger.warn('[StreamElements] Follow event missing username; skipping', 'streamelements', { eventData });
                return;
            }

            const followData = {
                username,
                platform: platform,
                timestamp: Date.now(),
                source: 'StreamElements'
            };
            
            this.logger.debug(`[StreamElements] Processing ${platform} follow: ${followData.username}`, 'streamelements');

            this._emitPlatformEvent(PlatformEvents.FOLLOW, {
                platform,
                username: followData.username,
                userId,
                timestamp: new Date(followData.timestamp).toISOString(),
                source: 'streamelements',
                sourceType: 'streamelements:follow'
            });
            
            this.platformLogger.info(`New follower from StreamElements: ${followData.username}`, platform);

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

        const handlerMap = {
            [PlatformEvents.FOLLOW]: 'onFollow'
        };

        const handlerName = handlerMap[type as keyof typeof handlerMap];
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
        this.logger.debug('[StreamElements] Received ping, sending pong', 'streamelements');
        this.sendMessage({ type: 'pong' });
    }

    handlePong(): void {
        this.logger.debug('[StreamElements] Received pong response', 'streamelements');
    }

    startKeepAlive(): void {
        // Send ping every 30 seconds
        this.pingInterval = safeSetInterval(() => {
            if (this.isConnected()) {
                this.sendMessage({ type: 'ping' });
                this.logger.debug('[StreamElements] Sent keep-alive ping', 'streamelements');
            }
        }, 30000);
        
        this.logger.debug('[StreamElements] Keep-alive mechanism started', 'streamelements');
    }

    stopKeepAlive(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
            this.logger.debug('[StreamElements] Keep-alive mechanism stopped', 'streamelements');
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
        this.logger.info(`[StreamElements] Connection closed (${code}): ${reason}`);
        
        this.isConnecting = false;
        this.isReady = false;
        this.stopKeepAlive();
        this.cleanup();
        
        // Attempt reconnection with exponential backoff
        this.scheduleReconnection();
    }

    handleConnectionError(err: unknown): void {
        const connectionError = err as { message?: string; toString?: () => string };
        const errorMessage = connectionError?.message || connectionError?.toString?.() || 'Unknown error';
        this.errorHandler.handleConnectionError(err, 'connection', errorMessage);

        if (this.retryHandleConnectionError) {
            this.retryHandleConnectionError('StreamElements', err, () => this.connect(), () => this.cleanup());
            return;
        }

        this.scheduleReconnection();
    }

    scheduleReconnection(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }
        
        const delay = this.incrementRetryCount('StreamElements');
        
        this.logger.debug(`[StreamElements] Scheduling reconnection in ${delay}ms`, 'streamelements');
        
        this.reconnectTimeout = safeSetTimeout(() => {
            if (!this.isConnected() && this.config.enabled) {
                this.connect();
            }
        }, delay);
    }

    async disconnect(): Promise<void> {
        this.logger.debug('[StreamElements] Disconnecting from StreamElements WebSocket...', 'streamelements');
        
        this.isConnecting = false;
        this.isReady = false;
        
        this.stopKeepAlive();
        
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        
        if (this.connection) {
            try {
                this.connection.close();
                this.logger.debug('[StreamElements] Successfully disconnected', 'streamelements');
            } catch (err) {
                this.logger.debug('[StreamElements] Error during disconnect:', 'streamelements', err.message || err);
            }
        }
        
        this.cleanup();
    }

    cleanup(): void {
        if (this.connection) {
            try {
                this.connection.removeAllListeners();
            } catch (cleanupError) {
                this.logger.debug('[StreamElements] Error removing listeners during cleanup:', 'streamelements', cleanupError.message || cleanupError);
            }
            this.connection = null;
        }
        this.connectionTime = null;
        this.logger.debug('[StreamElements] Connection cleanup completed', 'streamelements');
    }

    async logRawPlatformData(eventType: string, data: unknown): Promise<void> {
        if (!this.config.dataLoggingEnabled) {
            return;
        }

        try {
            const logsDir = this.config.dataLoggingPath;
            await fs.mkdir(logsDir, { recursive: true });

            const ingestTimestamp = getSystemTimestampISO();
            const logEntry = {
                ingestTimestamp,
                platform: 'streamelements',
                eventType,
                payload: data
            };

            const logFile = path.join(logsDir, 'streamelements-data-log.ndjson');
            await fs.appendFile(logFile, `${JSON.stringify(logEntry)}\n`);

            this.logger.debug(`Raw platform data logged to ${logFile}`, 'streamelements-platform');
        } catch (error) {
            this.errorHandler.handleDataLoggingError(error, 'platform');
            // Don't throw - logging failures shouldn't break the main flow
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
