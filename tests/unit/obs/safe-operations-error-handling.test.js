const { describe, expect, it, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { safeOBSOperation } = require('../../../src/obs/safe-operations');

describe('safeOBSOperation error handling', () => {
    let originalNodeEnv;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        restoreAllMocks();
    });

    it('rethrows operation errors', async () => {
        const obsManager = {
            isReady: createMockFn().mockResolvedValue(true)
        };

        await expect(
            safeOBSOperation(obsManager, () => { throw new Error('testOperationFailed'); }, 'Test Operation')
        ).rejects.toThrow('testOperationFailed');
    });

    it('returns null when OBS is not ready', async () => {
        const obsManager = {
            isReady: createMockFn().mockResolvedValue(false)
        };

        const operation = createMockFn();
        const result = await safeOBSOperation(obsManager, operation, 'Not ready test');

        expect(result).toBeNull();
        expect(operation).not.toHaveBeenCalled();
    });

    it('returns operation result when successful', async () => {
        const obsManager = {
            isReady: createMockFn().mockResolvedValue(true)
        };

        const operation = createMockFn().mockResolvedValue({ success: true, data: 'testData' });
        const result = await safeOBSOperation(obsManager, operation, 'Success test');

        expect(result).toEqual({ success: true, data: 'testData' });
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('executes operation when OBS is ready', async () => {
        const obsManager = {
            isReady: createMockFn().mockResolvedValue(true)
        };

        const operation = createMockFn().mockResolvedValue('completed');
        await safeOBSOperation(obsManager, operation, 'Execute test');

        expect(obsManager.isReady).toHaveBeenCalledTimes(1);
        expect(operation).toHaveBeenCalledTimes(1);
    });
});
