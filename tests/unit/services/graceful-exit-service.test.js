
const { EventEmitter } = require('events');

// Mock the logger
jest.mock('../../../src/core/logging', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        console: jest.fn()
    }
}));

const { GracefulExitService } = require('../../../src/services/GracefulExitService');
const { logger } = require('../../../src/core/logging');

describe('GracefulExitService', () => {
    let gracefulExitService;
    let mockEventBus;
    let mockAppRuntime;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        // Create mock EventBus
        mockEventBus = new EventEmitter();
        mockEventBus.emit = jest.fn(mockEventBus.emit.bind(mockEventBus));

        // Create mock AppRuntime with required methods
        mockAppRuntime = {
            shutdown: jest.fn().mockResolvedValue(undefined),
            getPlatforms: jest.fn().mockReturnValue({ tiktok: {}, twitch: {}, youtube: {} })
        };

        // Mock process.exit
        jest.spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterEach(() => {
        if (gracefulExitService && typeof gracefulExitService.stop === 'function') {
            gracefulExitService.stop();
        }
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    describe('Service Initialization', () => {
        it('should initialize with target message count', () => {
            // Given: GracefulExitService needs to be created
            // When: Service is initialized with target message count
            // Then: Service should track target and be ready
            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, 10);

            expect(gracefulExitService.isEnabled()).toBe(true);
            expect(gracefulExitService.getTargetMessageCount()).toBe(10);
            expect(gracefulExitService.getProcessedMessageCount()).toBe(0);
        });

        it('should be disabled when target message count is null', () => {
            // Given: No target message count specified
            // When: Service is initialized with null
            // Then: Service should be disabled
            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, null);

            expect(gracefulExitService.isEnabled()).toBe(false);
        });

        it('should emit service initialization event', () => {
            // Given: EventBus ready to receive events
            // When: GracefulExitService is initialized
            // Then: Should emit service:initialized event
            const initEvents = [];
            mockEventBus.on('service:initialized', (data) => initEvents.push(data));

            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, 5);

            expect(initEvents.length).toBeGreaterThan(0);
            expect(initEvents[0]).toMatchObject({
                serviceName: 'GracefulExitService',
                status: 'ready'
            });
        });
    });

    describe('Message Counting', () => {
        it('should increment message count when message is processed', () => {
            // Given: GracefulExitService tracking messages
            // When: Messages are processed
            // Then: Message count should increment
            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, 10);

            gracefulExitService.incrementMessageCount();
            expect(gracefulExitService.getProcessedMessageCount()).toBe(1);

            gracefulExitService.incrementMessageCount();
            expect(gracefulExitService.getProcessedMessageCount()).toBe(2);
        });

        it('should not count messages when service is disabled', () => {
            // Given: GracefulExitService is disabled (null target)
            // When: incrementMessageCount is called
            // Then: Count should remain at 0
            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, null);

            gracefulExitService.incrementMessageCount();
            expect(gracefulExitService.getProcessedMessageCount()).toBe(0);
        });

        it('should emit progress event at regular intervals', () => {
            // Given: GracefulExitService tracking messages
            // When: Multiple messages are processed
            // Then: Should emit progress events
            const progressEvents = [];
            mockEventBus.on('graceful-exit:progress', (data) => progressEvents.push(data));

            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, 10);

            for (let i = 0; i < 5; i++) {
                gracefulExitService.incrementMessageCount();
            }

            expect(progressEvents.length).toBeGreaterThan(0);
            expect(progressEvents[progressEvents.length - 1]).toMatchObject({
                processed: 5,
                target: 10,
                percentage: 50
            });
        });
    });

    describe('Graceful Exit Trigger', () => {
        it('should trigger graceful exit when target count is reached', async () => {
            // Given: GracefulExitService with target of 3 messages
            // When: 3 messages are processed
            // Then: Should trigger graceful exit
            const exitEvents = [];
            mockEventBus.on('graceful-exit:triggered', (data) => exitEvents.push(data));

            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, 3);

            gracefulExitService.incrementMessageCount(); // 1
            gracefulExitService.incrementMessageCount(); // 2

            const shouldExit = gracefulExitService.incrementMessageCount(); // 3

            expect(shouldExit).toBe(true);
            expect(exitEvents.length).toBeGreaterThan(0);
        });

        it('should enter shutdown state when target is reached', async () => {
            // Given: GracefulExitService with target of 2 messages
            // When: Target count is reached and triggerExit is called
            // Then: Service should enter shutdown state
            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, 2);

            gracefulExitService.incrementMessageCount(); // 1
            gracefulExitService.incrementMessageCount(); // 2

            // Trigger exit in background
            const exitPromise = gracefulExitService.triggerExit();

            // Verify the service is shutting down
            expect(gracefulExitService.isShuttingDown).toBe(true);

            // Wait for completion
            await exitPromise;
        });

        it('should complete shutdown sequence when exit is triggered', async () => {
            // Given: GracefulExitService ready to exit
            // When: Graceful exit is triggered
            // Then: Should complete shutdown sequence and enter shutdown state
            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, 5);

            for (let i = 0; i < 5; i++) {
                gracefulExitService.incrementMessageCount();
            }

            // Trigger exit
            const exitPromise = gracefulExitService.triggerExit();

            // Verify service is shutting down
            expect(gracefulExitService.isShuttingDown).toBe(true);

            // Wait for completion
            await exitPromise;
        });

        it('should not trigger exit before target is reached', () => {
            // Given: GracefulExitService with target of 10
            // When: Only 5 messages processed
            // Then: Should not trigger exit
            const exitEvents = [];
            mockEventBus.on('graceful-exit:triggered', (data) => exitEvents.push(data));

            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, 10);

            for (let i = 0; i < 5; i++) {
                gracefulExitService.incrementMessageCount();
            }

            expect(exitEvents.length).toBe(0);
        });
    });

    describe('Error Handling', () => {
        it('should handle shutdown errors gracefully', async () => {
            // Given: AppRuntime.shutdown that throws error
            // When: Graceful exit is triggered
            // Then: Error should be logged and system should attempt force exit
            mockAppRuntime.shutdown.mockRejectedValue(new Error('Shutdown failed'));

            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, 1);
            gracefulExitService.incrementMessageCount();

            await gracefulExitService.triggerExit();

            expect(logger.error).toHaveBeenCalled();
            const errorCall = logger.error.mock.calls.find(call =>
                call[0].includes('error') || call[0].includes('failed')
            );
            expect(errorCall).toBeDefined();
        });

        it('should force exit after timeout if shutdown hangs', async () => {
            // Given: AppRuntime.shutdown that never resolves
            // When: Graceful exit is triggered
            // Then: Should force exit after timeout
            mockAppRuntime.shutdown.mockImplementation(() => new Promise(() => {})); // Never resolves

            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, 1);
            gracefulExitService.incrementMessageCount();

            // Don't await - just trigger the exit
            gracefulExitService.triggerExit();

            // Fast-forward 10 seconds to trigger timeout
            jest.advanceTimersByTime(10000);

            // Give a tick for the timeout callback to execute
            await Promise.resolve();

            expect(process.exit).toHaveBeenCalledWith(1);
        });
    });

    describe('Statistics and Reporting', () => {
        it('should provide current statistics', () => {
            // Given: GracefulExitService with messages processed
            // When: getStats is called
            // Then: Should return current statistics
            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, 10);

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
            // Given: GracefulExitService near target
            // When: 90% of messages processed
            // Then: Should indicate nearing completion
            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, 10);

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
            // Given: GracefulExitService running
            // When: stop() is called
            // Then: Should clean up resources
            gracefulExitService = new GracefulExitService(mockEventBus, mockAppRuntime, 10);

            gracefulExitService.stop();

            // Should not throw errors after stop
            expect(() => gracefulExitService.incrementMessageCount()).not.toThrow();
        });
    });
});
