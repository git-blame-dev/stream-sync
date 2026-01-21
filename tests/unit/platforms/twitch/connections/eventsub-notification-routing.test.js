const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');

const TwitchEventSub = require('../../../../../src/platforms/twitch-eventsub');

const createEventSub = (configOverrides = {}, depsOverrides = {}) => {
    const config = {
        clientId: 'test-client-id',
        accessToken: 'test-token',
        channel: 'teststreamer',
        username: 'teststreamer',
        dataLoggingEnabled: false,
        broadcasterId: 'test-broadcaster-id',
        ...configOverrides
    };
    const authManager = depsOverrides.authManager || {
        getState: () => 'READY',
        getUserId: () => 'test-user-123',
        getAccessToken: async () => 'test-token',
        authState: { executeWhenReady: async (fn) => fn() }
    };
    return new TwitchEventSub(config, {
        logger: noOpLogger,
        authManager,
        axios: { post: createMockFn().mockResolvedValue({ data: {} }), get: createMockFn().mockResolvedValue({ data: {} }), delete: createMockFn().mockResolvedValue({ data: {} }) },
        WebSocketCtor: class { close() {} },
        ChatFileLoggingService: class { logRawPlatformData() {} },
        ...depsOverrides
    });
};

describe('TwitchEventSub notification routing', () => {
    let eventSub;

    afterEach(() => {
        if (eventSub?.cleanup) {
            eventSub.cleanup().catch(() => {});
        }
    });

    it('routes chat notifications and emits message event', async () => {
        eventSub = createEventSub();
        const messageEvents = [];
        eventSub.on('message', (data) => messageEvents.push(data));

        const payload = {
            metadata: { message_type: 'notification', message_id: 'test-msg-id-1' },
            payload: {
                subscription: { type: 'channel.chat.message' },
                event: {
                    message: { text: 'hello from chat' },
                    chatter_user_name: 'TestChatter',
                    chatter_user_id: 'chatter-123',
                    broadcaster_user_id: 'broadcaster-456'
                }
            }
        };

        await eventSub.handleWebSocketMessage(payload);

        expect(messageEvents).toHaveLength(1);
        expect(messageEvents[0].context.username).toBe('TestChatter');
        expect(messageEvents[0].message).toBe('hello from chat');
    });

    it('routes follow notifications and emits follow event', async () => {
        eventSub = createEventSub();
        const followEvents = [];
        eventSub.on('follow', (data) => followEvents.push(data));

        const payload = {
            metadata: { message_type: 'notification', message_id: 'test-msg-id-2' },
            payload: {
                subscription: { type: 'channel.follow' },
                event: {
                    user_name: 'NewFollower',
                    user_id: 'follower-456',
                    followed_at: '2024-01-01T00:00:00Z'
                }
            }
        };

        await eventSub.handleWebSocketMessage(payload);

        expect(followEvents).toHaveLength(1);
        expect(followEvents[0].username).toBe('NewFollower');
    });

    it('emits subscription events with canonical months for renewal handling', () => {
        eventSub = createEventSub();
        const paypiggyEvents = [];
        eventSub.on('paypiggy', (data) => paypiggyEvents.push(data));

        const subscriptionEvent = {
            user_name: 'LongTenure',
            user_id: '123',
            tier: '1000',
            cumulative_months: 7,
            is_gift: false,
            timestamp: '2024-01-01T00:00:00Z'
        };

        eventSub._handlePaypiggyEvent(subscriptionEvent);

        expect(paypiggyEvents).toHaveLength(1);
        expect(paypiggyEvents[0]).toMatchObject({
            username: 'LongTenure',
            months: 7,
            timestamp: subscriptionEvent.timestamp
        });
    });

    it('emits resubscription messages with canonical months for renewal handling', () => {
        eventSub = createEventSub();
        const paypiggyMessageEvents = [];
        eventSub.on('paypiggyMessage', (data) => paypiggyMessageEvents.push(data));

        const resubEvent = {
            user_name: 'Resubber',
            user_id: '456',
            tier: '1000',
            cumulative_months: 9,
            message: { text: 'Great stream!' },
            timestamp: '2024-01-01T00:00:00Z'
        };

        eventSub._handlePaypiggyMessageEvent(resubEvent);

        expect(paypiggyMessageEvents).toHaveLength(1);
        expect(paypiggyMessageEvents[0]).toMatchObject({
            username: 'Resubber',
            months: 9,
            message: 'Great stream!',
            timestamp: resubEvent.timestamp
        });
    });

    it('routes raid events and emits raid event', async () => {
        eventSub = createEventSub();
        const raidEvents = [];
        eventSub.on('raid', (data) => raidEvents.push(data));

        const payload = {
            metadata: { message_type: 'notification', message_id: 'test-msg-id-3' },
            payload: {
                subscription: { type: 'channel.raid' },
                event: {
                    from_broadcaster_user_name: 'RaiderStreamer',
                    from_broadcaster_user_id: 'raider-789',
                    viewers: 50,
                    timestamp: '2024-01-01T00:00:00Z'
                }
            }
        };

        await eventSub.handleWebSocketMessage(payload);

        expect(raidEvents).toHaveLength(1);
        expect(raidEvents[0].username).toBe('RaiderStreamer');
        expect(raidEvents[0].viewerCount).toBe(50);
    });
});
