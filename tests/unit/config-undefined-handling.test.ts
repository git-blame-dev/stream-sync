import { afterEach, describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';

import { createMockFn, restoreAllMocks } from '../helpers/bun-mock-utils';

const nodeRequire = createRequire(import.meta.url);

type LoggerLike = {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};

const { noOpLogger, createMockNotificationManager } = nodeRequire('../helpers/mock-factories') as {
    noOpLogger: LoggerLike;
    createMockNotificationManager: (overrides?: Record<string, unknown>) => {
        handleNotification: ReturnType<typeof createMockFn>;
    };
};
const { setupAutomatedCleanup } = nodeRequire('../helpers/mock-lifecycle') as {
    setupAutomatedCleanup: (options?: Record<string, unknown>) => void;
};
const { createTestAppRuntime } = nodeRequire('../helpers/runtime-test-harness') as {
    createTestAppRuntime: (
        configOverrides: Record<string, unknown>,
        dependencyOverrides: { logger: LoggerLike; notificationManager: { handleNotification: ReturnType<typeof createMockFn> } }
    ) => { runtime: { config: Record<string, unknown> | undefined; handleGiftNotification: (...args: unknown[]) => Promise<unknown> } };
};

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Gift Notification Config Resiliency', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const buildAppRuntime = (overrides: {
        logger?: LoggerLike;
        notificationManager?: { handleNotification: ReturnType<typeof createMockFn> };
    } = {}) => {
        const mockLogger = overrides.logger || noOpLogger;
        const notificationManager = overrides.notificationManager || createMockNotificationManager({
            handleNotification: createMockFn(async () => true)
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
        const { runtime } = buildAppRuntime();
        runtime.config = undefined;

        await expect(
            runtime.handleGiftNotification('tiktok', 'TestGifter', {
                giftType: 'Rose',
                giftCount: 3,
                amount: 3,
                currency: 'coins',
                repeatCount: 1,
                type: 'platform:gift',
                userId: 'gifter-1',
                timestamp: '2024-01-01T00:00:00.000Z',
                id: 'gift-evt-1'
            })
        ).rejects.toThrow('AppRuntime config unavailable for gift notifications');
    });

    test('gift notifications require complete gift payloads', async () => {
        const notificationManager = createMockNotificationManager({
            handleNotification: createMockFn(async () => true)
        });
        const { runtime } = buildAppRuntime({ notificationManager });

        await expect(
            runtime.handleGiftNotification('tiktok', 'TestGifter', {
                giftType: undefined,
                giftCount: undefined,
                amount: undefined,
                currency: undefined,
                repeatCount: undefined,
                type: 'platform:gift',
                userId: 'gifter-2',
                timestamp: '2024-01-01T00:00:01.000Z',
                id: 'gift-evt-2'
            })
        ).rejects.toThrow('Gift notification requires giftType, giftCount, amount, and currency');

        expect(notificationManager.handleNotification).not.toHaveBeenCalled();
    });
});
