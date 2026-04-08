import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'bun:test';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { waitForDelay, scheduleTimeout, scheduleInterval } = nodeRequire('../helpers/time-utils') as {
    waitForDelay: (delay?: number) => Promise<void>;
    scheduleTimeout: typeof setTimeout;
    scheduleInterval: typeof setInterval;
};
const testClock = nodeRequire('../helpers/test-clock') as {
    reset: () => number;
    useRealTime: () => void;
};
const { initializeTestLogging } = nodeRequire('../helpers/test-setup') as {
    initializeTestLogging: () => void;
};
const { initializeStaticSecrets, _resetForTesting } = nodeRequire('../../src/core/secrets') as {
    initializeStaticSecrets: () => void;
    _resetForTesting: () => void;
};

// Initialize logging FIRST at module load time, before any test files import modules
// This ensures getUnifiedLogger() works when production code falls back to it
initializeTestLogging();
const {
    createMockFn,
    clearAllMocks,
    restoreAllMocks
} = nodeRequire('../helpers/bun-mock-utils');
const { mockModule } = nodeRequire('../helpers/bun-module-mocks');
const {
    installTimerTracking,
    clearTrackedTimers,
    restoreTimerTracking
} = nodeRequire('../helpers/bun-timers');

type SetupGlobalState = typeof globalThis & {
    __ORIGINAL_PROCESS_EXIT__?: typeof process.exit;
    __NOOP_PROCESS_EXIT__?: (code?: string | number | null) => void;
    waitForDelay: typeof waitForDelay;
    scheduleTestTimeout: typeof scheduleTimeout;
    scheduleTestInterval: typeof scheduleInterval;
    expectNoAuthentication: () => void;
    restoreConsole: () => void;
    createLoggerMock: () => Record<string, unknown>;
    __TEST_LOGGER__: Record<string, unknown>;
    originalConsole: Console;
};

const setupGlobal = global as SetupGlobalState;
const originalProcessExit = setupGlobal.__ORIGINAL_PROCESS_EXIT__ || process.exit;
const noopProcessExit = setupGlobal.__NOOP_PROCESS_EXIT__ || (() => {});
const originalConsole = setupGlobal.console;

setupGlobal.waitForDelay = waitForDelay;
setupGlobal.scheduleTestTimeout = scheduleTimeout;
setupGlobal.scheduleTestInterval = scheduleInterval;

setupGlobal.expectNoAuthentication = () => {};

setupGlobal.restoreConsole = () => {
    setupGlobal.console = originalConsole;
};

// Helper for tests that need a mock logger - inject via DI, don't mock globally
const createLoggerMock = () => ({
    info: createMockFn(),
    debug: createMockFn(),
    warn: createMockFn(),
    error: createMockFn(),
    log: createMockFn()
});

// Make available globally for tests that need it
setupGlobal.createLoggerMock = createLoggerMock;

const createWebSocketMock = () => {
    const webSocketMock = createMockFn().mockImplementation(() => ({
        on: createMockFn(),
        send: createMockFn(),
        close: createMockFn(),
        readyState: 1,
        CONNECTING: 0,
        OPEN: 1,
        CLOSING: 2,
        CLOSED: 3
    }));
    webSocketMock.CONNECTING = 0;
    webSocketMock.OPEN = 1;
    webSocketMock.CLOSING = 2;
    webSocketMock.CLOSED = 3;
    return webSocketMock;
};

const createAxiosMock = () => ({
    post: createMockFn().mockResolvedValue({ data: { data: [] } }),
    get: createMockFn().mockResolvedValue({ data: { data: [] } }),
    delete: createMockFn().mockResolvedValue({ data: { data: [] } }),
    create: createMockFn(() => ({
        post: createMockFn().mockResolvedValue({ data: { data: [] } }),
        get: createMockFn().mockResolvedValue({ data: { data: [] } }),
        delete: createMockFn().mockResolvedValue({ data: { data: [] } })
    }))
});

const createTikTokConnectorMock = () => ({
    WebcastPushConnection: createMockFn().mockImplementation(() => ({
        connect: createMockFn().mockResolvedValue(true),
        disconnect: createMockFn().mockResolvedValue(true),
        on: createMockFn(),
        getState: createMockFn().mockReturnValue({ isConnected: true })
    })),
    WebcastEvent: {},
    ControlEvent: {},
    __esModule: true
});

const createYoutubeiMock = () => ({
    Innertube: {
        create: createMockFn().mockResolvedValue({
            session: {
                context: {
                    client: {
                        clientName: 'WEB',
                        clientVersion: '2.0.0'
                    }
                }
            },
            call: createMockFn().mockResolvedValue({}),
            actions: {
                session: {
                    getStreamingData: createMockFn().mockResolvedValue({})
                }
            },
            getInfo: createMockFn().mockResolvedValue({
                basic_info: {
                    title: 'Mock Video Title',
                    channel: { name: 'Mock Channel' },
                    view_count: 1000,
                    like_count: 100
                },
                player_overlays: {
                    player_overlay_renderer: {
                        view_count: { text: '1,234 watching' }
                    }
                },
                video_details: {
                    view_count: '1234'
                }
            }),
            getBasicInfo: createMockFn().mockResolvedValue({
                basic_info: {
                    title: 'Mock Video Title',
                    view_count: 1000
                }
            })
        })
    }
});

const toHaveLengthGreaterThan = (received: unknown, expected: number) => {
    const receivedArray = Array.isArray(received) ? received : [];
    const pass = receivedArray.length > expected;
    return {
        message: () => `expected array to have length greater than ${expected}, but got ${receivedArray.length}`,
        pass
    };
};

const toBeValidNotification = (received: unknown) => {
    const notification = received && typeof received === 'object'
        ? received as Record<string, unknown>
        : {};
    const requiredProps = ['id', 'type', 'username', 'platform', 'displayMessage', 'ttsMessage'];
    const missingProps = requiredProps.filter((prop) => !Object.prototype.hasOwnProperty.call(notification, prop));
    if (missingProps.length === 0) {
        return { message: () => 'expected notification to be valid', pass: true };
    }
    return {
        message: () => `expected notification to be valid, but missing properties: ${missingProps.join(', ')}`,
        pass: false
    };
};

const toBeValidUser = (received: unknown) => {
    const user = received && typeof received === 'object'
        ? received as Record<string, unknown>
        : {};
    const requiredProps = ['username'];
    const missingProps = requiredProps.filter((prop) => !Object.prototype.hasOwnProperty.call(user, prop));
    if (missingProps.length === 0) {
        return { message: () => 'expected user to be valid', pass: true };
    }
    return {
        message: () => `expected user to be valid, but missing properties: ${missingProps.join(', ')}`,
        pass: false
    };
};

const registerModuleMocks = () => {
    const webSocketMock = createWebSocketMock();

    mockModule('ws', () => webSocketMock);

    mockModule('axios', createAxiosMock);

    mockModule('tiktok-live-connector', createTikTokConnectorMock);
    mockModule('youtubei.js', createYoutubeiMock);
};

registerModuleMocks();

expect.extend({
    toHaveLengthGreaterThan,
    toBeValidNotification,
    toBeValidUser
});

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

    setupGlobal.__TEST_LOGGER__ = createLoggerMock();

    process.exit = createMockFn((code = 0) => noopProcessExit(code));

    setupGlobal.originalConsole = originalConsole;
    setupGlobal.console = {
        log: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn(),
        debug: createMockFn()
    } as unknown as Console;

    installTimerTracking();
});

beforeEach(() => {
    testClock.reset();
    clearAllMocks();
});

afterEach(() => {
    clearTrackedTimers();
});

afterAll(() => {
    process.exit = originalProcessExit;
    setupGlobal.console = originalConsole;
    restoreTimerTracking();
    restoreAllMocks();
});

export {
    createLoggerMock,
    registerModuleMocks,
    createWebSocketMock,
    createAxiosMock,
    createTikTokConnectorMock,
    createYoutubeiMock,
    toHaveLengthGreaterThan,
    toBeValidNotification,
    toBeValidUser
};
