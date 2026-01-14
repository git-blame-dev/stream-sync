
const WebSocket = require('ws');
const { EventEmitter } = require('events');
const { safeSetTimeout, safeSetInterval } = require('../utils/timeout-validator');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { ConfigValidatorStatic } = require('../utils/config-validator');
const { createRetrySystem } = require('../utils/retry-system');
const { STREAMELEMENTS } = require('../core/endpoints');


class StreamElementsPlatform extends EventEmitter {
    constructor(config = {}, dependencies = {}) {
        super();
        
        // Extract dependencies with fallbacks
        const { getUnifiedLogger } = require('../core/logging');
        const logger = dependencies.logger || getUnifiedLogger();
        const retrySystem = dependencies.retrySystem || createRetrySystem({ logger });
        
        // Store injected dependencies
        this.errorHandler = createPlatformErrorHandler(logger, 'streamelements');
        // debugLog function removed - using logger.debug directly
        this.logger = logger;
        this.platformLogger = logger;
        this.incrementRetryCount = retrySystem.incrementRetryCount.bind(retrySystem);
        this.resetRetryCount = retrySystem.resetRetryCount.bind(retrySystem);
        this.retryHandleConnectionError = retrySystem.handleConnectionError.bind(retrySystem);
        this.retryHandleConnectionSuccess = retrySystem.handleConnectionSuccess.bind(retrySystem);
        
        const trimToUndefined = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

        this.config = {
            enabled: ConfigValidatorStatic.parseBoolean(config.enabled, false),
            youtubeChannelId: trimToUndefined(config.youtubeChannelId),
            twitchChannelId: trimToUndefined(config.twitchChannelId),
            jwtToken: trimToUndefined(config.jwtToken),
            dataLoggingEnabled: ConfigValidatorStatic.parseBoolean(config.dataLoggingEnabled, false),
            dataLoggingPath: trimToUndefined(config.dataLoggingPath)
        };
        
        this.connection = null;
        this.isConnecting = false;
        this.isReady = false;
        this.connectionTime = null;
        this.pingInterval = null;
        this.reconnectTimeout = null;
        
        // Event handlers for external systems
        this.eventHandlers = {};
        
        // Emit deprecation warnings
        this.logger.warn('StreamElementsPlatform is deprecated and will be removed in a future version. Use YouTube platform with StreamElements service instead.', 'StreamElements');
        this.logger.info('To migrate: Move StreamElements config to YouTube platform section and enable streamelements service.', 'StreamElements');
        
    }
    async initialize(handlers = {}) {
        this.eventHandlers = handlers;
        
        if (!this.config.enabled) {
            this.logger.debug('[StreamElements] Platform disabled in configuration', 'streamelements');
            return false;
        }
        
        return true;
    }

    checkConnectionPrerequisites() {
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

    isConnected() {
        return !!(this.connection && this.connection.readyState === WebSocket.OPEN && this.isReady);
    }

    async connect() {
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

    async connectToWebSocket() {
        const wsUrl = STREAMELEMENTS.WEBSOCKET;
        
        this.connection = new WebSocket(wsUrl);
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

    setupEventListeners() {
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

    handleConnectionOpen() {
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

    authenticate() {
        const authMessage = {
            type: 'auth',
            token: this.config.jwtToken
        };
        
        this.sendMessage(authMessage);
        this.logger.debug('[StreamElements] Authentication message sent', 'streamelements');
    }

    subscribeToFollowEvents() {
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

    handleMessage(data) {
        let message;
        try {
            message = JSON.parse(data.toString());
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

    handleAuthResponse(message) {
        if (message.success) {
            this.logger.debug('[StreamElements] Authentication successful', 'streamelements');
            this.subscribeToFollowEvents();
        } else {
            this.errorHandler.handleAuthenticationError(`failed: ${message.error || 'Unknown error'}`);
            this.disconnect();
        }
    }

    async handleFollowEvent(message) {
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
            
            // Emit via modern platform:event path and let PlatformEventRouter/NotificationManager handle it
            this.emit('platform:event', {
                platform,
                type: 'platform:follow',
                data: {
                    username: followData.username,
                    userId,
                    timestamp: new Date(followData.timestamp).toISOString(),
                    source: 'streamelements',
                    sourceType: 'streamelements:follow'
                }
            });
            
            this.platformLogger.info(platform, `New follower from StreamElements: ${followData.username}`);

        } catch (error) {
            this.errorHandler.handleEventProcessingError(error, 'follow', message?.data);
        }
    }

    mapStreamElementsPlatform(sePlatform) {
        const platformMap = {
            'youtube': 'youtube',
            'twitch': 'twitch'
        };
        
        return platformMap[sePlatform?.toLowerCase()] || null;
    }

    handlePing() {
        this.logger.debug('[StreamElements] Received ping, sending pong', 'streamelements');
        this.sendMessage({ type: 'pong' });
    }

    handlePong() {
        this.logger.debug('[StreamElements] Received pong response', 'streamelements');
    }

    startKeepAlive() {
        // Send ping every 30 seconds
        this.pingInterval = safeSetInterval(() => {
            if (this.isConnected()) {
                this.sendMessage({ type: 'ping' });
                this.logger.debug('[StreamElements] Sent keep-alive ping', 'streamelements');
            }
        }, 30000);
        
        this.logger.debug('[StreamElements] Keep-alive mechanism started', 'streamelements');
    }

    stopKeepAlive() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
            this.logger.debug('[StreamElements] Keep-alive mechanism stopped', 'streamelements');
        }
    }

    sendMessage(message) {
        if (this.connection && this.connection.readyState === WebSocket.OPEN) {
            this.connection.send(JSON.stringify(message));
        } else {
            this.logger.debug('[StreamElements] Cannot send message - WebSocket not connected', 'streamelements');
        }
    }

    handleConnectionClose(code, reason) {
        this.logger.info(`[StreamElements] Connection closed (${code}): ${reason}`);
        
        this.isConnecting = false;
        this.isReady = false;
        this.stopKeepAlive();
        this.cleanup();
        
        // Attempt reconnection with exponential backoff
        this.scheduleReconnection();
    }

    handleConnectionError(err) {
        const errorMessage = err?.message || err?.toString() || 'Unknown error';
        this.errorHandler.handleConnectionError(err, 'connection', errorMessage);

        if (this.retryHandleConnectionError) {
            this.retryHandleConnectionError('StreamElements', err, () => this.connect(), () => this.cleanup());
            return;
        }

        this.scheduleReconnection();
    }

    scheduleReconnection() {
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

    async disconnect() {
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

    cleanup() {
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

    async logRawPlatformData(eventType, data) {
        if (!this.config.dataLoggingEnabled) {
            return; // Exit early if logging disabled
        }

        if (!this.config.dataLoggingPath) {
            this.errorHandler.logOperationalError(
                'dataLoggingPath is required when dataLoggingEnabled is true',
                'streamelements'
            );
            return;
        }

        try {
            const fs = require('fs').promises;
            const path = require('path');

            // Ensure logs directory exists
            const logsDir = this.config.dataLoggingPath;
            await fs.mkdir(logsDir, { recursive: true });

            // Create log entry with timestamp and event type
            const timestamp = new Date().toISOString();
            const logEntry = `[${timestamp}] [${eventType.toUpperCase()}] ${JSON.stringify(data, null, 2)}\n\n`;

            // Append to platform-specific log file
            const logFile = path.join(logsDir, 'streamelements-data-log.txt');
            await fs.appendFile(logFile, logEntry);

            this.logger.debug(`Raw platform data logged to ${logFile}`, 'streamelements-platform');
        } catch (error) {
            this.errorHandler.handleDataLoggingError(error, 'platform');
            // Don't throw - logging failures shouldn't break the main flow
        }
    }

    getStatus() {
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

module.exports = {
    StreamElementsPlatform
}; 
