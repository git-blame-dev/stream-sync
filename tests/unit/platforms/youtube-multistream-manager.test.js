const { describe, test, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');

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
                getConnectionCount: createMockFn(() => 0),
                getAllVideoIds: createMockFn(() => []),
                hasConnection: createMockFn(() => false)
            },
            getActiveYouTubeVideoIds: createMockFn(() => []),
            getLiveVideoIds: createMockFn(async () => []),
            connectToYouTubeStream: createMockFn().mockResolvedValue(),
            disconnectFromYouTubeStream: createMockFn().mockResolvedValue(),
            checkStreamShortageAndWarn: createMockFn(),
            _logMultiStreamStatus: createMockFn(),
            _handleProcessingError: createMockFn(),
            _handleError: createMockFn(),
            logger: {
                info: createMockFn(),
                debug: createMockFn(),
                warn: createMockFn()
            },
            _emitPlatformEvent: createMockFn(),
            ...overrides
        };

        return platform;
    };

    const buildManager = (platform, now = () => 100) => createYouTubeMultiStreamManager({
        platform,
        safeSetInterval: createMockFn(),
        validateTimeout: (value) => value,
        now
    });

    test('emits stream-detected platform:event when new streams appear', async () => {
        const emitted = [];
        const platform = buildPlatform({
            getLiveVideoIds: createMockFn(async () => ['stream-1']),
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
            getLiveVideoIds: createMockFn(async () => []),
            _emitPlatformEvent: (type, payload) => emitted.push({ type, payload })
        });
        const manager = buildManager(platform);

        await manager.checkMultiStream();

        expect(emitted).toEqual([]);
    });
});
