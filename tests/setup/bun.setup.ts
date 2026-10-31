import { afterAll, beforeAll, beforeEach, vi } from 'bun:test';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { scheduleTimeout } = nodeRequire('../helpers/time-utils') as {
    scheduleTimeout: typeof setTimeout;
};
const testClock = nodeRequire('../helpers/test-clock') as {
    reset: () => number;
    useRealTime: () => void;
};
const { resetDeterministicTestState } = nodeRequire('../helpers/deterministic-test-state') as {
    resetDeterministicTestState: () => void;
};
const { initializeTestLogging } = nodeRequire('../helpers/test-setup') as {
    initializeTestLogging: () => void;
};
const { initializeStaticSecrets, _resetForTesting } = nodeRequire('../../src/core/secrets') as {
    initializeStaticSecrets: () => void;
    _resetForTesting: () => void;
};

initializeTestLogging();

type SetupGlobalState = typeof globalThis & {
    scheduleTestTimeout: typeof scheduleTimeout;
    restoreConsole: () => void;
    originalConsole: Console;
};

const setupGlobal = global as SetupGlobalState;
const originalConsole = setupGlobal.console;

setupGlobal.scheduleTestTimeout = scheduleTimeout;

setupGlobal.restoreConsole = () => {
    setupGlobal.console = originalConsole;
};

beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.TWITCH_DISABLE_AUTH = 'true';
    process.env.YOUTUBE_DISABLE_AUTH = 'true';
    process.env.TIKTOK_DISABLE_AUTH = 'true';
    process.env.TWITCH_CLIENT_SECRET = 'test_mock_secret';
    process.env.TWITCH_API_KEY = 'test_mock_key';
    process.env.YOUTUBE_API_KEY = 'test_mock_key';
    process.env.TIKTOK_API_KEY = 'test_mock_key';

    _resetForTesting();
    initializeStaticSecrets();

    setupGlobal.originalConsole = originalConsole;
});

beforeEach(() => {
    testClock.reset();
    resetDeterministicTestState();
    const mockedConsole: Console = {
        ...originalConsole,
        log: vi.fn<(...args: unknown[]) => unknown>(),
        info: vi.fn<(...args: unknown[]) => unknown>(),
        warn: vi.fn<(...args: unknown[]) => unknown>(),
        error: vi.fn<(...args: unknown[]) => unknown>(),
        debug: vi.fn<(...args: unknown[]) => unknown>()
    };
    setupGlobal.console = mockedConsole;
});

afterAll(() => {
    setupGlobal.console = originalConsole;
});
