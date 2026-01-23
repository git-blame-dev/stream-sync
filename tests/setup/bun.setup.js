const { beforeAll, beforeEach, afterEach, afterAll, expect } = require('bun:test');
const { waitForDelay, scheduleTimeout, scheduleInterval } = require('../helpers/time-utils');
const testClock = require('../helpers/test-clock');
const { initializeTestLogging } = require('../helpers/test-setup');

// Initialize logging FIRST at module load time, before any test files import modules
// This ensures getUnifiedLogger() works when production code falls back to it
initializeTestLogging();
const {
    createMockFn,
    clearAllMocks,
    restoreAllMocks
} = require('../helpers/bun-mock-utils');
const { mockModule } = require('../helpers/bun-module-mocks');
const {
    installTimerTracking,
    clearTrackedTimers,
    restoreTimerTracking
} = require('../helpers/bun-timers');

const originalProcessExit = global.__ORIGINAL_PROCESS_EXIT__ || process.exit;
const noopProcessExit = global.__NOOP_PROCESS_EXIT__ || (() => {});
const originalConsole = global.console;

global.waitForDelay = waitForDelay;
global.scheduleTestTimeout = scheduleTimeout;
global.scheduleTestInterval = scheduleInterval;

global.expectNoAuthentication = () => {};

global.restoreConsole = () => {
    global.console = originalConsole;
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
global.createLoggerMock = createLoggerMock;

const registerModuleMocks = () => {
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

    mockModule('ws', () => webSocketMock);

    mockModule('axios', () => ({
        post: createMockFn().mockResolvedValue({ data: { data: [] } }),
        get: createMockFn().mockResolvedValue({ data: { data: [] } }),
        delete: createMockFn().mockResolvedValue({ data: { data: [] } }),
        create: createMockFn(() => ({
            post: createMockFn().mockResolvedValue({ data: { data: [] } }),
            get: createMockFn().mockResolvedValue({ data: { data: [] } }),
            delete: createMockFn().mockResolvedValue({ data: { data: [] } })
        }))
    }));

    mockModule('tiktok-live-connector', () => ({
        WebcastPushConnection: createMockFn().mockImplementation(() => ({
            connect: createMockFn().mockResolvedValue(true),
            disconnect: createMockFn().mockResolvedValue(true),
            on: createMockFn(),
            getState: createMockFn().mockReturnValue({ isConnected: true })
        })),
        WebcastEvent: {},
        ControlEvent: {},
        __esModule: true
    }));

    mockModule('youtubei.js', () => ({
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
    }));
};

registerModuleMocks();

expect.extend({
    toHaveLengthGreaterThan(received, expected) {
        const pass = received.length > expected;
        return {
            message: () => `expected array to have length greater than ${expected}, but got ${received.length}`,
            pass
        };
    },
    toBeValidNotification(received) {
        const requiredProps = ['id', 'type', 'username', 'platform', 'displayMessage', 'ttsMessage'];
        const missingProps = requiredProps.filter((prop) => !received.hasOwnProperty(prop));
        if (missingProps.length === 0) {
            return { message: () => 'expected notification to be valid', pass: true };
        }
        return {
            message: () => `expected notification to be valid, but missing properties: ${missingProps.join(', ')}`,
            pass: false
        };
    },
    toBeValidUser(received) {
        const requiredProps = ['username'];
        const missingProps = requiredProps.filter((prop) => !received.hasOwnProperty(prop));
        if (missingProps.length === 0) {
            return { message: () => 'expected user to be valid', pass: true };
        }
        return {
            message: () => `expected user to be valid, but missing properties: ${missingProps.join(', ')}`,
            pass: false
        };
    }
});

beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.TWITCH_DISABLE_AUTH = 'true';
    process.env.YOUTUBE_DISABLE_AUTH = 'true';
    process.env.TIKTOK_DISABLE_AUTH = 'true';
    process.env.TWITCH_API_KEY = 'test_mock_key';
    process.env.YOUTUBE_API_KEY = 'test_mock_key';
    process.env.TIKTOK_API_KEY = 'test_mock_key';

    global.__TEST_LOGGER__ = createLoggerMock();

    process.exit = createMockFn((code = 0) => noopProcessExit(code));

    global.originalConsole = originalConsole;
    global.console = {
        log: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn(),
        debug: createMockFn()
    };

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
    global.console = originalConsole;
    restoreTimerTracking();
    restoreAllMocks();
});
