const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn } = require('../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../helpers/mock-factories');

const { TwitchPlatform } = require('../../../../src/platforms/twitch');

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
        eventsub_enabled: true,
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
