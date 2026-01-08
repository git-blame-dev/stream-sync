
const { initializeTestLogging } = require('../helpers/test-setup');
const { createMockLogger } = require('../helpers/mock-factories');

initializeTestLogging();

const createAuthManager = (overrides = {}) => {
    const requiredScopes = overrides.scopes || [
        'user:read:chat',
        'moderator:read:followers',
        'channel:read:subscriptions',
        'bits:read'
    ];

    return {
        getState: jest.fn().mockReturnValue(overrides.state || 'READY'),
        getScopes: jest.fn().mockResolvedValue(requiredScopes),
        getUserId: jest.fn().mockReturnValue(overrides.userId),
        getAccessToken: jest.fn().mockResolvedValue(overrides.accessToken || 'centralized-token'),
        authState: { executeWhenReady: jest.fn().mockImplementation(async (fn) => fn()) },
        twitchAuth: { triggerOAuthFlow: jest.fn() },
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
    beforeEach(() => {
        jest.resetModules();
        jest.unmock('../../src/platforms/twitch');
        jest.unmock('../../src/platforms/twitch-eventsub');
    });

    it('accepts centralized auth for EventSub validation without raw tokens', async () => {
        const TwitchEventSub = jest.requireActual('../../src/platforms/twitch-eventsub');
        const eventSub = new TwitchEventSub(
            { enabled: true, eventsub_enabled: true },
            { authManager: createAuthManager({ userId: TEST_USER_ID }), logger: createMockLogger('debug') }
        );

        const validation = await eventSub._validateConfig();

        expect(validation.valid).toBe(true);
        expect(validation.components.configuration.issues).toHaveLength(0);
        expect(validation.components.authManager.details.state).toBe('READY');
    });

    it('keeps stream lifecycle transitions from crashing when polling hooks are missing', async () => {
        const { TwitchPlatform } = jest.requireActual('../../src/platforms/twitch');
        const platform = new TwitchPlatform(baseConfig, {
            authManager: createAuthManager({ userId: TEST_USER_ID }),
            logger: createMockLogger('debug')
        });

        await platform.initialize({});

        expect(() => platform.handleStreamOnlineEvent({ timestamp: '2024-01-01T00:00:00Z' })).not.toThrow();
    });

    it('emits raid events with normalized user shape and metadata', async () => {
        const { TwitchPlatform } = jest.requireActual('../../src/platforms/twitch');
        const platform = new TwitchPlatform(baseConfig, {
            authManager: createAuthManager({ userId: TEST_USER_ID }),
            logger: createMockLogger('debug')
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

    it('warns but still emits chat events when normalization validation fails', async () => {
        jest.doMock('../../src/utils/message-normalization', () => ({
            normalizeTwitchMessage: jest.fn(() => ({
                userId: 'chat-1',
                username: 'chatter',
                message: 'Hello world',
                timestamp: '2024-01-01T00:00:00Z',
                isMod: false,
                isSubscriber: false,
                isBroadcaster: false
            })),
            validateNormalizedMessage: jest.fn(() => ({
                isValid: false,
                issues: ['missing badge data']
            }))
        }));

        const { TwitchPlatform } = jest.requireActual('../../src/platforms/twitch');
        const logger = createMockLogger('debug');
        const platform = new TwitchPlatform(baseConfig, {
            authManager: createAuthManager({ userId: TEST_USER_ID }),
            logger
        });

        const events = [];
        platform.handlers = { onChat: (payload) => events.push(payload) };

        await platform.onMessageHandler(
            '#tester',
            { username: 'chatter', 'display-name': 'Chatter', 'user-id': 'chat-1', mod: false, subscriber: false },
            'Hello world',
            false
        );

        expect(logger.warn).toHaveBeenCalled();
        expect(events).toHaveLength(1);
        expect(events[0].metadata.correlationId).toBeDefined();
    });

    it('returns user-friendly errors when sending without an EventSub connection', async () => {
        const { TwitchPlatform } = jest.requireActual('../../src/platforms/twitch');
        const platform = new TwitchPlatform(baseConfig, {
            authManager: createAuthManager({ userId: TEST_USER_ID }),
            logger: createMockLogger('debug')
        });

        await expect(platform.sendMessage('hello')).rejects.toThrow(/twitch chat is unavailable/i);
    });

    it('applies data logging toggles across chat and stream events', async () => {
        const recorded = [];
        class RecordingLoggingService {
            constructor() {
                this.logRawPlatformData = jest.fn().mockImplementation(async (platform, eventType, data) => {
                    recorded.push({ platform, eventType, data });
                });
            }
        }

        const { TwitchPlatform } = require('../../src/platforms/twitch');
        const platform = new TwitchPlatform(
            { ...baseConfig, dataLoggingEnabled: true },
            {
                authManager: createAuthManager({ userId: TEST_USER_ID }),
                logger: createMockLogger('debug'),
                ChatFileLoggingService: RecordingLoggingService
            }
        );

        platform.handlers = {
            onChat: jest.fn(),
            onStreamStatus: jest.fn()
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
