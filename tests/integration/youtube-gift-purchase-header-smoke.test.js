const { describe, test, afterEach, expect } = require('bun:test');

const { YouTubeNotificationDispatcher } = require('../../src/utils/youtube-notification-dispatcher');
const { getSyntheticFixture } = require('../helpers/platform-test-data');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const giftPurchaseHeaderOnly = getSyntheticFixture('youtube', 'gift-purchase-header');
const giftPurchaseTimestamp = new Date(
    Math.floor(Number(giftPurchaseHeaderOnly.item.timestampUsec) / 1000)
).toISOString();

describe('YouTube Gift Purchase Smoke (Canonical Author)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('routes gift purchase through dispatcher to handler', async () => {
        const mockLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
        const dispatcher = new YouTubeNotificationDispatcher({ logger: mockLogger });
        const onGiftPaypiggy = createMockFn();

        const result = await dispatcher.dispatchGiftMembership(giftPurchaseHeaderOnly, { onGiftPaypiggy });

        expect(result).toBe(true);
        expect(onGiftPaypiggy).toHaveBeenCalledTimes(1);

        const notification = onGiftPaypiggy.mock.calls[0][0];
        expect(notification.type).toBe('platform:giftpaypiggy');
        expect(notification.username).toBe('GiftGiver');
        expect(notification.userId).toBe(giftPurchaseHeaderOnly.item.author.id);
        expect(notification.giftCount).toBe(5);
        expect(notification.id).toBe(giftPurchaseHeaderOnly.item.id);
        expect(notification.timestamp).toBe(giftPurchaseTimestamp);
    });
});
