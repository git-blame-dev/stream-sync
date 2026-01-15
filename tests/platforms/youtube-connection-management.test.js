
const { describe, test, expect, beforeEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

const { initializeTestLogging } = require('../helpers/test-setup');

const mockErrorHandler = {
    handleEventProcessingError: createMockFn(),
    logOperationalError: createMockFn()
};

mockModule('../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: createMockFn(() => mockErrorHandler)
}));

const { createPlatformErrorHandler } = require('../../src/utils/platform-error-handler');

// Initialize logging for tests
initializeTestLogging();

const { YouTubeConnectionManager } = require('../../src/utils/youtube-connection-manager');

describe('YouTube Connection Manager - Lifecycle Behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let connectionManager;
    let mockLogger;
    let mockConnection;

    beforeEach(() => {
        // Reset platform error handler mocks
        mockErrorHandler.handleEventProcessingError.mockReset();
        mockErrorHandler.logOperationalError.mockReset();
        createPlatformErrorHandler.mockClear();

        // Create mock logger
        mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

        // Create mock connection
        mockConnection = {
            id: 'test-connection-1',
            videoId: 'test-video-id',
            status: 'connecting',
            ready: false,
            disconnect: createMockFn(),
            isReady: createMockFn().mockReturnValue(false)
        };

        // Create connection manager instance
        connectionManager = new YouTubeConnectionManager(mockLogger);
        connectionManager.errorHandler = mockErrorHandler;
    });

    describe('Connection Addition', () => {
        it('should add a new connection successfully', async () => {
            const videoId = 'test-video-id';
            const connection = { ...mockConnection };

            const result = await connectionManager.connectToStream(videoId, async () => connection);

            expect(result).toBe(true);
            expect(connectionManager.hasConnection(videoId)).toBe(true);
            expect(mockLogger.info).toHaveBeenCalledWith(
                `Successfully connected to ${videoId}`,
                'youtube'
            );
        });

        it('should not replace existing connection when adding to same video ID', async () => {
            const videoId = 'test-video-id';
            const connection1 = { ...mockConnection, id: 'connection-1' };
            const connection2 = { ...mockConnection, id: 'connection-2' };

            const result1 = await connectionManager.connectToStream(videoId, async () => connection1);
            const result2 = await connectionManager.connectToStream(videoId, async () => connection2);

            expect(result1).toBe(true);
            expect(result2).toBe(false);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining(`Already connected to ${videoId}`),
                'youtube'
            );
        });

        it('should track connection count correctly', async () => {
            const connection1 = { ...mockConnection, videoId: 'video-1' };
            const connection2 = { ...mockConnection, videoId: 'video-2' };

            expect(connectionManager.getConnectionCount()).toBe(0);

            await connectionManager.connectToStream('video-1', async () => connection1);
            expect(connectionManager.getConnectionCount()).toBe(1);

            await connectionManager.connectToStream('video-2', async () => connection2);
            expect(connectionManager.getConnectionCount()).toBe(2);
        });
    });

    describe('Connection Removal & Recovery', () => {
        it('removes an existing connection and updates state', async () => {
            const videoId = 'test-video-id';
            const connection = { ...mockConnection };

            await connectionManager.connectToStream(videoId, async () => connection);
            await connectionManager.removeConnection(videoId);

            expect(connectionManager.hasConnection(videoId)).toBe(false);
            expect(connectionManager.getConnection(videoId)).toBeUndefined();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Removed connection for video test-video-id',
                'youtube'
            );
        });

        it('handles removal of non-existent connection gracefully', async () => {
            await connectionManager.removeConnection('non-existent-video');

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Attempted to remove non-existent connection for video non-existent-video',
                'youtube'
            );
        });

        it('invokes connection disconnect hook when removal occurs', async () => {
            const videoId = 'test-video-id';
            const connection = { ...mockConnection, disconnect: createMockFn() };

            await connectionManager.connectToStream(videoId, async () => connection);
            await connectionManager.removeConnection(videoId);

            expect(connection.disconnect).toHaveBeenCalled();
        });

        it('updates aggregate connection count after removal', async () => {
            const connection = { ...mockConnection };

            await connectionManager.connectToStream('test-video', async () => connection);
            expect(connectionManager.getConnectionCount()).toBe(1);

            await connectionManager.removeConnection('test-video');
            expect(connectionManager.getConnectionCount()).toBe(0);
        });
    });

    describe('Connection Status Management', () => {
        it('should set connection as ready', async () => {
            const videoId = 'test-video-id';
            const connection = { ...mockConnection };

            await connectionManager.connectToStream(videoId, async () => connection);
            connectionManager.setConnectionReady(videoId);

            expect(connectionManager.isConnectionReady(videoId)).toBe(true);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Connection ready for video test-video-id',
                'youtube'
            );
        });

        it('should handle setting ready status for non-existent connection', () => {
            connectionManager.setConnectionReady('non-existent-video');

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Attempted to set ready status for non-existent connection: non-existent-video',
                'youtube'
            );
        });

        it('should check if any connection is ready', async () => {
            const connection1 = { ...mockConnection, videoId: 'video-1', ready: false };
            const connection2 = { ...mockConnection, videoId: 'video-2', ready: true };

            await connectionManager.connectToStream('video-1', async () => connection1);
            await connectionManager.connectToStream('video-2', async () => connection2);

            // Mark video-2 as ready
            connectionManager.setConnectionReady('video-2');

            expect(connectionManager.isAnyConnectionReady()).toBe(true);
        });

        it('should return false when no connections are ready', async () => {
            const connection = { ...mockConnection, ready: false };
            await connectionManager.connectToStream('test-video', async () => connection);

            expect(connectionManager.isAnyConnectionReady()).toBe(false);
        });
    });

    describe('Connection Queries', () => {
        it('should get all active video IDs', async () => {
            const connection1 = { ...mockConnection, videoId: 'video-1' };
            const connection2 = { ...mockConnection, videoId: 'video-2' };

            await connectionManager.connectToStream('video-1', async () => connection1);
            await connectionManager.connectToStream('video-2', async () => connection2);

            const activeVideoIds = connectionManager.getActiveVideoIds();
            expect(activeVideoIds).toContain('video-1');
            expect(activeVideoIds).toContain('video-2');
            expect(activeVideoIds).toHaveLength(2);
        });

        it('should get all connections', async () => {
            const connection1 = { ...mockConnection, videoId: 'video-1' };
            const connection2 = { ...mockConnection, videoId: 'video-2' };

            await connectionManager.connectToStream('video-1', async () => connection1);
            await connectionManager.connectToStream('video-2', async () => connection2);

            const allConnections = connectionManager.getAllConnections();
            expect(allConnections).toContain(connection1);
            expect(allConnections).toContain(connection2);
            expect(allConnections).toHaveLength(2);
        });

        it('should check if connection exists', async () => {
            const connection = { ...mockConnection };
            await connectionManager.connectToStream('test-video', async () => connection);

            expect(connectionManager.hasConnection('test-video')).toBe(true);
            expect(connectionManager.hasConnection('non-existent')).toBe(false);
        });

        it('should get connection by video ID', async () => {
            const connection = { ...mockConnection };
            await connectionManager.connectToStream('test-video', async () => connection);

            expect(connectionManager.getConnection('test-video')).toBe(connection);
            expect(connectionManager.getConnection('non-existent')).toBeUndefined();
        });
    });

    describe('Connection Cleanup', () => {
        it('should cleanup all connections', async () => {
            const connection1 = { ...mockConnection, videoId: 'video-1', disconnect: createMockFn() };
            const connection2 = { ...mockConnection, videoId: 'video-2', disconnect: createMockFn() };

            await connectionManager.connectToStream('video-1', async () => connection1);
            await connectionManager.connectToStream('video-2', async () => connection2);

            connectionManager.cleanupAllConnections();

            expect(connection1.disconnect).toHaveBeenCalled();
            expect(connection2.disconnect).toHaveBeenCalled();
            expect(connectionManager.getConnectionCount()).toBe(0);
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Cleaned up all 2 connections',
                'youtube'
            );
        });

        it('should handle cleanup when no connections exist', () => {
            connectionManager.cleanupAllConnections();

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'No connections to cleanup',
                'youtube'
            );
        });
    });

    describe('Connection State Management', () => {
        it('should get connection state for debugging', async () => {
            const connection = { ...mockConnection, ready: true };
            await connectionManager.connectToStream('test-video', async () => connection);
            connectionManager.setConnectionReady('test-video');

            const state = connectionManager.getConnectionState();

            expect(state).toEqual({
                totalConnections: 1,
                readyConnections: 1,
                activeVideoIds: ['test-video'],
                hasAnyReady: true
            });
        });

        it('should track ready connection count', async () => {
            const connection1 = { ...mockConnection, videoId: 'video-1', ready: false };
            const connection2 = { ...mockConnection, videoId: 'video-2', ready: true };

            await connectionManager.connectToStream('video-1', async () => connection1);
            await connectionManager.connectToStream('video-2', async () => connection2);

            // Mark video-2 as ready
            connectionManager.setConnectionReady('video-2');

            expect(connectionManager.getReadyConnectionCount()).toBe(1);
        });

        it('should get connection statistics', async () => {
            const connection1 = { ...mockConnection, videoId: 'video-1', ready: false };
            const connection2 = { ...mockConnection, videoId: 'video-2', ready: true };

            await connectionManager.connectToStream('video-1', async () => connection1);
            await connectionManager.connectToStream('video-2', async () => connection2);

            // Mark video-2 as ready
            connectionManager.setConnectionReady('video-2');

            const stats = connectionManager.getStats();

            expect(stats).toEqual({
                totalConnections: 2,
                readyConnections: 1,
                activeVideoIds: ['video-1', 'video-2'],
                hasAnyReady: true
            });
        });
    });

    describe('Error Handling', () => {
        it('routes disconnect failures through platform error handler', async () => {
            const connection = { ...mockConnection, disconnect: createMockFn().mockRejectedValue(new Error('Disconnect failed')) };

            await connectionManager.connectToStream('test-video', async () => connection);

            // Should not throw error
            await expect(connectionManager.removeConnection('test-video')).resolves.toBeUndefined();

            expect(connection.disconnect).toHaveBeenCalled();

            await Promise.resolve();

            const handlerInstance = connectionManager.errorHandler || mockErrorHandler;
            expect(handlerInstance.handleEventProcessingError).toHaveBeenCalledWith(
                expect.any(Error),
                'connection',
                expect.objectContaining({ videoId: 'test-video' }),
                'Error removing connection for video test-video',
                'youtube-connection'
            );
        });

        it('logs successful connection operations for observability', async () => {
            const connection = { ...mockConnection };
            await connectionManager.connectToStream('test-video', async () => connection);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Successfully connected to test-video',
                'youtube'
            );
        });
    });
}); 
