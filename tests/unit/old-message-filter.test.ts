import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';

import { createMockFn, restoreAllMocks } from '../helpers/bun-mock-utils';

const nodeRequire = createRequire(import.meta.url);

type LoggerLike = {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};

const { createTestUser, initializeTestLogging } = nodeRequire('../helpers/test-setup') as {
    createTestUser: (overrides?: Record<string, unknown>) => Record<string, unknown>;
    initializeTestLogging: () => void;
};
const { noOpLogger } = nodeRequire('../helpers/mock-factories') as {
    noOpLogger: LoggerLike;
};
const { createConfigFixture } = nodeRequire('../helpers/config-fixture') as {
    createConfigFixture: (overrides?: Record<string, unknown>) => Record<string, unknown>;
};
const testClock = nodeRequire('../helpers/test-clock') as {
    now: () => number;
};

type MockFn = ReturnType<typeof createMockFn>;

type RouterRuntime = {
    config: {
        general: {
            filterOldMessages: boolean;
        };
        twitch: {
            messagesEnabled: boolean;
            greetingsEnabled: boolean;
        };
    };
    platformLifecycleService: {
        getPlatformConnectionTime: MockFn;
    };
    gracefulExitService: unknown;
};

type RouterInstance = {
    runtime: RouterRuntime;
    handleChatMessage: (platform: string, message: unknown) => Promise<void>;
    shouldSkipForConnection: (platform: string, timestamp: string) => boolean;
    enqueueChatMessage: MockFn;
    detectCommand: MockFn;
    processCommand: MockFn;
    isFirstMessage: MockFn;
    isGreetingEnabled: MockFn;
};

type RouterConstructor = new (deps: {
    runtime: RouterRuntime;
    logger: LoggerLike;
    config: ReturnType<typeof createConfigFixture>;
}) => RouterInstance;

type RouterOverrides = {
    general?: Partial<RouterRuntime['config']['general']>;
    connectionTime?: number | null;
    gracefulExitService?: unknown;
};

initializeTestLogging();

describe('Old Message Filter', () => {
    let ChatNotificationRouter: RouterConstructor;

    beforeEach(() => {
        ChatNotificationRouter = nodeRequire('../../src/services/ChatNotificationRouter.js') as RouterConstructor;
    });

    afterEach(() => {
        restoreAllMocks();
    });

    const buildRouter = (overrides: RouterOverrides = {}) => {
        const runtime: RouterRuntime = {
            config: {
                general: {
                    filterOldMessages: true,
                    ...overrides.general
                },
                twitch: { messagesEnabled: true, greetingsEnabled: true }
            },
            platformLifecycleService: {
                getPlatformConnectionTime: createMockFn(() => overrides.connectionTime || null)
            },
            gracefulExitService: overrides.gracefulExitService || null
        };

        const router: RouterInstance = new ChatNotificationRouter({
            runtime,
            logger: noOpLogger,
            config: createConfigFixture()
        });

        router.enqueueChatMessage = createMockFn(() => undefined);
        router.detectCommand = createMockFn(async () => null);
        router.processCommand = createMockFn(() => undefined);
        router.isFirstMessage = createMockFn(() => false);
        router.isGreetingEnabled = createMockFn(() => false);

        return { router, runtime };
    };

    const createMessage = (timestamp: string) => createTestUser({
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
