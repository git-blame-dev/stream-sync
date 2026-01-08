
const { initializeTestLogging, createTestUser, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { createMockLogger, createMockNotificationBuilder } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { expectValidNotification } = require('../helpers/assertion-helpers');

// Initialize logging FIRST (required for all tests)
initializeTestLogging();

// Setup automated cleanup (no manual mock management)
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const { RetrySystem, ADAPTIVE_RETRY_CONFIG } = require('../../src/utils/retry-system');

describe('Core Utility Functions', () => {
    describe('Adaptive Retry System', () => {
        // Test timeout protection as per rules
        jest.setTimeout(TEST_TIMEOUTS.UNIT);
        let retrySystem;

        // Reset shared state before each test to ensure isolation
        beforeEach(() => {
            retrySystem = new RetrySystem({ logger: createMockLogger('debug') });
        });

        test('ADAPTIVE_RETRY_CONFIG should be exported with correct configuration', () => {
            // Test configuration structure and values
            expect(ADAPTIVE_RETRY_CONFIG).toBeDefined();
            expect(typeof ADAPTIVE_RETRY_CONFIG).toBe('object');
            expect(typeof ADAPTIVE_RETRY_CONFIG.BASE_DELAY).toBe('number');
            expect(typeof ADAPTIVE_RETRY_CONFIG.MAX_DELAY).toBe('number');
            expect(typeof ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER).toBe('number');
            
            // Validate configuration values
            expect(ADAPTIVE_RETRY_CONFIG.BASE_DELAY).toBeGreaterThan(0);
            expect(ADAPTIVE_RETRY_CONFIG.MAX_DELAY).toBeGreaterThanOrEqual(ADAPTIVE_RETRY_CONFIG.BASE_DELAY);
            expect(ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER).toBeGreaterThan(1);
        });

        test('calculateAdaptiveRetryDelay should calculate initial delay correctly', () => {
            // Test initial delay calculation
            const delay = retrySystem.calculateAdaptiveRetryDelay('TestPlatform');
            expect(delay).toBe(ADAPTIVE_RETRY_CONFIG.BASE_DELAY);
        });

        test('incrementRetryCount should increase the retry count and return a new delay', () => {
            // Test first increment
            const firstDelay = retrySystem.incrementRetryCount('TestPlatform');
            expect(retrySystem.getRetryCount('TestPlatform')).toBe(1);
            expect(firstDelay).toBe(ADAPTIVE_RETRY_CONFIG.BASE_DELAY * ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER);

            // Test second increment
            const secondDelay = retrySystem.incrementRetryCount('TestPlatform');
            expect(retrySystem.getRetryCount('TestPlatform')).toBe(2);
            expect(secondDelay).toBe(ADAPTIVE_RETRY_CONFIG.BASE_DELAY * Math.pow(ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER, 2));
        });

        test('resetRetryCount should reset the count for a specific platform', () => {
            // Setup: increment retry count
            retrySystem.incrementRetryCount('TestPlatform');
            retrySystem.incrementRetryCount('TestPlatform');
            expect(retrySystem.getRetryCount('TestPlatform')).toBe(2);

            // Test reset functionality
            retrySystem.resetRetryCount('TestPlatform');
            expect(retrySystem.getRetryCount('TestPlatform')).toBe(0);
        });

        test('calculateAdaptiveRetryDelay should respect the MAX_DELAY', () => {
            const platform = 'TestPlatform';
            let delay = 0;

            // Increment many times to ensure we hit the cap
            for (let i = 0; i < 20; i++) {
                delay = retrySystem.incrementRetryCount(platform);
            }

            // The calculated delay should not exceed MAX_DELAY
            const finalCalculatedDelay = retrySystem.calculateAdaptiveRetryDelay(platform);
            expect(finalCalculatedDelay).toBe(ADAPTIVE_RETRY_CONFIG.MAX_DELAY);
            // The delay returned by the last increment should also be capped
            expect(delay).toBe(ADAPTIVE_RETRY_CONFIG.MAX_DELAY);
        });

        test('getRetryCount should return 0 for a platform that has not retried', () => {
            // Test default state for new platforms
            expect(retrySystem.getRetryCount('NewPlatform')).toBe(0);
        });

        test('Retry counts should be independent across platforms', () => {
            // Test platform isolation
            retrySystem.incrementRetryCount('PlatformA');
            retrySystem.incrementRetryCount('PlatformA');
            retrySystem.incrementRetryCount('PlatformB');

            expect(retrySystem.getRetryCount('PlatformA')).toBe(2);
            expect(retrySystem.getRetryCount('PlatformB')).toBe(1);

            // Test reset isolation
            retrySystem.resetRetryCount('PlatformA');
            expect(retrySystem.getRetryCount('PlatformA')).toBe(0);
            expect(retrySystem.getRetryCount('PlatformB')).toBe(1); // Should not be affected
        });
    });
});
