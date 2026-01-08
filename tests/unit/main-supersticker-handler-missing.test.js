
jest.mock('../../src/core/logging', () => ({
    setConfigValidator: jest.fn(),
    setDebugMode: jest.fn(),
    initializeLoggingConfig: jest.fn(),
    initializeConsoleOverride: jest.fn(),
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    },
    getLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

const { initializeTestLogging, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { createMockNotificationManager } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { createTestAppRuntime } = require('../helpers/runtime-test-harness');

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('SuperSticker Notification Handling', () => {
    jest.setTimeout(TEST_TIMEOUTS.UNIT);

    test('routes SuperSticker payloads through handleGiftNotification', async () => {
        const notificationManager = createMockNotificationManager({
            handleNotification: jest.fn().mockResolvedValue(true)
        });

        const { runtime } = createTestAppRuntime({
            general: { enabled: true },
            youtube: { enabled: true }
        }, {
            notificationManager
        });

        await runtime.handleGiftNotification('youtube', 'StickerFan', {
            type: 'gift',
            giftType: 'Super Sticker',
            giftCount: 1,
            amount: 5,
            currency: 'USD',
            sticker: 'Shiba dog shaking his hips saying Thank you',
            userId: 'sticker-1',
            timestamp: '2024-01-01T00:00:00.000Z',
            id: 'supersticker-evt-1'
        });

        expect(notificationManager.handleNotification).toHaveBeenCalledWith(
            'gift',
            'youtube',
            expect.objectContaining({
                username: 'StickerFan',
                giftType: 'Super Sticker',
                giftCount: 1,
                amount: 5,
                currency: 'USD',
                type: 'gift'
            })
        );
    });
});
