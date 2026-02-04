
const { createPlatformErrorHandler } = require('./platform-error-handler');
const { EventEmitter } = require('events');
const { validateLoggerInterface } = require('./dependency-validator');
const { secrets } = require('../core/secrets');

function ensureEmitterInterface(connection, logger, platform = 'tiktok') {
    if (!connection || typeof connection !== 'object') {
        return connection;
    }

    const hasEmitterSurface =
        typeof connection.on === 'function' &&
        typeof connection.emit === 'function' &&
        typeof connection.removeAllListeners === 'function';

    if (hasEmitterSurface) {
        return connection;
    }

    const emitter = new EventEmitter();
    const bind = (method) => {
        if (typeof emitter[method] === 'function') {
            connection[method] = emitter[method].bind(emitter);
        }
    };

    ['on', 'once', 'off', 'emit', 'removeListener', 'removeAllListeners', 'prependListener', 'prependOnceListener', 'listenerCount', 'eventNames'].forEach(bind);

    // Align aliases for compatibility
    if (!connection.off && typeof connection.removeListener === 'function') {
        connection.off = connection.removeListener.bind(connection);
    }

    logger?.debug(`Hardened ${platform} connection with EventEmitter wrapper`, platform);
    return connection;
}

class PlatformConnectionFactory {
    constructor(logger = null) {
        this.logger = this._resolveLogger(logger);
        this.errorHandler = createPlatformErrorHandler(this.logger, 'platform-connection-factory');
    }

    _resolveLogger(logger) {
        if (!logger) {
            throw new Error('Platform Connection Factory initialization failed: logger dependency is required.');
        }

        try {
            const normalized = this._normalizeLoggerMethods(logger);
            validateLoggerInterface(normalized);
            return normalized;
        } catch (error) {
            throw new Error(`Platform Connection Factory initialization failed: ${error.message}`);
        }
    }

    _normalizeLoggerMethods(logger) {
        const required = ['debug', 'info', 'warn', 'error'];
        const normalized = { ...logger };
        required.forEach((method) => {
            if (typeof normalized[method] !== 'function') {
                normalized[method] = () => {};
            }
        });
        return normalized;
    }
    
    createConnection(platform, config, dependencies) {
        this.logger.debug(`Creating connection for platform: ${platform}`, platform);
        
        // FAIL-FAST: Validate inputs before proceeding
        if (!platform || typeof platform !== 'string') {
            throw new Error('Platform name is required and must be a string');
        }
        
        if (!config || typeof config !== 'object') {
            throw new Error(`Configuration is required for ${platform} connection`);
        }
        
        if (!dependencies || typeof dependencies !== 'object') {
            throw new Error(`Platform creation failed for ${platform}: missing dependencies. ` +
                           'Provide a dependencies object with required platform services.');
        }
        
        // Logger is required for all platforms
        if (!dependencies.logger) {
            throw new Error(`Platform creation failed for ${platform}: missing dependencies (logger). ` +
                           'All platforms require a logger dependency for proper operation.');
        }
        
        try {
            validateLoggerInterface(dependencies.logger);
        } catch (error) {
            throw new Error(`Platform creation failed for ${platform}: ${error.message}`);
        }
        
        // Normalize platform name
        const normalizedPlatform = platform.toLowerCase();
        
        try {
            switch (normalizedPlatform) {
                case 'tiktok':
                    return this.createTikTokConnection(config, dependencies);
                    
                case 'youtube':
                    return this.createYouTubeConnection(config, dependencies);
                    
                case 'twitch':
                    return this.createTwitchConnection(config, dependencies);
                    
                default:
                    throw new Error(`Unsupported platform: ${platform}`);
            }
        } catch (error) {
            this._handleFactoryError(`Failed to create connection for ${platform}: ${error.message}`, error, platform);
            throw error;
        }
    }
    
    createTikTokConnection(config, dependencies) {
        const cleanUsername = config.username.replace(/^@/, '').trim();
        if (cleanUsername !== config.username) {
            this.logger.debug(`TikTok username cleaned from '${config.username}' to '${cleanUsername}'`, 'tiktok');
        }

        const hasWebsocketClient = typeof dependencies.TikTokWebSocketClient === 'function';
        if (!hasWebsocketClient) {
            throw new Error('TikTok connection creation failed: missing TikTokWebSocketClient');
        }

        const connectionConfig = this.buildTikTokConnectionConfig(config, dependencies);

        try {
            this.logger.debug(`Creating TikTok connection for user: '${cleanUsername}'`, 'tiktok');

            const connection = new dependencies.TikTokWebSocketClient(cleanUsername, connectionConfig);

            if (!connection) {
                throw new Error(`TikTok connection constructor returned null for user '${cleanUsername}'`);
            }

            const essentialMethods = ['connect'];
            for (const method of essentialMethods) {
                if (typeof connection[method] !== 'function') {
                    throw new Error(`TikTok connection for user '${cleanUsername}' missing essential method: ${method}`);
                }
            }

            const optionalMethods = ['disconnect', 'fetchIsLive', 'waitUntilLive', 'on', 'removeAllListeners'];
            for (const method of optionalMethods) {
                if (typeof connection[method] !== 'function') {
                    connection[method] = () => {};
                }
            }

            ensureEmitterInterface(connection, this.logger, 'tiktok');
            return connection;
        } catch (error) {
            const errorMessage = error?.message || error?.toString() || 'Unknown error';
            this._handleFactoryError(`Failed to create TikTok connection for user '${cleanUsername}': ${errorMessage}`, error, 'tiktok');
            throw new Error(`Failed to create TikTok connection for user '${cleanUsername}': ${errorMessage}`);
        }
    }
    
    buildTikTokConnectionConfig(config, dependencies) {
        const apiKey = secrets.tiktok.apiKey || null;

        const baseConfig = {
            apiKey,
            WebSocketCtor: dependencies?.WebSocketCtor
        };

        if (apiKey) {
            const maskedKey = (apiKey.length <= 12)
                ? `${apiKey.slice(0, 5)}...`
                : `${apiKey.slice(0, 10)}...`;
            this.logger.debug(`Using EulerStream API key: ${maskedKey}`, 'tiktok');
        } else {
            this.logger.warn('No API key configured - WebSocket may fail', 'tiktok');
        }

        return baseConfig;
    }
    
    createYouTubeConnection(config, dependencies) {
        try {
            // Create a basic YouTube connection object for state management
            const connection = {
                platform: 'youtube',
                config: config,
                dependencies: dependencies,
                isValid: true,
                connected: false,
                
                // Essential methods for compatibility
                connect: async () => {
                    connection.connected = true;
                    return Promise.resolve();
                },
                
                disconnect: async () => {
                    connection.connected = false;
                    return Promise.resolve();
                },
                
                isConnected: () => connection.connected,
                
                // Event emitter compatibility
                on: () => {},
                removeAllListeners: () => {},
                
                // YouTube-specific methods (minimal implementation for state management)
                getApiKey: () => secrets.youtube.apiKey || null,
                getUsername: () => config.username
            };
            
            // Validate the created connection
            if (!connection) {
                throw new Error('YouTube connection creation failed');
            }
            
            return connection;
            
        } catch (error) {
            this._handleFactoryError(`Failed to create YouTube connection: ${error.message}`, error, 'youtube');
            throw error;
        }
    }
    
    createTwitchConnection(config, dependencies) {
        // This is a placeholder for future expansion
        throw new Error('Twitch connection creation not yet implemented');
    }
    
    getSupportedPlatforms() {
        return ['tiktok', 'youtube']; // TikTok and YouTube supported
    }
    
    isPlatformSupported(platform) {
        if (!platform || typeof platform !== 'string') {
            return false;
        }
        
        return this.getSupportedPlatforms().includes(platform.toLowerCase());
    }
    
    createStandardDependencies(platform, baseLogger) {
        const { createStandardDependencies } = require('./dependency-validator');
        return createStandardDependencies(platform, baseLogger);
    }
}

PlatformConnectionFactory.prototype._handleFactoryError = function(message, error, platform) {
    if (!this.errorHandler && this.logger) {
        this.errorHandler = createPlatformErrorHandler(this.logger, 'platform-connection');
    }

    if (this.errorHandler && error instanceof Error) {
        this.errorHandler.handleEventProcessingError(error, platform || 'platform-connection', null, message);
        return;
    }

    if (this.errorHandler) {
        this.errorHandler.logOperationalError(message, platform || 'platform-connection');
    }
};

module.exports = { PlatformConnectionFactory };
