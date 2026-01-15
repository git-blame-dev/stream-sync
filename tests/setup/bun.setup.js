const { beforeAll, beforeEach, afterEach, afterAll, expect, mock } = require('bun:test');
const { waitForDelay, scheduleTimeout, scheduleInterval } = require('../helpers/time-utils');
const testClock = require('../helpers/test-clock');
const { initializeTestLogging } = require('../helpers/test-setup');
const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');
const {
    createMockFn,
    isMockFunction,
    clearAllMocks,
    restoreAllMocks
} = require('../helpers/bun-mock-utils');
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

const createLoggerMock = () => ({
    info: createMockFn(),
    debug: createMockFn(),
    warn: createMockFn(),
    error: createMockFn(),
    log: createMockFn()
});

const mockHttpClient = {
    get: createMockFn().mockResolvedValue({ data: {} }),
    post: createMockFn().mockResolvedValue({ data: {} }),
    put: createMockFn().mockResolvedValue({ data: {} }),
    delete: createMockFn().mockResolvedValue({ data: {} }),
    getWithUserAgent: createMockFn().mockResolvedValue({ data: {} })
};

const applyLoggingMocks = () => {
    const logging = require('../../src/core/logging');
    if (logging && typeof logging.getLogger === 'function' && isMockFunction(logging.getLogger)) {
        const logger = createLoggerMock();
        logging.getLogger.mockReturnValue(logger);
        if (typeof logging.getUnifiedLogger === 'function' && isMockFunction(logging.getUnifiedLogger)) {
            logging.getUnifiedLogger.mockReturnValue(logger);
        }
        if (logging.logger && typeof logging.logger === 'object') {
            Object.assign(logging.logger, logger);
        }
    }
};

const registerModuleMocks = () => {
    mock.module('../../src/core/logging', () => ({
        logger: createLoggerMock(),
        platformLogger: createLoggerMock(),
        getUnifiedLogger: createMockFn(() => createLoggerMock()),
        setDebugMode: createMockFn(),
        getDebugMode: createMockFn(() => false),
        getLogger: createMockFn(() => createLoggerMock()),
        initializeUnifiedLogger: createMockFn(),
        setConfigValidator: createMockFn(),
        initializeLoggingConfig: createMockFn(),
        initializeConsoleOverride: createMockFn(),
        logChatMessage: createMockFn(),
        formatPlatformName: createMockFn((platform) => platform),
        __esModule: true
    }));

    mock.module('../../src/utils/logger-utils', () => ({
        getLazyLogger: () => createLoggerMock(),
        createNoopLogger: () => createLoggerMock(),
        getLoggerOrNoop: (logger) => logger || createLoggerMock(),
        getLazyUnifiedLogger: createMockFn(() => createLoggerMock()),
        safeObjectStringify: (obj) => {
            try {
                return JSON.stringify(obj);
            } catch (error) {
                return String(obj);
            }
        },
        __esModule: true
    }));

    mock.module('../../src/utils/http-client', () => ({
        HttpClient: createMockFn().mockImplementation(() => mockHttpClient),
        createHttpClient: createMockFn(() => mockHttpClient),
        __esModule: true
    }));

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

    mock.module('ws', () => webSocketMock);

    mock.module('axios', () => ({
        post: createMockFn().mockResolvedValue({ data: { data: [] } }),
        get: createMockFn().mockResolvedValue({ data: { data: [] } }),
        delete: createMockFn().mockResolvedValue({ data: { data: [] } }),
        create: createMockFn(() => ({
            post: createMockFn().mockResolvedValue({ data: { data: [] } }),
            get: createMockFn().mockResolvedValue({ data: { data: [] } }),
            delete: createMockFn().mockResolvedValue({ data: { data: [] } })
        }))
    }));

    mock.module('tiktok-live-connector', () => ({
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

    mock.module('youtubei.js', () => ({
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

    initializeTestLogging();

    if (!global.__TEST_RUNTIME_CONSTANTS__) {
        global.__TEST_RUNTIME_CONSTANTS__ = createRuntimeConstantsFixture();
    }

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
    applyLoggingMocks();
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
