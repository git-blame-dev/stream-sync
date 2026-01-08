
jest.unmock('../../src/platforms/youtube');

jest.resetModules();
const { YouTubePlatform } = jest.requireActual('../../src/platforms/youtube');
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
            logger: logger || { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
            notificationManager,
            streamDetectionService: {
                detectLiveStreams: jest.fn().mockResolvedValue({ success: true, videoIds: [] })
            }
        }
    );
    platform.viewerCountProvider = provider;
    return platform;
};

describe('YouTubePlatform viewer count behavior', () => {
    it('returns provider value for a specific video', async () => {
        const provider = {
            getViewerCountForVideo: jest.fn().mockResolvedValue(321)
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
            getViewerCountForVideo: jest.fn().mockRejectedValue(new Error('network'))
        };
        const platform = createPlatform(provider, {
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            info: jest.fn()
        });

        const result = await platform.getViewerCountForVideo('video-123');

        expect(result).toBe(0);
    });
});
