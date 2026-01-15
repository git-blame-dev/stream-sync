const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

describe('safeOBSOperation error handling', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        restoreAllMocks();
process.env.NODE_ENV = originalEnv;
    
        restoreAllModuleMocks();});

    it('routes operation failures through createPlatformErrorHandler and rethrows', async () => {
        process.env.NODE_ENV = 'test';

        const errorHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };

        mockModule('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: createMockFn(() => errorHandler)
        }));

        const obsManager = {
            isReady: createMockFn().mockResolvedValue(true)
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
            isReady: createMockFn().mockResolvedValue(false)
        };

        const operation = createMockFn();
        const { safeOBSOperation } = require('../../../src/obs/safe-operations');

        const result = await safeOBSOperation(obsManager, operation, 'Not ready test');

        expect(result).toBeNull();
        expect(operation).not.toHaveBeenCalled();
    });
});
