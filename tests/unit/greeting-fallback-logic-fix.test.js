
const { describe, test, expect, beforeEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

mockModule('../../src/core/logging', () => ({
    setConfigValidator: createMockFn(),
    setDebugMode: createMockFn(),
    initializeLoggingConfig: createMockFn(),
    initializeConsoleOverride: createMockFn(),
    logger: {
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn(),
        debug: createMockFn()
    },
    getLogger: createMockFn(() => ({
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn(),
        debug: createMockFn(),
        console: createMockFn()
    }))
}));

const { initializeTestLogging, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { createMockLogger, createMockConfig } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { createTestAppRuntime } = require('../helpers/runtime-test-harness');

// Initialize logging first
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Greeting Fallback Logic Fix', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let runtime;
    let mockConfig;
    let mockLogger;

    beforeEach(() => {
        mockLogger = createMockLogger('debug');
        mockConfig = createMockConfig({
            general: { 
                greetingsEnabled: true, // Global setting enabled
                streamDetectionEnabled: false,
                streamRetryInterval: 15,
                streamMaxRetries: 3,
                continuousMonitoringInterval: 60000
            },
            tiktok: { 
                enabled: true
                // No greetingsEnabled - should inherit from global
            }
        });

        ({ runtime } = createTestAppRuntime(mockConfig, {
            logger: mockLogger
        }));
    });

    describe('when platform has no specific greetingsEnabled setting', () => {
        it('should fall back to global greetingsEnabled setting', () => {
            // Arrange: Get platform settings like in the actual code
            const platform = 'tiktok';
            const settings = runtime.config[platform] || {};
            
            // Act: Check the current logic (this is what's failing)
            const currentLogic = settings.greetingsEnabled; // This is undefined
            
            // Assert: Current logic fails
            expect(currentLogic).toBeUndefined();
            expect(!!currentLogic).toBe(false); // This is why greetings don't work!
            
            // The correct logic should be:
            const correctLogic = settings.greetingsEnabled !== undefined ? 
                settings.greetingsEnabled : runtime.config.general.greetingsEnabled;
            
            expect(correctLogic).toBe(true);
        });

        it('should use platform-specific setting when explicitly defined', () => {
            // Arrange: Set platform-specific setting
            runtime.config.tiktok.greetingsEnabled = false;
            
            const platform = 'tiktok';
            const settings = runtime.config[platform] || {};
            
            // Act: Check with explicit platform setting
            const result = settings.greetingsEnabled !== undefined ? 
                settings.greetingsEnabled : runtime.config.general.greetingsEnabled;
            
            // Assert: Should use platform-specific setting
            expect(result).toBe(false);
        });

        it('should enable greetings when global is true and platform is undefined', () => {
            // Arrange: Simulate the exact condition from main.js line 957
            const platform = 'tiktok';
            const settings = runtime.config[platform] || {};
            const isFirstMessage = true;
            
            // Current broken logic
            const brokenCondition = isFirstMessage && settings.greetingsEnabled;
            expect(brokenCondition).toBe(undefined); // undefined && true = undefined
            
            // Fixed logic
            const greetingsEnabled = settings.greetingsEnabled !== undefined ? 
                settings.greetingsEnabled : runtime.config.general.greetingsEnabled;
            const fixedCondition = isFirstMessage && greetingsEnabled;
            expect(fixedCondition).toBe(true);
        });
    });
});
