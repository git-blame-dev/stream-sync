const { describe, test, expect, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { PlatformEvents } = require('../../../../../src/interfaces/PlatformEvents');
const { createYouTubeEventRouter } = require('../../../../../src/platforms/youtube/events/event-router');

describe('YouTube event router', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('routes event types to platform handlers', async () => {
        const superChatCalls = [];
        const superStickerCalls = [];
        const membershipCalls = [];
        const giftMembershipCalls = [];
        const chatTextCalls = [];
        const lowPriorityCalls = [];

        const platform = {
            logger: noOpLogger,
            handleSuperChat: (item) => superChatCalls.push(item),
            handleSuperSticker: (item) => superStickerCalls.push(item),
            handleMembership: (item) => membershipCalls.push(item),
            handleGiftMembershipPurchase: (item) => giftMembershipCalls.push(item),
            handleChatTextMessage: (item) => chatTextCalls.push(item),
            handleLowPriorityEvent: (item, type) => lowPriorityCalls.push({ item, type }),
            _emitPlatformEvent: () => {},
            eventFactory: {
                createErrorEvent: () => ({ type: PlatformEvents.ERROR, platform: 'youtube' })
            }
        };

        const router = createYouTubeEventRouter({ platform });
        const chatItem = (type) => ({ item: { type } });

        await router.routeEvent(chatItem('LiveChatPaidMessage'), 'LiveChatPaidMessage');
        await router.routeEvent(chatItem('LiveChatPaidSticker'), 'LiveChatPaidSticker');
        await router.routeEvent(chatItem('LiveChatMembershipItem'), 'LiveChatMembershipItem');
        await router.routeEvent(chatItem('LiveChatSponsorshipsGiftPurchaseAnnouncement'), 'LiveChatSponsorshipsGiftPurchaseAnnouncement');
        await router.routeEvent(chatItem('LiveChatTextMessage'), 'LiveChatTextMessage');
        await router.routeEvent(chatItem('LiveChatViewerEngagementMessage'), 'LiveChatViewerEngagementMessage');

        expect(superChatCalls).toHaveLength(1);
        expect(superStickerCalls).toHaveLength(1);
        expect(membershipCalls).toHaveLength(1);
        expect(giftMembershipCalls).toHaveLength(1);
        expect(chatTextCalls).toHaveLength(1);
        expect(lowPriorityCalls).toHaveLength(1);
        expect(lowPriorityCalls[0].type).toBe('LiveChatViewerEngagementMessage');
    });

    test('emits platform error when handler is missing', async () => {
        const emittedEvents = [];

        const platform = {
            logger: noOpLogger,
            handleSuperChat: undefined,
            _emitPlatformEvent: (eventType, payload) => emittedEvents.push({ eventType, payload }),
            eventFactory: {
                createErrorEvent: () => ({ type: PlatformEvents.ERROR, platform: 'youtube' })
            }
        };

        const router = createYouTubeEventRouter({ platform });

        await router.routeEvent({ item: { type: 'LiveChatPaidMessage' } }, 'LiveChatPaidMessage');

        expect(emittedEvents).toHaveLength(1);
        expect(emittedEvents[0].eventType).toBe(PlatformEvents.ERROR);
        expect(emittedEvents[0].payload).toMatchObject({
            type: PlatformEvents.ERROR,
            platform: 'youtube'
        });
    });
});
