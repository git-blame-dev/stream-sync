const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { TikTokPlatform } = require('../../../src/platforms/tiktok');

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

    const createPlatform = (options = {}) => {
        const mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

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
                logger: mockLogger
            }
        );

        return { platform, mockLogger };
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
            'testUser1',
            'TestUser One',
            'Rose',
            2,
            1,
            'coins',
            {
                user: { userId: 'testTikTokUser1', uniqueId: 'testUser1' },
                repeatCount: 2,
                giftDetails: { giftName: 'Rose', diamondCount: 1 }
            }
        )).resolves.toBeUndefined();
    });

    it('handles gift aggregation mode without throwing', async () => {
        const { platform } = createPlatform({ aggregationEnabled: true });
        const errorHandler = { handleEventProcessingError: createMockFn() };
        platform.errorHandler = errorHandler;

        await expect(platform.giftAggregator.handleStandardGift(
            'testUser2',
            'TestUser Two',
            'Sunglasses',
            5,
            10,
            'coins',
            {
                user: { userId: 'testTikTokUser2', uniqueId: 'testUser2' },
                repeatCount: 5,
                giftDetails: { giftName: 'Sunglasses', diamondCount: 10 }
            }
        )).resolves.toBeUndefined();
    });

    it('processes gifts through platform handleStandardGift method', async () => {
        const { platform } = createPlatform({ aggregationEnabled: false });
        const errorHandler = { handleEventProcessingError: createMockFn() };
        platform.errorHandler = errorHandler;

        await expect(platform.handleStandardGift(
            'testUser3',
            'TestUser Three',
            'Diamond',
            1,
            100,
            'diamonds',
            {
                user: { userId: 'testTikTokUser3', uniqueId: 'testUser3' },
                repeatCount: 1,
                giftDetails: { giftName: 'Diamond', diamondCount: 100 }
            }
        )).resolves.toBeUndefined();
    });
});
