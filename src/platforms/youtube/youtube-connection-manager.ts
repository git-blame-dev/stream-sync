import { createPlatformErrorHandler } from '../../utils/platform-error-handler';
import { getSystemTimestampISO } from '../../utils/timestamp';

type ConnectionLogger = {
    debug: (message: string, source?: string) => void;
    info: (message: string, source?: string) => void;
    warn: (message: string, source?: string) => void;
};

type ConnectionState = 'connecting' | 'connected' | 'ready' | 'disconnecting' | 'disconnected' | 'error';

type ManagedConnection = {
    stop?: () => Promise<void>;
    disconnect?: () => Promise<void>;
    [key: string]: unknown;
};

type ConnectionConfig = {
    enableAPI?: boolean;
    streamDetectionMethod?: string;
    viewerCountMethod?: string;
    [key: string]: unknown;
};

type ConnectionData = {
    attemptId: number;
    connection: ManagedConnection | null;
    state: ConnectionState;
    metadata: Record<string, unknown>;
    ready?: boolean;
};

type ConnectionFactory = (videoId: string, attemptId: number) => Promise<ManagedConnection>;

type ConnectionStates = {
    CONNECTING: ConnectionState;
    CONNECTED: ConnectionState;
    READY: ConnectionState;
    DISCONNECTING: ConnectionState;
    DISCONNECTED: ConnectionState;
    ERROR: ConnectionState;
};

type ConnectionStateSummary = {
    totalConnections: number;
    readyConnections: number;
    activeVideoIds: string[];
    hasAnyReady: boolean;
};

type ConnectionStatus = ConnectionData & { videoId: string; ready: boolean };

class YouTubeConnectionManager {
    logger: ConnectionLogger;
    config: ConnectionConfig;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    private connections: Map<string, ConnectionData>;
    CONNECTION_STATES: ConnectionStates;
    private operationLocks: Set<string>;
    private lifecycleGeneration: number;
    private acceptingConnections: boolean;
    private connectionAttemptIds: Map<string, number>;

    constructor(logger: ConnectionLogger, options: { config?: ConnectionConfig } = {}) {
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
        this.lifecycleGeneration = 0;
        this.acceptingConnections = true;
        this.connectionAttemptIds = new Map();
    }

    startLifecycle(): void {
        this.lifecycleGeneration += 1;
        this.acceptingConnections = true;
    }

    async connectToStream(videoId: string, connectionFactory: ConnectionFactory, options: { reason?: string } = {}): Promise<boolean> {
        if (!this.acceptingConnections) {
            return false;
        }
        const lifecycleGeneration = this.lifecycleGeneration;
        let connectionData: ConnectionData | undefined;

        try {
            if (this.connections.has(videoId)) {
                const existing = this.connections.get(videoId);
                this.logger.warn(`Already connected to ${videoId} (state: ${existing?.state})`, 'youtube');
                return false;
            }

            this.logger.info(`Starting connection to ${videoId}`, 'youtube');

            const attemptId = (this.connectionAttemptIds.get(videoId) ?? 0) + 1;
            this.connectionAttemptIds.set(videoId, attemptId);
            connectionData = {
                attemptId,
                connection: null,
                state: this.CONNECTION_STATES.CONNECTING,
                metadata: {
                    connectedAt: getSystemTimestampISO(),
                    reason: options.reason || 'stream detected',
                    lifecycleGeneration
                }
            };
            this.connections.set(videoId, connectionData);

            const startTime = Date.now();
            const connection = await connectionFactory(videoId, attemptId);
            const duration = Date.now() - startTime;

            if (!this.acceptingConnections
                || lifecycleGeneration !== this.lifecycleGeneration
                || this.connections.get(videoId) !== connectionData) {
                await this.shutdownConnection(connection, videoId);
                return false;
            }

            connectionData.connection = connection;
            if (!connectionData.ready) {
                connectionData.state = this.CONNECTION_STATES.CONNECTED;
            }
            connectionData.metadata.connectionDuration = duration;

            this.logger.info(`Successfully connected to ${videoId}`, 'youtube');
            return true;
        } catch (error) {
            const errorMessage = this.getErrorMessage(error);
            this.handleConnectionError(`Failed to connect to ${videoId}: ${errorMessage}`, error, { videoId });
            if (connectionData && this.connections.get(videoId) === connectionData) {
                this.connections.delete(videoId);
            }
            return false;
        }
    }

    async disconnectFromStream(videoId: string, reason = 'unknown', expectedAttemptId?: number): Promise<boolean> {
        const currentConnection = this.connections.get(videoId);
        if (!currentConnection) {
            this.logger.warn(`No connection to disconnect for ${videoId}`, 'youtube');
            return false;
        }
        if (expectedAttemptId !== undefined && currentConnection.attemptId !== expectedAttemptId) {
            this.logger.debug(`Ignored stale disconnection for ${videoId}`, 'youtube');
            return false;
        }

        const lockKey = `disconnect_${videoId}_${currentConnection.attemptId}`;
        if (this.operationLocks.has(lockKey)) {
            this.logger.warn(`Disconnection already in progress for ${videoId}`, 'youtube');
            return false;
        }

        this.operationLocks.add(lockKey);
        const connectionData = currentConnection;

        try {
            this.logger.info(`Disconnecting from ${videoId} (reason: ${reason})`, 'youtube');

            connectionData.state = this.CONNECTION_STATES.DISCONNECTING;
            connectionData.metadata.disconnectReason = reason;
            connectionData.metadata.disconnectedAt = getSystemTimestampISO();

            const shutdownSucceeded = await this.shutdownConnection(connectionData.connection, videoId);
            if (shutdownSucceeded) {
                this.logger.info(`Successfully disconnected from ${videoId}`, 'youtube');
            }
            return shutdownSucceeded;
        } catch (error) {
            const errorMessage = this.getErrorMessage(error);
            this.handleConnectionError(`Error disconnecting from ${videoId}: ${errorMessage}`, error, { videoId });
            return false;
        } finally {
            if (connectionData && this.connections.get(videoId) === connectionData) {
                this.connections.delete(videoId);
            }
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
            await this.shutdownConnection(connectionData?.connection ?? null, videoId);
        } catch (error) {
            this.handleConnectionError(`Error removing connection for video ${videoId}`, error, { videoId });
        } finally {
            if (connectionData && this.connections.get(videoId) === connectionData) {
                this.connections.delete(videoId);
            }
            this.logger.debug(`Removed connection for video ${videoId}`, 'youtube');
        }
    }

    setConnectionReady(videoId: string, attemptId: number): void {
        const connectionData = this.connections.get(videoId);
        if (!connectionData || connectionData.attemptId !== attemptId) {
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

    isCurrentAttempt(videoId: string, attemptId: number): boolean {
        return this.connections.get(videoId)?.attemptId === attemptId;
    }

    getConnection(videoId: string): ManagedConnection | null | undefined {
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

    getAllConnections(): Array<ManagedConnection | null> {
        return Array.from(this.connections.values()).map((connectionData) => connectionData.connection);
    }

    getAllConnectionData(): ConnectionData[] {
        return Array.from(this.connections.values(), connectionData => ({
            ...connectionData,
            metadata: { ...connectionData.metadata }
        }));
    }

    async cleanupAllConnections(): Promise<void> {
        this.acceptingConnections = false;
        this.lifecycleGeneration += 1;
        const count = this.connections.size;
        if (count === 0) {
            this.logger.debug('No connections to cleanup', 'youtube');
            return;
        }

        const connections = Array.from(this.connections);
        this.connections.clear();
        await Promise.all(connections.map(async ([videoId, connectionData]) => {
            try {
                await this.shutdownConnection(connectionData.connection, videoId);
            } catch (error) {
                this.handleConnectionError(`Error removing connection for video ${videoId}`, error, { videoId });
            }
        }));

        this.logger.info(`Cleaned up all ${count} connections`, 'youtube');
    }

    getConnectionState(): ConnectionStateSummary {
        return {
            totalConnections: this.getConnectionCount(),
            readyConnections: this.getReadyConnectionCount(),
            activeVideoIds: this.getActiveVideoIds(),
            hasAnyReady: this.isAnyConnectionReady()
        };
    }

    getStats(): ConnectionStateSummary {
        return this.getConnectionState();
    }

    getConnectionStatus(videoId: string): ConnectionStatus | null {
        const connection = this.connections.get(videoId);
        if (!connection) {
            return null;
        }

        return {
            videoId,
            attemptId: connection.attemptId,
            ready: !!connection.ready,
            state: connection.state,
            metadata: { ...connection.metadata },
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

    private async shutdownConnection(connection: ManagedConnection | null | undefined, videoId: string | null): Promise<boolean> {
        if (!connection) {
            return true;
        }

        let succeeded = true;

        try {
            if (typeof connection.stop === 'function') {
                await connection.stop();
            }
        } catch (error) {
            succeeded = false;
            this.handleConnectionError(`Error stopping connection for ${videoId || 'unknown'}`, error, { videoId });
        }

        if (typeof connection.disconnect === 'function') {
            try {
                await connection.disconnect();
            } catch (error) {
                succeeded = false;
                this.handleConnectionError(`Error disconnecting connection for ${videoId || 'unknown'}`, error, { videoId });
            }
        }

        return succeeded;
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
