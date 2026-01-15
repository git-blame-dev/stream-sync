const { describe, test, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { unmockModule, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

unmockModule('../../src/platforms/tiktok');
const { TikTokPlatform } = require('../../src/platforms/tiktok');
const { createMockTikTokPlatformDependencies } = require('../helpers/mock-factories');

describe('TikTokPlatform event emissions', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    const baseConfig = { enabled: true, username: 'event_tester' };

    const createPlatformUnderTest = () => {
        const webcastEvent = {
            CHAT: 'chat',
            GIFT: 'gift',
            FOLLOW: 'follow',
            ROOM_USER: 'roomUser',
            ENVELOPE: 'envelope',
            SUBSCRIBE: 'subscribe',
            SUPER_FAN: 'superfan',
            SOCIAL: 'social',
            ERROR: 'error',
            DISCONNECT: 'disconnect'
        };

        const dependencies = createMockTikTokPlatformDependencies({ webcastEvent });
        dependencies.connectionFactory = {
            createConnection: createMockFn().mockReturnValue({
                on: createMockFn(),
                removeAllListeners: createMockFn()
            }),
            cleanup: createMockFn()
        };
        const platform = new TikTokPlatform(baseConfig, dependencies);

        const eventHandlers = {};
        platform.connection = {
            on: createMockFn((event, handler) => {
                eventHandlers[event] = handler;
                return platform.connection;
            }),
            removeAllListeners: createMockFn()
        };

        const envelopes = [];
        const shares = [];
        const follows = [];
        const paypiggies = [];
        const viewerCounts = [];
        platform.handlers = {
            ...platform.handlers,
            onEnvelope: (data) => envelopes.push(data),
            onShare: (data) => shares.push(data),
            onFollow: (data) => follows.push(data),
            onPaypiggy: (data) => paypiggies.push(data),
            onViewerCount: (data) => viewerCounts.push(data)
        };

        platform.setupEventListeners();

        return { platform, eventHandlers, envelopes, shares, follows, paypiggies, viewerCounts, webcastEvent };
    };

    it('emits envelope events with the normalized payload', async () => {
        const { eventHandlers, envelopes, webcastEvent } = createPlatformUnderTest();
        const envelopePayload = {
            msgId: 'envelope-msg-1',
            amount: 42,
            currency: 'coins',
            user: { userId: 'envelope-user-id', uniqueId: 'envelopeUser' }
        };

        await eventHandlers[webcastEvent.ENVELOPE](envelopePayload);

        expect(envelopes).toHaveLength(1);
        expect(envelopes[0].type).toBe('platform:envelope');
        expect(envelopes[0].userId).toBe('envelope-user-id');
        expect(envelopes[0].username).toBe('envelopeUser');
        expect(envelopes[0].giftType).toBe('Treasure Chest');
        expect(envelopes[0].giftCount).toBe(1);
        expect(envelopes[0].amount).toBe(42);
        expect(envelopes[0].currency).toBe('coins');
        expect(envelopes[0].metadata).toBeUndefined();
    });

    it('emits social (share) events through the share channel', async () => {
        const { eventHandlers, shares, follows, webcastEvent } = createPlatformUnderTest();
        const socialPayload = {
            user: { userId: 'share-user-id', uniqueId: 'shareUser' },
            common: {
                displayText: {
                    displayType: 'pm_mt_guidance_share',
                    defaultPattern: '{0:user} shared the LIVE'
                }
            }
        };

        await eventHandlers[webcastEvent.SOCIAL](socialPayload);

        expect(shares).toHaveLength(1);
        expect(shares[0].metadata.interactionType).toBe('share');
        expect(shares[0].username).toBe('shareUser');
        expect(follows).toHaveLength(0);
    });

    it('emits follow from social payloads that only include follow wording', async () => {
        const { eventHandlers, shares, follows, webcastEvent } = createPlatformUnderTest();
        const socialPayload = {
            user: { userId: 'follow-user-id', uniqueId: 'followUser' },
            common: {
                displayText: { defaultPattern: '{0:user} followed the LIVE creator' }
            }
        };

        await eventHandlers[webcastEvent.SOCIAL](socialPayload);

        expect(follows).toHaveLength(1);
        expect(shares).toHaveLength(0);
        expect(follows[0].username).toBe('followUser');
    });

    it('treats share-shaped FOLLOW payloads as share events', async () => {
        const { eventHandlers, shares, follows, webcastEvent } = createPlatformUnderTest();
        const followPayload = {
            user: { userId: 'share-user-id', uniqueId: 'shareUser' },
            msgId: 'msg_share_follow_1',
            common: {
                displayText: {
                    displayType: 'pm_mt_guidance_share',
                    defaultPattern: '{0:user} shared the LIVE'
                }
            }
        };

        await eventHandlers[webcastEvent.FOLLOW](followPayload);

        expect(shares).toHaveLength(1);
        expect(shares[0].metadata.interactionType).toBe('share');
        expect(shares[0].username).toBe('shareUser');
        expect(follows).toHaveLength(0);
    });

    it('dedupes share events when SOCIAL then FOLLOW carry the same msgId', async () => {
        const { eventHandlers, shares, follows, webcastEvent } = createPlatformUnderTest();
        const socialPayload = {
            user: { userId: 'share-user-id', uniqueId: 'shareUser' },
            msgId: 'msg_share_dupe_social_first',
            common: {
                displayText: {
                    displayType: 'pm_mt_guidance_share',
                    defaultPattern: '{0:user} shared the LIVE'
                }
            }
        };
        const followPayload = { ...socialPayload };

        await eventHandlers[webcastEvent.SOCIAL](socialPayload);
        await eventHandlers[webcastEvent.FOLLOW](followPayload);

        expect(shares).toHaveLength(1);
        expect(shares[0].username).toBe('shareUser');
        expect(follows).toHaveLength(0);
    });

    it('dedupes share events when FOLLOW then SOCIAL carry the same msgId', async () => {
        const { eventHandlers, shares, follows, webcastEvent } = createPlatformUnderTest();
        const payload = {
            user: { userId: 'share-user-id', uniqueId: 'shareUser' },
            msgId: 'msg_share_dupe_follow_first',
            common: {
                displayText: {
                    displayType: 'pm_mt_guidance_share',
                    defaultPattern: '{0:user} shared the LIVE'
                }
            }
        };

        await eventHandlers[webcastEvent.FOLLOW](payload);
        await eventHandlers[webcastEvent.SOCIAL](payload);

        expect(shares).toHaveLength(1);
        expect(shares[0].username).toBe('shareUser');
        expect(follows).toHaveLength(0);
    });

    it('emits subscribe events as paypiggy notifications', async () => {
        const { eventHandlers, paypiggies, webcastEvent } = createPlatformUnderTest();
        const subscribePayload = { user: { userId: 'sub123', uniqueId: 'sub123', nickname: 'Subscriber' } };

        await eventHandlers[webcastEvent.SUBSCRIBE](subscribePayload);

        expect(paypiggies).toHaveLength(1);
        const event = paypiggies[0];
        expect(event.type).toBe('platform:paypiggy');
        expect(event.userId).toBe('sub123');
    });

    it('emits superfan subscription events with SuperFan tier', async () => {
        const { eventHandlers, paypiggies, webcastEvent } = createPlatformUnderTest();
        const superfanPayload = {
            user: {
                userId: 'sf123',
                uniqueId: 'sf123',
                nickname: 'SuperFanUser'
            }
        };

        await eventHandlers[webcastEvent.SUPER_FAN](superfanPayload);

        expect(paypiggies).toHaveLength(1);
        const event = paypiggies[0];
        expect(event.type).toBe('platform:paypiggy');
        expect(event.platform).toBe('tiktok');
        expect(event.userId).toBe('sf123');
        expect(event.username).toBe('sf123');
        expect(event.tier).toBe('superfan');
        expect(event.metadata).toBeUndefined();
    });

    it('emits viewer count updates via PlatformEvents.VIEWER_COUNT', () => {
        const { eventHandlers, viewerCounts, webcastEvent } = createPlatformUnderTest();
        const viewerPayload = { viewerCount: 777 };

        eventHandlers[webcastEvent.ROOM_USER](viewerPayload);

        expect(viewerCounts).toHaveLength(1);
        expect(viewerCounts[0].platform).toBe('tiktok');
        expect(viewerCounts[0].count).toBe(777);
    });
});
