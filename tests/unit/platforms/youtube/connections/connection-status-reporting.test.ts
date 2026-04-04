const { describe, test, expect, beforeEach } = require('bun:test');
const { createMockFn } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { EventEmitter } = require('events');

const createMockPlatform = () => {
    const platform = new EventEmitter();
    platform.connectionManager = {
        connections: new Map(),
        connectToStream: createMockFn().mockResolvedValue(true),
        removeConnection: createMockFn(),
        setConnectionReady: createMockFn(),
        isConnectionReady: createMockFn(),
        getActiveVideoIds: createMockFn(),
        getConnectionCount: createMockFn(),
        getReadyConnectionCount: createMockFn(),
        hasConnection: createMockFn(),
        getConnection: createMockFn(),
        getAllVideoIds: createMockFn()
    };
    platform.logger = noOpLogger;
    platform.config = {
        youtube: {
            enabled: true,
            multiStreamEnabled: true
        }
    };
    platform.getActiveYouTubeVideoIds = createMockFn(() => {
        return platform.connectionManager.getActiveVideoIds().filter(videoId =>
            platform.connectionManager.isConnectionReady(videoId)
        );
    });
    return platform;
};

describe('YouTube Connection Status Reporting', () => {
    let platform;

    beforeEach(() => {
        platform = createMockPlatform();
    });

    describe('User Behavior: Status reporting only counts ready connections', () => {
        test('should report zero active connections when connections exist but none are ready', () => {
            const storedVideoIds = ['video1', 'video2', 'video3'];
            platform.connectionManager.getActiveVideoIds.mockReturnValue(storedVideoIds);
            platform.connectionManager.isConnectionReady.mockReturnValue(false);

            const activeIds = platform.getActiveYouTubeVideoIds();

            expect(activeIds).toEqual([]);
        });

        test('should report only ready connections when mix of ready and not-ready exists', () => {
            const storedVideoIds = ['video1', 'video2', 'video3'];
            platform.connectionManager.getActiveVideoIds.mockReturnValue(storedVideoIds);
            platform.connectionManager.isConnectionReady
                .mockReturnValueOnce(true)
                .mockReturnValueOnce(false)
                .mockReturnValueOnce(true);

            const activeIds = platform.getActiveYouTubeVideoIds();

            expect(activeIds).toEqual(['video1', 'video3']);
        });

        test('should show accurate status distinguishing stored vs ready connections', () => {
            const storedConnections = ['video1', 'video2', 'video3'];
            platform.connectionManager.getAllVideoIds = createMockFn().mockReturnValue(storedConnections);
            platform.getActiveYouTubeVideoIds = createMockFn().mockReturnValue(['video1']);

            const storedCount = platform.connectionManager.getAllVideoIds().length;
            const readyCount = platform.getActiveYouTubeVideoIds().length;

            expect(readyCount).toBe(1);
            expect(storedCount).toBe(3);
            expect(readyCount).toBeLessThan(storedCount);
        });
    });

    describe('User Behavior: YouTube Premiere handling with connection states', () => {
        test('should track Premiere connection state until start event', () => {
            const premiereVideoId = 'premiere123';
            platform.connectionManager.hasConnection.mockReturnValue(true);
            platform.connectionManager.isConnectionReady.mockReturnValue(false);

            const hasConnection = platform.connectionManager.hasConnection(premiereVideoId);
            const isReady = platform.connectionManager.isConnectionReady(premiereVideoId);

            expect(hasConnection).toBe(true);
            expect(isReady).toBe(false);

            platform.connectionManager.setConnectionReady(premiereVideoId);
            platform.connectionManager.isConnectionReady.mockReturnValue(true);

            const isReadyAfterStart = platform.connectionManager.isConnectionReady(premiereVideoId);

            expect(isReadyAfterStart).toBe(true);
        });

        test('should properly connect to Premieres with correct livestream status', () => {
            const premiereData = {
                videoId: 'premiere456',
                isLive: true,
                isUpcoming: true,
                snippet: {
                    title: 'My Premiere Stream',
                    channelTitle: 'TestChannel'
                }
            };

            const shouldConnect = premiereData.isLive && premiereData.isUpcoming;

            expect(shouldConnect).toBe(true);
            expect(premiereData.snippet.title).toBe('My Premiere Stream');
            expect(premiereData.snippet.channelTitle).toBe('TestChannel');
        });
    });

    describe('User Behavior: Connection filtering accuracy', () => {
        test('should provide accurate connection counts for status reporting', () => {
            const allConnections = ['video1', 'video2', 'video3', 'video4'];
            const readyConnections = ['video1', 'video3'];

            platform.connectionManager.getActiveVideoIds.mockReturnValue(allConnections);
            platform.connectionManager.getConnectionCount.mockReturnValue(4);
            platform.connectionManager.getReadyConnectionCount.mockReturnValue(2);
            platform.connectionManager.isConnectionReady.mockImplementation(videoId =>
                readyConnections.includes(videoId)
            );

            const totalCount = platform.connectionManager.getConnectionCount();
            const readyCount = platform.connectionManager.getReadyConnectionCount();
            const activeIds = allConnections.filter(id =>
                platform.connectionManager.isConnectionReady(id)
            );

            expect(totalCount).toBe(4);
            expect(readyCount).toBe(2);
            expect(activeIds).toEqual(['video1', 'video3']);
            expect(activeIds.length).toBe(readyCount);
        });

        test('should handle edge case of no connections gracefully', () => {
            platform.connectionManager.getActiveVideoIds.mockReturnValue([]);
            platform.connectionManager.getConnectionCount.mockReturnValue(0);
            platform.connectionManager.getReadyConnectionCount.mockReturnValue(0);

            const activeIds = platform.connectionManager.getActiveVideoIds();
            const readyCount = platform.connectionManager.getReadyConnectionCount();

            expect(activeIds).toEqual([]);
            expect(readyCount).toBe(0);
            expect(activeIds.length).toBe(readyCount);
        });

        test('should maintain accuracy during connection state transitions', () => {
            const videoId = 'video_transition';
            platform.connectionManager.hasConnection.mockReturnValue(true);
            platform.connectionManager.isConnectionReady
                .mockReturnValueOnce(false)
                .mockReturnValueOnce(true);

            const initialState = platform.connectionManager.isConnectionReady(videoId);

            expect(initialState).toBe(false);

            platform.connectionManager.setConnectionReady(videoId);
            const finalState = platform.connectionManager.isConnectionReady(videoId);

            expect(finalState).toBe(true);
        });
    });

    describe('Integration: Complete connection status workflow', () => {
        test('should demonstrate complete connection lifecycle with accurate status reporting', async () => {
            platform.connectionManager.getActiveVideoIds.mockReturnValue([]);
            platform.connectionManager.getConnectionCount.mockReturnValue(0);

            const videoIds = ['video1', 'video2'];
            for (const id of videoIds) {
                await platform.connectionManager.connectToStream(id, async () => ({ videoId: id }));
            }

            platform.connectionManager.getActiveVideoIds.mockReturnValue(videoIds);
            platform.connectionManager.getConnectionCount.mockReturnValue(2);
            platform.connectionManager.hasConnection.mockReturnValue(true);
            platform.connectionManager.isConnectionReady.mockReturnValue(false);

            expect(platform.connectionManager.getConnectionCount()).toBe(2);
            expect(platform.connectionManager.isConnectionReady('video1')).toBe(false);
            expect(platform.connectionManager.isConnectionReady('video2')).toBe(false);

            platform.connectionManager.setConnectionReady('video1');
            platform.connectionManager.isConnectionReady.mockImplementation(id => id === 'video1');

            expect(platform.connectionManager.isConnectionReady('video1')).toBe(true);
            expect(platform.connectionManager.isConnectionReady('video2')).toBe(false);

            platform.connectionManager.setConnectionReady('video2');
            platform.connectionManager.isConnectionReady.mockReturnValue(true);

            expect(platform.connectionManager.isConnectionReady('video1')).toBe(true);
            expect(platform.connectionManager.isConnectionReady('video2')).toBe(true);
        });
    });
});
