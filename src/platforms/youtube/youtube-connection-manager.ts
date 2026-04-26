import { createPlatformErrorHandler } from '../../utils/platform-error-handler';
import { getSystemTimestampISO } from '../../utils/timestamp';

type ConnectionLogger = {
    debug: (message: string, source?: string) => void;
    info: (message: string, source?: string) => void;
    warn: (message: string, source?: string) => void;
};

type ConnectionData = {
    connection: unknown;
    state: string;
    metadata: Record<string, unknown>;
    ready?: boolean;
};

type ConnectionFactory = (videoId: string) => Promise<unknown>;

class YouTubeConnectionManager {
    logger: ConnectionLogger;
    config: Record<string, unknown>;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    connections: Map<string, ConnectionData>;
    CONNECTION_STATES: {
        CONNECTING: string;
        CONNECTED: string;
        READY: string;
        DISCONNECTING: string;
        DISCONNECTED: string;
        ERROR: string;
    };
    operationLocks: Set<string>;

    constructor(logger: ConnectionLogger, options: { config?: Record<string, unknown> } = {}) {
        this.logger = logger;
        this.config = options.config || {};
        this.errorHandler = createPlatformErrorHandler(this.logger, 'youtube-connection');
        this.connections = new Map();

        this.CONNECTION_STATES = {
            CONNECTING: 'connecting',
            CONNECTED: 'connected',
            READY: 'ready',
            DISCONNECTING: 'disconnecting',
            DISCONNECTED: 'disconnected',
            ERROR: 'error'
        };

        this.operationLocks = new Set();
    }

    async connectToStream(videoId: string, connectionFactory: ConnectionFactory, options: { reason?: string } = {}): Promise<boolean> {
        const lockKey = `connect_${videoId}`;
        if (this.operationLocks.has(lockKey)) {
            this.logger.warn(`Connection already in progress for ${videoId}`, 'youtube');
            return false;
        }

        this.operationLocks.add(lockKey);

        try {
            if (this.connections.has(videoId)) {
                const existing = this.connections.get(videoId);
                this.logger.warn(`Already connected to ${videoId} (state: ${existing?.state})`, 'youtube');
                return false;
            }

            this.logger.info(`Starting connection to ${videoId}`, 'youtube');

            this.connections.set(videoId, {
                connection: null,
                state: this.CONNECTION_STATES.CONNECTING,
                metadata: {
                    connectedAt: getSystemTimestampISO(),
                    reason: options.reason || 'stream detected'
                }
            });

            const startTime = Date.now();
            const connection = await connectionFactory(videoId);
            const duration = Date.now() - startTime;

            this.connections.set(videoId, {
                connection,
                state: this.CONNECTION_STATES.CONNECTED,
                metadata: {
                    connectedAt: getSystemTimestampISO(),
                    reason: options.reason || 'stream detected',
                    connectionDuration: duration
                }
            });

            this.logger.info(`Successfully connected to ${videoId}`, 'youtube');
            return true;
        } catch (error) {
            const errorMessage = this.getErrorMessage(error);
            this.handleConnectionError(`Failed to connect to ${videoId}: ${errorMessage}`, error, { videoId });
            this.connections.delete(videoId);
            return false;
        } finally {
            this.operationLocks.delete(lockKey);
        }
    }

    async disconnectFromStream(videoId: string, reason = 'unknown'): Promise<boolean> {
        const lockKey = `disconnect_${videoId}`;
        if (this.operationLocks.has(lockKey)) {
            this.logger.warn(`Disconnection already in progress for ${videoId}`, 'youtube');
            return false;
        }

        this.operationLocks.add(lockKey);

        try {
            if (!this.connections.has(videoId)) {
                this.logger.warn(`No connection to disconnect for ${videoId}`, 'youtube');
                return false;
            }

            const connectionData = this.connections.get(videoId) as ConnectionData;
            this.logger.info(`Disconnecting from ${videoId} (reason: ${reason})`, 'youtube');

            connectionData.state = this.CONNECTION_STATES.DISCONNECTING;
            connectionData.metadata.disconnectReason = reason;
            connectionData.metadata.disconnectedAt = getSystemTimestampISO();

            await this.shutdownConnection(connectionData.connection, videoId);
            this.connections.delete(videoId);
            this.logger.info(`Successfully disconnected from ${videoId}`, 'youtube');
            return true;
        } catch (error) {
            const errorMessage = this.getErrorMessage(error);
            this.handleConnectionError(`Error disconnecting from ${videoId}: ${errorMessage}`, error, { videoId });
            return false;
        } finally {
            this.operationLocks.delete(lockKey);
        }
    }

    async removeConnection(videoId: string): Promise<void> {
        if (!this.connections.has(videoId)) {
            this.logger.warn(`Attempted to remove non-existent connection for video ${videoId}`, 'youtube');
            return;
        }

        const connectionData = this.connections.get(videoId);
        try {
            await this.shutdownConnection(connectionData ? connectionData.connection : null, videoId);
        } catch (error) {
            this.handleConnectionError(`Error removing connection for video ${videoId}`, error, { videoId });
        } finally {
            this.connections.delete(videoId);
            this.logger.debug(`Removed connection for video ${videoId}`, 'youtube');
        }
    }

    setConnectionReady(videoId: string): void {
        const connectionData = this.connections.get(videoId);
        if (!connectionData) {
            this.logger.warn(`Attempted to set ready status for non-existent connection: ${videoId}`, 'youtube');
            return;
        }

        connectionData.ready = true;
        connectionData.state = this.CONNECTION_STATES.READY;
        this.logger.debug(`Connection ready for video ${videoId}`, 'youtube');
    }

    isConnectionReady(videoId: string): boolean {
        const connectionData = this.connections.get(videoId);
        return !!(connectionData && connectionData.ready);
    }

    isAnyConnectionReady(): boolean {
        for (const connection of this.connections.values()) {
            if (connection.ready) {
                return true;
            }
        }
        return false;
    }

    hasAnyReady(): boolean {
        return this.isAnyConnectionReady();
    }

    hasConnection(videoId: string): boolean {
        return this.connections.has(videoId);
    }

    getConnection(videoId: string): unknown {
        const connectionData = this.connections.get(videoId);
        return connectionData ? connectionData.connection : undefined;
    }

    getConnectionCount(): number {
        return this.connections.size;
    }

    getReadyConnectionCount(): number {
        let count = 0;
        for (const connectionData of this.connections.values()) {
            if (connectionData.ready) {
                count++;
            }
        }
        return count;
    }

    getActiveVideoIds(): string[] {
        return Array.from(this.connections.keys());
    }

    getAllConnections(): unknown[] {
        return Array.from(this.connections.values()).map((connectionData) => connectionData.connection);
    }

    getAllConnectionData(): ConnectionData[] {
        return Array.from(this.connections.values());
    }

    cleanupAllConnections(): void {
        const count = this.connections.size;
        if (count === 0) {
            this.logger.debug('No connections to cleanup', 'youtube');
            return;
        }

        for (const [videoId, connectionData] of this.connections) {
            void this.shutdownConnection(connectionData ? connectionData.connection : null, videoId).catch((error) => {
                this.handleConnectionError(`Error removing connection for video ${videoId}`, error, { videoId });
            });
        }

        this.connections.clear();
        this.logger.info(`Cleaned up all ${count} connections`, 'youtube');
    }

    getConnectionState() {
        return {
            totalConnections: this.getConnectionCount(),
            readyConnections: this.getReadyConnectionCount(),
            activeVideoIds: this.getActiveVideoIds(),
            hasAnyReady: this.isAnyConnectionReady()
        };
    }

    getStats() {
        return this.getConnectionState();
    }

    getConnectionStatus(videoId: string): (ConnectionData & { videoId: string }) | null {
        const connection = this.connections.get(videoId);
        if (!connection) {
            return null;
        }

        return {
            videoId,
            ready: !!connection.ready,
            state: connection.state,
            metadata: connection.metadata,
            connection: connection.connection
        };
    }

    getAllVideoIds(): string[] {
        return this.getActiveVideoIds();
    }

    isApiEnabled(): boolean {
        return this.config.enableAPI === true
            || this.config.streamDetectionMethod === 'api'
            || this.config.viewerCountMethod === 'api';
    }

    isScrapingEnabled(): boolean {
        return this.config.streamDetectionMethod === 'scraping';
    }

    private async shutdownConnection(connection: unknown, videoId: string | null): Promise<void> {
        if (!connection || typeof connection !== 'object') {
            return;
        }

        const maybeConnection = connection as {
            stop?: () => Promise<void>;
            disconnect?: () => Promise<void>;
        };

        try {
            if (typeof maybeConnection.stop === 'function') {
                await maybeConnection.stop();
            }
        } catch (error) {
            this.handleConnectionError(`Error stopping connection for ${videoId || 'unknown'}`, error, { videoId });
        }

        if (typeof maybeConnection.disconnect === 'function') {
            try {
                await maybeConnection.disconnect();
            } catch (error) {
                this.handleConnectionError(`Error disconnecting connection for ${videoId || 'unknown'}`, error, { videoId });
                throw error;
            }
        }
    }

    private getErrorMessage(error: unknown): string {
        if (error instanceof Error && typeof error.message === 'string' && error.message.length > 0) {
            return error.message;
        }

        if (typeof error === 'string') {
            return error;
        }

        try {
            return JSON.stringify(error);
        } catch {
            return 'Unknown error';
        }
    }

    private handleConnectionError(message: string, error: unknown, eventData: Record<string, unknown>): void {
        if (!this.errorHandler && this.logger) {
            this.errorHandler = createPlatformErrorHandler(this.logger, 'youtube-connection');
        }

        if (this.errorHandler) {
            const normalizedError = error instanceof Error
                ? error
                : new Error(typeof error === 'string' ? error : JSON.stringify(error));
            this.errorHandler.handleEventProcessingError(
                normalizedError,
                'connection',
                eventData,
                message,
                'youtube-connection'
            );
        }
    }
}

export {
    YouTubeConnectionManager
};
