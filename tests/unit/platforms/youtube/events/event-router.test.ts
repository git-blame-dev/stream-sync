const { describe, test, expect, afterEach } = require('bun:test');
export {};
const { restoreAllMocks } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { PlatformEvents } = require('../../../../../src/interfaces/PlatformEvents');
const { createYouTubeEventRouter } = require('../../../../../src/platforms/youtube/events/event-router.ts');

describe('YouTube event router', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('routes event types to platform handlers', async () => {
        const superChatCalls: unknown[] = [];
        const superStickerCalls: unknown[] = [];
        const membershipCalls: unknown[] = [];
        const giftMembershipCalls: unknown[] = [];
        const chatTextCalls: unknown[] = [];
        const lowPriorityCalls: Array<{ item: unknown; type: string }> = [];

        const platform = {
            logger: noOpLogger,
            handleSuperChat: (item: unknown) => superChatCalls.push(item),
            handleSuperSticker: (item: unknown) => superStickerCalls.push(item),
            handleMembership: (item: unknown) => membershipCalls.push(item),
            handleGiftMembershipPurchase: (item: unknown) => giftMembershipCalls.push(item),
            handleChatTextMessage: (item: unknown) => chatTextCalls.push(item),
            handleLowPriorityEvent: (item: unknown, type: string) => lowPriorityCalls.push({ item, type }),
            _emitPlatformEvent: () => {},
            eventFactory: {
                createErrorEvent: () => ({ type: PlatformEvents.ERROR, platform: 'youtube' })
            }
        };

        const router = createYouTubeEventRouter({ platform });
        const chatItem = (type: string): { item: { type: string } } => ({ item: { type } });

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
        const emittedEvents: Array<{ eventType: string; payload: unknown }> = [];

        const platform = {
            logger: noOpLogger,
            handleSuperChat: undefined,
            _emitPlatformEvent: (eventType: string, payload: unknown) => emittedEvents.push({ eventType, payload }),
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

    test('passes LiveChatTextMessage runs payload through to handleChatTextMessage', async () => {
        const chatTextCalls: Array<{ item: { message: { runs: unknown[] } } }> = [];

        const platform = {
            logger: noOpLogger,
            handleChatTextMessage: (item: { item: { message: { runs: unknown[] } } }) => chatTextCalls.push(item),
            _emitPlatformEvent: () => {},
            eventFactory: {
                createErrorEvent: () => ({ type: PlatformEvents.ERROR, platform: 'youtube' })
            }
        };

        const router = createYouTubeEventRouter({ platform });
        const chatItem = {
            item: {
                type: 'LiveChatTextMessage',
                author: {
                    id: 'UC_TEST_CHANNEL_000500',
                    name: 'RouterRunsUser'
                },
                message: {
                    runs: [
                        { text: 'hello ' },
                        {
                            emoji: {
                                emoji_id: 'UC_TEST_EMOTE_500/TEST_EMOTE_500',
                                image: [{ url: 'https://yt3.ggpht.example.invalid/test-500=w48-h48-c-k-nd', width: 48 }]
                            }
                        }
                    ]
                }
            }
        };

        await router.routeEvent(chatItem, 'LiveChatTextMessage');

        expect(chatTextCalls).toHaveLength(1);
        expect(chatTextCalls[0].item.message.runs).toEqual(chatItem.item.message.runs);
    });

    test('throws when platform dependency is missing', () => {
        expect(() => createYouTubeEventRouter()).toThrow('YouTube event router requires platform');
    });

    test('throws when logger dependency is missing', () => {
        expect(() => createYouTubeEventRouter({ platform: {} })).toThrow('YouTube event router requires logger dependency');
    });

    test('returns false for invalid event type input', async () => {
        const router = createYouTubeEventRouter({
            platform: {
                logger: noOpLogger,
                _emitPlatformEvent: () => {}
            }
        });

        await expect(router.routeEvent({ item: { type: 'LiveChatTextMessage' } }, null)).resolves.toBe(false);
    });

    test('returns false for low-priority event when handler is missing', async () => {
        const router = createYouTubeEventRouter({
            platform: {
                logger: noOpLogger,
                _emitPlatformEvent: () => {},
                eventFactory: {
                    createErrorEvent: () => ({ type: PlatformEvents.ERROR, platform: 'youtube' })
                }
            }
        });

        await expect(router.routeEvent({ item: { type: 'LiveChatViewerEngagementMessage' } }, 'LiveChatViewerEngagementMessage')).resolves.toBe(false);
    });

    test('returns false for missing mapped handler without error event dependencies', async () => {
        const router = createYouTubeEventRouter({
            platform: {
                logger: noOpLogger,
                handleSuperChat: undefined
            }
        });

        await expect(router.routeEvent({ item: { type: 'LiveChatPaidMessage' } }, 'LiveChatPaidMessage')).resolves.toBe(false);
    });

    test('returns false when platform error event emit fails', async () => {
        const router = createYouTubeEventRouter({
            platform: {
                logger: noOpLogger,
                handleSuperChat: undefined,
                _emitPlatformEvent: () => {
                    throw new Error('emit failed');
                },
                eventFactory: {
                    createErrorEvent: () => ({ type: PlatformEvents.ERROR, platform: 'youtube' })
                }
            }
        });

        await expect(router.routeEvent({ item: { type: 'LiveChatPaidMessage' } }, 'LiveChatPaidMessage')).resolves.toBe(false);
    });
});
