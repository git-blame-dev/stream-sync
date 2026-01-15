
const { describe, test, expect, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { unmockModule, requireActual, resetModules, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

unmockModule('../../src/platforms/youtube');
const { YouTubePlatform } = requireActual('../../src/platforms/youtube');
const { createMockNotificationManager } = require('../helpers/mock-factories');

const createPlatform = (provider = null, logger = null) => {
    const notificationManager = createMockNotificationManager();
    const platform = new YouTubePlatform(
        {
            youtube: { viewerCountMethod: 'youtubei' },
            enabled: true,
            channel: 'test-channel'
        },
        {
            logger: logger || { debug: createMockFn(), warn: createMockFn(), error: createMockFn(), info: createMockFn() },
            notificationManager,
            streamDetectionService: {
                detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
            }
        }
    );
    platform.viewerCountProvider = provider;
    return platform;
};

describe('YouTubePlatform viewer count behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    it('returns provider value for a specific video', async () => {
        const provider = {
            getViewerCountForVideo: createMockFn().mockResolvedValue(321)
        };
        const platform = createPlatform(provider);

        const result = await platform.getViewerCountForVideo('video-123');

        expect(result).toBe(321);
        expect(provider.getViewerCountForVideo).toHaveBeenCalledWith('video-123');
    });

    it('returns 0 when no provider is configured', async () => {
        const platform = createPlatform(null);

        const result = await platform.getViewerCountForVideo('video-123');

        expect(result).toBe(0);
    });

    it('returns 0 when provider does not support per-video lookup', async () => {
        const provider = {};
        const platform = createPlatform(provider);

        const result = await platform.getViewerCountForVideo('video-123');

        expect(result).toBe(0);
    });

    it('returns 0 when provider throws', async () => {
        const provider = {
            getViewerCountForVideo: createMockFn().mockRejectedValue(new Error('network'))
        };
        const platform = createPlatform(provider, {
            debug: createMockFn(),
            warn: createMockFn(),
            error: createMockFn(),
            info: createMockFn()
        });

        const result = await platform.getViewerCountForVideo('video-123');

        expect(result).toBe(0);
    });
});
