
// ================================================================================================
// GLOBAL TEST CONFIGURATION
// ================================================================================================

const { waitForDelay, scheduleTimeout, scheduleInterval } = require('./time-utils');

global.waitForDelay = waitForDelay;
global.scheduleTestTimeout = scheduleTimeout;
global.scheduleTestInterval = scheduleInterval;

// Set test environment variables
process.env.NODE_ENV = 'test';

// Increase timeout for complex tests
jest.setTimeout(15000);

// ================================================================================================
// CONSOLE MOCKING
// ================================================================================================

// Mock console methods for testing
global.console = {
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
    dir: jest.fn(),
    time: jest.fn(),
    timeEnd: jest.fn(),
    group: jest.fn(),
    groupEnd: jest.fn(),
    table: jest.fn()
};

// ================================================================================================
// PROCESS MOCKING
// ================================================================================================

// Store original process.exit
const originalExit = process.exit;

// Mock process.exit to prevent tests from actually exiting
process.exit = jest.fn();

// ================================================================================================
// TIMER MOCKING
// ================================================================================================

// NOTE: Fake timers are NOT used globally as they cause async operation hangs
// Individual tests can enable fake timers with jest.useFakeTimers() if needed
// Most tests should use real timers to avoid hanging async operations

// ================================================================================================
// CUSTOM MATCHERS
// ================================================================================================

// Add custom matchers for better test assertions
expect.extend({
    toHaveLengthGreaterThan(received, expected) {
        const pass = received.length > expected;
        if (pass) {
            return {
                message: () => `expected array to have length greater than ${expected}, but got ${received.length}`,
                pass: true,
            };
        } else {
            return {
                message: () => `expected array to have length greater than ${expected}, but got ${received.length}`,
                pass: false,
            };
        }
    },
    
    toBeValidNotification(received) {
        const requiredProps = ['id', 'type', 'username', 'platform', 'displayMessage', 'ttsMessage'];
        const missingProps = requiredProps.filter(prop => !received.hasOwnProperty(prop));
        
        if (missingProps.length === 0) {
            return {
                message: () => `expected notification to be valid`,
                pass: true,
            };
        } else {
            return {
                message: () => `expected notification to be valid, but missing properties: ${missingProps.join(', ')}`,
                pass: false,
            };
        }
    },
    
    toBeValidUser(received) {
        const requiredProps = ['username'];
        const missingProps = requiredProps.filter(prop => !received.hasOwnProperty(prop));
        
        if (missingProps.length === 0) {
            return {
                message: () => `expected user to be valid`,
                pass: true,
            };
        } else {
            return {
                message: () => `expected user to be valid, but missing properties: ${missingProps.join(', ')}`,
                pass: false,
            };
        }
    }
});

// ================================================================================================
// TEST UTILITIES
// ================================================================================================

// Global test utilities
global.TEST_UTILS = {
    // Create a mock logger for tests
    createMockLogger: (level = 'debug') => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
    }),
    
    // Create a mock config for tests
    createMockConfig: (platform = 'tiktok') => ({
        enabled: true,
        username: 'testuser',
        debug: false,
        platform: platform
    }),
    
    // Wait for async operations (works with both real and fake timers)
    // IMPORTANT: This tracks timers to ensure proper cleanup
    waitFor: (ms = 100) => {
        if (jest.isMockFunction(setTimeout)) {
            // Fake timers are active - use Jest's timer advancement
            return new Promise(resolve => {
                globalThis['setTimeout'](resolve, ms);
                jest.advanceTimersByTime(ms);
            });
        } else {
            // Real timers - use normal setTimeout with cleanup tracking
            return new Promise(resolve => {
                const timerId = scheduleTimeout(() => {
                    resolve();
                }, ms);
                // Store timer for cleanup (if needed)
                if (!global.TEST_ACTIVE_TIMERS) global.TEST_ACTIVE_TIMERS = new Set();
                global.TEST_ACTIVE_TIMERS.add(timerId);
            });
        }
    },
    
    // Clear all mocks
    clearAllMocks: () => {
        jest.clearAllMocks();
        jest.clearAllTimers();
    }
};

// ================================================================================================
// BEFORE/AFTER HOOKS
// ================================================================================================

// Global beforeAll hook
beforeAll(() => {
    // Initialize test logging with error handling
    try {
        const { initializeTestLogging } = require('./test-setup');
        initializeTestLogging();
    } catch (error) {
        // Test setup not available or failed, continue with warning
        console.warn('Test logging initialization failed:', error.message);
        // Don't fail the test, just continue
    }
});

// Global beforeEach hook
beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    jest.clearAllTimers();
    
    // Reset console mocks - now they are properly initialized as Jest mocks
    console.log.mockClear();
    console.debug.mockClear();
    console.info.mockClear();
    console.warn.mockClear();
    console.error.mockClear();
});

// Global afterEach hook
afterEach(() => {
    // Clean up any remaining timers
    jest.clearAllTimers();
    
    // Clean up any tracked real timers
    if (global.TEST_ACTIVE_TIMERS) {
        global.TEST_ACTIVE_TIMERS.forEach(timerId => {
            try {
                clearTimeout(timerId);
            } catch (e) {
                // Timer may already be cleared
            }
        });
        global.TEST_ACTIVE_TIMERS.clear();
    }
    
    // Restore process.exit
    process.exit = originalExit;
});

// Global afterAll hook
afterAll(() => {
    // Clean up any global state
    jest.restoreAllMocks();
    
    // Final cleanup of any remaining timers
    jest.clearAllTimers();
    
    // Clean up any tracked real timers
    if (global.TEST_ACTIVE_TIMERS) {
        global.TEST_ACTIVE_TIMERS.forEach(timerId => {
            try {
                clearTimeout(timerId);
            } catch (e) {
                // Timer may already be cleared
            }
        });
        global.TEST_ACTIVE_TIMERS.clear();
    }
});

// ================================================================================================
// ERROR HANDLING
// ================================================================================================

// Handle unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process, just log the error
});

// Handle uncaught exceptions in tests
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Don't exit the process, just log the error
});

// ================================================================================================
// EXPORTS
// ================================================================================================

module.exports = {
    TEST_UTILS: global.TEST_UTILS
}; 
