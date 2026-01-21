const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');

const { TikTokPlatform } = require('../../../../../src/platforms/tiktok');

describe('TikTok gift processing', () => {
    let originalNodeEnv;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        restoreAllMocks();
    });

    const buildGift = (overrides = {}) => ({
        platform: 'tiktok',
        userId: 'testTikTokUser1',
        username: 'testUser1',
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

    const createPlatform = (options = {}) => {
        const platform = new TikTokPlatform(
            {
                enabled: true,
                username: 'testGiftUser',
                giftAggregationEnabled: options.aggregationEnabled ?? false
            },
            {
                TikTokWebSocketClient: createMockFn(() => ({})),
                WebcastEvent: {},
                ControlEvent: {},
                logger: noOpLogger
            }
        );

        return { platform };
    };

    it('creates platform with gift aggregator', () => {
        const { platform } = createPlatform();
        expect(platform.giftAggregator).toBeDefined();
    });

    it('handles gift processing via aggregator without throwing', async () => {
        const { platform } = createPlatform({ aggregationEnabled: false });
        const errorHandler = { handleEventProcessingError: createMockFn() };
        platform.errorHandler = errorHandler;

        await expect(platform.giftAggregator.handleStandardGift(
            buildGift({
                userId: 'testTikTokUser1',
                username: 'testUser1',
                giftType: 'Rose',
                giftCount: 2,
                repeatCount: 2,
                unitAmount: 1,
                amount: 2,
                currency: 'coins',
                id: 'gift-msg-1'
            })
        )).resolves.toBeUndefined();
    });

    it('handles gift aggregation mode without throwing', async () => {
        const { platform } = createPlatform({ aggregationEnabled: true });
        const errorHandler = { handleEventProcessingError: createMockFn() };
        platform.errorHandler = errorHandler;

        await expect(platform.giftAggregator.handleStandardGift(
            buildGift({
                userId: 'testTikTokUser2',
                username: 'testUser2',
                giftType: 'Sunglasses',
                giftCount: 5,
                repeatCount: 5,
                unitAmount: 10,
                amount: 50,
                currency: 'coins',
                id: 'gift-msg-2'
            })
        )).resolves.toBeUndefined();
    });

    it('processes gifts through platform handleStandardGift method', async () => {
        const { platform } = createPlatform({ aggregationEnabled: false });
        const errorHandler = { handleEventProcessingError: createMockFn() };
        platform.errorHandler = errorHandler;

        await expect(platform.handleStandardGift(buildGift({
            userId: 'testTikTokUser3',
            username: 'testUser3',
            giftType: 'Diamond',
            giftCount: 1,
            repeatCount: 1,
            unitAmount: 100,
            amount: 100,
            currency: 'diamonds',
            id: 'gift-msg-3'
        }))).resolves.toBeUndefined();
    });
});
