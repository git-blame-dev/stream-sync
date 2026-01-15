const { describe, test, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { YouTubePlatform } = require('../../src/platforms/youtube');
const { getSyntheticFixture } = require('../helpers/platform-test-data');
const {
    initializeTestLogging,
    createMockConfig,
    createMockPlatformDependencies
} = require('../helpers/test-setup');

initializeTestLogging();

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('YouTubePlatform dispatch table behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const baseConfig = createMockConfig('youtube', {
        enabled: true,
        username: 'test-channel',
        apiKey: 'test-key'
    });

    const createPlatform = () => new YouTubePlatform(baseConfig, {
        ...createMockPlatformDependencies('youtube'),
        streamDetectionService: {
            detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
        }
    });

    test('routes gift membership purchase announcements to giftpaypiggy notifications', async () => {
        const platform = createPlatform();
        const giftEvents = [];
        platform.handlers = {
            ...(platform.handlers || {}),
            onGiftPaypiggy: (event) => giftEvents.push(event)
        };

        const giftPurchase = getSyntheticFixture('youtube', 'gift-purchase-header');
        platform.handleChatMessage(giftPurchase);
        await flushPromises();

        expect(giftEvents).toHaveLength(1);
        const [event] = giftEvents;
        expect(event.type).toBe('platform:giftpaypiggy');
        expect(event.platform).toBe('youtube');
        expect(event.giftCount).toBe(5);
        expect(event.username).toBe('GiftGiver');
        expect(event.id).toBe(giftPurchase.item.id);
        expect(typeof event.timestamp).toBe('string');
        expect(event.timestamp.trim()).not.toBe('');
    });

    test('ignores gift membership redemption announcements', async () => {
        const platform = createPlatform();
        const giftEvents = [];
        platform.handlers = {
            ...(platform.handlers || {}),
            onGiftPaypiggy: (event) => giftEvents.push(event)
        };

        platform.handleChatMessage({
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatSponsorshipsGiftRedemptionAnnouncement',
                id: 'LCC.test-gift-redemption-001',
                timestampUsec: '1704067200000000',
                author: {
                    id: 'UC_TEST_CHANNEL_000001',
                    name: '@GiftedViewer'
                }
            }
        });
        await flushPromises();

        expect(giftEvents).toHaveLength(0);
    });
});
