function createTikTokConnectionOrchestrator(options = {}) {
    const { platform } = options;

    if (!platform) {
        throw new Error('platform is required to create TikTok connection orchestrator');
    }

    const connect = async (handlers) => {
        platform.logger.debug('connect() invoked', 'tiktok', {
            hasConnectingPromise: !!platform.connectingPromise,
            connectionActive: !!platform.connectionActive,
            retryLock: !!platform.retryLock,
            isConnecting: platform.connection?.isConnecting || false,
            isConnected: platform.connection?.isConnected || false
        });

        if (platform.connection && platform.connection.isConnecting && !platform.connectionActive) {
            platform.cleanupEventListeners();
            platform.connectionStateManager.markDisconnected();
            platform.connection = null;
            platform.listenersConfigured = false;
        }

        const prerequisites = platform.checkConnectionPrerequisites();
        if (!prerequisites.canConnect) {
            platform.logger.debug(`Cannot connect: ${prerequisites.reason}`, 'tiktok');
            return;
        }

        if (platform.connectingPromise) {
            return platform.connectingPromise;
        }

        if (platform.connection && (platform.connection.isConnecting || platform.connection.isConnected)) {
            platform.logger.debug('Connection attempt skipped: already connecting or connected.', 'tiktok');
            return;
        }

        const connectAttempt = async () => {
            if (platform.connection) {
                platform.cleanupEventListeners();
            }

            platform.connectionStateManager.markDisconnected();
            platform.connection = null;

            try {
                platform.connectionStateManager.markConnecting();
                platform.logger.info(`Connecting to TikTok user '${platform.config.username}'...`, 'tiktok');

                platform.connection = platform.connectionStateManager.ensureConnection();
                platform.setupEventListeners();

                await platform.connection.connect();

                if (!platform.connection) {
                    platform.connection = platform.connectionStateManager.ensureConnection();
                    platform.setupEventListeners();
                }

                await platform.handleConnectionSuccess();

                platform.logger.info(`Successfully connected to TikTok user '${platform.config.username}'`, 'tiktok');
            } catch (error) {
                if (typeof platform.handleConnectionError === 'function') {
                    platform.handleConnectionError(error);
                } else {
                    platform.connectionStateManager.markError(error);
                    platform.connection = null;
                    platform.listenersConfigured = false;
                    platform.errorHandler.handleConnectionError(
                        error,
                        'connection',
                        `TikTok connection failed for '${platform.config.username}': ${error.message}`
                    );
                }
                throw error;
            } finally {
                platform.connectingPromise = null;
            }
        };

        platform.connectingPromise = connectAttempt();
        return platform.connectingPromise;
    };

    const disconnect = async () => {
        platform.connectionActive = false;

        if (platform.connection) {
            try {
                await platform.connection.disconnect();
                platform.logger.info('Successfully disconnected.', 'tiktok');
            } catch (error) {
                platform.errorHandler.handleCleanupError(
                    error,
                    'connection disconnect',
                    `Error during disconnection: ${error.message}`
                );
            }
        }

        platform.cleanup();
    };

    return {
        connect,
        disconnect
    };
}

module.exports = {
    createTikTokConnectionOrchestrator
};
