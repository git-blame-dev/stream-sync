const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../helpers/mock-factories');

const { TwitchPlatform } = require('../../../../src/platforms/twitch');
const TwitchEventSub = require('../../../../src/platforms/twitch-eventsub');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../../src/core/secrets');

const createTwitchAuth = (overrides = {}) => ({
    isReady: createMockFn().mockReturnValue(overrides.ready ?? true),
    refreshTokens: createMockFn().mockResolvedValue(true),
    getUserId: createMockFn().mockReturnValue(overrides.userId || 'test-user-id'),
    ...overrides
});

const createMockApiClient = () => ({
    getBroadcasterId: createMockFn().mockResolvedValue('test-broadcaster-id')
});

const TEST_USER_ID = 'test-user-id';

const baseConfig = {
    enabled: true,
    username: 'tester',
    channel: 'tester',
    eventsubEnabled: false,
    dataLoggingEnabled: false
};

describe('TwitchPlatform event behaviors', () => {
    afterEach(() => {
        restoreAllMocks();
        _resetForTesting();
        initializeStaticSecrets();
    });

    it('accepts centralized auth for EventSub validation without raw tokens', async () => {
        _resetForTesting();
        initializeStaticSecrets();
        secrets.twitch.accessToken = 'centralized-token';
        const MockWebSocket = class { constructor() {} };
        const eventSub = new TwitchEventSub(
            { enabled: true, eventsubEnabled: true, broadcasterId: TEST_USER_ID, clientId: 'test-client-id' },
            {
                twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
                logger: noOpLogger,
                WebSocketCtor: MockWebSocket
            }
        );

        const validation = await eventSub._validateConfig();

        expect(validation.valid).toBe(true);
        expect(validation.components.configuration.issues).toHaveLength(0);
        expect(validation.components.twitchAuth.details.ready).toBe(true);
    });

    it('keeps stream lifecycle transitions from crashing when polling hooks are missing', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
            TwitchApiClient: createMockFn().mockImplementation(() => createMockApiClient()),
            logger: noOpLogger
        });

        await platform.initialize({});

        expect(() => platform.handleStreamOnlineEvent({ timestamp: '2024-01-01T00:00:00Z' })).not.toThrow();
    });

    it('emits raid events with normalized user shape and metadata', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
            logger: noOpLogger
        });

        const received = [];
        platform.handlers = { onRaid: (payload) => received.push(payload) };

        await platform.handleRaidEvent({
            username: 'RaidLeader',
            userId: 'raid-1',
            viewerCount: 42,
            timestamp: '2024-01-01T00:00:00Z'
        });

        expect(received).toHaveLength(1);
        expect(received[0].username).toBe('RaidLeader');
        expect(received[0].userId).toBe('raid-1');
        expect(received[0].metadata.correlationId).toBeDefined();
    });

    it('emits paypiggy error payloads when timestamps are missing', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
            logger: noOpLogger
        });

        const received = [];
        platform.handlers = { onPaypiggy: (payload) => received.push(payload) };

        await platform.handlePaypiggyEvent({
            username: 'Subscriber',
            userId: 'sub-1',
            tier: '1000',
            months: 6,
            is_gift: false
        });

        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({
            platform: 'twitch',
            isError: true
        });
        expect(received[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('emits gift error payloads when usernames are missing', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
            logger: noOpLogger
        });

        const received = [];
        platform.handlers = { onGift: (payload) => received.push(payload) };

        await platform.handleGiftEvent({
            userId: 'test-gift-1',
            giftType: 'subscription',
            giftCount: 2,
            amount: 4.99,
            currency: 'USD',
            timestamp: '2024-01-01T00:00:00Z'
        });

        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({
            platform: 'twitch',
            isError: true,
            userId: 'test-gift-1'
        });
        expect(received[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('emits giftpaypiggy error payloads when timestamps are missing', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
            logger: noOpLogger
        });

        const received = [];
        platform.handlers = { onGiftPaypiggy: (payload) => received.push(payload) };

        await platform.handlePaypiggyGiftEvent({
            username: 'testGifter',
            userId: 'test-gift-2',
            giftCount: 3,
            tier: '2000'
        });

        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({
            platform: 'twitch',
            isError: true,
            username: 'testGifter',
            userId: 'test-gift-2'
        });
        expect(received[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('skips follow event emission when timestamp is missing', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
            logger: noOpLogger
        });

        const received = [];
        platform.handlers = { onFollow: (payload) => received.push(payload) };

        await platform.handleFollowEvent({
            username: 'testFollower',
            userId: 'test-follow-1'
        });

        expect(received).toHaveLength(0);
    });

    it('emits chat events from EventSub payloads', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
            logger: noOpLogger
        });

        const events = [];
        platform.handlers = { onChat: (payload) => events.push(payload) };

        await platform.onMessageHandler({
            chatter_user_id: 'chat-1',
            chatter_user_name: 'chatter',
            broadcaster_user_id: 'broadcaster-1',
            message: { text: 'Hello world' },
            badges: { subscriber: '1' },
            timestamp: '2024-01-01T00:00:00Z'
        });

        expect(events).toHaveLength(1);
        expect(events[0].metadata.correlationId).toBeDefined();
    });

    it('returns user-friendly errors when sending without an EventSub connection', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
            logger: noOpLogger
        });

        await expect(platform.sendMessage('hello')).rejects.toThrow(/twitch chat is unavailable/i);
    });

    it('applies data logging toggles across chat and stream events', async () => {
        const recorded = [];
        class RecordingLoggingService {
            constructor() {
                this.logRawPlatformData = createMockFn().mockImplementation(async (platform, eventType, data) => {
                    recorded.push({ platform, eventType, data });
                });
            }
        }

        const platform = new TwitchPlatform(
            { ...baseConfig, dataLoggingEnabled: true },
            {
                twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
                logger: noOpLogger,
                ChatFileLoggingService: RecordingLoggingService
            }
        );

        platform.handlers = {
            onChat: createMockFn(),
            onStreamStatus: createMockFn()
        };

        await platform.onMessageHandler({
            chatter_user_id: 'log-1',
            chatter_user_name: 'logger',
            broadcaster_user_id: 'broadcaster-1',
            message: { text: 'Log this' },
            badges: {},
            timestamp: '2024-01-01T00:00:00Z'
        });

        platform.handleStreamOfflineEvent({ timestamp: '2024-01-01T00:00:05Z' });

        await new Promise(setImmediate);

        expect(recorded.find((entry) => entry.eventType === 'chat')).toBeDefined();
        expect(recorded.find((entry) => entry.eventType === 'stream-offline')).toBeDefined();
    });
});
