const { describe, it, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');

describe('PlatformLifecycleService stream detection routing (smoke)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('initializes YouTube directly and routes other platforms through StreamDetector', async () => {
        const streamDetector = {
            startStreamDetection: createMockFn().mockImplementation(async (_platform, _config, connect) => {
                await connect();
            })
        };

        const lifecycle = new PlatformLifecycleService({
            config: {
                youtube: { enabled: true, username: 'channel' },
                custom: { enabled: true }
            },
            streamDetector,
            logger: noOpLogger
        });

        const youtubeInit = createMockFn().mockResolvedValue(true);
        const customInit = createMockFn().mockResolvedValue(true);

        const youtubePlatform = createMockFn().mockImplementation(() => ({
            initialize: youtubeInit,
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
            custom: customPlatform
        });

        expect(youtubeInit).toHaveBeenCalledTimes(1);
        expect(customInit).toHaveBeenCalledTimes(1);
        expect(streamDetector.startStreamDetection).toHaveBeenCalledTimes(1);

        const [platformArg, platformConfigArg, connectArg, statusArg] = streamDetector.startStreamDetection.mock.calls[0];
        expect(platformArg).toBe('custom');
        expect(platformConfigArg).toEqual(expect.objectContaining({ enabled: true }));
        expect(typeof connectArg).toBe('function');
        expect(typeof statusArg).toBe('function');
    });
});
