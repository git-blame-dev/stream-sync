
describe('ViewerCountSystem cleanup resilience', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = originalEnv;
    });

    function createSystem({ cleanupImpl, safeDelayImpl }) {
        process.env.NODE_ENV = 'test';

        const handlerMock = {
            handleEventProcessingError: jest.fn(),
            logOperationalError: jest.fn()
        };

        const logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        jest.doMock('../../../src/core/config', () => ({
            configManager: {
                getNumber: jest.fn().mockReturnValue(15)
            }
        }));

        jest.doMock('../../../src/utils/timeout-validator', () => ({
            safeSetInterval: jest.fn(),
            safeDelay: safeDelayImpl || jest.fn().mockResolvedValue()
        }));

        jest.doMock('../../../src/core/logging', () => ({
            logger
        }));

        jest.doMock('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: jest.fn(() => handlerMock)
        }));

        const platform = { getViewerCount: jest.fn().mockResolvedValue(5) };
        const { ViewerCountSystem } = require('../../../src/utils/viewer-count');
        const system = new ViewerCountSystem({ platforms: { youtube: platform }, logger });
        system.streamStatus.youtube = true;

        system.addObserver({
            getObserverId: () => 'obs-1',
            cleanup: cleanupImpl || jest.fn().mockRejectedValue(new Error('cleanup fail'))
        });

        return { system, handlerMock, logger };
    }

    it('routes observer cleanup failures through error handler and completes', async () => {
        const { system, handlerMock, logger } = createSystem({});

        await expect(system.cleanup()).resolves.toBeUndefined();

        expect(handlerMock.handleEventProcessingError).toHaveBeenCalledWith(
            expect.any(Error),
            'observer-cleanup',
            expect.objectContaining({ observerId: 'obs-1' }),
            expect.stringContaining('Observer cleanup failed'),
            expect.any(String)
        );
    });

    it('warns and returns when observer cleanup hangs past timeout', async () => {
        const hangingCleanup = jest.fn(() => new Promise(() => {}));
        const { system, handlerMock, logger } = createSystem({
            cleanupImpl: hangingCleanup,
            safeDelayImpl: jest.fn().mockRejectedValue(new Error('timeout'))
        });

        await expect(system.cleanup()).resolves.toBeUndefined();

        expect(handlerMock.handleEventProcessingError).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Observer cleanup timed out or failed'),
            expect.any(String)
        );
    });
});
