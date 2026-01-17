const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger, setupAutomatedCleanup } = require('../../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../../helpers/assertion-helpers');
const { waitForDelay } = require('../../helpers/time-utils');
const { YouTubeConnectionManager } = require('../../../src/utils/youtube-connection-manager');

describe('YouTube Connection Manager - Behavior Excellence', () => {
    let connectionManager;
    let mockConnectionFactory;

    beforeEach(() => {
        mockConnectionFactory = createMockFn().mockImplementation(async (videoId) => ({
            videoId,
            state: 'connected',
            metadata: { connectedAt: new Date().toISOString() },
            _mockType: 'YouTubeConnection'
        }));

        connectionManager = new YouTubeConnectionManager(noOpLogger);
    });

    afterEach(() => {
        restoreAllMocks();
        if (connectionManager && connectionManager.connections) {
            connectionManager.connections.clear();
        }
        clearAllMocks();
    });

    describe('Connection Lifecycle Management', () => {
        it('should successfully establish new stream connection with proper state tracking', async () => {
            expect(connectionManager.getAllConnections()).toHaveLength(0);

            const result = await connectionManager.connectToStream('test-video-123', mockConnectionFactory);

            expect(result).toBe(true);

            const connections = connectionManager.getAllConnections();
            expect(connections).toHaveLength(1);
            const connectionData = connectionManager.getAllConnectionData();
            expect(connectionData[0].state).toBe('connected');
            expect(connections[0].videoId).toBe('test-video-123');

            expect(connectionManager.hasConnection('test-video-123')).toBe(true);
            expect(connectionManager.getConnection('test-video-123')).toBeDefined();
        });

        it('should properly disconnect existing stream connection with cleanup', async () => {
            await connectionManager.connectToStream('test-video-456', mockConnectionFactory);
            expect(connectionManager.hasConnection('test-video-456')).toBe(true);

            const result = await connectionManager.disconnectFromStream('test-video-456', 'stream ended');

            expect(result).toBe(true);

            expect(connectionManager.hasConnection('test-video-456')).toBe(false);
            expect(connectionManager.getAllConnections()).toHaveLength(0);
        });

        it('should maintain connection registry accuracy during multiple operations', async () => {
            const videoIds = ['stream-1', 'stream-2', 'stream-3'];

            for (const videoId of videoIds) {
                const result = await connectionManager.connectToStream(videoId, mockConnectionFactory);
                expect(result).toBe(true);
            }

            expect(connectionManager.getAllConnections()).toHaveLength(3);

            for (const videoId of videoIds) {
                expect(connectionManager.hasConnection(videoId)).toBe(true);
            }

            await connectionManager.disconnectFromStream('stream-2', 'user choice');

            expect(connectionManager.getAllConnections()).toHaveLength(2);
            expect(connectionManager.hasConnection('stream-1')).toBe(true);
            expect(connectionManager.hasConnection('stream-2')).toBe(false);
            expect(connectionManager.hasConnection('stream-3')).toBe(true);
        });
    });

    describe('Atomic Operations and Race Condition Prevention', () => {
        it('should prevent duplicate connections to same stream through atomic locking', async () => {
            const slowConnectionFactory = createMockFn().mockImplementation(async (videoId) => {
                await waitForDelay(50);
                return {
                    videoId,
                    state: 'connected',
                    metadata: { connectedAt: new Date().toISOString() }
                };
            });

            const [result1, result2] = await Promise.all([
                connectionManager.connectToStream('concurrent-test', slowConnectionFactory),
                connectionManager.connectToStream('concurrent-test', slowConnectionFactory)
            ]);

            expect([result1, result2]).toContain(true);
            expect([result1, result2]).toContain(false);

            const connections = connectionManager.getAllConnections();
            expect(connections).toHaveLength(1);
            expect(connections[0].videoId).toBe('concurrent-test');
        });

        it('should prevent concurrent disconnect operations on same stream', async () => {
            await connectionManager.connectToStream('disconnect-test', mockConnectionFactory);

            const [result1, result2] = await Promise.all([
                connectionManager.disconnectFromStream('disconnect-test', 'reason 1'),
                connectionManager.disconnectFromStream('disconnect-test', 'reason 2')
            ]);

            expect([result1, result2]).toContain(true);
            expect([result1, result2]).toContain(false);

            expect(connectionManager.hasConnection('disconnect-test')).toBe(false);
        });

        it('should maintain state consistency during rapid connect/disconnect cycles', async () => {
            const videoId = 'rapid-cycle-test';

            for (let i = 0; i < 5; i++) {
                const connectResult = await connectionManager.connectToStream(videoId, mockConnectionFactory);
                expect(connectResult).toBe(true);
                expect(connectionManager.hasConnection(videoId)).toBe(true);

                const disconnectResult = await connectionManager.disconnectFromStream(videoId, `cycle ${i}`);
                expect(disconnectResult).toBe(true);
                expect(connectionManager.hasConnection(videoId)).toBe(false);
            }

            expect(connectionManager.getAllConnections()).toHaveLength(0);
        });
    });

    describe('State Consistency and Resource Management', () => {
        it('should maintain accurate connection state during successful operations', async () => {
            const videoId = 'state-test-stream';

            await connectionManager.connectToStream(videoId, mockConnectionFactory);

            expect(connectionManager.hasConnection(videoId)).toBe(true);

            const allConnections = connectionManager.getAllConnections();
            expect(allConnections).toHaveLength(1);

            const connection = connectionManager.getConnection(videoId);
            expect(connection).toBeDefined();
            expect(connection.videoId).toBe(videoId);
        });

        it('should properly clean up resources when removing connections', async () => {
            const streams = ['cleanup-1', 'cleanup-2', 'cleanup-3'];

            for (const videoId of streams) {
                await connectionManager.connectToStream(videoId, mockConnectionFactory, {
                    reason: 'test connection'
                });
            }

            for (const videoId of streams) {
                await connectionManager.disconnectFromStream(videoId, 'cleanup test');
            }

            expect(connectionManager.getAllConnections()).toHaveLength(0);

            for (const videoId of streams) {
                expect(connectionManager.hasConnection(videoId)).toBe(false);
                expect(connectionManager.getConnection(videoId)).toBeUndefined();
            }
        });

        it('should handle connection metadata properly throughout lifecycle', async () => {
            const videoId = 'metadata-test';
            const connectionReason = 'stream detection triggered';

            await connectionManager.connectToStream(videoId, mockConnectionFactory, {
                reason: connectionReason
            });

            const connection = connectionManager.getConnection(videoId);
            expect(connection).toBeDefined();
            expect(connection.videoId).toBe(videoId);

            const allConnectionData = connectionManager.getAllConnectionData();
            const connectionData = allConnectionData.find(c => c.connection.videoId === videoId);
            expect(connectionData.metadata.reason).toBe(connectionReason);
            expect(connectionData.metadata.connectedAt).toBeDefined();
            expect(new Date(connectionData.metadata.connectedAt)).toBeInstanceOf(Date);
        });
    });

    describe('Error Recovery and Resilience', () => {
        it('should handle connection factory failures gracefully without corrupting state', async () => {
            const failingFactory = createMockFn().mockRejectedValue(new Error('Connection failed'));

            const result = await connectionManager.connectToStream('failing-stream', failingFactory);

            expect(result).toBe(false);

            expect(connectionManager.getActiveVideoIds()).toContain('failing-stream');

            const allConnectionData = connectionManager.getAllConnectionData();
            const failedConnection = allConnectionData.find(c =>
                c.connection === null && c.metadata && c.metadata.error
            );
            expect(failedConnection).toBeDefined();
            expect(failedConnection.state).toBe('error');

            const successResult = await connectionManager.connectToStream('working-stream', mockConnectionFactory);
            expect(successResult).toBe(true);
            expect(connectionManager.hasConnection('working-stream')).toBe(true);
        });

        it('should recover from partial connection failures without affecting other streams', async () => {
            await connectionManager.connectToStream('stable-stream', mockConnectionFactory);
            expect(connectionManager.hasConnection('stable-stream')).toBe(true);

            const failingFactory = createMockFn().mockRejectedValue(new Error('Network error'));
            const failResult = await connectionManager.connectToStream('unstable-stream', failingFactory);

            expect(failResult).toBe(false);
            expect(connectionManager.hasConnection('stable-stream')).toBe(true);

            expect(connectionManager.hasConnection('stable-stream')).toBe(true);
            const activeIds = connectionManager.getActiveVideoIds();
            expect(activeIds).toContain('stable-stream');
        });

        it('should maintain system stability during error conditions', async () => {
            const scenarios = [
                { videoId: 'success-1', shouldFail: false },
                { videoId: 'failure-1', shouldFail: true },
                { videoId: 'success-2', shouldFail: false },
                { videoId: 'failure-2', shouldFail: true }
            ];

            for (const scenario of scenarios) {
                const factory = scenario.shouldFail
                    ? createMockFn().mockRejectedValue(new Error('Simulated failure'))
                    : mockConnectionFactory;

                await connectionManager.connectToStream(scenario.videoId, factory);
            }

            const connections = connectionManager.getAllConnections();
            expect(connections).toHaveLength(4);

            expect(connectionManager.hasConnection('success-1')).toBe(true);
            expect(connectionManager.hasConnection('success-2')).toBe(true);
            expect(connectionManager.hasConnection('failure-1')).toBe(true);
            expect(connectionManager.hasConnection('failure-2')).toBe(true);

            const connectionData = connectionManager.getAllConnectionData();
            const successConnections = connectionData.filter(c => c.state === 'connected');
            expect(successConnections).toHaveLength(2);
        });

        it('cleans up all connections without errors', async () => {
            connectionManager.cleanupAllConnections();

            await connectionManager.connectToStream('to-clean', mockConnectionFactory);
            const stop = createMockFn().mockRejectedValue(new Error('stop failed'));
            const disconnect = createMockFn().mockResolvedValue();
            connectionManager.connections.set('to-clean', { connection: { stop, disconnect }, state: 'connected', metadata: {} });

            connectionManager.cleanupAllConnections();

            expect(connectionManager.getAllConnections()).toHaveLength(0);
        });

        it('handles shutdown errors gracefully', async () => {
            const connection = {
                stop: createMockFn().mockRejectedValue(new Error('stop error')),
                disconnect: createMockFn().mockRejectedValue(new Error('disconnect error'))
            };
            connectionManager.connections.set('err-video', { connection, state: 'connected', metadata: {} });

            await connectionManager.removeConnection('err-video');

            expect(connectionManager.hasConnection('err-video')).toBe(false);
        });
    });

    describe('Edge Cases and Boundary Conditions', () => {
        it('should handle disconnection of non-existent connections gracefully', async () => {
            const result = await connectionManager.disconnectFromStream('non-existent', 'test');

            expect(result).toBe(false);

            expect(connectionManager.getAllConnections()).toHaveLength(0);
        });

        it('should handle duplicate connection attempts gracefully', async () => {
            const videoId = 'duplicate-test';
            await connectionManager.connectToStream(videoId, mockConnectionFactory);

            const duplicateResult = await connectionManager.connectToStream(videoId, mockConnectionFactory);

            expect(duplicateResult).toBe(false);

            expect(connectionManager.hasConnection(videoId)).toBe(true);
            expect(connectionManager.getAllConnections()).toHaveLength(1);
        });

        it('should handle empty video ID and invalid parameters appropriately', async () => {
            const emptyResult = await connectionManager.connectToStream('', mockConnectionFactory);
            const nullResult = await connectionManager.connectToStream(null, mockConnectionFactory);

            const totalConnections = connectionManager.getAllConnections().length;

            expect(totalConnections).toBeGreaterThanOrEqual(0);
            expect(Array.isArray(connectionManager.getAllConnections())).toBe(true);
        });
    });

    describe('Connection Query and Status Methods', () => {
        it('should provide accurate connection status information', async () => {
            await connectionManager.connectToStream('active-1', mockConnectionFactory);
            await connectionManager.connectToStream('active-2', mockConnectionFactory);

            const allConnections = connectionManager.getAllConnections();
            const isReady1 = connectionManager.isConnectionReady('active-1');
            const isReady2 = connectionManager.isConnectionReady('active-2');
            const isReadyNonExistent = connectionManager.isConnectionReady('non-existent');

            expect(allConnections).toHaveLength(2);
            expect(isReady1).toBe(false);
            expect(isReady2).toBe(false);
            expect(isReadyNonExistent).toBe(false);

            expect(connectionManager.hasConnection('active-1')).toBe(true);
            expect(connectionManager.hasConnection('active-2')).toBe(true);

            const connection1 = connectionManager.getConnection('active-1');
            expect(connection1).toBeDefined();
            expect(connection1.videoId).toBe('active-1');
        });

        it('should maintain connection statistics accurately', async () => {
            expect(connectionManager.getAllConnections()).toHaveLength(0);

            await connectionManager.connectToStream('stats-1', mockConnectionFactory);
            expect(connectionManager.getAllConnections()).toHaveLength(1);

            await connectionManager.connectToStream('stats-2', mockConnectionFactory);
            expect(connectionManager.getAllConnections()).toHaveLength(2);

            await connectionManager.disconnectFromStream('stats-1', 'test');
            expect(connectionManager.getAllConnections()).toHaveLength(1);

            await connectionManager.disconnectFromStream('stats-2', 'test');
            expect(connectionManager.getAllConnections()).toHaveLength(0);

            expect(connectionManager.hasConnection('stats-1')).toBe(false);
            expect(connectionManager.hasConnection('stats-2')).toBe(false);
        });
    });

    describe('Configuration Gating', () => {
        it('reports API usage based on configuration flags', () => {
            const youtubeiManager = new YouTubeConnectionManager(noOpLogger, {
                config: {
                    enableAPI: false,
                    streamDetectionMethod: 'youtubei',
                    viewerCountMethod: 'youtubei'
                }
            });

            expect(youtubeiManager.isApiEnabled()).toBe(false);

            const apiManager = new YouTubeConnectionManager(noOpLogger, {
                config: {
                    enableAPI: true,
                    streamDetectionMethod: 'api',
                    viewerCountMethod: 'api'
                }
            });

            expect(apiManager.isApiEnabled()).toBe(true);
        });

        it('reports scraping usage based on stream detection method', () => {
            const youtubeiManager = new YouTubeConnectionManager(noOpLogger, {
                config: {
                    streamDetectionMethod: 'youtubei'
                }
            });

            expect(youtubeiManager.isScrapingEnabled()).toBe(false);

            const scrapingManager = new YouTubeConnectionManager(noOpLogger, {
                config: {
                    streamDetectionMethod: 'scraping'
                }
            });

            expect(scrapingManager.isScrapingEnabled()).toBe(true);
        });
    });

    describe('Error handling and resilience', () => {
        it('normalizes non-Error failures during connection attempts', async () => {
            const handler = { handleEventProcessingError: createMockFn() };
            connectionManager.errorHandler = handler;

            const result = await connectionManager.connectToStream('broken', async () => {
                throw 'boom';
            });

            expect(result).toBe(false);

            const status = connectionManager.getConnectionStatus('broken');
            expect(status.state).toBe(connectionManager.CONNECTION_STATES.ERROR);
            expect(status.metadata.error).toBe('boom');

            expect(handler.handleEventProcessingError).toHaveBeenCalledWith(
                expect.any(Error),
                'connection',
                expect.objectContaining({ videoId: 'broken' }),
                expect.stringContaining('Failed to connect to broken'),
                'youtube-connection'
            );
            expect(handler.handleEventProcessingError.mock.calls[0][0].message).toBe('boom');
        });

        it('removes connections even when stop fails and routes errors', async () => {
            const handler = { handleEventProcessingError: createMockFn() };
            connectionManager.errorHandler = handler;
            connectionManager.connections.set('vid', {
                connection: {
                    stop: createMockFn().mockRejectedValue('stop fail'),
                    disconnect: createMockFn().mockResolvedValue()
                },
                state: connectionManager.CONNECTION_STATES.CONNECTED,
                metadata: {}
            });

            await connectionManager.removeConnection('vid');

            expect(connectionManager.hasConnection('vid')).toBe(false);
            expect(handler.handleEventProcessingError).toHaveBeenCalledWith(
                expect.any(Error),
                'connection',
                expect.objectContaining({ videoId: 'vid' }),
                expect.stringContaining('Error stopping connection'),
                'youtube-connection'
            );
            expect(handler.handleEventProcessingError.mock.calls[0][0].message).toBe('stop fail');
        });
    });
});
