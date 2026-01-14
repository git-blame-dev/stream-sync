const { describe, it, expect, afterEach } = require('bun:test');
const { unmockModule, restoreAllModuleMocks, resetModules } = require('../../helpers/bun-module-mocks');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

// Use real implementation (jest.setup mocks the platform by default).
unmockModule('../../../src/platforms/streamelements');

afterEach(() => {
    restoreAllMocks();
    restoreAllModuleMocks();
    resetModules();
});

describe('StreamElementsPlatform connection error handling', () => {
    it('routes connection errors through error handler and retry handler', () => {
        const { StreamElementsPlatform } = require('../../../src/platforms/streamelements');

        const mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

        const platform = new StreamElementsPlatform({ enabled: true }, { logger: mockLogger });
        const errorHandler = { handleConnectionError: createMockFn() };
        platform.errorHandler = errorHandler;
        platform.retryHandleConnectionError = createMockFn();

        const error = new Error('connection lost');
        platform.handleConnectionError(error);

        expect(errorHandler.handleConnectionError).toHaveBeenCalledTimes(1);
        const [errorArg, category, message] = errorHandler.handleConnectionError.mock.calls[0];
        expect(errorArg).toBe(error);
        expect(category).toBe('connection');
        expect(message).toMatch(/connection lost/i);

        expect(platform.retryHandleConnectionError).toHaveBeenCalledTimes(1);
        const [platformName, retryError, reconnectFn, cleanupFn] = platform.retryHandleConnectionError.mock.calls[0];
        expect(platformName).toBe('StreamElements');
        expect(retryError).toBe(error);
        expect(typeof reconnectFn).toBe('function');
        expect(typeof cleanupFn).toBe('function');
    });
});
