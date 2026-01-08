
const originalEnv = process.env.NODE_ENV;

describe('ViewerCountSystem polling resilience', () => {
    afterEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = originalEnv;
    });

    function createSystem({ platformReady = true } = {}) {
        process.env.NODE_ENV = 'test';
        jest.doMock('../../../src/core/config', () => ({
            configManager: {
                getNumber: jest.fn().mockReturnValue(15)
            }
        }));
        jest.doMock('../../../src/utils/timeout-validator', () => ({
            safeSetInterval: jest.fn((fn) => { fn(); return 1; }),
            safeDelay: jest.fn()
        }));
        jest.doMock('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: jest.fn(() => ({
                handleEventProcessingError: jest.fn(),
                logOperationalError: jest.fn()
            }))
        }));
        const platform = {
            isReady: jest.fn().mockReturnValue(platformReady),
            getViewerCount: jest.fn().mockRejectedValue(new Error('fetch failed'))
        };
        jest.doMock('../../../src/utils/viewer-count-providers', () => ({
            TwitchViewerCountProvider: jest.fn(() => platform),
            YouTubeViewerCountProvider: jest.fn(() => platform),
            TikTokViewerCountProvider: jest.fn(() => platform)
        }));

        const { ViewerCountSystem } = require('../../../src/utils/viewer-count');
        const system = new ViewerCountSystem({ platforms: { twitch: platform } });
        // default streamStatus.twitch is true; allow caller to set offline state
        if (!platformReady) {
            system.streamStatus.twitch = false;
        }
        return { system, platform };
    }

    it('skips polling when stream is offline', async () => {
        const { system, platform } = createSystem({ platformReady: false });

        await system.pollPlatform('twitch');

        expect(platform.getViewerCount).not.toHaveBeenCalled();
    });

    it('continues polling cycle when provider throws', async () => {
        const { system, platform } = createSystem({ platformReady: true });

        await system.pollPlatform('twitch');

        expect(platform.getViewerCount).toHaveBeenCalled();
        expect(system.counts.twitch).toBe(0);
    });
});
