const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const {
    useFakeTimers,
    useRealTimers,
    setSystemTime,
    advanceTimersByTime,
    getTimerCount
} = require('../../../../helpers/bun-timers');
const {
    createTikTokGiftAggregator
} = require('../../../../../src/platforms/tiktok/monetization/gift-aggregator');

describe('TikTok gift aggregator', () => {
    beforeEach(() => {
        useFakeTimers();
        setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
    });

    afterEach(() => {
        useRealTimers();
    });

    const buildGift = (overrides = {}) => ({
        platform: 'tiktok',
        userId: 'tt-user1',
        username: 'testUserOne',
        giftType: 'Rose',
        giftCount: 2,
        repeatCount: 2,
        unitAmount: 1,
        amount: 2,
        currency: 'coins',
        id: 'gift-msg-1',
        timestamp: '2025-01-15T12:00:00.000Z',
        ...overrides
    });

    const createTestPlatform = (overrides = {}) => ({
        giftAggregation: {},
        giftAggregationDelay: 2000,
        logger: noOpLogger,
        errorHandler: { handleEventProcessingError: () => {} },
        _handleGift: async () => undefined,
        ...overrides
    });

    describe('factory validation', () => {
        test('throws when platform is missing', () => {
            expect(() => createTikTokGiftAggregator({}))
                .toThrow('platform is required to create TikTok gift aggregator');
        });

        test('throws when platform is null', () => {
            expect(() => createTikTokGiftAggregator({ platform: null }))
                .toThrow('platform is required to create TikTok gift aggregator');
        });
    });

    describe('gift payload validation', () => {
        test('throws when gift payload is null', async () => {
            const giftAggregator = createTikTokGiftAggregator({
                platform: createTestPlatform()
            });

            await expect(giftAggregator.handleStandardGift(null))
                .rejects.toThrow('TikTok gift aggregation requires gift payload');
        });

        test('throws when gift payload is not an object', async () => {
            const giftAggregator = createTikTokGiftAggregator({
                platform: createTestPlatform()
            });

            await expect(giftAggregator.handleStandardGift('invalid'))
                .rejects.toThrow('TikTok gift aggregation requires gift payload');
        });

        test('throws when giftCount is zero', async () => {
            const giftAggregator = createTikTokGiftAggregator({
                platform: createTestPlatform()
            });

            await expect(giftAggregator.handleStandardGift(buildGift({ giftCount: 0 })))
                .rejects.toThrow('TikTok gift aggregation requires giftCount');
        });

        test('throws when giftCount is negative', async () => {
            const giftAggregator = createTikTokGiftAggregator({
                platform: createTestPlatform()
            });

            await expect(giftAggregator.handleStandardGift(buildGift({ giftCount: -1 })))
                .rejects.toThrow('TikTok gift aggregation requires giftCount');
        });

        test('throws when unitAmount is not finite', async () => {
            const giftAggregator = createTikTokGiftAggregator({
                platform: createTestPlatform()
            });

            await expect(giftAggregator.handleStandardGift(buildGift({ unitAmount: NaN })))
                .rejects.toThrow('TikTok gift aggregation requires unitAmount');
        });
    });

    describe('gift aggregation behavior', () => {
        test('aggregates gifts and delivers after delay', async () => {
            const handledGifts = [];
            const platform = createTestPlatform({
                _handleGift: async (payload) => handledGifts.push(payload)
            });

            const giftAggregator = createTikTokGiftAggregator({ platform });

            await giftAggregator.handleStandardGift(buildGift({ giftCount: 3 }));

            expect(handledGifts).toHaveLength(0);

            await advanceTimersByTime(platform.giftAggregationDelay);

            expect(handledGifts).toHaveLength(1);
            expect(handledGifts[0].giftCount).toBe(3);
            expect(handledGifts[0].isAggregated).toBe(true);
        });

        test('updates aggregation when new gift count arrives before timer fires', async () => {
            const handledGifts = [];
            const platform = createTestPlatform({
                _handleGift: async (payload) => handledGifts.push(payload)
            });

            const giftAggregator = createTikTokGiftAggregator({ platform });

            await giftAggregator.handleStandardGift(buildGift({ giftCount: 2 }));

            setSystemTime(new Date('2025-01-15T12:00:01.500Z'));
            await advanceTimersByTime(500);

            await giftAggregator.handleStandardGift(buildGift({ giftCount: 5 }));

            expect(handledGifts).toHaveLength(0);

            await advanceTimersByTime(platform.giftAggregationDelay);

            expect(handledGifts).toHaveLength(1);
            expect(handledGifts[0].giftCount).toBe(5);
        });

        test('ignores duplicate gift with same count within 1 second', async () => {
            const handledGifts = [];
            const platform = createTestPlatform({
                _handleGift: async (payload) => handledGifts.push(payload)
            });

            const giftAggregator = createTikTokGiftAggregator({ platform });

            await giftAggregator.handleStandardGift(buildGift({ giftCount: 2 }));

            setSystemTime(new Date('2025-01-15T12:00:00.500Z'));
            await advanceTimersByTime(500);

            await giftAggregator.handleStandardGift(buildGift({ giftCount: 2 }));

            await advanceTimersByTime(platform.giftAggregationDelay);

            expect(handledGifts).toHaveLength(1);
        });

        test('includes sourceType in delivered payload when present', async () => {
            const handledGifts = [];
            const platform = createTestPlatform({
                _handleGift: async (payload) => handledGifts.push(payload)
            });

            const giftAggregator = createTikTokGiftAggregator({ platform });

            await giftAggregator.handleStandardGift(buildGift({ sourceType: 'streak' }));
            await advanceTimersByTime(platform.giftAggregationDelay);

            expect(handledGifts).toHaveLength(1);
            expect(handledGifts[0].sourceType).toBe('streak');
        });

        test('cleans up aggregation state after delivery', async () => {
            const platform = createTestPlatform({
                _handleGift: async () => undefined
            });

            const giftAggregator = createTikTokGiftAggregator({ platform });

            await giftAggregator.handleStandardGift(buildGift());

            expect(platform.giftAggregation['tt-user1-Rose']).toBeDefined();

            await advanceTimersByTime(platform.giftAggregationDelay);

            expect(platform.giftAggregation['tt-user1-Rose']).toBeUndefined();
        });

        test('cleans up aggregation state when delivery fails', async () => {
            const platform = createTestPlatform({
                _handleGift: async () => { throw new Error('Handler failed'); }
            });

            const giftAggregator = createTikTokGiftAggregator({ platform });

            await giftAggregator.handleStandardGift(buildGift());
            await advanceTimersByTime(platform.giftAggregationDelay);

            expect(platform.giftAggregation['tt-user1-Rose']).toBeUndefined();
        });
    });

    describe('cleanupGiftAggregation', () => {
        test('cancels pending timers and prevents delivery', async () => {
            const handledGifts = [];
            const platform = createTestPlatform({
                _handleGift: async (payload) => handledGifts.push(payload)
            });

            const giftAggregator = createTikTokGiftAggregator({ platform });

            await giftAggregator.handleStandardGift(buildGift());

            expect(getTimerCount()).toBe(1);

            giftAggregator.cleanupGiftAggregation();

            expect(getTimerCount()).toBe(0);
            expect(platform.giftAggregation).toEqual({});

            await advanceTimersByTime(platform.giftAggregationDelay * 2);

            expect(handledGifts).toHaveLength(0);
        });

        test('handles empty aggregation state', () => {
            const platform = createTestPlatform({ giftAggregation: {} });
            const giftAggregator = createTikTokGiftAggregator({ platform });

            giftAggregator.cleanupGiftAggregation();

            expect(platform.giftAggregation).toEqual({});
        });
    });
});
