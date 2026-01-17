const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');
const { restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');
const { useFakeTimers, useRealTimers, advanceTimersByTime } = require('../../helpers/bun-timers');

const { GracefulExitService } = require('../../../src/services/GracefulExitService');

describe('GracefulExitService', () => {
    let gracefulExitService;
    let mockAppRuntime;

    beforeEach(() => {
        clearAllMocks();
        useFakeTimers();

        mockAppRuntime = {
            shutdown: createMockFn().mockResolvedValue(undefined),
            getPlatforms: createMockFn().mockReturnValue({ tiktok: {}, twitch: {}, youtube: {} })
        };

        spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterEach(() => {
        if (gracefulExitService && typeof gracefulExitService.stop === 'function') {
            gracefulExitService.stop();
        }
        useRealTimers();
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    describe('Service Initialization', () => {
        it('should initialize with target message count', () => {
            gracefulExitService = new GracefulExitService(mockAppRuntime, 10);

            expect(gracefulExitService.isEnabled()).toBe(true);
            expect(gracefulExitService.getTargetMessageCount()).toBe(10);
            expect(gracefulExitService.getProcessedMessageCount()).toBe(0);
        });

        it('should be disabled when target message count is null', () => {
            gracefulExitService = new GracefulExitService(mockAppRuntime, null);

            expect(gracefulExitService.isEnabled()).toBe(false);
        });
    });

    describe('Message Counting', () => {
        it('should increment message count when message is processed', () => {
            gracefulExitService = new GracefulExitService(mockAppRuntime, 10);

            gracefulExitService.incrementMessageCount();
            expect(gracefulExitService.getProcessedMessageCount()).toBe(1);

            gracefulExitService.incrementMessageCount();
            expect(gracefulExitService.getProcessedMessageCount()).toBe(2);
        });

        it('should not count messages when service is disabled', () => {
            gracefulExitService = new GracefulExitService(mockAppRuntime, null);

            gracefulExitService.incrementMessageCount();
            expect(gracefulExitService.getProcessedMessageCount()).toBe(0);
        });
    });

    describe('Graceful Exit Trigger', () => {
        it('should trigger graceful exit when target count is reached', async () => {
            gracefulExitService = new GracefulExitService(mockAppRuntime, 3);

            gracefulExitService.incrementMessageCount();
            gracefulExitService.incrementMessageCount();

            const shouldExit = gracefulExitService.incrementMessageCount();

            expect(shouldExit).toBe(true);
            expect(gracefulExitService.getProcessedMessageCount()).toBe(3);
        });

        it('should enter shutdown state when target is reached', async () => {
            gracefulExitService = new GracefulExitService(mockAppRuntime, 2);

            gracefulExitService.incrementMessageCount();
            gracefulExitService.incrementMessageCount();

            const exitPromise = gracefulExitService.triggerExit();

            expect(gracefulExitService.isShuttingDown).toBe(true);

            await exitPromise;
        });

        it('should complete shutdown sequence when exit is triggered', async () => {
            gracefulExitService = new GracefulExitService(mockAppRuntime, 5);

            for (let i = 0; i < 5; i++) {
                gracefulExitService.incrementMessageCount();
            }

            const exitPromise = gracefulExitService.triggerExit();

            expect(gracefulExitService.isShuttingDown).toBe(true);

            await exitPromise;
        });

        it('should not trigger exit before target is reached', () => {
            gracefulExitService = new GracefulExitService(mockAppRuntime, 10);

            let shouldExit = false;
            for (let i = 0; i < 5; i++) {
                shouldExit = gracefulExitService.incrementMessageCount();
            }

            expect(shouldExit).toBe(false);
        });
    });

    describe('Error Handling', () => {
        it('should handle shutdown errors gracefully', async () => {
            mockAppRuntime.shutdown.mockRejectedValue(new Error('Shutdown failed'));

            gracefulExitService = new GracefulExitService(mockAppRuntime, 1);
            gracefulExitService.incrementMessageCount();

            await gracefulExitService.triggerExit();

            expect(gracefulExitService.isShuttingDown).toBe(true);
        });

        it('should force exit after timeout if shutdown hangs', async () => {
            mockAppRuntime.shutdown.mockImplementation(() => new Promise(() => {}));

            gracefulExitService = new GracefulExitService(mockAppRuntime, 1);
            gracefulExitService.incrementMessageCount();

            gracefulExitService.triggerExit();

            advanceTimersByTime(10000);

            await Promise.resolve();

            expect(process.exit).toHaveBeenCalledWith(1);
        });
    });

    describe('Statistics and Reporting', () => {
        it('should provide current statistics', () => {
            gracefulExitService = new GracefulExitService(mockAppRuntime, 10);

            gracefulExitService.incrementMessageCount();
            gracefulExitService.incrementMessageCount();

            const stats = gracefulExitService.getStats();

            expect(stats).toMatchObject({
                enabled: true,
                processed: 2,
                target: 10,
                remaining: 8,
                percentage: 20
            });
        });

        it('should indicate when target is close to being reached', () => {
            gracefulExitService = new GracefulExitService(mockAppRuntime, 10);

            for (let i = 0; i < 9; i++) {
                gracefulExitService.incrementMessageCount();
            }

            const stats = gracefulExitService.getStats();

            expect(stats.percentage).toBeGreaterThanOrEqual(90);
            expect(stats.remaining).toBe(1);
        });
    });

    describe('Service Lifecycle', () => {
        it('should clean up resources when stopped', () => {
            gracefulExitService = new GracefulExitService(mockAppRuntime, 10);

            gracefulExitService.stop();

            expect(() => gracefulExitService.incrementMessageCount()).not.toThrow();
        });
    });
});
