const { describe, test, expect } = require('bun:test');
const { createMockFn } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const {
    createTikTokGiftAggregator
} = require('../../../../../src/platforms/tiktok/monetization/gift-aggregator');

describe('TikTok gift aggregator', () => {
    const buildGift = (overrides = {}) => ({
        platform: 'tiktok',
        userId: 'tt-user1',
        username: 'User One',
        giftType: 'Rose',
        giftCount: 2,
        repeatCount: 2,
        unitAmount: 1,
        amount: 2,
        currency: 'coins',
        id: 'gift-msg-1',
        timestamp: '2025-01-02T03:04:05.000Z',
        ...overrides
    });

    test('dedupes duplicate gift events within 1 second', async () => {
        const scheduledTimers = [];
        const timerHandle = { ref: 'timer-1' };

        const safeSetTimeout = createMockFn((callback) => {
            scheduledTimers.push(callback);
            return timerHandle;
        });

        const nowValues = [1000, 1500];
        const now = () => nowValues.shift();

        const platform = {
            giftAggregation: {},
            giftAggregationDelay: 2000,
            logger: noOpLogger,
            errorHandler: { handleEventProcessingError: createMockFn() },
            _handleGift: async () => undefined
        };

        const giftAggregator = createTikTokGiftAggregator({
            platform,
            safeSetTimeout,
            now,
            formatCoinAmount: () => '',
            safeObjectStringify: () => '{}'
        });

        await giftAggregator.handleStandardGift(buildGift({ giftCount: 2, repeatCount: 2 }));
        await giftAggregator.handleStandardGift(buildGift({ giftCount: 2, repeatCount: 2 }));

        const key = 'tt-user1-Rose';
        expect(platform.giftAggregation[key]?.timer).toBe(timerHandle);
        expect(scheduledTimers).toHaveLength(1);
    });

    test('rejects gifts missing canonical identity', async () => {
        const platform = {
            giftAggregation: {},
            giftAggregationDelay: 2000,
            logger: noOpLogger,
            errorHandler: { handleEventProcessingError: createMockFn() },
            _handleGift: async () => undefined
        };

        const giftAggregator = createTikTokGiftAggregator({
            platform,
            safeSetTimeout: createMockFn(),
            now: () => 1000,
            formatCoinAmount: () => '',
            safeObjectStringify: () => '{}'
        });

        await expect(giftAggregator.handleStandardGift(buildGift({ userId: '' })))
            .rejects.toThrow('TikTok gift aggregation requires userId');
    });
});
