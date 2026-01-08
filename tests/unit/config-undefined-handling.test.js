
const { initializeTestLogging, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { createMockLogger, createMockNotificationManager } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { createTestAppRuntime } = require('../helpers/runtime-test-harness');

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Gift Notification Config Resiliency', () => {
    jest.setTimeout(TEST_TIMEOUTS.UNIT);

    const buildAppRuntime = (overrides = {}) => {
        const mockLogger = overrides.logger || createMockLogger('debug', { captureConsole: true });
        const notificationManager = overrides.notificationManager || createMockNotificationManager({
            handleNotification: jest.fn().mockResolvedValue(true)
        });

        const { runtime } = createTestAppRuntime({
            general: { debugEnabled: true, greetingsEnabled: false }
        }, {
            logger: mockLogger,
            notificationManager
        });

        return { runtime, mockLogger, notificationManager };
    };

    test('handleGiftNotification throws when config becomes undefined', async () => {
        const { runtime, mockLogger } = buildAppRuntime();
        runtime.config = undefined;

        await expect(
            runtime.handleGiftNotification('tiktok', 'TestGifter', {
                giftType: 'Rose',
                giftCount: 3,
                amount: 3,
                currency: 'coins',
                repeatCount: 1,
                type: 'gift',
                userId: 'gifter-1',
                timestamp: '2024-01-01T00:00:00.000Z',
                id: 'gift-evt-1'
            })
        ).rejects.toThrow('AppRuntime config unavailable for gift notifications');

        expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('gift notifications require complete gift payloads', async () => {
        const notificationManager = createMockNotificationManager({
            handleNotification: jest.fn().mockResolvedValue(true)
        });
        const { runtime } = buildAppRuntime({ notificationManager });

        await expect(
            runtime.handleGiftNotification('tiktok', 'TestGifter', {
                giftType: undefined,
                giftCount: undefined,
                amount: undefined,
                currency: undefined,
                repeatCount: undefined,
                type: 'gift',
                userId: 'gifter-2',
                timestamp: '2024-01-01T00:00:01.000Z',
                id: 'gift-evt-2'
            })
        ).rejects.toThrow('Gift notification requires giftType, giftCount, amount, and currency');

        expect(notificationManager.handleNotification).not.toHaveBeenCalled();
    });
});
