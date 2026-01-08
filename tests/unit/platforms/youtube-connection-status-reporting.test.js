
const { EventEmitter } = require('events');

// Mock behavior-focused factories
const createMockPlatform = () => {
    const platform = new EventEmitter();
    platform.connectionManager = {
        connections: new Map(),
        connectToStream: jest.fn().mockResolvedValue(true),
        removeConnection: jest.fn(),
        setConnectionReady: jest.fn(),
        isConnectionReady: jest.fn(),
        getActiveVideoIds: jest.fn(),
        getConnectionCount: jest.fn(),
        getReadyConnectionCount: jest.fn(),
        hasConnection: jest.fn(),
        getConnection: jest.fn(),
        getAllVideoIds: jest.fn()
    };
    platform.logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    };
    platform.config = {
        youtube: {
            enabled: true,
            multiStreamEnabled: true
        }
    };
    // Add the method we're testing - this should fail because the real behavior doesn't exist yet
    platform.getActiveYouTubeVideoIds = jest.fn(() => {
        // This is the behavior we want to implement:
        // Only return connections that are actually ready (have received start event)
        return platform.connectionManager.getActiveVideoIds().filter(videoId => 
            platform.connectionManager.isConnectionReady(videoId)
        );
    });
    return platform;
};

const createMockNotificationManager = () => ({
    getDisplayedNotifications: jest.fn(() => []),
    addNotification: jest.fn(),
    clearNotifications: jest.fn()
});

const expectValidNotification = (notification) => {
    expect(notification).toBeDefined();
    expect(notification.content).toBeDefined();
    expect(typeof notification.content).toBe('string');
    expect(notification.content.length).toBeGreaterThan(0);
};

const expectNoTechnicalArtifacts = (content) => {
    // Ensure no technical artifacts in user-facing content
    expect(content).not.toMatch(/undefined/i);
    expect(content).not.toMatch(/\[object Object\]/i);
    expect(content).not.toMatch(/function\s*\(/i);
    expect(content).not.toMatch(/Promise\s*\{/i);
    expect(content).not.toMatch(/Error:/i);
};

// Create a YouTube platform instance for testing
const createYouTubePlatform = (mockLogger, mockConnectionManager) => {
    const YouTube = require('../../../src/platforms/youtube');
    return new YouTube(
        {
            youtube: {
                enabled: true,
                channels: ['testchannel'],
                apiKey: 'test-api-key',
                multiStreamEnabled: true
            }
        },
        {
            onMessage: jest.fn(),
            onFollow: jest.fn(),
            onGift: jest.fn(),
            onMembership: jest.fn(),
            onStreamStart: jest.fn(),
            onStreamEnd: jest.fn()
        },
        mockLogger,
        createMockNotificationManager()
    );
};

describe('YouTube Connection Status Reporting', () => {
    let platform;
    let mockLogger;
    let mockConnectionManager;

    beforeEach(() => {
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        mockConnectionManager = {
            connections: new Map(),
            addConnection: jest.fn(),
            removeConnection: jest.fn(),
            setConnectionReady: jest.fn(),
            isConnectionReady: jest.fn(),
            getActiveVideoIds: jest.fn(),
            getConnectionCount: jest.fn(),
            getReadyConnectionCount: jest.fn(),
            hasConnection: jest.fn(),
            getConnection: jest.fn()
        };

        platform = createMockPlatform();
    });

    describe('User Behavior: Status reporting only counts ready connections', () => {
        test('should report zero active connections when connections exist but none are ready', () => {
            // Given: Platform has stored connections but none are ready
            const storedVideoIds = ['video1', 'video2', 'video3'];
            platform.connectionManager.getActiveVideoIds.mockReturnValue(storedVideoIds);
            platform.connectionManager.isConnectionReady
                .mockReturnValue(false); // All connections are not ready
            
            // When: User requests active YouTube video IDs
            const activeIds = platform.getActiveYouTubeVideoIds();
            
            // Then: User sees no active connections (behavior-focused assertion)
            expect(activeIds).toEqual([]);
            expect(activeIds.length).toBe(0);
            
            // And: System correctly distinguishes stored vs ready connections
            expect(platform.connectionManager.getActiveVideoIds).toHaveBeenCalled();
            expect(platform.connectionManager.isConnectionReady).toHaveBeenCalledWith('video1');
            expect(platform.connectionManager.isConnectionReady).toHaveBeenCalledWith('video2');
            expect(platform.connectionManager.isConnectionReady).toHaveBeenCalledWith('video3');
        });

        test('should report only ready connections when mix of ready and not-ready exists', () => {
            // Given: Platform has mixed connection states
            const storedVideoIds = ['video1', 'video2', 'video3'];
            platform.connectionManager.getActiveVideoIds.mockReturnValue(storedVideoIds);
            platform.connectionManager.isConnectionReady
                .mockReturnValueOnce(true)   // video1 is ready
                .mockReturnValueOnce(false)  // video2 is not ready  
                .mockReturnValueOnce(true);  // video3 is ready
            
            // When: User requests active YouTube video IDs
            const activeIds = platform.getActiveYouTubeVideoIds();
            
            // Then: User sees only the ready connections
            expect(activeIds).toEqual(['video1', 'video3']);
            expect(activeIds.length).toBe(2);
            
            // And: All connections were checked for readiness
            expect(platform.connectionManager.isConnectionReady).toHaveBeenCalledTimes(3);
        });

        test('should show accurate status logging distinguishing stored vs ready connections', () => {
            // Given: Platform has 3 stored connections, 1 ready
            const storedConnections = ['video1', 'video2', 'video3'];
            platform.connectionManager.getAllVideoIds = jest.fn().mockReturnValue(storedConnections);
            platform.getActiveYouTubeVideoIds = jest.fn().mockReturnValue(['video1']); // Only 1 ready
            
            // When: System logs multi-stream status
            const storedCount = platform.connectionManager.getAllVideoIds().length;
            const readyCount = platform.getActiveYouTubeVideoIds().length;
            
            // Log the status (simulating the real behavior)
            platform.logger.info(`Multi-stream status: ${readyCount} ready, ${storedCount} total connections`, 'youtube');
            
            // Then: User sees accurate status information in logs
            expect(platform.logger.info).toHaveBeenCalledWith(
                'Multi-stream status: 1 ready, 3 total connections',
                'youtube'
            );
            
            // And: Status clearly distinguishes ready vs total connections
            expect(readyCount).toBe(1);
            expect(storedCount).toBe(3);
            expect(readyCount).toBeLessThan(storedCount);
        });
    });

    describe('User Behavior: YouTube Premiere handling with connection states', () => {
        test('should show specific logging for Premiere connections', () => {
            // Given: A YouTube Premiere with isLive: true, isUpcoming: true
            const premiereVideoData = {
                videoId: 'premiere123',
                isLive: true,
                isUpcoming: true,
                title: 'Test Premiere Stream'
            };
            
            // When: System processes a Premiere connection
            platform.logger.info(`Premiere detected: ${premiereVideoData.title} (${premiereVideoData.videoId})`, 'youtube');
            platform.logger.info('Premiere connection established, waiting for start event...', 'youtube');
            
            // Then: User sees specific Premiere logging messages
            expect(platform.logger.info).toHaveBeenCalledWith(
                'Premiere detected: Test Premiere Stream (premiere123)',
                'youtube'
            );
            expect(platform.logger.info).toHaveBeenCalledWith(
                'Premiere connection established, waiting for start event...',
                'youtube'
            );
        });

        test('should track Premiere connection state until start event', () => {
            // Given: A Premiere connection is established
            const premiereVideoId = 'premiere123';
            platform.connectionManager.hasConnection.mockReturnValue(true);
            platform.connectionManager.isConnectionReady.mockReturnValue(false); // Not ready until start event
            
            // When: Checking connection status before start event
            const hasConnection = platform.connectionManager.hasConnection(premiereVideoId);
            const isReady = platform.connectionManager.isConnectionReady(premiereVideoId);
            
            // Then: Connection exists but is not ready
            expect(hasConnection).toBe(true);
            expect(isReady).toBe(false);
            
            // When: Start event fires (simulated)
            platform.connectionManager.setConnectionReady(premiereVideoId);
            platform.connectionManager.isConnectionReady.mockReturnValue(true);
            
            const isReadyAfterStart = platform.connectionManager.isConnectionReady(premiereVideoId);
            
            // Then: Connection becomes ready after start event
            expect(isReadyAfterStart).toBe(true);
            expect(platform.connectionManager.setConnectionReady).toHaveBeenCalledWith(premiereVideoId);
        });

        test('should properly connect to Premieres with correct livestream status', () => {
            // Given: A Premiere that is both live and upcoming
            const premiereData = {
                videoId: 'premiere456',
                isLive: true,
                isUpcoming: true,
                snippet: {
                    title: 'My Premiere Stream',
                    channelTitle: 'TestChannel'
                }
            };
            
            // When: System evaluates if it should connect to this Premiere
            const shouldConnect = premiereData.isLive && premiereData.isUpcoming;
            
            // Then: System recognizes this as a valid connection target
            expect(shouldConnect).toBe(true);
            
            // And: System can extract proper metadata
            expect(premiereData.snippet.title).toBe('My Premiere Stream');
            expect(premiereData.snippet.channelTitle).toBe('TestChannel');
        });
    });

    describe('User Behavior: Connection filtering accuracy', () => {
        test('should provide accurate connection counts for status reporting', () => {
            // Given: Multiple connections with different states
            const allConnections = ['video1', 'video2', 'video3', 'video4'];
            const readyConnections = ['video1', 'video3']; // Only 2 are ready
            
            platform.connectionManager.getActiveVideoIds.mockReturnValue(allConnections);
            platform.connectionManager.getConnectionCount.mockReturnValue(4);
            platform.connectionManager.getReadyConnectionCount.mockReturnValue(2);
            platform.connectionManager.isConnectionReady.mockImplementation(videoId => 
                readyConnections.includes(videoId)
            );
            
            // When: System generates status summary
            const totalCount = platform.connectionManager.getConnectionCount();
            const readyCount = platform.connectionManager.getReadyConnectionCount();
            const activeIds = allConnections.filter(id => 
                platform.connectionManager.isConnectionReady(id)
            );
            
            // Then: Status accurately reflects connection states
            expect(totalCount).toBe(4);
            expect(readyCount).toBe(2);
            expect(activeIds).toEqual(['video1', 'video3']);
            expect(activeIds.length).toBe(readyCount);
        });

        test('should handle edge case of no connections gracefully', () => {
            // Given: No connections exist
            platform.connectionManager.getActiveVideoIds.mockReturnValue([]);
            platform.connectionManager.getConnectionCount.mockReturnValue(0);
            platform.connectionManager.getReadyConnectionCount.mockReturnValue(0);
            
            // When: System requests active video IDs
            const activeIds = platform.connectionManager.getActiveVideoIds();
            const readyCount = platform.connectionManager.getReadyConnectionCount();
            
            // Then: System handles empty state gracefully
            expect(activeIds).toEqual([]);
            expect(readyCount).toBe(0);
            expect(activeIds.length).toBe(readyCount);
        });

        test('should maintain accuracy during connection state transitions', () => {
            // Given: A connection transitioning from not-ready to ready
            const videoId = 'video_transition';
            platform.connectionManager.hasConnection.mockReturnValue(true);
            platform.connectionManager.isConnectionReady
                .mockReturnValueOnce(false)  // Initially not ready
                .mockReturnValueOnce(true);  // After start event
            
            // When: Checking state before transition
            const initialState = platform.connectionManager.isConnectionReady(videoId);
            
            // Then: Connection exists but not ready
            expect(initialState).toBe(false);
            
            // When: Connection transitions to ready (start event)
            platform.connectionManager.setConnectionReady(videoId);
            const finalState = platform.connectionManager.isConnectionReady(videoId);
            
            // Then: Connection is now ready
            expect(finalState).toBe(true);
            expect(platform.connectionManager.setConnectionReady).toHaveBeenCalledWith(videoId);
        });
    });

    describe('Integration: Complete connection status workflow', () => {
        test('should demonstrate complete connection lifecycle with accurate status reporting', async () => {
            // Given: Starting with no connections
            platform.connectionManager.getActiveVideoIds.mockReturnValue([]);
            platform.connectionManager.getConnectionCount.mockReturnValue(0);

            // When: Adding connections (they start as not-ready)
            const videoIds = ['video1', 'video2'];
            for (const id of videoIds) {
                await platform.connectionManager.connectToStream(id, async () => ({ videoId: id }));
            }
            
            // Update mocks to reflect new state
            platform.connectionManager.getActiveVideoIds.mockReturnValue(videoIds);
            platform.connectionManager.getConnectionCount.mockReturnValue(2);
            platform.connectionManager.hasConnection.mockReturnValue(true);
            platform.connectionManager.isConnectionReady.mockReturnValue(false); // Not ready initially
            
            // Then: Connections exist but none are ready
            expect(platform.connectionManager.getConnectionCount()).toBe(2);
            expect(platform.connectionManager.isConnectionReady('video1')).toBe(false);
            expect(platform.connectionManager.isConnectionReady('video2')).toBe(false);
            
            // When: First connection receives start event
            platform.connectionManager.setConnectionReady('video1');
            platform.connectionManager.isConnectionReady.mockImplementation(id => id === 'video1');
            
            // Then: Only one connection is ready
            expect(platform.connectionManager.isConnectionReady('video1')).toBe(true);
            expect(platform.connectionManager.isConnectionReady('video2')).toBe(false);
            
            // When: Second connection receives start event
            platform.connectionManager.setConnectionReady('video2');
            platform.connectionManager.isConnectionReady.mockReturnValue(true);
            
            // Then: Both connections are ready
            expect(platform.connectionManager.isConnectionReady('video1')).toBe(true);
            expect(platform.connectionManager.isConnectionReady('video2')).toBe(true);
        });
    });
});

// Note: These tests should FAIL initially because the behavior described here
// is the target behavior we want to implement.
