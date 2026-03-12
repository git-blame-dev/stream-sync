const { describe, test, expect } = require('bun:test');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { createTwitchEventSubEventRouter } = require('../../../../../src/platforms/twitch/events/event-router');

describe('Twitch EventSub event router', () => {
    test('emits chat message payloads with metadata timestamp', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { channel: 'streamer', dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('channel.chat.message', {
            chatter_user_id: '1',
            chatter_user_name: 'viewer',
            broadcaster_user_id: '2',
            message: { text: 'hi' }
        }, {
            message_timestamp: '2024-01-01T00:00:00.123456789Z'
        });

        const messageEvent = emitted.find((evt) => evt.type === 'chatMessage');
        expect(messageEvent).toBeDefined();
        expect(messageEvent.payload.message.text).toBe('hi');
        expect(messageEvent.payload.chatter_user_name).toBe('viewer');
        expect(messageEvent.payload.timestamp).toBe('2024-01-01T00:00:00.123Z');
    });

    test('keeps chat message fragments when applying metadata timestamp fallback', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { channel: 'streamer', dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('channel.chat.message', {
            chatter_user_id: 'test-chat-user-id',
            chatter_user_name: 'test-chat-user-name',
            broadcaster_user_id: 'test-broadcaster-id',
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
            }
        }, {
            message_timestamp: '2024-01-01T00:00:00.123456789Z'
        });

        const messageEvent = emitted.find((evt) => evt.type === 'chatMessage');
        expect(messageEvent).toBeDefined();
        expect(messageEvent.payload.timestamp).toBe('2024-01-01T00:00:00.123Z');
        expect(messageEvent.payload.message.fragments).toEqual([
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

    test('does not emit chat events when timestamp is missing', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { channel: 'streamer', dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('channel.chat.message', {
            chatter_user_id: '1',
            chatter_user_name: 'viewer',
            broadcaster_user_id: '2',
            message: { text: 'hi' }
        });

        expect(emitted.find((evt) => evt.type === 'chatMessage')).toBeUndefined();
    });

    test('does not emit follow events when followed_at is missing', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('channel.follow', {
            user_name: 'Follower',
            user_id: 'follower-1',
            user_login: 'follower'
        });

        expect(emitted.find((evt) => evt.type === 'follow')).toBeUndefined();
    });

    test('emits follow events when followed_at is present', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('channel.follow', {
            user_name: 'Follower',
            user_id: 'follower-2',
            user_login: 'follower',
            followed_at: '2024-02-01T00:00:00Z'
        });

        const followEvent = emitted.find((evt) => evt.type === 'follow');
        expect(followEvent).toBeDefined();
        expect(followEvent.payload).toMatchObject({
            username: 'Follower',
            userId: 'follower',
            timestamp: '2024-02-01T00:00:00.000Z'
        });
    });

    test('emits bits gifts when cheermote data is missing', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleBitsUseEvent({
            user_name: 'Cheerer',
            user_id: '777',
            user_login: 'cheerer',
            bits: 50,
            message_id: 'bits-msg-1',
            message: { text: 'hello' },
            timestamp: '2024-01-01T00:00:00Z'
        });

        const giftEvent = emitted.find((evt) => evt.type === 'gift');
        expect(giftEvent).toBeDefined();
        expect(giftEvent.payload.giftType).toBe('bits');
        expect(giftEvent.payload.message).toBe('hello');
        expect(giftEvent.payload.id).toBe('bits-msg-1');
        expect(giftEvent.payload.cheermoteInfo).toBeNull();
    });

    test('does not emit stream status events without required timestamps', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('stream.online', { id: 'stream-1' });
        router.handleNotificationEvent('stream.offline', { id: 'stream-1' });

        expect(emitted.find((evt) => evt.type === 'streamOnline')).toBeUndefined();
        expect(emitted.find((evt) => evt.type === 'streamOffline')).toBeUndefined();
    });

    test('suppresses gift subscription notifications for gift events', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handlePaypiggyEvent({
            user_name: 'GiftedUser',
            user_id: '123',
            user_login: 'gifteduser',
            is_gift: true
        });

        expect(emitted).toEqual([]);
    });

    test('emits subscription payloads with normalized months and metadata timestamp', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('channel.subscribe', {
            user_name: 'Subscriber',
            user_id: 'sub-1',
            user_login: 'subscriber',
            tier: '1000',
            cumulative_months: '6',
            is_gift: false
        }, {
            message_timestamp: '2024-03-01T00:00:00.111222333Z'
        });

        const paypiggyEvent = emitted.find((evt) => evt.type === 'paypiggy');
        expect(paypiggyEvent).toBeDefined();
        expect(paypiggyEvent.payload).toMatchObject({
            username: 'Subscriber',
            userId: 'subscriber',
            tier: '1000',
            months: 6,
            timestamp: '2024-03-01T00:00:00.111Z'
        });
    });

    test('emits subscription message payloads with message text and metadata timestamp', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('channel.subscription.message', {
            user_name: 'Resubber',
            user_id: 'resub-1',
            user_login: 'resubber',
            tier: '1000',
            cumulative_months: 12,
            message: { text: 'Still here!' }
        }, {
            message_timestamp: '2024-03-02T00:00:00.987654321Z'
        });

        const messageEvent = emitted.find((evt) => evt.type === 'paypiggyMessage');
        expect(messageEvent).toBeDefined();
        expect(messageEvent.payload).toMatchObject({
            username: 'Resubber',
            userId: 'resubber',
            tier: '1000',
            months: 12,
            message: 'Still here!',
            timestamp: '2024-03-02T00:00:00.987Z'
        });
    });

    test('extracts text content from bits.use fragments and emits a gift payload', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleBitsUseEvent({
            user_name: 'Cheerer',
            user_id: '777',
            user_login: 'cheerer',
            bits: 50,
            id: 'bits-evt-1',
            message: {
                fragments: [
                    { type: 'cheermote', text: 'Cheer50', cheermote: { prefix: 'Cheer', bits: 50 } },
                    { type: 'text', text: 'hello ' },
                    { type: 'text', text: 'world' }
                ]
            },
            timestamp: '2024-01-01T00:00:00Z'
        });

        const giftEvent = emitted.find((evt) => evt.type === 'gift');
        expect(giftEvent).toBeDefined();
        expect(giftEvent.payload.username).toBe('Cheerer');
        expect(giftEvent.payload.amount).toBe(50);
        expect(giftEvent.payload.currency).toBe('bits');
        expect(giftEvent.payload.giftCount).toBe(1);
        expect(giftEvent.payload.giftType).toBe('bits');
        expect(giftEvent.payload.message).toBe('hello world');
        expect(giftEvent.payload.repeatCount).toBe(1);
        expect(giftEvent.payload.id).toEqual(expect.any(String));
    });

    test('emits anonymous bits gifts without identity fields', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleBitsUseEvent({
            bits: 25,
            id: 'bits-anon-1',
            is_anonymous: true,
            message: { text: 'wow' },
            timestamp: '2024-01-02T00:00:00Z'
        });

        const giftEvent = emitted.find((evt) => evt.type === 'gift');
        expect(giftEvent).toBeDefined();
        expect(giftEvent.payload.isAnonymous).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(giftEvent.payload, 'username')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(giftEvent.payload, 'userId')).toBe(false);
    });

    test('does not emit bits gifts when metadata timestamp is missing', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('channel.bits.use', {
            user_name: 'Cheerer',
            user_id: '777',
            user_login: 'cheerer',
            bits: 50,
            id: 'bits-evt-missing-ts',
            message: {
                fragments: [
                    { type: 'cheermote', text: 'Cheer50', cheermote: { prefix: 'Cheer', bits: 50 } },
                    { type: 'text', text: 'hello ' },
                    { type: 'text', text: 'world' }
                ]
            }
        });

        const giftEvent = emitted.find((evt) => evt.type === 'gift');
        expect(giftEvent).toBeUndefined();
    });

    test('emits paypiggyGift payloads with gift count and cumulative total', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('channel.subscription.gift', {
            user_name: 'GiftPilot',
            user_login: 'giftpilot',
            tier: '1000',
            total: 3,
            cumulative_total: 12,
            is_anonymous: true
        }, {
            message_timestamp: '2024-01-01T00:00:00.444555666Z'
        });

        const giftEvent = emitted.find((evt) => evt.type === 'paypiggyGift');
        expect(giftEvent).toBeDefined();
        expect(giftEvent.payload).toMatchObject({
            username: 'GiftPilot',
            userId: 'giftpilot',
            tier: '1000',
            giftCount: 3,
            cumulativeTotal: 12,
            isAnonymous: true,
            timestamp: '2024-01-01T00:00:00.444Z'
        });
    });

    test('emits anonymous paypiggyGift payloads without identity fields', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('channel.subscription.gift', {
            tier: '1000',
            total: 2,
            is_anonymous: true
        }, {
            message_timestamp: '2024-01-03T00:00:00.123456789Z'
        });

        const giftEvent = emitted.find((evt) => evt.type === 'paypiggyGift');
        expect(giftEvent).toBeDefined();
        expect(giftEvent.payload.isAnonymous).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(giftEvent.payload, 'username')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(giftEvent.payload, 'userId')).toBe(false);
    });

    test('uses metadata timestamp for stream offline notifications', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('stream.online', {
            id: 'stream-1',
            started_at: '2024-02-01T00:00:00Z'
        });

        router.handleNotificationEvent('stream.offline', {
            id: 'stream-1'
        }, {
            message_timestamp: '2024-02-01T01:00:00.456789123Z'
        });

        const onlineEvent = emitted.find((evt) => evt.type === 'streamOnline');
        const offlineEvent = emitted.find((evt) => evt.type === 'streamOffline');
        expect(onlineEvent.payload).toMatchObject({
            streamId: 'stream-1',
            timestamp: '2024-02-01T00:00:00.000Z'
        });
        expect(offlineEvent.payload).toMatchObject({
            streamId: 'stream-1',
            timestamp: '2024-02-01T01:00:00.456Z'
        });
    });

    test('uses metadata timestamp for raid and gift notifications', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('channel.raid', {
            from_broadcaster_user_name: 'Raider',
            from_broadcaster_user_login: 'raider',
            viewers: 8
        }, {
            message_timestamp: '2024-03-01T00:00:00.100200300Z'
        });

        router.handleNotificationEvent('channel.subscription.gift', {
            user_name: 'Gifter',
            user_login: 'gifter',
            tier: '1000',
            total: 2
        }, {
            message_timestamp: '2024-03-01T00:01:00.400500600Z'
        });

        const raidEvent = emitted.find((evt) => evt.type === 'raid');
        const giftEvent = emitted.find((evt) => evt.type === 'paypiggyGift');
        expect(raidEvent.payload.timestamp).toBe('2024-03-01T00:00:00.100Z');
        expect(giftEvent.payload.timestamp).toBe('2024-03-01T00:01:00.400Z');
    });

    test('logs raw events before timestamp fallback', () => {
        const logged = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: true },
            logger: noOpLogger,
            emit: () => {},
            logRawPlatformData: async (...args) => logged.push(args),
            logError: () => {}
        });

        const rawEvent = {
            id: 'stream-1',
            started_at: '2024-02-01T00:00:00Z'
        };

        router.handleNotificationEvent('stream.online', rawEvent);

        expect(logged).toHaveLength(1);
        const loggedEvent = logged[0][1];
        expect(Object.prototype.hasOwnProperty.call(loggedEvent, 'timestamp')).toBe(false);
        expect(loggedEvent.started_at).toBe('2024-02-01T00:00:00Z');
    });
});
