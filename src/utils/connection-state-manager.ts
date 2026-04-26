import { createPlatformErrorHandler } from './platform-error-handler';
import {
    validateConnectionFactoryInterface,
    validateConnectionStateManagerDependencies
} from './dependency-validator';

type LoggerLike = {
    debug: (message: string, scope?: string, payload?: unknown) => void;
};

type ConnectionLike = {
    connect: () => unknown;
    on?: (eventName: string, handler: (...args: unknown[]) => void) => unknown;
    emit?: (eventName: string, payload?: unknown) => unknown;
    removeAllListeners?: () => unknown;
    disconnect?: () => Promise<void> | void;
};

type ConnectionFactoryLike = {
    createConnection: (platform: string, config: unknown, dependencies: unknown) => unknown;
};

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

type DependenciesLike = {
    logger: LoggerLike;
    [key: string]: unknown;
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function hasCatchMethod(value: unknown): value is { catch: (handler: () => void) => void } {
    return !!value
        && typeof value === 'object'
        && typeof (value as { catch?: unknown }).catch === 'function';
}

function getErrorMessageFromUnknown(error: unknown): string | null {
    if (!error || typeof error !== 'object') {
        return null;
    }

    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
}

class ConnectionStateManager {
    platform: string;
    connectionFactory: ConnectionFactoryLike;
    logger: LoggerLike | null;
    errorHandler: ReturnType<typeof createPlatformErrorHandler> | null;
    state: ConnectionState;
    connection: ConnectionLike | null;
    lastError: unknown;
    connectionTime: number;
    config: unknown;
    dependencies: DependenciesLike | null;

    constructor(platform: string, connectionFactory: ConnectionFactoryLike) {
        this.platform = platform;

        if (connectionFactory) {
            validateConnectionFactoryInterface(connectionFactory);
        }

        this.connectionFactory = connectionFactory;
        this.logger = null;
        this.errorHandler = null;
        this.state = 'disconnected';
        this.connection = null;
        this.lastError = null;
        this.connectionTime = 0;
        this.config = null;
        this.dependencies = null;
    }

    initialize(config: unknown, dependencies: unknown): void {
        validateConnectionStateManagerDependencies(config, dependencies);

        this.config = config;
        this.dependencies = dependencies as DependenciesLike;
        this.logger = this.dependencies.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'connection-state-manager');
    }

    ensureConnection(): ConnectionLike {
        if (this.connection && this.isConnectionValid(this.connection)) {
            this.logger?.debug(`Connection already exists and is valid for ${this.platform}`, this.platform);
            return this.connection;
        }

        this.logger?.debug(`Creating new connection for ${this.platform}`, this.platform);

        if (!this.config || !this.dependencies) {
            throw new Error(`Cannot create connection - state manager not properly initialized for ${this.platform}`);
        }

        try {
            const createdConnection = this.connectionFactory.createConnection(this.platform, this.config, this.dependencies);
            if (!createdConnection) {
                throw new Error(
                    `Factory returned null/invalid connection for ${this.platform}. `
                    + 'Connection factory must return a valid connection object.'
                );
            }
            if (!this.isConnectionValid(createdConnection)) {
                throw new Error(`Factory created invalid connection for ${this.platform}`);
            }

            this.connection = createdConnection;
            return this.connection;
        } catch (error) {
            this.lastError = error;
            this.state = 'error';
            this.logStateManagerError(`Failed to create connection for ${this.platform}: ${getErrorMessage(error)}`, error);
            throw error;
        }
    }

    isConnectionValid(connection: unknown): connection is ConnectionLike {
        if (!connection || typeof connection !== 'object' || typeof (connection as { connect?: unknown }).connect !== 'function') {
            return false;
        }

        if (this.platform !== 'tiktok') {
            return true;
        }

        return typeof (connection as { on?: unknown }).on === 'function'
            && typeof (connection as { emit?: unknown }).emit === 'function'
            && typeof (connection as { removeAllListeners?: unknown }).removeAllListeners === 'function';
    }

    getState(): ConnectionState {
        return this.state;
    }

    setState(newState: ConnectionState): void {
        const oldState = this.state;
        this.state = newState;

        if (newState === 'connected') {
            this.connectionTime = Date.now();
            this.lastError = null;
        }

        this.logger?.debug(`Connection state changed from ${oldState} to ${newState} for ${this.platform}`, this.platform);
    }

    getConnection(): ConnectionLike | null {
        return this.connection;
    }

    isConnected(): boolean {
        return this.state === 'connected'
            && this.connection !== null
            && this.isConnectionValid(this.connection);
    }

    isConnecting(): boolean {
        return this.state === 'connecting';
    }

    markConnecting(): void {
        this.setState('connecting');
    }

    markConnected(): void {
        this.setState('connected');
    }

    markDisconnected(): void {
        this.setState('disconnected');
        this.connection = null;
        this.connectionTime = 0;
    }

    markError(error: unknown): void {
        this.lastError = error;
        this.setState('error');
        this.connection = null;
    }

    cleanup(): void {
        if (this.connection) {
            try {
                if (typeof this.connection.removeAllListeners === 'function') {
                    this.connection.removeAllListeners();
                }
                if (typeof this.connection.disconnect === 'function') {
                    const result = this.connection.disconnect();
                    if (hasCatchMethod(result)) {
                        result.catch(() => {});
                    }
                }
            } catch (error) {
                this.logger?.debug(`Error during connection cleanup for ${this.platform}: ${getErrorMessage(error)}`, this.platform);
            }
        }

        this.connection = null;
        this.state = 'disconnected';
        this.connectionTime = 0;
        this.lastError = null;

        this.logger?.debug(`Connection state manager cleaned up for ${this.platform}`, this.platform);
    }

    getConnectionInfo(): {
        platform: string;
        state: ConnectionState;
        hasConnection: boolean;
        isValid: boolean;
        connectionTime: number;
        lastError: string | null;
        isConnected: boolean;
        isConnecting: boolean;
    } {
        return {
            platform: this.platform,
            state: this.state,
            hasConnection: this.connection !== null,
            isValid: this.connection ? this.isConnectionValid(this.connection) : false,
            connectionTime: this.connectionTime,
            lastError: getErrorMessageFromUnknown(this.lastError),
            isConnected: this.isConnected(),
            isConnecting: this.isConnecting()
        };
    }

    private logStateManagerError(message: string, error: unknown): void {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'connection-state-manager', null, message);
            return;
        }

        if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'connection-state-manager', error);
        }
    }
}

export { ConnectionStateManager };
