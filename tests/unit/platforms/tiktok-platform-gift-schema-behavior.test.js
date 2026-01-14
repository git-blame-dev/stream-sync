const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { unmockModule, restoreAllModuleMocks, resetModules } = require('../helpers/bun-module-mocks');
const { useFakeTimers, useRealTimers, runOnlyPendingTimers } = require('../helpers/bun-timers');

unmockModule('../../../src/platforms/tiktok');

const { TikTokPlatform } = require('../../../src/platforms/tiktok');
const { createMockTikTokPlatformDependencies } = require('../../helpers/mock-factories');
const testClock = require('../../helpers/test-clock');

describe('TikTokPlatform gift aggregation and schema behavior', () => {
    const baseConfig = { enabled: true, username: 'gift_tester', giftAggregationEnabled: true };

    const createDependencies = () => ({
        ...createMockTikTokPlatformDependencies(),
        timestampService: {
            extractTimestamp: createMockFn(() => new Date(testClock.now()).toISOString())
        },
        connectionFactory: {
            createConnection: createMockFn(() => ({
                on: createMockFn(),
                removeAllListeners: createMockFn(),
                disconnect: createMockFn(),
                isConnected: false
            }))
        }
    });

    const createGiftEvent = (repeatCount = 1) => {
        const timestamp = testClock.now();
        return {
            user: { userId: 'tt-gifter-1', uniqueId: 'gifter123', nickname: 'Gifter One' },
            giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
            repeatCount,
            giftType: 0,
            msgId: `gift-${timestamp}`,
            createTime: timestamp
        };
    };

    const runAllGiftTimers = async () => {
        runOnlyPendingTimers();
        await Promise.resolve();
    };

    beforeEach(() => {
        useFakeTimers();
    });

    afterEach(() => {
        useRealTimers();
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    it('emits aggregated gifts with normalized user schema and correct amount', async () => {
        const platform = new TikTokPlatform(baseConfig, createDependencies());
        const emittedGifts = [];
        platform.handlers = {
            ...platform.handlers,
            onGift: (data) => emittedGifts.push(data)
        };

        await platform.handleTikTokGift(createGiftEvent(1));
        await platform.handleTikTokGift(createGiftEvent(3));

        await runAllGiftTimers();

        expect(emittedGifts).toHaveLength(1);
        const [giftEvent] = emittedGifts;
        expect(giftEvent.userId).toBe('tt-gifter-1');
        expect(giftEvent.username).toBe('gifter123');
        expect(giftEvent.amount).toBe(3);
        expect(giftEvent.giftType).toBe('Rose');
        expect(giftEvent.isAggregated).toBe(true);
    });

    it('emits chat messages with normalized user schema', async () => {
        const platform = new TikTokPlatform(baseConfig, createDependencies());
        const chatEvents = [];
        platform.handlers = {
            ...platform.handlers,
            onChat: (data) => chatEvents.push(data)
        };

        await platform._handleChatMessage({
            user: { userId: 'tt-chatter-1', uniqueId: 'chatter', nickname: 'Chatter Box' },
            comment: 'Hello TikTok!',
            createTime: testClock.now()
        });

        expect(chatEvents).toHaveLength(1);
        const [chatEvent] = chatEvents;
        expect(chatEvent.userId).toBe('tt-chatter-1');
        expect(chatEvent.username).toBe('chatter');
        expect(chatEvent.message).toEqual({ text: 'Hello TikTok!' });
    });

    it('emits TikTok gifts with giftType/amount/currency fields', async () => {
        const platform = new TikTokPlatform(
            { ...baseConfig, giftAggregationEnabled: false },
            createDependencies()
        );
        const emittedGifts = [];
        platform.handlers = {
            ...platform.handlers,
            onGift: (data) => emittedGifts.push(data)
        };

        await platform.handleTikTokGift({
            user: { userId: 'tt-gifter-2', uniqueId: 'gifter123', nickname: 'Gifter One' },
            giftDetails: { giftName: 'Heart Me', diamondCount: 25, giftType: 0 },
            repeatCount: 3,
            repeatEnd: true,
            msgId: 'gift-msg-1',
            createTime: testClock.now()
        });

        expect(emittedGifts).toHaveLength(1);
        const [giftEvent] = emittedGifts;
        expect(giftEvent.giftType).toBe('Heart Me');
        expect(giftEvent.giftCount).toBe(3);
        expect(giftEvent.repeatCount).toBe(3);
        expect(giftEvent.amount).toBe(75);
        expect(giftEvent.currency).toBe('coins');
        expect(giftEvent.isAggregated).toBe(false);
    });

    it('emits aggregated TikTok gifts with normalized amount and metadata', async () => {
        const platform = new TikTokPlatform(
            { ...baseConfig, giftAggregationEnabled: true, giftAggregationDelay: 25 },
            createDependencies()
        );
        const emittedGifts = [];
        platform.handlers = {
            ...platform.handlers,
            onGift: (data) => emittedGifts.push(data)
        };

        await platform.handleTikTokGift({
            user: { userId: 'tt-gifter-3', uniqueId: 'gifter123', nickname: 'Gifter One' },
            giftDetails: { giftName: 'User', diamondCount: 5, giftType: 0 },
            repeatCount: 2,
            repeatEnd: true,
            msgId: 'gift-msg-2',
            createTime: testClock.now()
        });

        await runAllGiftTimers();

        expect(emittedGifts).toHaveLength(1);
        const [giftEvent] = emittedGifts;
        expect(giftEvent.giftType).toBe('User');
        expect(giftEvent.giftCount).toBe(2);
        expect(giftEvent.repeatCount).toBe(2);
        expect(giftEvent.amount).toBe(10);
        expect(giftEvent.aggregatedCount).toBe(2);
        expect(giftEvent.isAggregated).toBe(true);
        expect(giftEvent.currency).toBe('coins');
    });
});
