const { waitForDelay, scheduleTimeout, scheduleInterval } = require('../helpers/time-utils');
const {
    __setTimerImplementations,
    __resetTimerImplementations
} = require('../../src/utils/timeout-validator');

global.waitForDelay = waitForDelay;
global.scheduleTestTimeout = scheduleTimeout;
global.scheduleTestInterval = scheduleInterval;

const originalUseFakeTimers = jest.useFakeTimers.bind(jest);
jest.useFakeTimers = (...args) => {
    const result = originalUseFakeTimers(...args);
    __setTimerImplementations({
        setTimeoutImpl: (...timerArgs) => global.setTimeout(...timerArgs),
        setIntervalImpl: (...timerArgs) => global.setInterval(...timerArgs)
    });
    return result;
};

const originalUseRealTimers = jest.useRealTimers.bind(jest);
jest.useRealTimers = (...args) => {
    const result = originalUseRealTimers(...args);
    __resetTimerImplementations();
    return result;
};


const { createMockLogger } = require('../helpers/mock-factories');
const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');

// Initialize test logging first (prevents console pollution)
const { initializeTestLogging } = require('../helpers/test-setup');
initializeTestLogging();

// Ensure NODE_ENV is set to test to prevent any authentication attempts
process.env.NODE_ENV = 'test';
global.__TEST_RUNTIME_CONSTANTS__ = createRuntimeConstantsFixture();

// Prevent any real network requests or authentication during tests
process.env.TWITCH_DISABLE_AUTH = 'true';
process.env.YOUTUBE_DISABLE_AUTH = 'true';
process.env.TIKTOK_DISABLE_AUTH = 'true';

// Override any real API keys/tokens that might be loaded from config files
process.env.TWITCH_API_KEY = 'test_mock_key';
process.env.YOUTUBE_API_KEY = 'test_mock_key';
process.env.TIKTOK_API_KEY = 'test_mock_key';

// Prevent tests from terminating the worker by calling process.exit
const originalProcessExit = global.__ORIGINAL_PROCESS_EXIT__ || process.exit;
const noopProcessExit = global.__NOOP_PROCESS_EXIT__ || (() => {});
process.exit = jest.fn((code = 0) => noopProcessExit(code));

afterAll(() => {
    process.exit = originalProcessExit;
});

// Create comprehensive platform mocks to prevent authentication
const mockLogger = createMockLogger('info');
global.__TEST_LOGGER__ = mockLogger;

// Global logger mock for consistent test behavior
jest.mock('../../src/core/logging', () => ({
    logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
    },
    platformLogger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
    },
    // Add getUnifiedLogger for compatibility
    getUnifiedLogger: jest.fn(() => ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
    })),
    // Debug mode functions
    setDebugMode: jest.fn(),
    getDebugMode: jest.fn(() => false),
    // Add other logging functions that tests might expect
    getLogger: jest.fn(() => ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
    })),
    initializeUnifiedLogger: jest.fn(),
    setConfigValidator: jest.fn(),
    initializeLoggingConfig: jest.fn(),
    initializeConsoleOverride: jest.fn(),
    logChatMessage: jest.fn(),
    formatPlatformName: jest.fn(platform => platform),
    __esModule: true
}));

const createLoggerMock = () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn()
});

const applyLoggingMocks = () => {
    const logging = require('../../src/core/logging');
    if (logging && typeof logging.getLogger === 'function' && jest.isMockFunction(logging.getLogger)) {
        const logger = createLoggerMock();
        logging.getLogger.mockReturnValue(logger);
        if (typeof logging.getUnifiedLogger === 'function' && jest.isMockFunction(logging.getUnifiedLogger)) {
            logging.getUnifiedLogger.mockReturnValue(logger);
        }
        if (logging.logger && typeof logging.logger === 'object') {
            Object.assign(logging.logger, logger);
        }
    }
};

beforeEach(() => {
    applyLoggingMocks();
});

// Mock logger-utils to provide test-compatible logger
jest.mock('../../src/utils/logger-utils', () => ({
    getLazyLogger: () => ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
    }),
    createNoopLogger: () => ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
    }),
    getLoggerOrNoop: (logger) => logger || ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
    }),
    getLazyUnifiedLogger: jest.fn(() => ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
    })),
    safeObjectStringify: (obj) => {
        try {
            return JSON.stringify(obj);
        } catch (e) {
            return String(obj);
        }
    },
    __esModule: true
}));

const mockHttpClient = {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
    getWithUserAgent: jest.fn().mockResolvedValue({ data: {} })
};

// Mock http-client to prevent getUnifiedLogger() calls during module loading
jest.mock('../../src/utils/http-client', () => ({
    HttpClient: jest.fn().mockImplementation(() => mockHttpClient),
    createHttpClient: jest.fn(() => mockHttpClient),
    __esModule: true
}));

// Global app handler mock for platforms that expect app.handleX methods
global.createTestApp = () => ({
    handleChatMessage: jest.fn().mockResolvedValue(true),
    handleNotification: jest.fn().mockResolvedValue(true),
    handleFollowNotification: jest.fn().mockResolvedValue(true),
    handlePaypiggyNotification: jest.fn().mockResolvedValue(true),
    handleGiftNotification: jest.fn().mockResolvedValue(true),
    handleMemberNotification: jest.fn().mockResolvedValue(true),
    updateViewerCount: jest.fn(),
    logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
    }
});

// Mock all platform modules at the Jest level
jest.mock('../../src/platforms/twitch', () => {
    return {
        TwitchPlatform: jest.fn().mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(true),
            connect: jest.fn().mockResolvedValue(true),
            disconnect: jest.fn().mockResolvedValue(true),
            on: jest.fn(),
            sendMessage: jest.fn().mockResolvedValue(true),
            isConnected: jest.fn().mockReturnValue(false),
            getViewerCount: jest.fn().mockReturnValue(0),
            // Mock all handler methods
            onChat: jest.fn(),
            onViewerCount: jest.fn(),
            onFollow: jest.fn(),
            onSubscription: jest.fn(),
            onGift: jest.fn(),
            onRaid: jest.fn(),
            // Add missing platform handler methods
            handleChatMessage: jest.fn().mockResolvedValue(true),
            handleFollowNotification: jest.fn().mockResolvedValue(true),
            handlePaypiggyNotification: jest.fn().mockResolvedValue(true),
            handleGiftNotification: jest.fn().mockResolvedValue(true),
            handleMemberNotification: jest.fn().mockResolvedValue(true),
            // Add the missing event handler methods that tests are looking for
            handleFollowEvent: jest.fn().mockResolvedValue(true),
            handlePaypiggyEvent: jest.fn().mockResolvedValue(true),
            handleRaidEvent: jest.fn().mockResolvedValue(true),
            handleCheerEvent: jest.fn().mockResolvedValue(true),
            logRawPlatformData: jest.fn().mockResolvedValue(true)
        })),
        __esModule: true
    };
});

// Mock TwitchEventSub to prevent real WebSocket connections and API calls
jest.mock('../../src/platforms/twitch-eventsub', () => {
    return jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(true),
        connect: jest.fn().mockResolvedValue(true),
        disconnect: jest.fn().mockResolvedValue(true),
        subscribe: jest.fn().mockResolvedValue(true),
        unsubscribe: jest.fn().mockResolvedValue(true),
        subscribeToEvents: jest.fn().mockResolvedValue(true),
        isConnected: jest.fn().mockReturnValue(false),
        isActive: jest.fn().mockReturnValue(false),
        cleanup: jest.fn().mockResolvedValue(true),
        on: jest.fn(),
        off: jest.fn(),
        removeListener: jest.fn(),
        emit: jest.fn(),
        sendMessage: jest.fn().mockResolvedValue(true)
    }));
});

// Mock WebSocket to prevent real connections
jest.mock('ws', () => {
    return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        send: jest.fn(),
        close: jest.fn(),
        readyState: 1, // WebSocket.OPEN
        CONNECTING: 0,
        OPEN: 1,
        CLOSING: 2,
        CLOSED: 3
    }));
});

// Mock axios to prevent real HTTP requests to Twitch API
jest.mock('axios', () => ({
    post: jest.fn().mockResolvedValue({ data: { data: [] } }),
    get: jest.fn().mockResolvedValue({ data: { data: [] } }),
    delete: jest.fn().mockResolvedValue({ data: { data: [] } }),
    create: jest.fn(() => ({
        post: jest.fn().mockResolvedValue({ data: { data: [] } }),
        get: jest.fn().mockResolvedValue({ data: { data: [] } }),
        delete: jest.fn().mockResolvedValue({ data: { data: [] } })
    }))
}));

jest.mock('../../src/platforms/tiktok', () => {
    return {
        TikTokPlatform: jest.fn().mockImplementation((config = {}, dependencies = {}) => ({
            config: {
                giftAggregationEnabled: config.giftAggregationEnabled !== undefined ? config.giftAggregationEnabled : true,
                ...config
            },
            // Gift aggregation system properties
            giftAggregation: {},
            giftAggregationDelay: 2000,
            // Dependencies
            notificationBridge: dependencies.notificationBridge || null,
            initialize: jest.fn().mockResolvedValue(true),
            connect: jest.fn().mockResolvedValue(true),
            disconnect: jest.fn().mockResolvedValue(true),
            on: jest.fn(),
            isConnected: jest.fn().mockReturnValue(false),
            getViewerCount: jest.fn().mockReturnValue(0),
            // Mock all handler methods
            onChat: jest.fn(),
            onViewerCount: jest.fn(),
            onGift: jest.fn(),
            onFollow: jest.fn(),
            onSubscription: jest.fn(),
            // Add missing platform handler methods
            handleChatMessage: jest.fn().mockResolvedValue(true),
            handleFollowNotification: jest.fn().mockResolvedValue(true),
            handlePaypiggyNotification: jest.fn().mockResolvedValue(true),
            handleGiftNotification: jest.fn().mockResolvedValue(true),
            handleMemberNotification: jest.fn().mockResolvedValue(true),
            handleConnectionError: jest.fn().mockResolvedValue(true),
            logRawPlatformData: jest.fn().mockResolvedValue(true),
            // Add missing gift handling methods with aggregation logic
            handleTikTokGift: jest.fn().mockImplementation(function(giftData) {
                // Simulate basic gift aggregation when enabled
                if (this.config.giftAggregationEnabled) {
                    const userId = giftData.userId;
                    if (!userId) {
                        return Promise.resolve(true);
                    }
                    const giftType = giftData.giftDetails?.giftName || 'Unknown';
                    const aggregationKey = `${userId}-${giftType}`;
                    
                    if (!this.giftAggregation[aggregationKey]) {
                        // Create a proper timer that can be cleaned up
                        const timerId = global.scheduleTestTimeout(() => {
                            // Cleanup this aggregation entry when timer expires
                            delete this.giftAggregation[aggregationKey];
                        }, 2000);
                        
                        this.giftAggregation[aggregationKey] = {
                            totalCount: 0,
                            timer: timerId
                        };
                    }
                    // TikTok uses cumulative counts - use the latest count, not sum
                    this.giftAggregation[aggregationKey].totalCount = giftData.repeatCount || 1;
                } else {
                    // When aggregation disabled, immediately call app.handleGiftNotification
                    if (this.notificationBridge && this.notificationBridge.handleGiftNotification) {
                        const displayName = giftData.uniqueId;
                        if (!displayName) {
                            return Promise.resolve(true);
                        }
                        const giftType = giftData.giftDetails?.giftName || 'Unknown';
                        const giftCount = giftData.repeatCount || 1;
                        const unitAmount = giftData.giftDetails?.diamondCount || 0;
                        const amount = unitAmount * giftCount;
                        this.notificationBridge.handleGiftNotification('tiktok', displayName, {
                            giftType: giftType,
                            giftCount,
                            amount,
                            currency: 'coins',
                            isAggregated: false
                        });
                    }
                }
                return Promise.resolve(true);
            }),
            handleGift: jest.fn().mockResolvedValue(true),
            destroy: jest.fn().mockImplementation(function() {
                // Clean up aggregation timers
                Object.values(this.giftAggregation).forEach(aggregation => {
                    if (aggregation.timer) {
                        clearTimeout(aggregation.timer);
                    }
                });
                this.giftAggregation = {};
                return Promise.resolve();
            })
        })),
        __esModule: true
    };
});

jest.mock('../../src/platforms/streamelements', () => {
    return {
        StreamElementsPlatform: jest.fn().mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(true),
            connect: jest.fn().mockResolvedValue(true),
            disconnect: jest.fn().mockResolvedValue(true),
            on: jest.fn(),
            isConnected: jest.fn().mockReturnValue(false),
            // Mock all handler methods
            onFollow: jest.fn(),
            onSubscription: jest.fn(),
            onGift: jest.fn(),
            // Add missing platform handler methods
            handleChatMessage: jest.fn().mockResolvedValue(true),
            handleFollowNotification: jest.fn().mockResolvedValue(true),
            handlePaypiggyNotification: jest.fn().mockResolvedValue(true),
            handleGiftNotification: jest.fn().mockResolvedValue(true),
            handleMemberNotification: jest.fn().mockResolvedValue(true),
            logRawPlatformData: jest.fn().mockResolvedValue(true)
        })),
        __esModule: true
    };
});

// Mock the platforms index file
jest.mock('../../src/platforms/index', () => {
    return {
        TwitchPlatform: jest.fn().mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(true),
            connect: jest.fn().mockResolvedValue(true),
            disconnect: jest.fn().mockResolvedValue(true),
            on: jest.fn(),
            handleChatMessage: jest.fn().mockResolvedValue(true),
            handleFollowNotification: jest.fn().mockResolvedValue(true),
            handlePaypiggyNotification: jest.fn().mockResolvedValue(true),
            handleGiftNotification: jest.fn().mockResolvedValue(true),
            handleMemberNotification: jest.fn().mockResolvedValue(true),
            logRawPlatformData: jest.fn().mockResolvedValue(true)
        })),
        YouTubePlatform: jest.fn().mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(true),
            connect: jest.fn().mockResolvedValue(true),
            disconnect: jest.fn().mockResolvedValue(true),
            on: jest.fn(),
            handleChatMessage: jest.fn().mockResolvedValue(true),
            handleSuperChat: jest.fn().mockResolvedValue(true),
            handleFollowNotification: jest.fn().mockResolvedValue(true),
            handleMemberNotification: jest.fn().mockResolvedValue(true),
            handleGiftNotification: jest.fn().mockResolvedValue(true),
            logRawPlatformData: jest.fn().mockResolvedValue(true)
        })),
        TikTokPlatform: jest.fn().mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(true),
            connect: jest.fn().mockResolvedValue(true),
            disconnect: jest.fn().mockResolvedValue(true),
            on: jest.fn(),
            handleChatMessage: jest.fn().mockResolvedValue(true),
            handleFollowNotification: jest.fn().mockResolvedValue(true),
            handlePaypiggyNotification: jest.fn().mockResolvedValue(true),
            handleGiftNotification: jest.fn().mockResolvedValue(true),
            handleMemberNotification: jest.fn().mockResolvedValue(true),
            logRawPlatformData: jest.fn().mockResolvedValue(true)
        })),
        StreamElementsPlatform: jest.fn().mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(true),
            connect: jest.fn().mockResolvedValue(true),
            disconnect: jest.fn().mockResolvedValue(true),
            on: jest.fn(),
            handleChatMessage: jest.fn().mockResolvedValue(true),
            handleFollowNotification: jest.fn().mockResolvedValue(true),
            handlePaypiggyNotification: jest.fn().mockResolvedValue(true),
            handleGiftNotification: jest.fn().mockResolvedValue(true),
            handleMemberNotification: jest.fn().mockResolvedValue(true),
            logRawPlatformData: jest.fn().mockResolvedValue(true)
        })),
        __esModule: true
    };
});

// NOTE: We don't globally mock main.js because some integration tests
// need to import it properly. Individual tests should mock main.js 
// if they need to prevent platform imports.

// Mock external libraries that might trigger authentication
// Note: These mocks will only work if the libraries are installed
// For uninstalled libraries, we'll use moduleNameMapper in package.json

// We'll handle these via moduleNameMapper instead of jest.mock()
// to avoid module resolution errors for uninstalled packages

// Global console override to reduce test noise
global.originalConsole = console;
global.console = {
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
};

// Restore console for debugging when needed
global.restoreConsole = () => {
    global.console = global.originalConsole;
};

// Add global test utilities
global.expectNoAuthentication = () => {
    // Utility to verify no authentication attempts were made
    // This can be expanded to check specific authentication methods
};

// Global timer cleanup to prevent hanging handles
let activeTimers = new Set();
const originalSetTimeout = global.setTimeout;
const originalSetInterval = global.setInterval;
const originalClearTimeout = global.clearTimeout;
const originalClearInterval = global.clearInterval;

// Override setTimeout to track active timers
global.setTimeout = function(callback, delay, ...args) {
    const timerId = originalSetTimeout.call(this, callback, delay, ...args);
    activeTimers.add(timerId);
    return timerId;
};

// Override setInterval to track active intervals
global.setInterval = function(callback, delay, ...args) {
    const intervalId = originalSetInterval.call(this, callback, delay, ...args);
    activeTimers.add(intervalId);
    return intervalId;
};

// Override clearTimeout to untrack cleared timers
global.clearTimeout = function(timerId) {
    activeTimers.delete(timerId);
    return originalClearTimeout.call(this, timerId);
};

// Override clearInterval to untrack cleared intervals
global.clearInterval = function(intervalId) {
    activeTimers.delete(intervalId);
    return originalClearInterval.call(this, intervalId);
};

// Clean up all active timers after each test
afterEach(() => {
    // Clear any remaining active timers
    activeTimers.forEach(timerId => {
        try {
            originalClearTimeout(timerId);
            originalClearInterval(timerId);
        } catch (error) {
            // Ignore errors when clearing already-cleared timers
        }
    });
    activeTimers.clear();
});

// Final cleanup on test suite completion
afterAll(() => {
    // Restore original timer functions
    global.setTimeout = originalSetTimeout;
    global.setInterval = originalSetInterval;
    global.clearTimeout = originalClearTimeout;
    global.clearInterval = originalClearInterval;
    
    // Clear any remaining timers
    activeTimers.forEach(timerId => {
        try {
            originalClearTimeout(timerId);
            originalClearInterval(timerId);
        } catch (error) {
            // Ignore errors
        }
    });
    activeTimers.clear();
});
