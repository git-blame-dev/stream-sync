const {
    createTikTokGiftAggregator
} = require('../../../../src/platforms/tiktok/gifts/tiktok-gift-aggregator');

describe('TikTok gift aggregator', () => {
    test('dedupes duplicate repeatCount events within 1 second', async () => {
        const scheduledTimers = [];
        const timerHandle = { ref: 'timer-1' };

        const safeSetTimeout = jest.fn((callback) => {
            scheduledTimers.push(callback);
            return timerHandle;
        });

        const nowValues = [1000, 1500];
        const now = () => nowValues.shift();

        const platform = {
            giftAggregation: {},
            giftAggregationDelay: 2000,
            logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
            errorHandler: { handleEventProcessingError: jest.fn() },
            _handleGift: async () => undefined
        };

        const giftAggregator = createTikTokGiftAggregator({
            platform,
            safeSetTimeout,
            now,
            logTikTokGiftData: async () => undefined,
            formatCoinAmount: () => '',
            safeObjectStringify: () => '{}'
        });

        await giftAggregator.handleStandardGift(
            'user1',
            'User One',
            'Rose',
            2,
            1,
            'coins',
            { userId: 'tt-user1', repeatCount: 2, giftDetails: { giftName: 'Rose', diamondCount: 1 } }
        );

        await giftAggregator.handleStandardGift(
            'user1',
            'User One',
            'Rose',
            2,
            1,
            'coins',
            { userId: 'tt-user1', repeatCount: 2, giftDetails: { giftName: 'Rose', diamondCount: 1 } }
        );

        const key = 'user1-Rose';
        expect(platform.giftAggregation[key]?.timer).toBe(timerHandle);
        expect(scheduledTimers).toHaveLength(1);
    });
});
