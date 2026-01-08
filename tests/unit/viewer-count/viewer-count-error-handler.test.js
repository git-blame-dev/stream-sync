describe('ViewerCountSystem observer error handling', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = originalEnv;
    });

    function createSystemWithFailingObserver(handlerMock) {
        process.env.NODE_ENV = 'test';

        jest.doMock('../../../src/core/config', () => ({
            configManager: {
                getNumber: jest.fn().mockReturnValue(15)
            }
        }));

        jest.doMock('../../../src/utils/timeout-validator', () => ({
            safeSetInterval: jest.fn(),
            safeDelay: jest.fn()
        }));

        jest.doMock('../../../src/core/logging', () => ({
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn()
            }
        }));

        jest.doMock('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: jest.fn(() => handlerMock)
        }));

        const platform = { getViewerCount: jest.fn().mockResolvedValue(5) };
        const { ViewerCountSystem } = require('../../../src/utils/viewer-count');
        const system = new ViewerCountSystem({ platforms: { youtube: platform } });

        system.streamStatus.youtube = true;

        system.addObserver({
            getObserverId: () => 'bad-observer',
            onViewerCountUpdate: () => { throw new Error('observer boom'); }
        });

        return { system, platform };
    }

    it('routes observer failures through platform error handler without crashing polling', async () => {
        const handlerMock = {
            handleEventProcessingError: jest.fn(),
            logOperationalError: jest.fn()
        };
        const { system, platform } = createSystemWithFailingObserver(handlerMock);

        await expect(system.pollPlatform('youtube')).resolves.toBeUndefined();

        expect(platform.getViewerCount).toHaveBeenCalledTimes(1);
        expect(handlerMock.handleEventProcessingError).toHaveBeenCalledTimes(1);
        const [error, eventType] = handlerMock.handleEventProcessingError.mock.calls[0];
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('observer boom');
        expect(eventType).toBe('observer-update');
    });
});
