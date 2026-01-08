const { EventEmitter } = require('events');

// Shared mocks configured per test to allow module reloading
const createHandler = () => ({
    handleEventProcessingError: jest.fn(),
    logOperationalError: jest.fn()
});

let gracefulHandler;
let systemHandler;
const mockHandlerFactory = jest.fn();

let scheduledTimeouts;
const mockSafeSetTimeout = jest.fn();

jest.mock('../../../src/core/logging', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        console: jest.fn()
    }
}));

jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: (...args) => mockHandlerFactory(...args)
}));

jest.mock('../../../src/utils/timeout-validator', () => ({
    safeSetTimeout: (...args) => mockSafeSetTimeout(...args)
}));

describe('GracefulExitService additional behavior', () => {
    let GracefulExitService;
    let logger;
    let runtime;
    let eventBus;

    beforeEach(() => {
        jest.resetModules();
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
            shutdown: jest.fn().mockResolvedValue(undefined),
            getPlatforms: jest.fn()
        };
        eventBus = new EventEmitter();
        eventBus.emit = jest.fn(eventBus.emit.bind(eventBus));

        jest.spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('disables tracking when target is non-positive', () => {
        const service = new GracefulExitService(eventBus, runtime, 0);

        expect(service.isEnabled()).toBe(false);
        expect(service.incrementMessageCount()).toBe(false);
        expect(service.getStats().enabled).toBe(false);
    });

    test('guards against duplicate shutdown attempts', async () => {
        const service = new GracefulExitService(eventBus, runtime, 1);
        service.isShuttingDown = true;

        await service.triggerExit();

        expect(runtime.shutdown).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });

    test('routes shutdown errors through platform error handlers and schedules forced exit', async () => {
        runtime.shutdown.mockRejectedValue(new Error('shutdown failed'));

        const service = new GracefulExitService(eventBus, runtime, 1);
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
        const service = new GracefulExitService(eventBus, runtime, 1);

        const summary = service._buildExitSummary();

        expect(summary.memoryStats).toBeUndefined();
    });
});
