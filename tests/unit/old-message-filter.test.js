
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');
const { createTestUser } = require('../helpers/test-setup');
const { noOpLogger } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const testClock = require('../helpers/test-clock');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const applyMocks = () => {
    mockModule('../../src/utils/chat-logger', () => ({
        logChatMessageWithConfig: createMockFn(),
        logChatMessageSkipped: createMockFn()
    }));
};

applyMocks();

describe('Old Message Filter', () => {
    let logChatMessageWithConfig;
    let logChatMessageSkipped;
    let ChatNotificationRouter;

    beforeEach(() => {
        resetModules();
        applyMocks();
        const chatLogger = require('../../src/utils/chat-logger');
        logChatMessageWithConfig = chatLogger.logChatMessageWithConfig;
        logChatMessageSkipped = chatLogger.logChatMessageSkipped;
        ChatNotificationRouter = require('../../src/services/ChatNotificationRouter');
    });

    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    const buildRouter = (overrides = {}) => {
        const runtime = {
            config: {
                general: {
                    filterOldMessages: true,
                    ...overrides.general
                }
            },
            platformLifecycleService: {
                getPlatformConnectionTime: createMockFn().mockReturnValue(overrides.connectionTime || null)
            },
            gracefulExitService: overrides.gracefulExitService || null
        };

        const logger = noOpLogger;
        const router = new ChatNotificationRouter({ runtime, logger });

        router.enqueueChatMessage = createMockFn();
        router.detectCommand = createMockFn().mockResolvedValue(null);
        router.processCommand = createMockFn();
        router.isFirstMessage = createMockFn().mockReturnValue(false);
        router.isGreetingEnabled = createMockFn().mockReturnValue(false);
        router.detectMonetization = createMockFn().mockReturnValue({ detected: false });

        return { router, runtime };
    };

    const createMessage = (timestamp) => createTestUser({
        username: 'testuser',
        userId: '12345',
        message: 'Hello world',
        timestamp
    });

    test('skips messages sent before the latest platform connection', async () => {
        const connectionTime = testClock.now();
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
        const connectionTime = testClock.now();
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
        await router.handleChatMessage('twitch', createMessage(new Date(testClock.now()).toISOString()));

        expect(logChatMessageSkipped).not.toHaveBeenCalled();
        expect(router.enqueueChatMessage).toHaveBeenCalled();
    });

    test('shouldSkipForConnection returns false for invalid timestamps', () => {
        const { router, runtime } = buildRouter({ connectionTime: testClock.now() });
        runtime.platformLifecycleService.getPlatformConnectionTime.mockReturnValue(testClock.now());

        expect(router.shouldSkipForConnection('twitch', 'not-a-date')).toBe(false);
    });
});
