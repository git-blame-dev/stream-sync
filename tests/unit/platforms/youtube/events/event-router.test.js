const { describe, test, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { PlatformEvents } = require('../../../../../src/interfaces/PlatformEvents');
const { createYouTubeEventRouter } = require('../../../../../src/platforms/youtube/events/event-router');

describe('YouTube event router', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const createPlatform = (overrides = {}) => {
        const platform = {
            logger: noOpLogger,
            handleSuperChat: createMockFn(),
            handleSuperSticker: createMockFn(),
            handleMembership: createMockFn(),
            handleGiftMembershipPurchase: createMockFn(),
            handleChatTextMessage: createMockFn(),
            handleLowPriorityEvent: createMockFn(),
            _emitPlatformEvent: createMockFn(),
            eventFactory: {
                createErrorEvent: createMockFn(() => ({
                    type: PlatformEvents.ERROR,
                    platform: 'youtube'
                }))
            },
            ...overrides
        };

        return platform;
    };

    test('routes event types to platform handlers', async () => {
        const platform = createPlatform();
        const router = createYouTubeEventRouter({ platform });
        const chatItem = (type) => ({ item: { type } });

        await router.routeEvent(chatItem('LiveChatPaidMessage'), 'LiveChatPaidMessage');
        await router.routeEvent(chatItem('LiveChatPaidSticker'), 'LiveChatPaidSticker');
        await router.routeEvent(chatItem('LiveChatMembershipItem'), 'LiveChatMembershipItem');
        await router.routeEvent(chatItem('LiveChatSponsorshipsGiftPurchaseAnnouncement'), 'LiveChatSponsorshipsGiftPurchaseAnnouncement');
        await router.routeEvent(chatItem('LiveChatTextMessage'), 'LiveChatTextMessage');
        await router.routeEvent(chatItem('LiveChatViewerEngagementMessage'), 'LiveChatViewerEngagementMessage');

        expect(platform.handleSuperChat).toHaveBeenCalledTimes(1);
        expect(platform.handleSuperSticker).toHaveBeenCalledTimes(1);
        expect(platform.handleMembership).toHaveBeenCalledTimes(1);
        expect(platform.handleGiftMembershipPurchase).toHaveBeenCalledTimes(1);
        expect(platform.handleChatTextMessage).toHaveBeenCalledTimes(1);
        expect(platform.handleLowPriorityEvent).toHaveBeenCalledTimes(1);
        expect(platform.handleLowPriorityEvent).toHaveBeenCalledWith(
            expect.any(Object),
            'LiveChatViewerEngagementMessage'
        );
    });

    test('emits platform error when handler is missing', async () => {
        const platform = createPlatform({ handleSuperChat: undefined });
        const router = createYouTubeEventRouter({ platform });

        await router.routeEvent({ item: { type: 'LiveChatPaidMessage' } }, 'LiveChatPaidMessage');

        expect(platform._emitPlatformEvent).toHaveBeenCalledTimes(1);
        const [eventType, payload] = platform._emitPlatformEvent.mock.calls[0];
        expect(eventType).toBe(PlatformEvents.ERROR);
        expect(payload).toMatchObject({
            type: PlatformEvents.ERROR,
            platform: 'youtube'
        });
    });
});
