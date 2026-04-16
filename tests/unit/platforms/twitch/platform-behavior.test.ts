const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn } = require('../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../helpers/mock-factories');
const { createTwitchEventSubChatMessageEvent } = require('../../../helpers/twitch-test-data');

const { TwitchPlatform } = require('../../../../src/platforms/twitch.ts');
const { DEFAULT_AVATAR_URL } = require('../../../../src/constants/avatar');

const createReadyTwitchAuth = () => ({
    isReady: () => true,
    refreshTokens: async () => true,
    getUserId: () => 'test-user-id'
});

const createPlatform = (configOverrides = {}, depsOverrides = {}) => {
    const config = {
        enabled: true,
        username: 'teststreamer',
        channel: 'teststreamer',
        dataLoggingEnabled: false,
        ...configOverrides
    };
    if (!depsOverrides.twitchAuth) {
        throw new Error('twitchAuth is required - provide explicit mock');
    }
    const twitchAuth = depsOverrides.twitchAuth;
    const TwitchEventSub = depsOverrides.TwitchEventSub || createMockFn().mockImplementation(() => ({
        initialize: createMockFn().mockResolvedValue(),
        connect: createMockFn().mockResolvedValue(),
        disconnect: createMockFn().mockResolvedValue(),
        cleanup: createMockFn().mockResolvedValue(),
        on: createMockFn(),
        isConnected: () => true
    }));
    return new TwitchPlatform(config, {
        logger: noOpLogger,
        twitchAuth,
        timestampService: { extractTimestamp: () => new Date().toISOString() },
        TwitchEventSub,
        ChatFileLoggingService: class { logRawPlatformData() {} },
        ...depsOverrides
    });
};

describe('TwitchPlatform behavior standards', () => {
    let platform;

    afterEach(() => {
        if (platform?.cleanup) {
            platform.cleanup().catch(() => {});
        }
    });

    it('emits chat events using the standardized schema', async () => {
        platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
        const emitted = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === 'platform:chat-message') emitted.push(payload.data);
        });

        await platform.onMessageHandler({
            chatter_user_id: 'test-user-12345',
            chatter_user_name: 'testviewer1',
            broadcaster_user_id: 'broadcaster-1',
            message: { text: '  hello  ' },
            badges: { subscriber: '1' },
            timestamp: '2024-01-01T00:00:00Z'
        });

        expect(emitted).toHaveLength(1);
        const payload = emitted[0];
        expect(payload.userId).toBe('test-user-12345');
        expect(payload.username).toBe('testviewer1');
        expect(payload.message.text).toBe('hello');
        expect(payload.platform).toBe('twitch');
        expect(payload.timestamp).toEqual(expect.any(String));
        expect(payload.isMod).toBe(false);
        expect(payload.isBroadcaster).toBe(false);
        expect(payload.isPaypiggy).toBe(true);
        expect(payload.metadata.isPaypiggy).toBe(true);
    });

    it('emits canonical Twitch message parts for emote fragment chat payloads', async () => {
        platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
        const emitted = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === 'platform:chat-message') emitted.push(payload.data);
        });

        const event = createTwitchEventSubChatMessageEvent({
            chatter_user_id: 'test-chat-user-id-1',
            chatter_user_name: 'test-chat-user-name-1',
            badges: [
                { set_id: 'moderator', id: '1' },
                { set_id: 'subscriber', id: '12' }
            ]
        });

        await platform.onMessageHandler(event);

        expect(emitted).toHaveLength(1);
        const payload = emitted[0];
        expect(payload.message.text).toBe('testEmote test message testEmote hello world this is a message to everyone testEmote how are we today?');
        expect(payload.message.parts).toEqual([
            {
                type: 'emote',
                platform: 'twitch',
                emoteId: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0'
            },
            { type: 'text', text: ' test message ' },
            {
                type: 'emote',
                platform: 'twitch',
                emoteId: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0'
            },
            { type: 'text', text: ' hello world this is a message to everyone ' },
            {
                type: 'emote',
                platform: 'twitch',
                emoteId: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0'
            },
            { type: 'text', text: ' how are we today?' }
        ]);
        expect(payload.metadata.isMod).toBe(true);
        expect(payload.metadata.isPaypiggy).toBe(true);
        expect(payload.isMod).toBe(true);
        expect(payload.isBroadcaster).toBe(false);
    });

    it('accepts emote-only Twitch chat when canonical message parts exist', async () => {
        platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
        const emitted = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === 'platform:chat-message') emitted.push(payload.data);
        });

        const event = createTwitchEventSubChatMessageEvent({
            message: {
                text: '   ',
                fragments: [
                    {
                        type: 'emote',
                        text: 'testEmote',
                        emote: {
                            id: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                            format: ['static', 'animated']
                        }
                    }
                ]
            }
        });

        await platform.onMessageHandler(event);

        expect(emitted).toHaveLength(1);
        expect(emitted[0].message.text).toBe('');
        expect(emitted[0].message.parts).toEqual([
            {
                type: 'emote',
                platform: 'twitch',
                emoteId: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0'
            }
        ]);
    });

    it('treats subscriber badge version 0 as paypiggy while moderator 0 stays non-mod', async () => {
        platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
        const emitted = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === 'platform:chat-message') emitted.push(payload.data);
        });

        await platform.onMessageHandler({
            chatter_user_id: 'test-user-badge-zero',
            chatter_user_name: 'testviewerbadgezero',
            broadcaster_user_id: 'test-broadcaster-badge-zero',
            message: { text: 'hello' },
            badges: {
                moderator: '0',
                subscriber: '0'
            },
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(emitted).toHaveLength(1);
        expect(emitted[0].metadata.isMod).toBe(false);
        expect(emitted[0].metadata.isPaypiggy).toBe(true);
        expect(emitted[0].isPaypiggy).toBe(true);
    });

    it('treats founder badge as paypiggy status for chat payloads', async () => {
        platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
        const emitted = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === 'platform:chat-message') emitted.push(payload.data);
        });

        await platform.onMessageHandler({
            chatter_user_id: 'test-user-founder',
            chatter_user_name: 'founderviewer',
            broadcaster_user_id: 'test-broadcaster-founder',
            message: { text: 'founder message' },
            badges: { founder: '0' },
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(emitted).toHaveLength(1);
        expect(emitted[0].isPaypiggy).toBe(true);
        expect(emitted[0].metadata.isPaypiggy).toBe(true);
    });

    it('does not treat legacy subscriber payload flag as paypiggy without badges', async () => {
        platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
        const emitted = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === 'platform:chat-message') emitted.push(payload.data);
        });

        await platform.onMessageHandler({
            chatter_user_id: 'test-user-subscriber-flag',
            chatter_user_name: 'subscriberflagviewer',
            broadcaster_user_id: 'test-broadcaster-subscriber-flag',
            message: { text: 'subscriber flag message' },
            badges: {},
            subscriber: true,
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(emitted).toHaveLength(1);
        expect(emitted[0].isPaypiggy).toBe(false);
        expect(emitted[0].metadata.isPaypiggy).toBe(false);
    });

    it('emits degraded chat payload when message text and message parts are both empty', async () => {
        platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
        const emitted = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === 'platform:chat-message') emitted.push(payload.data);
        });

        await platform.onMessageHandler({
            chatter_user_id: 'test-user-empty-chat',
            chatter_user_name: 'testvieweremptychat',
            broadcaster_user_id: 'test-broadcaster-empty-chat',
            message: {
                text: '   ',
                fragments: [
                    {
                        type: 'emote',
                        text: 'invalid',
                        emote: {
                            id: '   ',
                            format: ['animated']
                        }
                    }
                ]
            },
            badges: [],
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(emitted).toHaveLength(1);
        expect(emitted[0].username).toBe('testvieweremptychat');
        expect(emitted[0].avatarUrl).toBe(DEFAULT_AVATAR_URL);
        expect(emitted[0].message).toEqual({ text: 'Unknown Message' });
        expect(emitted[0].metadata.missingFields).toContain('message');
    });

    it('emits connection lifecycle events for EventSub changes', () => {
        platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
        const connectedEvents = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === 'platform:connection') connectedEvents.push(payload.data);
        });

        platform._handleEventSubConnectionChange(true, { reason: 'connected-test' });

        expect(connectedEvents).toHaveLength(1);
        expect(connectedEvents[0]).toMatchObject({
            platform: 'twitch',
            status: 'connected'
        });
    });

    it('forwards connection lifecycle events to injected onConnection handlers', () => {
        const onConnection = createMockFn();
        platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
        platform.handlers = { onConnection };

        platform._handleEventSubConnectionChange(false, { reason: 'socket dropped', willReconnect: true });

        expect(onConnection).toHaveBeenCalledTimes(1);
        expect(onConnection.mock.calls[0][0]).toMatchObject({
            platform: 'twitch',
            status: 'disconnected',
            willReconnect: true
        });
    });

    it('maps resubscription data to months and isRenewal in subscription events', () => {
        platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
        const resubData = {
            tier: '1000',
            months: 5,
            userId: 'test-user-123',
            username: 'testresubber',
            displayName: 'Test Resub User',
            timestamp: '2024-01-01T00:00:00Z'
        };

        const event = platform.eventFactory.createPaypiggyMessageEvent(resubData);

        expect(event.type).toBe('platform:paypiggy');
        expect(event.months).toBe(5);
        expect(event.isRenewal).toBe(true);
    });

    it('uses provided months for resubscription messages', () => {
        platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
        const resubData = {
            tier: '1000',
            months: 7,
            userId: 'test-user-789',
            username: 'testlongtenure',
            displayName: 'Test Long Tenure Sub',
            timestamp: '2024-01-01T00:00:00Z'
        };

        const event = platform.eventFactory.createPaypiggyMessageEvent(resubData);

        expect(event.type).toBe('platform:paypiggy');
        expect(event.months).toBe(7);
        expect(event.isRenewal).toBe(true);
    });

    it('routes paypiggy events through the canonical handler', () => {
        platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
        const paypiggyHandlerCalls = [];

        platform.handlers = { onPaypiggy: (payload) => paypiggyHandlerCalls.push(payload) };

        const payload = { type: 'platform:paypiggy', platform: 'twitch', username: 'testsupporter' };
        platform._emitPlatformEvent('platform:paypiggy', payload);

        expect(paypiggyHandlerCalls).toHaveLength(1);
        expect(paypiggyHandlerCalls[0]).toBe(payload);
    });

    it('returns zero when viewer count provider is missing', async () => {
        platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });

        const count = await platform.getViewerCount();

        expect(count).toBe(0);
    });

    it('returns zero when viewer count provider throws', async () => {
        platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
        platform.viewerCountProvider = {
            getViewerCount: async () => { throw new Error('test viewer count failure'); }
        };

        const count = await platform.getViewerCount();

        expect(count).toBe(0);
    });
});
