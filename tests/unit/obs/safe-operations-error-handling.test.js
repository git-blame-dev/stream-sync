describe('safeOBSOperation error handling', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = originalEnv;
    });

    it('routes operation failures through createPlatformErrorHandler and rethrows', async () => {
        process.env.NODE_ENV = 'test';

        const errorHandler = {
            handleEventProcessingError: jest.fn(),
            logOperationalError: jest.fn()
        };

        jest.doMock('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: jest.fn(() => errorHandler)
        }));

        jest.doMock('../../../src/core/logging', () => ({
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn()
            }
        }));

        const obsManager = {
            isReady: jest.fn().mockResolvedValue(true)
        };

        const { safeOBSOperation } = require('../../../src/obs/safe-operations');

        await expect(
            safeOBSOperation(obsManager, () => { throw new Error('obs op fail'); }, 'Test Operation')
        ).rejects.toThrow('obs op fail');

        expect(errorHandler.handleEventProcessingError).toHaveBeenCalledTimes(1);
        const [error, eventType, payload, message, context] = errorHandler.handleEventProcessingError.mock.calls[0];
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('obs op fail');
        expect(eventType).toBe('obs-operation');
        expect(payload).toEqual({ context: 'Test Operation' });
        expect(message).toContain('Test Operation');
        expect(context).toBe('obs-safety');
    });

    it('skips operation entirely when OBS is not ready', async () => {
        const obsManager = {
            isReady: jest.fn().mockResolvedValue(false)
        };

        const operation = jest.fn();
        const { safeOBSOperation } = require('../../../src/obs/safe-operations');

        const result = await safeOBSOperation(obsManager, operation, 'Not ready test');

        expect(result).toBeNull();
        expect(operation).not.toHaveBeenCalled();
    });
});
