
const { describe, test, expect, jest } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

mockModule('../../src/core/logging', () => ({
    setConfigValidator: createMockFn(),
    setDebugMode: createMockFn(),
    initializeLoggingConfig: createMockFn(),
    initializeConsoleOverride: createMockFn(),
    logger: {
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn(),
        debug: createMockFn()
    },
    getLogger: createMockFn(() => ({
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn(),
        debug: createMockFn()
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
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    jest.setTimeout(TEST_TIMEOUTS.UNIT);

    test('routes SuperSticker payloads through handleGiftNotification', async () => {
        const notificationManager = createMockNotificationManager({
            handleNotification: createMockFn().mockResolvedValue(true)
        });

        const { runtime } = createTestAppRuntime({
            general: { enabled: true },
            youtube: { enabled: true }
        }, {
            notificationManager
        });

        await runtime.handleGiftNotification('youtube', 'StickerFan', {
            type: 'platform:gift',
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
            'platform:gift',
            'youtube',
            expect.objectContaining({
                username: 'StickerFan',
                giftType: 'Super Sticker',
                giftCount: 1,
                amount: 5,
                currency: 'USD',
                type: 'platform:gift'
            })
        );
    });
});
