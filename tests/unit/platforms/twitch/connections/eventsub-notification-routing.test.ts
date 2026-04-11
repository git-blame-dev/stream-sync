const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');

const { TwitchEventSub } = require('../../../../../src/platforms/twitch-eventsub.ts');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../../../src/core/secrets');

const createReadyTwitchAuth = () => ({
    isReady: () => true,
    refreshTokens: createMockFn().mockResolvedValue(true),
    getUserId: () => 'test-user-123'
});

const createEventSub = (configOverrides = {}, depsOverrides = {}) => {
    const config = {
        clientId: 'test-client-id',
        channel: 'teststreamer',
        username: 'teststreamer',
        dataLoggingEnabled: false,
        broadcasterId: 'test-broadcaster-id',
        ...configOverrides
    };
    secrets.twitch.accessToken = 'test-token';
    if (!depsOverrides.twitchAuth) {
        throw new Error('twitchAuth is required - provide explicit mock');
    }
    const twitchAuth = depsOverrides.twitchAuth;
    return new TwitchEventSub(config, {
        logger: noOpLogger,
        twitchAuth,
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
        _resetForTesting();
        initializeStaticSecrets();
    });

    it('routes chat notifications and emits chat message event', async () => {
        eventSub = createEventSub({}, { twitchAuth: createReadyTwitchAuth() });
        const messageEvents = [];
        eventSub.on('chatMessage', (data) => messageEvents.push(data));

        const payload = {
            metadata: {
                message_type: 'notification',
                message_id: 'test-msg-id-1',
                message_timestamp: '2024-01-01T00:00:00.123456789Z'
            },
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
        expect(messageEvents[0].chatter_user_name).toBe('TestChatter');
        expect(messageEvents[0].message.text).toBe('hello from chat');
        expect(messageEvents[0].timestamp).toBe('2024-01-01T00:00:00.123Z');
    });

    it('preserves EventSub message fragments on routed chat notifications', async () => {
        eventSub = createEventSub({}, { twitchAuth: createReadyTwitchAuth() });
        const messageEvents = [];
        eventSub.on('chatMessage', (data) => messageEvents.push(data));

        const payload = {
            metadata: {
                message_type: 'notification',
                message_id: 'test-msg-id-fragments',
                message_timestamp: '2024-01-01T00:00:00.555666777Z'
            },
            payload: {
                subscription: { type: 'channel.chat.message' },
                event: {
                    message: {
                        text: 'testEmote test message',
                        fragments: [
                            {
                                type: 'emote',
                                text: 'testEmote',
                                emote: {
                                    id: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                                    format: ['static', 'animated']
                                }
                            },
                            {
                                type: 'text',
                                text: ' test message'
                            }
                        ]
                    },
                    chatter_user_name: 'test-chat-user-name',
                    chatter_user_id: 'test-chat-user-id',
                    broadcaster_user_id: 'test-broadcaster-id'
                }
            }
        };

        await eventSub.handleWebSocketMessage(payload);

        expect(messageEvents).toHaveLength(1);
        expect(messageEvents[0].timestamp).toBe('2024-01-01T00:00:00.555Z');
        expect(messageEvents[0].message.fragments).toEqual([
            {
                type: 'emote',
                text: 'testEmote',
                emote: {
                    id: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                    format: ['static', 'animated']
                }
            },
            {
                type: 'text',
                text: ' test message'
            }
        ]);
    });

    it('routes follow notifications and emits follow event', async () => {
        eventSub = createEventSub({}, { twitchAuth: createReadyTwitchAuth() });
        const followEvents = [];
        eventSub.on('follow', (data) => followEvents.push(data));

        const payload = {
            metadata: { message_type: 'notification', message_id: 'test-msg-id-2' },
            payload: {
                subscription: { type: 'channel.follow' },
                event: {
                    user_name: 'NewFollower',
                    user_id: 'newfollower-1',
                    user_login: 'newfollower',
                    followed_at: '2024-01-01T00:00:00Z'
                }
            }
        };

        await eventSub.handleWebSocketMessage(payload);

        expect(followEvents).toHaveLength(1);
        expect(followEvents[0].username).toBe('NewFollower');
        expect(followEvents[0].timestamp).toBe('2024-01-01T00:00:00.000Z');
    });

    it('emits subscription events with canonical months for renewal handling', () => {
        eventSub = createEventSub({}, { twitchAuth: createReadyTwitchAuth() });
        const paypiggyEvents = [];
        eventSub.on('paypiggy', (data) => paypiggyEvents.push(data));

        const subscriptionEvent = {
            user_name: 'LongTenure',
            user_id: 'longtenure-1',
            user_login: 'longtenure',
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
        eventSub = createEventSub({}, { twitchAuth: createReadyTwitchAuth() });
        const paypiggyMessageEvents = [];
        eventSub.on('paypiggyMessage', (data) => paypiggyMessageEvents.push(data));

        const resubEvent = {
            user_name: 'Resubber',
            user_id: 'resubber-1',
            user_login: 'resubber',
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
        eventSub = createEventSub({}, { twitchAuth: createReadyTwitchAuth() });
        const raidEvents = [];
        eventSub.on('raid', (data) => raidEvents.push(data));

        const payload = {
            metadata: {
                message_type: 'notification',
                message_id: 'test-msg-id-3',
                message_timestamp: '2024-01-01T00:00:00.456789123Z'
            },
            payload: {
                subscription: { type: 'channel.raid' },
                event: {
                    from_broadcaster_user_name: 'RaiderStreamer',
                    from_broadcaster_user_id: 'raiderstreamer-1',
                    from_broadcaster_user_login: 'raiderstreamer',
                    viewers: 50
                }
            }
        };

        await eventSub.handleWebSocketMessage(payload);

        expect(raidEvents).toHaveLength(1);
        expect(raidEvents[0].username).toBe('RaiderStreamer');
        expect(raidEvents[0].viewerCount).toBe(50);
        expect(raidEvents[0].timestamp).toBe('2024-01-01T00:00:00.456Z');
    });

    it('routes bits notifications when canonical id comes from metadata message_id', async () => {
        eventSub = createEventSub({}, { twitchAuth: createReadyTwitchAuth() });
        const giftEvents = [];
        eventSub.on('gift', (data) => giftEvents.push(data));

        const payload = {
            metadata: {
                message_type: 'notification',
                message_id: 'test-eventsub-bits-id-1',
                message_timestamp: '2024-01-01T00:00:00.654321987Z'
            },
            payload: {
                subscription: { type: 'channel.bits.use' },
                event: {
                    user_name: 'BitsCheerer',
                    user_id: 'bitscheerer-1',
                    user_login: 'bitscheerer',
                    bits: 88,
                    message: {
                        text: 'Cheer88 test message'
                    }
                }
            }
        };

        await eventSub.handleWebSocketMessage(payload);

        expect(giftEvents).toHaveLength(1);
        expect(giftEvents[0].id).toBe('test-eventsub-bits-id-1');
        expect(giftEvents[0].amount).toBe(88);
        expect(giftEvents[0].timestamp).toBe('2024-01-01T00:00:00.654Z');
    });
});
