import { createPlatformErrorHandler } from '../../utils/platform-error-handler';
import { getSystemTimestampISO } from '../../utils/timestamp';
import { withOperationDeadline } from '../../utils/timeout-wrapper';

const RETIREMENT_TIMEOUT_MS = 5000;

type ConnectionLogger = {
    debug: (message: string, source?: string) => void;
    info: (message: string, source?: string) => void;
    warn: (message: string, source?: string) => void;
};

type ConnectionState = 'connecting' | 'connected' | 'ready' | 'disconnecting' | 'disconnected' | 'error';

type ManagedConnection = {
    stop?: () => void | Promise<void>;
    disconnect?: () => void | Promise<void>;
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

export type YouTubeConnectionAttemptContext = {
    signal: AbortSignal;
    adopt: (connection: ManagedConnection) => void;
};

type ConnectionFactory = (videoId: string, attemptId: number, context: YouTubeConnectionAttemptContext) => Promise<ManagedConnection>;

type ConnectionAttempt = ConnectionData & {
    controller: AbortController;
    factoryCompletion: Promise<void>;
    resources: Map<ManagedConnection, Promise<boolean> | undefined>;
    retirement?: Promise<boolean>;
};

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
    private connections: Map<string, ConnectionAttempt>;
    CONNECTION_STATES: ConnectionStates;
    private retiring = new Set<ConnectionAttempt>();
    private cleanupPromise: Promise<void> | undefined;
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
        let connectionData: ConnectionAttempt | undefined;

        try {
            if (this.connections.has(videoId)) {
                const existing = this.connections.get(videoId);
                this.logger.warn(`Already connected to ${videoId} (state: ${existing?.state})`, 'youtube');
                return false;
            }

            const attemptId = (this.connectionAttemptIds.get(videoId) ?? 0) + 1;
            this.connectionAttemptIds.set(videoId, attemptId);
            let completeFactory!: () => void;
            connectionData = {
                attemptId,
                connection: null,
                state: this.CONNECTION_STATES.CONNECTING,
                controller: new AbortController(),
                factoryCompletion: new Promise<void>(resolve => { completeFactory = resolve; }),
                resources: new Map(),
                metadata: {
                    connectedAt: getSystemTimestampISO(),
                    reason: options.reason || 'stream detected',
                    lifecycleGeneration
                }
            };
            this.connections.set(videoId, connectionData);

            const startTime = performance.now();
            const captured = connectionData;
            let rawFactory: Promise<ManagedConnection>;
            try {
                rawFactory = Promise.resolve(connectionFactory(videoId, attemptId, {
                    signal: captured.controller.signal,
                    adopt: connection => this.adoptConnection(videoId, captured, connection)
                }));
            } catch (error) {
                rawFactory = Promise.reject(error);
            }
            // Observe actual acquisition independently of the caller-facing abort race.
            // Late resources still enter the captured attempt's retirement path.
            const acquisition = rawFactory.then(connection => {
                try { this.adoptConnection(videoId, captured, connection); return connection; }
                finally { completeFactory(); }
            }, error => { completeFactory(); throw error; });
            void acquisition.catch(() => {});
            await withOperationDeadline(() => acquisition, { parentAbortSignal: captured.controller.signal });
            const duration = performance.now() - startTime;

            if (!this.acceptingConnections
                || lifecycleGeneration !== this.lifecycleGeneration
                || this.connections.get(videoId) !== connectionData) {
                await this.retireAttempt(videoId, captured);
                return false;
            }

            if (!connectionData.ready) {
                connectionData.state = this.CONNECTION_STATES.CONNECTED;
            }
            connectionData.metadata.connectionDuration = duration;
            return true;
        } catch (error) {
            const retirement = connectionData ? this.retireAttempt(videoId, connectionData) : undefined;
            const errorMessage = this.getErrorMessage(error);
            this.handleConnectionError(`Failed to connect to ${videoId}: ${errorMessage}`, error, { videoId });
            await retirement;
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

        const connectionData = currentConnection;
        const retirement = this.retireAttempt(videoId, connectionData);

        try {
            this.logRetirement('info', `Disconnecting from ${videoId} (reason: ${reason})`);

            connectionData.state = this.CONNECTION_STATES.DISCONNECTING;
            connectionData.metadata.disconnectReason = reason;
            connectionData.metadata.disconnectedAt = getSystemTimestampISO();

            const shutdownSucceeded = await retirement;
            if (shutdownSucceeded) {
                this.logRetirement('info', `Successfully disconnected from ${videoId}`);
            }
            return shutdownSucceeded;
        } catch (error) {
            const errorMessage = this.getErrorMessage(error);
            this.handleConnectionError(`Error disconnecting from ${videoId}: ${errorMessage}`, error, { videoId });
            await retirement;
            return false;
        }
    }

    async removeConnection(videoId: string): Promise<void> {
        const connectionData = this.connections.get(videoId);
        if (!connectionData) {
            this.logger.warn(`Attempted to remove non-existent connection for video ${videoId}`, 'youtube');
            return;
        }

        const retirement = this.retireAttempt(videoId, connectionData);
        try {
            await retirement;
        } catch (error) {
            this.handleConnectionError(`Error removing connection for video ${videoId}`, error, { videoId });
        } finally {
            this.logRetirement('debug', `Removed connection for video ${videoId}`);
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
            attemptId: connectionData.attemptId,
            connection: connectionData.connection,
            state: connectionData.state,
            ...(connectionData.ready === undefined ? {} : { ready: connectionData.ready }),
            metadata: { ...connectionData.metadata }
        }));
    }

    cleanupAllConnections(): Promise<void> {
        this.acceptingConnections = false;
        this.lifecycleGeneration += 1;
        if (this.cleanupPromise && this.connections.size === 0) return this.cleanupPromise;
        let complete!: () => void;
        const cleanup = new Promise<void>(resolve => { complete = resolve; });
        this.cleanupPromise = cleanup;
        const connections = Array.from(this.connections);
        this.connections.clear();
        for (const [videoId, connectionData] of connections) this.retireAttempt(videoId, connectionData);
        void Promise.all([...this.retiring].map(attempt => attempt.retirement)).finally(() => {
            if (this.cleanupPromise === cleanup) this.cleanupPromise = undefined;
            complete();
        }).catch(() => {});
        return cleanup;
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

    private adoptConnection(videoId: string, attempt: ConnectionAttempt, connection: ManagedConnection): void {
        if (attempt.resources.has(connection)) return;
        attempt.resources.set(connection, undefined);
        const current = !attempt.retirement && this.acceptingConnections
            && this.connections.get(videoId) === attempt
            && attempt.metadata.lifecycleGeneration === this.lifecycleGeneration;
        if (current && attempt.connection === null) {
            attempt.connection = connection;
            return;
        }

        // Register the exact late/conflicting resource before retiring. Never look
        // up the replacement by video ID when disposing this captured attempt.
        if (attempt.retirement) this.retireResource(videoId, attempt, connection);
        void this.retireAttempt(videoId, attempt);
        throw new Error(current ? 'YouTube attempt adopted a different connection' : 'YouTube connection attempt retired');
    }

    private retireResource(videoId: string, attempt: ConnectionAttempt, connection: ManagedConnection): Promise<boolean> {
        const existing = attempt.resources.get(connection);
        if (existing) return existing;
        let complete!: (succeeded: boolean) => void;
        const retirement = new Promise<boolean>(resolve => { complete = resolve; });
        attempt.resources.set(connection, retirement);
        // Publish identity before calling user/SDK code, which may reenter cleanup.
        void this.shutdownConnection(connection, videoId).then(complete, () => complete(false));
        return retirement;
    }

    private retireAttempt(videoId: string, attempt: ConnectionAttempt): Promise<boolean> {
        if (attempt.retirement) return attempt.retirement;
        let complete!: (succeeded: boolean) => void;
        attempt.retirement = new Promise<boolean>(resolve => { complete = resolve; });
        this.retiring.add(attempt);
        if (this.connections.get(videoId) === attempt) this.connections.delete(videoId);
        attempt.state = this.CONNECTION_STATES.DISCONNECTING;
        attempt.controller.abort(new Error('YouTube connection attempt retired'));
        for (const connection of attempt.resources.keys()) this.retireResource(videoId, attempt, connection);

        // Acquisition and all already-acquired resources retire concurrently under
        // one bound. Actual acquisition completion, not abort acknowledgement,
        // determines when the final set of late resources can be joined.
        void withOperationDeadline(async () => {
            await attempt.factoryCompletion;
            let joinedCount: number;
            let succeeded = true;
            do {
                joinedCount = attempt.resources.size;
                const outcomes = await Promise.all([...attempt.resources.values()]);
                succeeded = succeeded && outcomes.every(outcome => outcome === true);
            } while (joinedCount !== attempt.resources.size);
            return succeeded;
        }, { budgetMs: RETIREMENT_TIMEOUT_MS, operationName: 'YouTube connection retirement' }).then(complete, () => {
            this.logRetirement('warn', `YouTube connection retirement deadline exceeded after ${RETIREMENT_TIMEOUT_MS}ms; acquisition or cleanup may still be running`);
            complete(false);
        }).finally(() => { this.retiring.delete(attempt); }).catch(() => {});
        return attempt.retirement;
    }

    private logRetirement(level: keyof ConnectionLogger, message: string): void {
        try { this.logger[level](message, 'youtube'); }
        catch { /* Diagnostics cannot interrupt resource retirement. */ }
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
        if (typeof error === 'string' && error.length > 0) return error;
        if (error instanceof Error && typeof error.message === 'string' && error.message.length > 0) {
            return error.message;
        }

        return `Non-Error YouTube failure (${error === null ? 'null' : typeof error})`;
    }

    private handleConnectionError(message: string, error: unknown, eventData: Record<string, unknown>): void {
        try {
            if (!this.errorHandler && this.logger) {
                this.errorHandler = createPlatformErrorHandler(this.logger, 'youtube-connection');
            }

            if (this.errorHandler) {
                const normalizedError = error instanceof Error
                    ? error
                    : new Error(this.getErrorMessage(error));
                this.errorHandler.handleEventProcessingError(
                    normalizedError,
                    'connection',
                    eventData,
                    message,
                    'youtube-connection'
                );
            }
        } catch { /* Preserve the originating outcome and continue every disposer. */ }
    }
}

export {
    YouTubeConnectionManager
};
