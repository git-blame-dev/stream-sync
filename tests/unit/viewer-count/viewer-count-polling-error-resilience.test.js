
const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const originalEnv = process.env.NODE_ENV;

describe('ViewerCountSystem polling resilience', () => {
    afterEach(() => {
        restoreAllMocks();
process.env.NODE_ENV = originalEnv;
    
        restoreAllModuleMocks();});

    function createSystem({ platformReady = true } = {}) {
        process.env.NODE_ENV = 'test';
        mockModule('../../../src/core/config', () => ({
            configManager: {
                getNumber: createMockFn().mockReturnValue(15)
            }
        }));
        mockModule('../../../src/utils/timeout-validator', () => ({
            safeSetInterval: createMockFn((fn) => { fn(); return 1; }),
            safeDelay: createMockFn()
        }));
        mockModule('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: createMockFn(() => ({
                handleEventProcessingError: createMockFn(),
                logOperationalError: createMockFn()
            }))
        }));
        const platform = {
            isReady: createMockFn().mockReturnValue(platformReady),
            getViewerCount: createMockFn().mockRejectedValue(new Error('fetch failed'))
        };
        mockModule('../../../src/utils/viewer-count-providers', () => ({
            TwitchViewerCountProvider: createMockFn(() => platform),
            YouTubeViewerCountProvider: createMockFn(() => platform),
            TikTokViewerCountProvider: createMockFn(() => platform)
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
