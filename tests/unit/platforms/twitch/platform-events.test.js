const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../helpers/mock-factories');

const { TwitchPlatform } = require('../../../../src/platforms/twitch');
const TwitchEventSub = require('../../../../src/platforms/twitch-eventsub');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../../src/core/secrets');
const { DEFAULT_AVATAR_URL } = require('../../../../src/constants/avatar');

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
const FALLBACK_AVATAR_URL = DEFAULT_AVATAR_URL;

const baseConfig = {
    enabled: true,
    username: 'tester',
    channel: 'tester',
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
            { enabled: true, broadcasterId: TEST_USER_ID, clientId: 'test-client-id' },
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
            TwitchEventSub: createMockFn().mockImplementation(() => ({
                initialize: createMockFn().mockResolvedValue(),
                on: createMockFn(),
                isConnected: () => true,
                isActive: () => true
            })),
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
        expect(received[0].avatarUrl).toBe(FALLBACK_AVATAR_URL);
        expect(received[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('uses injected processing timestamp for monetization error envelopes', async () => {
        const processingTimestamp = '2024-01-11T12:34:56.000Z';
        const platform = new TwitchPlatform(baseConfig, {
            twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
            logger: noOpLogger,
            getErrorEnvelopeTimestampISO: () => processingTimestamp
        });

        const received = [];
        platform.handlers = { onPaypiggy: (payload) => received.push(payload) };

        await platform.handlePaypiggyEvent({
            username: 'test-subscriber',
            userId: 'test-sub-1',
            tier: '1000'
        });

        expect(received).toHaveLength(1);
        expect(received[0].isError).toBe(true);
        expect(received[0].timestamp).toBe(processingTimestamp);
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
        expect(received[0].avatarUrl).toBe(FALLBACK_AVATAR_URL);
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
        expect(received[0].avatarUrl).toBe(FALLBACK_AVATAR_URL);
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
        expect(events[0].avatarUrl).toBe(FALLBACK_AVATAR_URL);
        expect(events[0].isMod).toBe(false);
        expect(events[0].isBroadcaster).toBe(false);
        expect(events[0].isPaypiggy).toBe(true);
        expect(events[0].metadata.isPaypiggy).toBe(true);
        expect(events[0].metadata.correlationId).toBeDefined();
    });

    it('resolves and caches Twitch avatar by user id for repeated events', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
            logger: noOpLogger
        });

        const lookupCalls = [];
        platform.apiClient = {
            getUserById: createMockFn().mockImplementation(async (userId) => {
                lookupCalls.push(userId);
                return {
                    id: userId,
                    profile_image_url: 'https://example.invalid/twitch-user-avatar.jpg'
                };
            })
        };

        const received = [];
        platform.handlers = { onFollow: (payload) => received.push(payload) };

        await platform.handleFollowEvent({
            username: 'lookup-user',
            userId: 'lookup-user-id',
            timestamp: '2024-01-01T00:00:00Z'
        });

        await platform.handleFollowEvent({
            username: 'lookup-user',
            userId: 'lookup-user-id',
            timestamp: '2024-01-01T00:00:01Z'
        });

        expect(received).toHaveLength(2);
        expect(received[0].avatarUrl).toBe('https://example.invalid/twitch-user-avatar.jpg');
        expect(received[1].avatarUrl).toBe('https://example.invalid/twitch-user-avatar.jpg');
        expect(lookupCalls).toEqual(['lookup-user-id']);
    });

    it('caches fallback avatar for repeated events when Helix lookup returns no avatar', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
            logger: noOpLogger
        });

        const lookupCalls = [];
        platform.apiClient = {
            getUserById: createMockFn().mockImplementation(async (userId) => {
                lookupCalls.push(userId);
                return null;
            })
        };

        const received = [];
        platform.handlers = { onFollow: (payload) => received.push(payload) };

        await platform.handleFollowEvent({
            username: 'fallback-user',
            userId: 'fallback-user-id',
            timestamp: '2024-01-01T00:00:00Z'
        });
        await platform.handleFollowEvent({
            username: 'fallback-user',
            userId: 'fallback-user-id',
            timestamp: '2024-01-01T00:00:01Z'
        });

        expect(received).toHaveLength(2);
        expect(received[0].avatarUrl).toBe(FALLBACK_AVATAR_URL);
        expect(received[1].avatarUrl).toBe(FALLBACK_AVATAR_URL);
        expect(lookupCalls).toEqual(['fallback-user-id']);
    });

    it('caches fallback avatar for repeated events when Helix lookup throws', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
            logger: noOpLogger
        });

        const lookupCalls = [];
        platform.apiClient = {
            getUserById: createMockFn().mockImplementation(async (userId) => {
                lookupCalls.push(userId);
                throw new Error('helix unavailable');
            })
        };

        const received = [];
        platform.handlers = { onFollow: (payload) => received.push(payload) };

        await platform.handleFollowEvent({
            username: 'error-user',
            userId: 'error-user-id',
            timestamp: '2024-01-01T00:00:00Z'
        });
        await platform.handleFollowEvent({
            username: 'error-user',
            userId: 'error-user-id',
            timestamp: '2024-01-01T00:00:01Z'
        });

        expect(received).toHaveLength(2);
        expect(received[0].avatarUrl).toBe(FALLBACK_AVATAR_URL);
        expect(received[1].avatarUrl).toBe(FALLBACK_AVATAR_URL);
        expect(lookupCalls).toEqual(['error-user-id']);
    });

    it('evicts oldest avatar cache entries when configured cache size is exceeded', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
            logger: noOpLogger,
            avatarCacheMaxSize: 2
        });

        const received = [];
        platform.handlers = { onFollow: (payload) => received.push(payload) };

        await platform.handleFollowEvent({
            username: 'user-one',
            userId: 'u1',
            avatarUrl: 'https://example.invalid/u1.png',
            timestamp: '2024-01-01T00:00:00Z'
        });
        await platform.handleFollowEvent({
            username: 'user-two',
            userId: 'u2',
            avatarUrl: 'https://example.invalid/u2.png',
            timestamp: '2024-01-01T00:00:01Z'
        });
        await platform.handleFollowEvent({
            username: 'user-three',
            userId: 'u3',
            avatarUrl: 'https://example.invalid/u3.png',
            timestamp: '2024-01-01T00:00:02Z'
        });

        await platform.handleFollowEvent({
            username: 'user-one',
            userId: 'u1',
            timestamp: '2024-01-01T00:00:03Z'
        });
        await platform.handleFollowEvent({
            username: 'user-two',
            userId: 'u2',
            timestamp: '2024-01-01T00:00:04Z'
        });

        expect(received).toHaveLength(5);
        expect(received[0].avatarUrl).toBe('https://example.invalid/u1.png');
        expect(received[1].avatarUrl).toBe('https://example.invalid/u2.png');
        expect(received[2].avatarUrl).toBe('https://example.invalid/u3.png');
        expect(received[3].avatarUrl).toBe(FALLBACK_AVATAR_URL);
        expect(received[4].avatarUrl).toBe('https://example.invalid/u2.png');
    });

    it('clears avatar cache during cleanup', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
            logger: noOpLogger
        });

        const received = [];
        platform.handlers = { onFollow: (payload) => received.push(payload) };

        await platform.handleFollowEvent({
            username: 'cleanup-user',
            userId: 'cleanup-user-id',
            avatarUrl: 'https://example.invalid/cleanup-user.png',
            timestamp: '2024-01-01T00:00:00Z'
        });

        await platform.cleanup();
        platform.handlers = { onFollow: (payload) => received.push(payload) };

        await platform.handleFollowEvent({
            username: 'cleanup-user',
            userId: 'cleanup-user-id',
            timestamp: '2024-01-01T00:00:01Z'
        });

        expect(received).toHaveLength(2);
        expect(received[0].avatarUrl).toBe('https://example.invalid/cleanup-user.png');
        expect(received[1].avatarUrl).toBe(FALLBACK_AVATAR_URL);
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
