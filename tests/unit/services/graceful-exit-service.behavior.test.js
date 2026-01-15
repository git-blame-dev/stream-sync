const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

// Shared mocks configured per test to allow module reloading
const createHandler = () => ({
    handleEventProcessingError: createMockFn(),
    logOperationalError: createMockFn()
});

let gracefulHandler;
let systemHandler;
const mockHandlerFactory = createMockFn();

let scheduledTimeouts;
const mockSafeSetTimeout = createMockFn();

mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: (...args) => mockHandlerFactory(...args)
}));

mockModule('../../../src/utils/timeout-validator', () => ({
    safeSetTimeout: (...args) => mockSafeSetTimeout(...args)
}));

describe('GracefulExitService additional behavior', () => {
    let GracefulExitService;
    let runtime;

    beforeEach(() => {
        resetModules();
        scheduledTimeouts = [];

        gracefulHandler = createHandler();
        systemHandler = createHandler();

        mockHandlerFactory.mockReset()
            .mockReturnValueOnce(gracefulHandler)
            .mockReturnValueOnce(systemHandler);

        mockSafeSetTimeout.mockReset().mockImplementation((callback) => {
            scheduledTimeouts.push(callback);
            return 'timeout-id';
        });

        ({ GracefulExitService } = require('../../../src/services/GracefulExitService'));

        runtime = {
            shutdown: createMockFn().mockResolvedValue(undefined),
            getPlatforms: createMockFn()
        };

        spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterEach(() => {
        restoreAllMocks();
        clearAllMocks();
        restoreAllModuleMocks();
    });

    test('disables tracking when target is non-positive', () => {
        const service = new GracefulExitService(runtime, 0);

        expect(service.isEnabled()).toBe(false);
        expect(service.incrementMessageCount()).toBe(false);
        expect(service.getStats().enabled).toBe(false);
    });

    test('guards against duplicate shutdown attempts', async () => {
        const service = new GracefulExitService(runtime, 1);
        service.isShuttingDown = true;

        await service.triggerExit();

        // Observable behavior: shutdown should not be called again
        expect(runtime.shutdown).not.toHaveBeenCalled();
    });

    test('handles shutdown errors gracefully', async () => {
        runtime.shutdown.mockRejectedValue(new Error('shutdown failed'));

        const service = new GracefulExitService(runtime, 1);
        service.incrementMessageCount();

        // Should not throw - errors are handled gracefully
        await service.triggerExit();

        // Observable behavior: service should enter shutdown state
        expect(service.isShuttingDown).toBe(true);
    });

    test('builds exit summary without memory stats', () => {
        const service = new GracefulExitService(runtime, 1);

        const summary = service._buildExitSummary();

        expect(summary.memoryStats).toBeUndefined();
    });
});
