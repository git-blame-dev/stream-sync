const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const noOpLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const { TwitchPlatform } = require('../../src/platforms/twitch');
const TwitchEventSub = require('../../src/platforms/twitch-eventsub');

const createAuthManager = (overrides = {}) => {
    const requiredScopes = overrides.scopes || [
        'user:read:chat',
        'moderator:read:followers',
        'channel:read:subscriptions',
        'bits:read'
    ];

    return {
        getState: createMockFn().mockReturnValue(overrides.state || 'READY'),
        getScopes: createMockFn().mockResolvedValue(requiredScopes),
        getUserId: createMockFn().mockReturnValue(overrides.userId),
        getAccessToken: createMockFn().mockResolvedValue(overrides.accessToken || 'centralized-token'),
        authState: { executeWhenReady: createMockFn().mockImplementation(async (fn) => fn()) },
        twitchAuth: { triggerOAuthFlow: createMockFn() },
        ...overrides
    };
};

const TEST_USER_ID = 'test-user-id';

const baseConfig = {
    enabled: true,
    username: 'tester',
    channel: 'tester',
    eventsub_enabled: false,
    dataLoggingEnabled: false
};

describe('Twitch platform refactor behaviors', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('accepts centralized auth for EventSub validation without raw tokens', async () => {
        const MockWebSocket = class { constructor() {} };
        const eventSub = new TwitchEventSub(
            { enabled: true, eventsub_enabled: true },
            {
                authManager: createAuthManager({ userId: TEST_USER_ID }),
                logger: noOpLogger,
                WebSocketCtor: MockWebSocket
            }
        );

        const validation = await eventSub._validateConfig();

        expect(validation.valid).toBe(true);
        expect(validation.components.configuration.issues).toHaveLength(0);
        expect(validation.components.authManager.details.state).toBe('READY');
    });

    it('keeps stream lifecycle transitions from crashing when polling hooks are missing', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            authManager: createAuthManager({ userId: TEST_USER_ID }),
            logger: noOpLogger
        });

        await platform.initialize({});

        expect(() => platform.handleStreamOnlineEvent({ timestamp: '2024-01-01T00:00:00Z' })).not.toThrow();
    });

    it('emits raid events with normalized user shape and metadata', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            authManager: createAuthManager({ userId: TEST_USER_ID }),
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

    it('emits chat events even when normalization validation fails', async () => {
        const mockNormalizeTwitchMessage = createMockFn(() => ({
            userId: 'chat-1',
            username: 'chatter',
            message: 'Hello world',
            timestamp: '2024-01-01T00:00:00Z',
            isMod: false,
            isSubscriber: false,
            isBroadcaster: false
        }));
        const mockValidateNormalizedMessage = createMockFn(() => ({
            isValid: false,
            issues: ['missing badge data']
        }));

        const platform = new TwitchPlatform(baseConfig, {
            authManager: createAuthManager({ userId: TEST_USER_ID }),
            logger: noOpLogger,
            normalizeTwitchMessage: mockNormalizeTwitchMessage,
            validateNormalizedMessage: mockValidateNormalizedMessage
        });

        const events = [];
        platform.handlers = { onChat: (payload) => events.push(payload) };

        await platform.onMessageHandler(
            '#tester',
            { username: 'chatter', 'display-name': 'Chatter', 'user-id': 'chat-1', mod: false, subscriber: false },
            'Hello world',
            false
        );

        expect(events).toHaveLength(1);
        expect(events[0].metadata.correlationId).toBeDefined();
    });

    it('returns user-friendly errors when sending without an EventSub connection', async () => {
        const platform = new TwitchPlatform(baseConfig, {
            authManager: createAuthManager({ userId: TEST_USER_ID }),
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
                authManager: createAuthManager({ userId: TEST_USER_ID }),
                logger: noOpLogger,
                ChatFileLoggingService: RecordingLoggingService
            }
        );

        platform.handlers = {
            onChat: createMockFn(),
            onStreamStatus: createMockFn()
        };

        await platform.onMessageHandler(
            '#tester',
            { username: 'logger', 'display-name': 'Logger', 'user-id': 'log-1', mod: false, subscriber: false },
            'Log this',
            false
        );

        platform.handleStreamOfflineEvent({ timestamp: '2024-01-01T00:00:05Z' });

        await new Promise(setImmediate);

        expect(recorded.find((entry) => entry.eventType === 'chat')).toBeDefined();
        expect(recorded.find((entry) => entry.eventType === 'stream-offline')).toBeDefined();
    });
});
