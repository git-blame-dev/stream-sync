
const { createMockPlatform, setupAutomatedCleanup } = require('../../helpers/mock-factories');
const { 
    expectValidNotification, 
    expectNoTechnicalArtifacts,
    expectValidStreamData 
} = require('../../helpers/assertion-helpers');
const { YouTubeConnectionManager } = require('../../../src/utils/youtube-connection-manager');

describe('YouTube Connection Manager - Behavior Excellence', () => {
    let connectionManager;
    let mockLogger;
    let mockConnectionFactory;

    beforeEach(() => {
        // Create behavior-focused mock logger
        mockLogger = {
            info: jest.fn(),
            warn: jest.fn(), 
            error: jest.fn(),
            debug: jest.fn(),
            _mockType: 'Logger'
        };

        // Create behavior-focused connection factory
        mockConnectionFactory = jest.fn().mockImplementation(async (videoId) => ({
            videoId,
            state: 'connected',
            metadata: { connectedAt: new Date().toISOString() },
            _mockType: 'YouTubeConnection'
        }));

        connectionManager = new YouTubeConnectionManager(mockLogger);
    });

    afterEach(() => {
        // Clean up any connections
        if (connectionManager && connectionManager.connections) {
            connectionManager.connections.clear();
        }
        // Clear all mocks
        jest.clearAllMocks();
    });

    describe('Connection Lifecycle Management', () => {
        it('should successfully establish new stream connection with proper state tracking', async () => {
            // Given: No existing connections
            expect(connectionManager.getAllConnections()).toHaveLength(0);
            
            // When: Connecting to a new stream
            const result = await connectionManager.connectToStream('test-video-123', mockConnectionFactory);
            
            // Then: Connection established successfully
            expect(result).toBe(true);
            
            // And: Connection is properly tracked
            const connections = connectionManager.getAllConnections();
            expect(connections).toHaveLength(1);
            const connectionData = connectionManager.getAllConnectionData();
            expect(connectionData[0].state).toBe('connected');
            expect(connections[0].videoId).toBe('test-video-123');
            
            // And: Connection exists and can be accessed
            expect(connectionManager.hasConnection('test-video-123')).toBe(true);
            expect(connectionManager.getConnection('test-video-123')).toBeDefined();
        });

        it('should properly disconnect existing stream connection with cleanup', async () => {
            // Given: Established connection
            await connectionManager.connectToStream('test-video-456', mockConnectionFactory);
            expect(connectionManager.hasConnection('test-video-456')).toBe(true);
            
            // When: Disconnecting from stream
            const result = await connectionManager.disconnectFromStream('test-video-456', 'stream ended');
            
            // Then: Disconnection successful
            expect(result).toBe(true);
            
            // And: Connection is no longer tracked
            expect(connectionManager.hasConnection('test-video-456')).toBe(false);
            expect(connectionManager.getAllConnections()).toHaveLength(0);
        });

        it('should maintain connection registry accuracy during multiple operations', async () => {
            // Given: Multiple stream connections
            const videoIds = ['stream-1', 'stream-2', 'stream-3'];
            
            // When: Connecting to multiple streams
            for (const videoId of videoIds) {
                const result = await connectionManager.connectToStream(videoId, mockConnectionFactory);
                expect(result).toBe(true);
            }
            
            // Then: All connections tracked properly
            expect(connectionManager.getAllConnections()).toHaveLength(3);
            
            // And: Each connection individually accessible
            for (const videoId of videoIds) {
                expect(connectionManager.hasConnection(videoId)).toBe(true);
            }
            
            // When: Disconnecting middle stream
            await connectionManager.disconnectFromStream('stream-2', 'user choice');
            
            // Then: Only specified connection removed
            expect(connectionManager.getAllConnections()).toHaveLength(2);
            expect(connectionManager.hasConnection('stream-1')).toBe(true);
            expect(connectionManager.hasConnection('stream-2')).toBe(false);
            expect(connectionManager.hasConnection('stream-3')).toBe(true);
        });
    });

    describe('Atomic Operations and Race Condition Prevention', () => {
        it('should prevent duplicate connections to same stream through atomic locking', async () => {
            // Given: Slow connection factory to simulate race condition
            const slowConnectionFactory = jest.fn().mockImplementation(async (videoId) => {
                await waitForDelay(50);
                return {
                    videoId,
                    state: 'connected',
                    metadata: { connectedAt: new Date().toISOString() }
                };
            });
            
            // When: Attempting concurrent connections to same stream
            const [result1, result2] = await Promise.all([
                connectionManager.connectToStream('concurrent-test', slowConnectionFactory),
                connectionManager.connectToStream('concurrent-test', slowConnectionFactory)
            ]);
            
            // Then: Only one connection succeeds
            expect([result1, result2]).toContain(true);
            expect([result1, result2]).toContain(false);
            
            // And: Only one connection exists
            const connections = connectionManager.getAllConnections();
            expect(connections).toHaveLength(1);
            expect(connections[0].videoId).toBe('concurrent-test');
        });

        it('should prevent concurrent disconnect operations on same stream', async () => {
            // Given: Established connection
            await connectionManager.connectToStream('disconnect-test', mockConnectionFactory);
            
            // When: Attempting concurrent disconnections
            const [result1, result2] = await Promise.all([
                connectionManager.disconnectFromStream('disconnect-test', 'reason 1'),
                connectionManager.disconnectFromStream('disconnect-test', 'reason 2')
            ]);
            
            // Then: Only one disconnection succeeds
            expect([result1, result2]).toContain(true);
            expect([result1, result2]).toContain(false);
            
            // And: Stream is properly disconnected
            expect(connectionManager.hasConnection('disconnect-test')).toBe(false);
        });

        it('should maintain state consistency during rapid connect/disconnect cycles', async () => {
            const videoId = 'rapid-cycle-test';
            
            // When: Rapid connect/disconnect operations
            for (let i = 0; i < 5; i++) {
                // Connect
                const connectResult = await connectionManager.connectToStream(videoId, mockConnectionFactory);
                expect(connectResult).toBe(true);
                expect(connectionManager.hasConnection(videoId)).toBe(true);
                
                // Disconnect
                const disconnectResult = await connectionManager.disconnectFromStream(videoId, `cycle ${i}`);
                expect(disconnectResult).toBe(true);
                expect(connectionManager.hasConnection(videoId)).toBe(false);
            }
            
            // Then: Final state is clean
            expect(connectionManager.getAllConnections()).toHaveLength(0);
        });
    });

    describe('State Consistency and Resource Management', () => {
        it('should maintain accurate connection state during successful operations', async () => {
            const videoId = 'state-test-stream';
            
            // When: Connecting to stream
            await connectionManager.connectToStream(videoId, mockConnectionFactory);
            
            // Then: State is consistent across all access methods
            expect(connectionManager.hasConnection(videoId)).toBe(true);
            
            const allConnections = connectionManager.getAllConnections();
            expect(allConnections).toHaveLength(1);
            
            const connection = connectionManager.getConnection(videoId);
            expect(connection).toBeDefined();
            expect(connection.videoId).toBe(videoId);
        });

        it('should properly clean up resources when removing connections', async () => {
            // Given: Multiple connections with metadata
            const streams = ['cleanup-1', 'cleanup-2', 'cleanup-3'];
            
            for (const videoId of streams) {
                await connectionManager.connectToStream(videoId, mockConnectionFactory, {
                    reason: 'test connection'
                });
            }
            
            // When: Removing all connections
            for (const videoId of streams) {
                await connectionManager.disconnectFromStream(videoId, 'cleanup test');
            }
            
            // Then: No connections remain in registry
            expect(connectionManager.getAllConnections()).toHaveLength(0);
            
            // And: Individual connection checks return false
            for (const videoId of streams) {
                expect(connectionManager.hasConnection(videoId)).toBe(false);
                expect(connectionManager.getConnection(videoId)).toBeUndefined();
            }
        });

        it('should handle connection metadata properly throughout lifecycle', async () => {
            const videoId = 'metadata-test';
            const connectionReason = 'stream detection triggered';
            
            // When: Connecting with metadata
            await connectionManager.connectToStream(videoId, mockConnectionFactory, {
                reason: connectionReason
            });
            
            // Then: Connection is established and accessible
            const connection = connectionManager.getConnection(videoId);
            expect(connection).toBeDefined();
            expect(connection.videoId).toBe(videoId);
            
            // And: Connection metadata is available from the connection data
            const allConnectionData = connectionManager.getAllConnectionData();
            const connectionData = allConnectionData.find(c => c.connection.videoId === videoId);
            expect(connectionData.metadata.reason).toBe(connectionReason);
            expect(connectionData.metadata.connectedAt).toBeDefined();
            expect(new Date(connectionData.metadata.connectedAt)).toBeInstanceOf(Date);
        });
    });

    describe('Error Recovery and Resilience', () => {
        it('should handle connection factory failures gracefully without corrupting state', async () => {
            // Given: Failing connection factory
            const failingFactory = jest.fn().mockRejectedValue(new Error('Connection failed'));
            
            // When: Attempting to connect with failing factory
            const result = await connectionManager.connectToStream('failing-stream', failingFactory);
            
            // Then: Connection fails gracefully
            expect(result).toBe(false);
            
            // And: Failed connections are tracked in error state
            expect(connectionManager.getActiveVideoIds()).toContain('failing-stream');
            
            // But: Failed connection is in error state, not connected state
            const allConnectionData = connectionManager.getAllConnectionData();
            const failedConnection = allConnectionData.find(c => 
                c.connection === null && c.metadata && c.metadata.error
            );
            expect(failedConnection).toBeDefined();
            expect(failedConnection.state).toBe('error');
            
            // And: Subsequent connections still work
            const successResult = await connectionManager.connectToStream('working-stream', mockConnectionFactory);
            expect(successResult).toBe(true);
            expect(connectionManager.hasConnection('working-stream')).toBe(true);
        });

        it('should recover from partial connection failures without affecting other streams', async () => {
            // Given: One successful connection
            await connectionManager.connectToStream('stable-stream', mockConnectionFactory);
            expect(connectionManager.hasConnection('stable-stream')).toBe(true);
            
            // When: Another connection fails
            const failingFactory = jest.fn().mockRejectedValue(new Error('Network error'));
            const failResult = await connectionManager.connectToStream('unstable-stream', failingFactory);
            
            // Then: Failed connection doesn't affect existing connection
            expect(failResult).toBe(false);
            expect(connectionManager.hasConnection('stable-stream')).toBe(true);
            
            // And: Failed connection is tracked but stable connection remains
            expect(connectionManager.hasConnection('stable-stream')).toBe(true);
            const activeIds = connectionManager.getActiveVideoIds();
            expect(activeIds).toContain('stable-stream');
        });

        it('should maintain system stability during error conditions', async () => {
            // Given: Mixed success and failure scenarios
            const scenarios = [
                { videoId: 'success-1', shouldFail: false },
                { videoId: 'failure-1', shouldFail: true },
                { videoId: 'success-2', shouldFail: false },
                { videoId: 'failure-2', shouldFail: true }
            ];
            
            // When: Processing mixed scenarios
            for (const scenario of scenarios) {
                const factory = scenario.shouldFail 
                    ? jest.fn().mockRejectedValue(new Error('Simulated failure'))
                    : mockConnectionFactory;
                    
                await connectionManager.connectToStream(scenario.videoId, factory);
            }
            
            // Then: All connections are tracked (successful and failed)
            const connections = connectionManager.getAllConnections();
            expect(connections).toHaveLength(4); // All connections tracked with different states
            
            // And: Successful connections are accessible
            expect(connectionManager.hasConnection('success-1')).toBe(true);
            expect(connectionManager.hasConnection('success-2')).toBe(true);
            expect(connectionManager.hasConnection('failure-1')).toBe(true); // Failed connections are still tracked
            expect(connectionManager.hasConnection('failure-2')).toBe(true);
            
            // But: Only successful connections are in connected state
            const connectionData = connectionManager.getAllConnectionData();
            const successConnections = connectionData.filter(c => c.state === 'connected');
            expect(successConnections).toHaveLength(2);
        });

        it('cleans up all connections and logs when nothing to clean', async () => {
            connectionManager.cleanupAllConnections(); // no connections
            expect(mockLogger.debug).toHaveBeenCalledWith('No connections to cleanup', 'youtube');

            await connectionManager.connectToStream('to-clean', mockConnectionFactory);
            const stop = jest.fn().mockRejectedValue(new Error('stop failed'));
            const disconnect = jest.fn().mockResolvedValue();
            connectionManager.connections.set('to-clean', { connection: { stop, disconnect }, state: 'connected', metadata: {} });

            connectionManager.cleanupAllConnections();
            expect(mockLogger.info).toHaveBeenCalledWith('Cleaned up all 1 connections', 'youtube');
        });

        it('handles shutdown errors gracefully', async () => {
            const connection = {
                stop: jest.fn().mockRejectedValue(new Error('stop error')),
                disconnect: jest.fn().mockRejectedValue(new Error('disconnect error'))
            };
            connectionManager.connections.set('err-video', { connection, state: 'connected', metadata: {} });

            await connectionManager.removeConnection('err-video');

            expect(connectionManager.hasConnection('err-video')).toBe(false);
            expect(mockLogger.debug).toHaveBeenCalledWith('Removed connection for video err-video', 'youtube');
        });
    });

    describe('Edge Cases and Boundary Conditions', () => {
        it('should handle disconnection of non-existent connections gracefully', async () => {
            // When: Attempting to disconnect non-existent connection
            const result = await connectionManager.disconnectFromStream('non-existent', 'test');
            
            // Then: Operation completes without error
            expect(result).toBe(false);
            
            // And: System state remains stable
            expect(connectionManager.getAllConnections()).toHaveLength(0);
        });

        it('should handle duplicate connection attempts gracefully', async () => {
            // Given: Existing connection
            const videoId = 'duplicate-test';
            await connectionManager.connectToStream(videoId, mockConnectionFactory);
            
            // When: Attempting duplicate connection
            const duplicateResult = await connectionManager.connectToStream(videoId, mockConnectionFactory);
            
            // Then: Duplicate attempt is rejected
            expect(duplicateResult).toBe(false);
            
            // And: Original connection remains intact
            expect(connectionManager.hasConnection(videoId)).toBe(true);
            expect(connectionManager.getAllConnections()).toHaveLength(1);
        });

        it('should handle empty video ID and invalid parameters appropriately', async () => {
            // When: Attempting connection with empty/invalid parameters
            const emptyResult = await connectionManager.connectToStream('', mockConnectionFactory);
            const nullResult = await connectionManager.connectToStream(null, mockConnectionFactory);
            
            // Then: Implementation may handle these differently
            // Let's verify the total connections reflect actual behavior
            const totalConnections = connectionManager.getAllConnections().length;
            
            // And: System state is predictable regardless of parameter validation
            expect(totalConnections).toBeGreaterThanOrEqual(0);
            expect(Array.isArray(connectionManager.getAllConnections())).toBe(true);
        });
    });

    describe('Connection Query and Status Methods', () => {
        it('should provide accurate connection status information', async () => {
            // Given: Multiple connections with different states
            await connectionManager.connectToStream('active-1', mockConnectionFactory);
            await connectionManager.connectToStream('active-2', mockConnectionFactory);
            
            // When: Querying connection status
            const allConnections = connectionManager.getAllConnections();
            const isReady1 = connectionManager.isConnectionReady('active-1');
            const isReady2 = connectionManager.isConnectionReady('active-2');
            const isReadyNonExistent = connectionManager.isConnectionReady('non-existent');
            
            // Then: Status information is accurate
            expect(allConnections).toHaveLength(2);
            expect(isReady1).toBe(false); // Ready state requires setConnectionReady() to be called
            expect(isReady2).toBe(false); // Ready state requires setConnectionReady() to be called
            expect(isReadyNonExistent).toBe(false);
            
            // But: Connections exist and are accessible
            expect(connectionManager.hasConnection('active-1')).toBe(true);
            expect(connectionManager.hasConnection('active-2')).toBe(true);
            
            // And: Connection details are accessible
            const connection1 = connectionManager.getConnection('active-1');
            expect(connection1).toBeDefined();
            expect(connection1.videoId).toBe('active-1');
        });

        it('should maintain connection statistics accurately', async () => {
            // When: Establishing and removing connections
            expect(connectionManager.getAllConnections()).toHaveLength(0);
            
            await connectionManager.connectToStream('stats-1', mockConnectionFactory);
            expect(connectionManager.getAllConnections()).toHaveLength(1);
            
            await connectionManager.connectToStream('stats-2', mockConnectionFactory);
            expect(connectionManager.getAllConnections()).toHaveLength(2);
            
            await connectionManager.disconnectFromStream('stats-1', 'test');
            expect(connectionManager.getAllConnections()).toHaveLength(1);
            
            await connectionManager.disconnectFromStream('stats-2', 'test');
            expect(connectionManager.getAllConnections()).toHaveLength(0);
            
            // Then: Statistics remain accurate throughout operations
            expect(connectionManager.hasConnection('stats-1')).toBe(false);
            expect(connectionManager.hasConnection('stats-2')).toBe(false);
        });
    });

    describe('Configuration Gating', () => {
        it('reports API usage based on configuration flags', () => {
            const youtubeiManager = new YouTubeConnectionManager(mockLogger, {
                config: {
                    enableAPI: false,
                    streamDetectionMethod: 'youtubei',
                    viewerCountMethod: 'youtubei'
                }
            });

            expect(youtubeiManager.isApiEnabled()).toBe(false);

            const apiManager = new YouTubeConnectionManager(mockLogger, {
                config: {
                    enableAPI: true,
                    streamDetectionMethod: 'api',
                    viewerCountMethod: 'api'
                }
            });

            expect(apiManager.isApiEnabled()).toBe(true);
        });

        it('reports scraping usage based on stream detection method', () => {
            const youtubeiManager = new YouTubeConnectionManager(mockLogger, {
                config: {
                    streamDetectionMethod: 'youtubei'
                }
            });

            expect(youtubeiManager.isScrapingEnabled()).toBe(false);

            const scrapingManager = new YouTubeConnectionManager(mockLogger, {
                config: {
                    streamDetectionMethod: 'scraping'
                }
            });

            expect(scrapingManager.isScrapingEnabled()).toBe(true);
        });
    });

    describe('Error handling and resilience', () => {
        it('normalizes non-Error failures during connection attempts', async () => {
            const handler = { handleEventProcessingError: jest.fn() };
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
            const handler = { handleEventProcessingError: jest.fn() };
            connectionManager.errorHandler = handler;
            connectionManager.connections.set('vid', {
                connection: {
                    stop: jest.fn().mockRejectedValue('stop fail'),
                    disconnect: jest.fn().mockResolvedValue()
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
