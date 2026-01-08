
jest.mock('../../src/utils/chat-logger', () => ({
    logChatMessageWithConfig: jest.fn(),
    logChatMessageSkipped: jest.fn()
}));

const { logChatMessageWithConfig, logChatMessageSkipped } = require('../../src/utils/chat-logger');
const ChatNotificationRouter = require('../../src/services/ChatNotificationRouter');
const { initializeTestLogging, createTestUser, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { createMockLogger } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Old Message Filter', () => {
    jest.setTimeout(TEST_TIMEOUTS.UNIT);

    const buildRouter = (overrides = {}) => {
        const runtime = {
            config: {
                general: {
                    filterOldMessages: true,
                    ...overrides.general
                }
            },
            platformLifecycleService: {
                getPlatformConnectionTime: jest.fn().mockReturnValue(overrides.connectionTime || null)
            },
            gracefulExitService: overrides.gracefulExitService || null
        };

        const logger = createMockLogger('debug');
        const router = new ChatNotificationRouter({ runtime, logger });

        router.enqueueChatMessage = jest.fn();
        router.detectCommand = jest.fn().mockResolvedValue(null);
        router.processCommand = jest.fn();
        router.isFirstMessage = jest.fn().mockReturnValue(false);
        router.isGreetingEnabled = jest.fn().mockReturnValue(false);
        router.detectMonetization = jest.fn().mockReturnValue({ detected: false });

        return { router, runtime };
    };

    const createMessage = (timestamp) => createTestUser({
        username: 'testuser',
        userId: '12345',
        message: 'Hello world',
        timestamp
    });

    beforeEach(() => {
        logChatMessageWithConfig.mockClear();
        logChatMessageSkipped.mockClear();
    });

    test('skips messages sent before the latest platform connection', async () => {
        const connectionTime = Date.now();
        const { router, runtime } = buildRouter({ connectionTime });
        runtime.platformLifecycleService.getPlatformConnectionTime.mockReturnValue(connectionTime);

        const oldTimestamp = new Date(connectionTime - 1000).toISOString();
        await router.handleChatMessage('twitch', createMessage(oldTimestamp));

        expect(logChatMessageSkipped).toHaveBeenCalledWith(
            'twitch',
            expect.objectContaining({ username: 'testuser' }),
            'old message (sent before connection)'
        );
        expect(logChatMessageWithConfig).not.toHaveBeenCalled();
        expect(router.enqueueChatMessage).not.toHaveBeenCalled();
    });

    test('allows messages when filterOldMessages is disabled', async () => {
        const connectionTime = Date.now();
        const { router, runtime } = buildRouter({
            connectionTime,
            general: { filterOldMessages: false }
        });
        runtime.platformLifecycleService.getPlatformConnectionTime.mockReturnValue(connectionTime);

        const oldTimestamp = new Date(connectionTime - 2000).toISOString();
        await router.handleChatMessage('twitch', createMessage(oldTimestamp));

        expect(logChatMessageSkipped).not.toHaveBeenCalled();
        expect(logChatMessageWithConfig).toHaveBeenCalledWith(
            'twitch',
            expect.objectContaining({ username: 'testuser' }),
            runtime.config,
            expect.any(Object)
        );
    });

    test('allows messages when connection time is unavailable', async () => {
        const { router } = buildRouter({ connectionTime: null });
        await router.handleChatMessage('twitch', createMessage(new Date().toISOString()));

        expect(logChatMessageSkipped).not.toHaveBeenCalled();
        expect(router.enqueueChatMessage).toHaveBeenCalled();
    });

    test('shouldSkipForConnection returns false for invalid timestamps', () => {
        const { router, runtime } = buildRouter({ connectionTime: Date.now() });
        runtime.platformLifecycleService.getPlatformConnectionTime.mockReturnValue(Date.now());

        expect(router.shouldSkipForConnection('twitch', 'not-a-date')).toBe(false);
    });
});
