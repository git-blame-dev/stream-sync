const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { YouTubePlatform } = require('../../../../../src/platforms/youtube');

const createConnectionManager = (overrides = {}) => ({
    connections: new Map(),
    addConnection: createMockFn(),
    removeConnection: createMockFn(),
    setConnectionReady: createMockFn(),
    isConnectionReady: createMockFn().mockReturnValue(false),
    getActiveVideoIds: createMockFn().mockReturnValue([]),
    getAllVideoIds: createMockFn().mockReturnValue([]),
    getConnectionCount: createMockFn().mockReturnValue(0),
    getReadyConnectionCount: createMockFn().mockReturnValue(0),
    hasConnection: createMockFn(),
    getConnection: createMockFn(),
    getConnectionState: createMockFn(),
    ...overrides
});

const createPlatform = (configOverrides = {}, depsOverrides = {}) => {
    const config = {
        enabled: true,
        username: 'testchannel',
        channelId: 'UC-test-channel-id',
        multiStreamEnabled: true,
        ...configOverrides
    };
    const platform = new YouTubePlatform(config, {
        logger: noOpLogger,
        streamDetectionService: { detectLiveStreams: createMockFn().mockResolvedValue([]) },
        notificationDispatcher: { dispatch: createMockFn() },
        ChatFileLoggingService: class { logRawPlatformData() {} },
        ...depsOverrides
    });
    return platform;
};

describe('YouTube Connection Filtering Accuracy', () => {
    let youtubePlatform;

    afterEach(() => {
        if (youtubePlatform?.cleanup) {
            youtubePlatform.cleanup().catch(() => {});
        }
    });

    describe('getActiveYouTubeVideoIds filtering accuracy', () => {
        test('returns only ready connections, not all stored connections', () => {
            youtubePlatform = createPlatform();
            const storedVideoIds = ['testvideo1', 'testvideo2', 'testvideo3', 'testvideo4'];
            const readyVideoIds = ['testvideo1', 'testvideo3'];

            const mockConnectionManager = createConnectionManager({
                getActiveVideoIds: createMockFn().mockReturnValue(storedVideoIds),
                isConnectionReady: createMockFn().mockImplementation((videoId) => readyVideoIds.includes(videoId)),
                getConnectionCount: createMockFn().mockReturnValue(4),
                getReadyConnectionCount: createMockFn().mockReturnValue(2)
            });
            youtubePlatform.connectionManager = mockConnectionManager;

            const activeIds = youtubePlatform.getActiveYouTubeVideoIds();

            expect(activeIds).toEqual(readyVideoIds);
            expect(activeIds.length).toBe(2);
        });

        test('returns empty array when no connections are ready', () => {
            youtubePlatform = createPlatform();
            const storedVideoIds = ['testvideo1', 'testvideo2', 'testvideo3'];

            const mockConnectionManager = createConnectionManager({
                getActiveVideoIds: createMockFn().mockReturnValue(storedVideoIds),
                isConnectionReady: createMockFn().mockReturnValue(false),
                getConnectionCount: createMockFn().mockReturnValue(3),
                getReadyConnectionCount: createMockFn().mockReturnValue(0)
            });
            youtubePlatform.connectionManager = mockConnectionManager;

            const activeIds = youtubePlatform.getActiveYouTubeVideoIds();

            expect(activeIds).toEqual([]);
            expect(activeIds.length).toBe(0);
        });

        test('handles connection state transitions accurately', () => {
            youtubePlatform = createPlatform();
            const videoId = 'test_transition_video';
            const storedIds = [videoId];

            const isReadyMock = createMockFn()
                .mockReturnValueOnce(false)
                .mockReturnValueOnce(true);

            const mockConnectionManager = createConnectionManager({
                getActiveVideoIds: createMockFn().mockReturnValue(storedIds),
                isConnectionReady: isReadyMock
            });
            youtubePlatform.connectionManager = mockConnectionManager;

            const activeIdsBefore = youtubePlatform.getActiveYouTubeVideoIds();
            expect(activeIdsBefore).toEqual([]);

            const activeIdsAfter = youtubePlatform.getActiveYouTubeVideoIds();
            expect(activeIdsAfter).toEqual([videoId]);
        });
    });

    describe('status reporting accuracy for user interface', () => {
        test('shows accurate multi-stream status with proper distinction', () => {
            youtubePlatform = createPlatform();
            const storedConnections = ['testpremiere1', 'testlive_stream1', 'testpremiere2', 'testlive_stream2'];
            const readyConnections = ['testlive_stream1', 'testlive_stream2'];

            const mockConnectionManager = createConnectionManager({
                getAllVideoIds: createMockFn().mockReturnValue(storedConnections),
                getActiveVideoIds: createMockFn().mockReturnValue(storedConnections),
                getConnectionCount: createMockFn().mockReturnValue(4),
                getReadyConnectionCount: createMockFn().mockReturnValue(2),
                isConnectionReady: createMockFn().mockImplementation((id) => readyConnections.includes(id))
            });
            youtubePlatform.connectionManager = mockConnectionManager;

            const activeIds = youtubePlatform.getActiveYouTubeVideoIds();
            const storedIds = youtubePlatform.connectionManager.getAllVideoIds();

            expect(activeIds).toEqual(readyConnections);
            expect(storedIds).toEqual(storedConnections);
            expect(activeIds.length).toBe(2);
            expect(storedIds.length).toBe(4);
        });

        test('provides accurate counts for user dashboard display', () => {
            youtubePlatform = createPlatform();
            const allStoredIds = ['testpremiere_waiting', 'testlive_active1', 'testlive_active2', 'testpremiere_scheduled'];
            const actualReadyIds = ['testlive_active1', 'testlive_active2'];

            const mockConnectionManager = createConnectionManager({
                getAllVideoIds: createMockFn().mockReturnValue(allStoredIds),
                getActiveVideoIds: createMockFn().mockReturnValue(allStoredIds),
                getConnectionCount: createMockFn().mockReturnValue(4),
                getReadyConnectionCount: createMockFn().mockReturnValue(2),
                isConnectionReady: createMockFn().mockImplementation((id) => actualReadyIds.includes(id))
            });
            youtubePlatform.connectionManager = mockConnectionManager;

            const storedCount = youtubePlatform.connectionManager.getConnectionCount();
            const readyCount = youtubePlatform.connectionManager.getReadyConnectionCount();
            const userVisibleActiveIds = youtubePlatform.getActiveYouTubeVideoIds();

            expect(storedCount).toBe(4);
            expect(readyCount).toBe(2);
            expect(userVisibleActiveIds.length).toBe(readyCount);
            expect(userVisibleActiveIds).toEqual(actualReadyIds);
        });
    });

    describe('connection filtering for operational decisions', () => {
        test('enables accurate operational decisions based on ready connections', () => {
            youtubePlatform = createPlatform();
            const storedStreams = ['teststream1', 'teststream2', 'teststream3'];
            const operationallyActiveStreams = ['teststream2'];

            const mockConnectionManager = createConnectionManager({
                getActiveVideoIds: createMockFn().mockReturnValue(storedStreams),
                isConnectionReady: createMockFn().mockImplementation((id) => operationallyActiveStreams.includes(id))
            });
            youtubePlatform.connectionManager = mockConnectionManager;

            const streamsForOperations = youtubePlatform.getActiveYouTubeVideoIds();

            expect(streamsForOperations).toEqual(operationallyActiveStreams);
            expect(streamsForOperations.length).toBe(1);

            const shouldAggregateViewers = streamsForOperations.length > 0;
            const shouldShowMultiStreamStatus = streamsForOperations.length > 1;

            expect(shouldAggregateViewers).toBe(true);
            expect(shouldShowMultiStreamStatus).toBe(false);
        });
    });

    describe('edge cases: connection filtering robustness', () => {
        test('handles undefined connection manager gracefully', () => {
            youtubePlatform = createPlatform();
            youtubePlatform.connectionManager = null;

            const activeIds = youtubePlatform.getActiveYouTubeVideoIds();

            expect(activeIds).toBeDefined();
            expect(Array.isArray(activeIds)).toBe(true);
            expect(activeIds).toEqual([]);
        });

        test('returns empty array when getActiveVideoIds returns empty array', () => {
            youtubePlatform = createPlatform();

            const mockConnectionManager = createConnectionManager({
                getActiveVideoIds: createMockFn().mockReturnValue([]),
                isConnectionReady: createMockFn().mockReturnValue(false)
            });
            youtubePlatform.connectionManager = mockConnectionManager;

            const activeIds = youtubePlatform.getActiveYouTubeVideoIds();
            expect(activeIds).toEqual([]);
        });
    });
});
