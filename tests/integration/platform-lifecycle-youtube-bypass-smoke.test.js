
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');

describe('PlatformLifecycleService stream detection routing (smoke)', () => {
    it('initializes YouTube directly and routes other platforms through StreamDetector', async () => {
        const streamDetector = {
            startStreamDetection: jest.fn().mockImplementation(async (_platform, _config, connect) => {
                await connect();
            })
        };

        const lifecycle = new PlatformLifecycleService({
            config: {
                youtube: { enabled: true, username: 'channel' },
                custom: { enabled: true }
            },
            streamDetector
        });

        const youtubeInit = jest.fn().mockResolvedValue(true);
        const customInit = jest.fn().mockResolvedValue(true);

        const youtubePlatform = jest.fn().mockImplementation(() => ({
            initialize: youtubeInit,
            cleanup: jest.fn().mockResolvedValue(),
            on: jest.fn()
        }));
        const customPlatform = jest.fn().mockImplementation(() => ({
            initialize: customInit,
            cleanup: jest.fn().mockResolvedValue(),
            on: jest.fn()
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
