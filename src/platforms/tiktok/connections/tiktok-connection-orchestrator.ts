// A shared attempt snapshot of the root fence. Only its own setup/recovery may advance it.
export type TikTokConnectionLifetime = {
    generation: number;
    recoveryResult?: { action: string; reason?: string };
};

type ConnectionLike = {
    isConnecting?: boolean;
    isConnected?: boolean;
    connect: () => Promise<unknown>;
    disconnect: () => Promise<unknown>;
    [key: string]: unknown;
};

type TikTokOrchestratorPlatform = {
    logger: {
        debug: (message: string, category?: string, details?: unknown) => void;
        info: (message: string, category?: string, details?: unknown) => void;
    };
    config: {
        username: string;
    };
    connection: ConnectionLike | null;
    connectionActive: boolean;
    connectionGeneration: number;
    retryLock: boolean;
    listenersConfigured: boolean;
    connectingPromise: Promise<unknown> | null;
    connectionStateManager: {
        markDisconnected: () => void;
        markConnecting: () => void;
        markError: (error: unknown) => void;
        ensureConnection: () => ConnectionLike;
    };
    errorHandler: {
        handleConnectionError: (error: unknown, context: string, message: string) => void;
        handleCleanupError: (error: unknown, context: string, message: string) => void;
    };
    cleanupEventListeners: () => void;
    checkConnectionPrerequisites: () => {
        canConnect: boolean;
        reason?: string;
    };
    setupEventListeners: (lifetime: TikTokConnectionLifetime) => void;
    handleConnectionSuccess: () => Promise<void>;
    handleConnectionError?: (error: unknown, lifetime: TikTokConnectionLifetime) => { action: string; reason?: string } | void;
    cleanup: () => void | Promise<void>;
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function createTikTokConnectionOrchestrator(options: { platform?: TikTokOrchestratorPlatform } = {}) {
    const { platform } = options;

    if (!platform) {
        throw new Error('platform is required to create TikTok connection orchestrator');
    }

    let pendingLifetime: TikTokConnectionLifetime | null = null;
    let pendingPromise: Promise<unknown> | null = null;
    const connect = async (_handlers: unknown, onAttempt?: (lifetime: TikTokConnectionLifetime) => void) => {

        if (platform.connectingPromise) {
            if (pendingPromise === platform.connectingPromise && pendingLifetime) onAttempt?.(pendingLifetime);
            return platform.connectingPromise;
        }

        const staleConnection = platform.connection?.isConnecting && !platform.connectionActive
            ? platform.connection : null;
        if (!staleConnection) {
            const prerequisites = platform.checkConnectionPrerequisites();
            if (!prerequisites.canConnect) {
                platform.logger.debug(`Cannot connect: ${prerequisites.reason}`, 'tiktok');
                return;
            }
            if (platform.connection && (platform.connection.isConnecting || platform.connection.isConnected)) {
                return;
            }
        }

        const lifetime: TikTokConnectionLifetime = { generation: platform.connectionGeneration };
        onAttempt?.(lifetime);
        const connectAttempt = async () => {
            let connection: ConnectionLike | null = null;
            if (staleConnection) {
                platform.cleanupEventListeners();
                platform.connectionStateManager.markDisconnected();
                platform.connection = null;
                platform.listenersConfigured = false;
                try {
                    await staleConnection.disconnect?.();
                } catch (error) {
                    platform.errorHandler.handleCleanupError(error, 'stale connection disconnect', 'Error retiring stale TikTok connection');
                }
                if (lifetime.generation !== platform.connectionGeneration) return;
                const prerequisites = platform.checkConnectionPrerequisites();
                if (!prerequisites.canConnect) return;
            }
            if (platform.connection) {
                platform.cleanupEventListeners();
            }

            platform.connectionStateManager.markDisconnected();
            platform.connection = null;

            try {
                platform.connectionStateManager.markConnecting();

                platform.connection = platform.connectionStateManager.ensureConnection();
                connection = platform.connection;
                platform.setupEventListeners(lifetime);
                await connection.connect();

                if (lifetime.generation !== platform.connectionGeneration || platform.connection !== connection || connection.isConnected === false) {
                    throw connection.lastConnectionError instanceof Error
                        ? connection.lastConnectionError
                        : new Error('TikTok upstream disconnected before initialization completed');
                }

                await platform.handleConnectionSuccess();
            } catch (error: unknown) {
                if (connection && (lifetime.generation !== platform.connectionGeneration || platform.connection !== connection)) {
                    await connection.disconnect();
                    throw error;
                }
                if (typeof platform.handleConnectionError === 'function') {
                    const recoveryResult = platform.handleConnectionError(error, lifetime);
                    if (recoveryResult) lifetime.recoveryResult = recoveryResult;
                } else {
                    platform.connectionStateManager.markError(error);
                    platform.connection = null;
                    platform.listenersConfigured = false;
                    platform.errorHandler.handleConnectionError(
                        error,
                        'connection',
                        `TikTok connection failed for '${platform.config.username}': ${getErrorMessage(error)}`
                    );
                }
                throw error;
            }
        };

        const connectingPromise = connectAttempt().finally(() => {
            if (platform.connectingPromise === connectingPromise) platform.connectingPromise = null;
        });
        pendingLifetime = lifetime;
        pendingPromise = connectingPromise;
        platform.connectingPromise = connectingPromise;
        return platform.connectingPromise;
    };

    const disconnect = async () => {
        const generation = platform.connectionGeneration = (platform.connectionGeneration ?? 0) + 1;
        const connection = platform.connection;
        platform.connectionActive = false;
        platform.connectingPromise = null;
        platform.connection = null;
        platform.cleanupEventListeners();
        platform.listenersConfigured = false;
        platform.connectionStateManager.markDisconnected();
        if (connection) {
            try {
                await connection.disconnect();
                platform.logger.info('Successfully disconnected.', 'tiktok');
            } catch (error) {
                platform.errorHandler.handleCleanupError(error, 'connection disconnect', `Error during disconnection: ${getErrorMessage(error)}`);
            }
        }
        if (generation !== platform.connectionGeneration) return;
        await platform.cleanup();
    };

    return {
        connect,
        disconnect
    };
}

export { createTikTokConnectionOrchestrator };
