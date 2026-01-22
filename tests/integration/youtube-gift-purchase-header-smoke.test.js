const { describe, test, afterEach, expect } = require('bun:test');
const { YouTubePlatform } = require('../../src/platforms/youtube');
const { getSyntheticFixture } = require('../helpers/platform-test-data');
const { restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { createMockPlatformDependencies, createMockConfig } = require('../helpers/test-setup');

const giftPurchaseHeaderOnly = getSyntheticFixture('youtube', 'gift-purchase-header');
const giftPurchaseTimestamp = new Date(
    Math.floor(Number(giftPurchaseHeaderOnly.item.timestamp_usec) / 1000)
).toISOString();

describe('YouTube Gift Purchase Smoke (Canonical Author)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('routes gift purchase through event pipeline to handler', async () => {
        const config = createMockConfig('youtube', {
            enabled: true,
            username: 'test-channel',
            apiKey: 'test-key'
        });
        const dependencies = createMockPlatformDependencies('youtube', { logger: noOpLogger });
        const platform = new YouTubePlatform(config, dependencies);
        const giftEvents = [];
        platform.handlers = {
            ...platform.handlers,
            onGiftPaypiggy: (event) => giftEvents.push(event)
        };

        await platform.handleChatMessage(giftPurchaseHeaderOnly);

        expect(giftEvents).toHaveLength(1);
        const notification = giftEvents[0];
        expect(notification.type).toBe('platform:giftpaypiggy');
        expect(notification.username).toBe('GiftGiver');
        expect(notification.userId).toBe(giftPurchaseHeaderOnly.item.author.id);
        expect(notification.giftCount).toBe(5);
        expect(notification.id).toBe(giftPurchaseHeaderOnly.item.id);
        expect(notification.timestamp).toBe(giftPurchaseTimestamp);
    });
});
