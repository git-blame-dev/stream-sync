const { describe, it, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');

describe('PlatformLifecycleService connection routing (smoke)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('initializes enabled platforms directly without StreamDetector', async () => {
        const lifecycle = new PlatformLifecycleService({
            config: {
                youtube: { enabled: true, username: 'channel' },
                twitch: { enabled: true },
                custom: { enabled: true }
            },
            logger: noOpLogger
        });

        const youtubeInit = createMockFn().mockResolvedValue(true);
        const twitchInit = createMockFn().mockResolvedValue(true);
        const customInit = createMockFn().mockResolvedValue(true);

        const youtubePlatform = createMockFn().mockImplementation(() => ({
            initialize: youtubeInit,
            cleanup: createMockFn().mockResolvedValue(),
            on: createMockFn()
        }));
        const twitchPlatform = createMockFn().mockImplementation(() => ({
            initialize: twitchInit,
            cleanup: createMockFn().mockResolvedValue(),
            on: createMockFn()
        }));
        const customPlatform = createMockFn().mockImplementation(() => ({
            initialize: customInit,
            cleanup: createMockFn().mockResolvedValue(),
            on: createMockFn()
        }));

        await lifecycle.initializeAllPlatforms({
            youtube: youtubePlatform,
            twitch: twitchPlatform,
            custom: customPlatform
        });

        const status = lifecycle.getStatus();
        expect(status.initializedPlatforms).toEqual(
            expect.arrayContaining(['youtube', 'twitch', 'custom'])
        );
    });
});
