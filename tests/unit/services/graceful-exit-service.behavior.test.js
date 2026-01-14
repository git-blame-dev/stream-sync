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

mockModule('../../../src/core/logging', () => ({
    logger: {
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn(),
        console: createMockFn()
    }
}));

mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: (...args) => mockHandlerFactory(...args)
}));

mockModule('../../../src/utils/timeout-validator', () => ({
    safeSetTimeout: (...args) => mockSafeSetTimeout(...args)
}));

describe('GracefulExitService additional behavior', () => {
    let GracefulExitService;
    let logger;
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

        ({ logger } = require('../../../src/core/logging'));
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

        expect(runtime.shutdown).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });

    test('routes shutdown errors through platform error handlers and schedules forced exit', async () => {
        runtime.shutdown.mockRejectedValue(new Error('shutdown failed'));

        const service = new GracefulExitService(runtime, 1);
        service.incrementMessageCount();

        await service.triggerExit();

        expect(gracefulHandler.handleEventProcessingError).toHaveBeenCalled();
        expect(systemHandler.handleEventProcessingError).toHaveBeenCalled();
        expect(scheduledTimeouts.length).toBeGreaterThan(0);

        scheduledTimeouts.forEach((cb) => cb());

        expect(gracefulHandler.logOperationalError).toHaveBeenCalled();
        expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('builds exit summary without memory stats', () => {
        const service = new GracefulExitService(runtime, 1);

        const summary = service._buildExitSummary();

        expect(summary.memoryStats).toBeUndefined();
    });
});
