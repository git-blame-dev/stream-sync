
const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const {
    mockModule,
    unmockModule,
    requireActual,
    restoreAllModuleMocks,
    resetModules
} = require('../../helpers/bun-module-mocks');

unmockModule('../../../src/platforms/tiktok');

let scheduledAggregationCallback = null;

mockModule('../../../src/utils/timeout-validator', () => {
    const actual = requireActual('../../../src/utils/timeout-validator');
    return {
        ...actual,
        safeSetTimeout: createMockFn((callback, delay, ...args) => {
            scheduledAggregationCallback = () => callback(...args);
            return { ref: 'test-timer' };
        })
    };
});

describe('TikTok gift aggregation timer error handling', () => {
    beforeEach(() => {
        scheduledAggregationCallback = null;
        clearAllMocks();
    });

    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    it('routes aggregation timer failures through the error handler without crashing', async () => {
        const { TikTokPlatform } = require('../../../src/platforms/tiktok');

        const mockLogger = {
            debug: createMockFn(),
            info: createMockFn(() => {
                throw new Error('logger failure');
            }),
            warn: createMockFn(),
            error: createMockFn()
        };

        const errorHandler = {
            handleEventProcessingError: createMockFn()
        };

        const platform = new TikTokPlatform(
            { enabled: true, username: 'gift_tester', giftAggregationEnabled: true },
            {
                TikTokWebSocketClient: createMockFn(() => ({})),
                WebcastEvent: {},
                ControlEvent: {},
                logger: mockLogger
            }
        );
        platform.errorHandler = errorHandler;

        await platform.handleStandardGift(
            'user1',
            'User One',
            'Rose',
            2,
            1,
            'coins',
            {
                user: { userId: 'tt-user1', uniqueId: 'user1' },
                repeatCount: 2,
                giftDetails: { giftName: 'Rose', diamondCount: 1 }
            }
        );

        expect(typeof scheduledAggregationCallback).toBe('function');
        await expect(scheduledAggregationCallback()).resolves.toBeUndefined();

        expect(errorHandler.handleEventProcessingError).toHaveBeenCalledTimes(1);
        const [errorArg, eventType] = errorHandler.handleEventProcessingError.mock.calls[0];
        expect(errorArg).toBeInstanceOf(Error);
        expect(eventType).toBe('gift-aggregation');

        expect(platform.giftAggregation['user1-Rose']).toBeUndefined();
    });
});
