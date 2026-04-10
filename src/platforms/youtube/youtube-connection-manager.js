const { createPlatformErrorHandler } = require('../../utils/platform-error-handler');
const { getSystemTimestampISO } = require('../../utils/timestamp');

class YouTubeConnectionManager {
        constructor(logger, options = {}) {
        /** @private */
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

        async connectToStream(videoId, connectionFactory, options = {}) {
        // Prevent race conditions with atomic locks
        const lockKey = `connect_${videoId}`;
        if (this.operationLocks.has(lockKey)) {
            this.logger.warn(`Connection already in progress for ${videoId}`, 'youtube');
            return false;
        }
        
        this.operationLocks.add(lockKey);
        
        try {
            if (this.connections.has(videoId)) {
                const existing = this.connections.get(videoId);
                this.logger.warn(`Already connected to ${videoId} (state: ${existing.state})`, 'youtube');
                return false;
            }
            
            this.logger.info(`Starting connection to ${videoId}`, 'youtube');
            
            const connectingState = {
                connection: null,
                state: this.CONNECTION_STATES.CONNECTING,
                metadata: {
                    connectedAt: getSystemTimestampISO(),
                    reason: options.reason || 'stream detected'
                }
            };
            this.connections.set(videoId, connectingState);
            
            const startTime = Date.now();
            const connection = await connectionFactory(videoId);
            const duration = Date.now() - startTime;
            
            const connectedState = {
                connection: connection,
                state: this.CONNECTION_STATES.CONNECTED,
                metadata: {
                    connectedAt: getSystemTimestampISO(),
                    reason: options.reason || 'stream detected',
                    connectionDuration: duration
                }
            };
            this.connections.set(videoId, connectedState);
            
            this.logger.info(`Successfully connected to ${videoId}`, 'youtube');
            
            return true;
            
        } catch (error) {
            const errorMessage = this._getErrorMessage(error);
            this._handleConnectionError(`Failed to connect to ${videoId}: ${errorMessage}`, error, { videoId });

            this.connections.delete(videoId);
            
            return false;
        } finally {
            this.operationLocks.delete(lockKey);
        }
    }
    
        async disconnectFromStream(videoId, reason = 'unknown') {
        // Prevent race conditions with atomic locks
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
            
            const connectionData = this.connections.get(videoId);
            
            this.logger.info(`Disconnecting from ${videoId} (reason: ${reason})`, 'youtube');
            
            connectionData.state = this.CONNECTION_STATES.DISCONNECTING;
            connectionData.metadata.disconnectReason = reason;
            connectionData.metadata.disconnectedAt = getSystemTimestampISO();
            
            await this._shutdownConnection(connectionData.connection, videoId);
            
            this.connections.delete(videoId);
            
            this.logger.info(`Successfully disconnected from ${videoId}`, 'youtube');
            
            return true;
            
        } catch (error) {
            const errorMessage = this._getErrorMessage(error);
            this._handleConnectionError(`Error disconnecting from ${videoId}: ${errorMessage}`, error, { videoId });
            return false;
        } finally {
            this.operationLocks.delete(lockKey);
        }
    }

        async removeConnection(videoId) {
        if (!this.connections.has(videoId)) {
            this.logger.warn('Attempted to remove non-existent connection for video ' + videoId, 'youtube');
            return;
        }
        
        const connectionData = this.connections.get(videoId);
        try {
            const connection = connectionData ? connectionData.connection : null;
            await this._shutdownConnection(connection, videoId);
        } catch (err) {
            this._handleConnectionError('Error removing connection for video ' + videoId, err, { videoId });
        } finally {
            this.connections.delete(videoId);
            this.logger.debug('Removed connection for video ' + videoId, 'youtube');
        }
    }

        setConnectionReady(videoId) {
        const connectionData = this.connections.get(videoId);
        if (!connectionData) {
            this.logger.warn('Attempted to set ready status for non-existent connection: ' + videoId, 'youtube');
            return;
        }
        connectionData.ready = true;
        connectionData.state = this.CONNECTION_STATES.READY;
        this.logger.debug('Connection ready for video ' + videoId, 'youtube');
    }

        isConnectionReady(videoId) {
        const connectionData = this.connections.get(videoId);
        return !!(connectionData && connectionData.ready);
    }

        isAnyConnectionReady() {
        for (const connection of this.connections.values()) {
            if (connection.ready) return true;
        }
        return false;
    }
    
        hasAnyReady() {
        return this.isAnyConnectionReady();
    }

        hasConnection(videoId) {
        return this.connections.has(videoId);
    }

        getConnection(videoId) {
        const connectionData = this.connections.get(videoId);
        return connectionData ? connectionData.connection : undefined;
    }

        getConnectionCount() {
        return this.connections.size;
    }

        getReadyConnectionCount() {
        let count = 0;
        for (const connectionData of this.connections.values()) {
            if (connectionData.ready) count++;
        }
        return count;
    }

        getActiveVideoIds() {
        return Array.from(this.connections.keys());
    }

        getAllConnections() {
        return Array.from(this.connections.values()).map(connectionData => connectionData.connection);
    }

        getAllConnectionData() {
        return Array.from(this.connections.values());
    }

        cleanupAllConnections() {
        const count = this.connections.size;
        if (count === 0) {
            this.logger.debug('No connections to cleanup', 'youtube');
            return;
        }
        
        for (const [videoId, connectionData] of this.connections) {
            const connection = connectionData ? connectionData.connection : null;
            this._shutdownConnection(connection, videoId).catch((err) => {
                this._handleConnectionError('Error removing connection for video ' + videoId, err, { videoId });
            });
        }
        
        this.connections.clear();
        this.logger.info('Cleaned up all ' + count + ' connections', 'youtube');
    }

        getConnectionState() {
        const total = this.getConnectionCount();
        const ready = this.getReadyConnectionCount();
        const activeVideoIds = this.getActiveVideoIds();
        return {
            totalConnections: total,
            readyConnections: ready,
            activeVideoIds,
            hasAnyReady: this.isAnyConnectionReady()
        };
    }

        getStats() {
        return this.getConnectionState();
    }

        getConnectionStatus(videoId) {
        const connection = this.connections.get(videoId);
        if (!connection) {
            return null;
        }
        const status = {
            videoId,
            ready: !!connection.ready,
            state: connection.state,
            metadata: connection.metadata
        };
        return { ...status, connection: connection };
    }

        getAllVideoIds() {
        return this.getActiveVideoIds();
    }

        isApiEnabled() {
        return this.config.enableAPI === true ||
            this.config.streamDetectionMethod === 'api' ||
            this.config.viewerCountMethod === 'api';
    }

        isScrapingEnabled() {
        return this.config.streamDetectionMethod === 'scraping';
    }

        async _shutdownConnection(connection, videoId) {
        if (!connection) {
            return;
        }

        try {
            if (typeof connection.stop === 'function') {
                await connection.stop();
            }
        } catch (error) {
            this._handleConnectionError(
                `Error stopping connection for ${videoId || 'unknown'}`,
                error,
                { videoId }
            );
        }

        if (typeof connection.disconnect === 'function') {
            try {
                await connection.disconnect();
            } catch (error) {
                this._handleConnectionError(
                    `Error disconnecting connection for ${videoId || 'unknown'}`,
                    error,
                    { videoId }
                );
                throw error;
            }
        }
    }

        _getErrorMessage(error) {
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
}

YouTubeConnectionManager.prototype._handleConnectionError = function(message, error, eventData) {
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
};

module.exports = {
    YouTubeConnectionManager
}; 
