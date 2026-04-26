import { EventEmitter } from 'node:events';

import { createPlatformErrorHandler } from './platform-error-handler';
import { validateLoggerInterface } from './dependency-validator';
import { normalizeLoggerMethods } from './logger-resolver';
import { secrets } from '../core/secrets';

type FactoryLogger = {
    debug: (message: string, source?: string) => void;
    warn: (message: string, source?: string) => void;
};

type PlatformDependencies = {
    logger?: unknown;
    TikTokWebSocketClient?: new (username: string, config: Record<string, unknown>) => Record<string, unknown>;
    WebSocketCtor?: unknown;
    [key: string]: unknown;
};

function ensureEmitterInterface(connection: unknown, logger: FactoryLogger, platform = 'tiktok'): unknown {
    if (!connection || typeof connection !== 'object') {
        return connection;
    }

    const mutableConnection = connection as Record<string, unknown>;
    const hasEmitterSurface =
        typeof mutableConnection.on === 'function'
        && typeof mutableConnection.emit === 'function'
        && typeof mutableConnection.removeAllListeners === 'function';

    if (hasEmitterSurface) {
        return mutableConnection;
    }

    const emitter = new EventEmitter();
    const bind = (method: string) => {
        const emitterMethod = (emitter as unknown as Record<string, unknown>)[method];
        if (typeof emitterMethod === 'function') {
            mutableConnection[method] = (emitterMethod as Function).bind(emitter);
        }
    };

    [
        'on',
        'once',
        'off',
        'emit',
        'removeListener',
        'removeAllListeners',
        'prependListener',
        'prependOnceListener',
        'listenerCount',
        'eventNames'
    ].forEach(bind);

    if (!mutableConnection.off && typeof mutableConnection.removeListener === 'function') {
        mutableConnection.off = (mutableConnection.removeListener as Function).bind(mutableConnection);
    }

    logger?.debug(`Hardened ${platform} connection with EventEmitter wrapper`, platform);
    return mutableConnection;
}

class PlatformConnectionFactory {
    logger: FactoryLogger;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;

    constructor(logger: unknown = null) {
        this.logger = this.resolveLogger(logger);
        this.errorHandler = createPlatformErrorHandler(this.logger, 'platform-connection-factory');
    }

    resolveLogger(logger: unknown): FactoryLogger {
        if (!logger) {
            throw new Error('Platform Connection Factory initialization failed: logger dependency is required.');
        }

        try {
            const normalized = normalizeLoggerMethods(logger as Record<string, unknown>);
            validateLoggerInterface(normalized);
            return normalized;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Platform Connection Factory initialization failed: ${message}`);
        }
    }

    createConnection(platform: string, config: Record<string, unknown>, dependencies: PlatformDependencies): unknown {
        this.logger.debug(`Creating connection for platform: ${platform}`, platform);

        if (!platform || typeof platform !== 'string') {
            throw new Error('Platform name is required and must be a string');
        }

        if (!config || typeof config !== 'object') {
            throw new Error(`Configuration is required for ${platform} connection`);
        }

        if (!dependencies || typeof dependencies !== 'object') {
            throw new Error(
                `Platform creation failed for ${platform}: missing dependencies. `
                + 'Provide a dependencies object with required platform services.'
            );
        }

        if (!dependencies.logger) {
            throw new Error(
                `Platform creation failed for ${platform}: missing dependencies (logger). `
                + 'All platforms require a logger dependency for proper operation.'
            );
        }

        try {
            validateLoggerInterface(dependencies.logger as Record<string, unknown>);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Platform creation failed for ${platform}: ${message}`);
        }

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
            const message = error instanceof Error ? error.message : String(error);
            this.handleFactoryError(`Failed to create connection for ${platform}: ${message}`, error, platform);
            throw error;
        }
    }

    createTikTokConnection(config: Record<string, unknown>, dependencies: PlatformDependencies): unknown {
        const rawUsername = typeof config.username === 'string' ? config.username : '';
        const cleanUsername = rawUsername.replace(/^@/, '').trim();
        if (cleanUsername !== rawUsername) {
            this.logger.debug(`TikTok username cleaned from '${rawUsername}' to '${cleanUsername}'`, 'tiktok');
        }

        const hasWebsocketClient = typeof dependencies.TikTokWebSocketClient === 'function';
        if (!hasWebsocketClient) {
            throw new Error('TikTok connection creation failed: missing TikTokWebSocketClient');
        }

        const connectionConfig = this.buildTikTokConnectionConfig(config, dependencies);

        try {
            this.logger.debug(`Creating TikTok connection for user: '${cleanUsername}'`, 'tiktok');

            const ClientConstructor = dependencies.TikTokWebSocketClient as new (
                username: string,
                config: Record<string, unknown>
            ) => Record<string, unknown>;
            const connection = new ClientConstructor(cleanUsername, connectionConfig);

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
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.handleFactoryError(`Failed to create TikTok connection for user '${cleanUsername}': ${errorMessage}`, error, 'tiktok');
            throw new Error(`Failed to create TikTok connection for user '${cleanUsername}': ${errorMessage}`);
        }
    }

    buildTikTokConnectionConfig(_config: Record<string, unknown>, dependencies: PlatformDependencies): Record<string, unknown> {
        const apiKey = secrets.tiktok.apiKey || null;

        const baseConfig = {
            apiKey,
            WebSocketCtor: dependencies?.WebSocketCtor
        };

        if (apiKey) {
            const maskedKey = apiKey.length <= 12
                ? `${apiKey.slice(0, 5)}...`
                : `${apiKey.slice(0, 10)}...`;
            this.logger.debug(`Using EulerStream API key: ${maskedKey}`, 'tiktok');
        } else {
            this.logger.warn('No API key configured - WebSocket may fail', 'tiktok');
        }

        return baseConfig;
    }

    createYouTubeConnection(config: Record<string, unknown>, dependencies: PlatformDependencies): Record<string, unknown> {
        try {
            const connection: Record<string, unknown> = {
                platform: 'youtube',
                config,
                dependencies,
                isValid: true,
                connected: false,
                connect: async () => {
                    connection.connected = true;
                },
                disconnect: async () => {
                    connection.connected = false;
                },
                isConnected: () => connection.connected,
                on: () => {},
                removeAllListeners: () => {},
                getApiKey: () => secrets.youtube.apiKey || null,
                getUsername: () => config.username
            };

            if (!connection) {
                throw new Error('YouTube connection creation failed');
            }

            return connection;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.handleFactoryError(`Failed to create YouTube connection: ${message}`, error, 'youtube');
            throw error;
        }
    }

    createTwitchConnection(_config: Record<string, unknown>, _dependencies: PlatformDependencies): never {
        throw new Error('Twitch connection creation not yet implemented');
    }

    getSupportedPlatforms(): string[] {
        return ['tiktok', 'youtube'];
    }

    isPlatformSupported(platform: unknown): boolean {
        if (typeof platform !== 'string') {
            return false;
        }

        return this.getSupportedPlatforms().includes(platform.toLowerCase());
    }

    createStandardDependencies(platform: string, baseLogger: unknown): unknown {
        const { createStandardDependencies } = require('./dependency-validator') as {
            createStandardDependencies: (platformName: string, loggerCandidate: unknown) => unknown;
        };
        return createStandardDependencies(platform, baseLogger);
    }

    private handleFactoryError(message: string, error: unknown, platform: string): void {
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
    }
}

export { PlatformConnectionFactory };
