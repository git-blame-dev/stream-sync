const { createYouTubeMultiStreamManager } = require('../../../src/platforms/youtube/streams/youtube-multistream-manager');

describe('YouTube multi-stream manager', () => {
    const buildPlatform = (overrides = {}) => {
        const platform = {
            config: {
                maxStreams: 0,
                streamPollingInterval: 60,
                fullCheckInterval: 1000
            },
            connectionManager: {
                getConnectionCount: jest.fn(() => 0),
                getAllVideoIds: jest.fn(() => []),
                hasConnection: jest.fn(() => false)
            },
            getActiveYouTubeVideoIds: jest.fn(() => []),
            getLiveVideoIds: jest.fn(async () => []),
            connectToYouTubeStream: jest.fn().mockResolvedValue(),
            disconnectFromYouTubeStream: jest.fn().mockResolvedValue(),
            checkStreamShortageAndWarn: jest.fn(),
            _logMultiStreamStatus: jest.fn(),
            _handleProcessingError: jest.fn(),
            _handleError: jest.fn(),
            logger: {
                info: jest.fn(),
                debug: jest.fn(),
                warn: jest.fn()
            },
            _emitPlatformEvent: jest.fn(),
            ...overrides
        };

        return platform;
    };

    const buildManager = (platform, now = () => 100) => createYouTubeMultiStreamManager({
        platform,
        safeSetInterval: jest.fn(),
        validateTimeout: (value) => value,
        now
    });

    test('emits stream-detected platform:event when new streams appear', async () => {
        const emitted = [];
        const platform = buildPlatform({
            getLiveVideoIds: jest.fn(async () => ['stream-1']),
            _emitPlatformEvent: (type, payload) => emitted.push({ type, payload })
        });
        const manager = buildManager(platform, () => 123);

        await manager.checkMultiStream();

        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toMatchObject({
            type: 'platform:stream-detected',
            payload: expect.objectContaining({
                eventType: 'stream-detected',
                newStreamIds: ['stream-1'],
                allStreamIds: ['stream-1'],
                detectionTime: 123
            })
        });
    });

    test('does not emit stream-detected when no new streams are found', async () => {
        const emitted = [];
        const platform = buildPlatform({
            getLiveVideoIds: jest.fn(async () => []),
            _emitPlatformEvent: (type, payload) => emitted.push({ type, payload })
        });
        const manager = buildManager(platform);

        await manager.checkMultiStream();

        expect(emitted).toEqual([]);
    });
});
