const { describe, test, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../../helpers/bun-mock-utils');

const { YouTubePlatform } = require('../../../../../src/platforms/youtube');
const { getSyntheticFixture } = require('../../../../helpers/platform-test-data');
const {
    initializeTestLogging,
    createMockConfig,
    createMockPlatformDependencies
} = require('../../../../helpers/test-setup');

initializeTestLogging();

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));
const getDebugCalls = (logger) => logger.debug.mock.calls.map(([message, _scope, metadata]) => ({
    message,
    metadata: metadata || null
}));

describe('YouTubePlatform event routing behavior', () => {
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
        await platform.handleChatMessage(giftPurchase);
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

        await platform.handleChatMessage({
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
        const debugCalls = getDebugCalls(platform.logger);
        const giftLog = debugCalls.find(({ message }) =>
            message.includes('ignored gifted membership announcement for GiftedViewer')
        );
        expect(giftLog).toBeTruthy();
        expect(giftLog.metadata).toMatchObject({
            action: 'ignored_gifted_membership_announcement',
            recipient: 'GiftedViewer',
            eventType: 'LiveChatSponsorshipsGiftRedemptionAnnouncement'
        });
    });

    test('uses fallback username when gift redemption recipient is missing', async () => {
        const platform = createPlatform();

        await platform.handleChatMessage({
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatSponsorshipsGiftRedemptionAnnouncement',
                id: 'LCC.test-gift-redemption-002',
                timestampUsec: '1704067201000000',
                author: {
                    id: 'UC_TEST_CHANNEL_000002',
                    name: 'N/A'
                }
            }
        });
        await flushPromises();

        const debugCalls = getDebugCalls(platform.logger);
        const giftLog = debugCalls.find(({ message }) =>
            message.includes('ignored gifted membership announcement for Unknown User')
        );
        expect(giftLog).toBeTruthy();
        expect(giftLog.metadata).toMatchObject({
            action: 'ignored_gifted_membership_announcement',
            recipient: 'Unknown User',
            eventType: 'LiveChatSponsorshipsGiftRedemptionAnnouncement'
        });
    });

    test('logs ignored duplicates for renderer variants without unknown-event logging', async () => {
        const platform = createPlatform();
        platform.logRawPlatformData = createMockFn().mockResolvedValue();

        await platform.handleChatMessage({
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatPaidMessageRenderer',
                id: 'LCC.test-renderer-001',
                timestampUsec: '1704067202000000',
                author: {
                    id: 'UC_TEST_CHANNEL_000003',
                    name: '@RendererUser'
                }
            }
        });
        await flushPromises();

        expect(platform.logRawPlatformData).toHaveBeenCalledTimes(0);
        const debugCalls = getDebugCalls(platform.logger);
        const duplicateLog = debugCalls.find(({ message }) =>
            message.includes('ignored duplicate LiveChatPaidMessageRenderer')
        );
        expect(duplicateLog).toBeTruthy();
        expect(duplicateLog.metadata).toMatchObject({
            action: 'ignored_duplicate',
            eventType: 'LiveChatPaidMessageRenderer',
            author: 'RendererUser'
        });
    });
});
