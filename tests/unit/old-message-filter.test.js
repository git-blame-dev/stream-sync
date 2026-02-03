const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { createTestUser, initializeTestLogging } = require('../helpers/test-setup');
const { noOpLogger } = require('../helpers/mock-factories');
const { createConfigFixture } = require('../helpers/config-fixture');
const testClock = require('../helpers/test-clock');

initializeTestLogging();

describe('Old Message Filter', () => {
    let ChatNotificationRouter;

    beforeEach(() => {
        ChatNotificationRouter = require('../../src/services/ChatNotificationRouter');
    });

    afterEach(() => {
        restoreAllMocks();
    });

    const buildRouter = (overrides = {}) => {
        const runtime = {
            config: {
                general: {
                    filterOldMessages: true,
                    ...overrides.general
                },
                twitch: { messagesEnabled: true, greetingsEnabled: true }
            },
            platformLifecycleService: {
                getPlatformConnectionTime: createMockFn().mockReturnValue(overrides.connectionTime || null)
            },
            gracefulExitService: overrides.gracefulExitService || null
        };

        const router = new ChatNotificationRouter({
            runtime,
            logger: noOpLogger,
            config: createConfigFixture()
        });

        router.enqueueChatMessage = createMockFn();
        router.detectCommand = createMockFn().mockResolvedValue(null);
        router.processCommand = createMockFn();
        router.isFirstMessage = createMockFn().mockReturnValue(false);
        router.isGreetingEnabled = createMockFn().mockReturnValue(false);

        return { router, runtime };
    };

    const createMessage = (timestamp) => createTestUser({
        username: 'testuser',
        userId: 'test12345',
        message: 'Hello world',
        timestamp
    });

    test('skips messages sent before the latest platform connection', async () => {
        const connectionTime = testClock.now();
        const { router, runtime } = buildRouter({ connectionTime });
        runtime.platformLifecycleService.getPlatformConnectionTime.mockReturnValue(connectionTime);

        const oldTimestamp = new Date(connectionTime - 1000).toISOString();
        await router.handleChatMessage('twitch', createMessage(oldTimestamp));

        expect(router.enqueueChatMessage).not.toHaveBeenCalled();
    });

    test('allows messages when filterOldMessages is disabled', async () => {
        const connectionTime = testClock.now();
        const { router, runtime } = buildRouter({
            connectionTime,
            general: { filterOldMessages: false }
        });
        runtime.platformLifecycleService.getPlatformConnectionTime.mockReturnValue(connectionTime);

        const oldTimestamp = new Date(connectionTime - 2000).toISOString();
        await router.handleChatMessage('twitch', createMessage(oldTimestamp));

        expect(router.enqueueChatMessage).toHaveBeenCalled();
    });

    test('allows messages when connection time is unavailable', async () => {
        const { router } = buildRouter({ connectionTime: null });
        await router.handleChatMessage('twitch', createMessage(new Date(testClock.now()).toISOString()));

        expect(router.enqueueChatMessage).toHaveBeenCalled();
    });

    test('shouldSkipForConnection returns false for invalid timestamps', () => {
        const { router, runtime } = buildRouter({ connectionTime: testClock.now() });
        runtime.platformLifecycleService.getPlatformConnectionTime.mockReturnValue(testClock.now());

        expect(router.shouldSkipForConnection('twitch', 'not-a-date')).toBe(false);
    });
});
