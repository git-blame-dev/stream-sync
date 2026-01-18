const { describe, test, expect, beforeEach } = require('bun:test');
const { TEST_TIMEOUTS } = require('../helpers/test-setup');
const { noOpLogger } = require('../helpers/mock-factories');
const { RetrySystem, ADAPTIVE_RETRY_CONFIG } = require('../../src/utils/retry-system');

describe('Core Utility Functions', () => {
    describe('Adaptive Retry System', () => {
        let retrySystem;

        beforeEach(() => {
            retrySystem = new RetrySystem({ logger: noOpLogger });
        });

        test('ADAPTIVE_RETRY_CONFIG should be exported with correct configuration', () => {
            expect(ADAPTIVE_RETRY_CONFIG).toBeDefined();
            expect(typeof ADAPTIVE_RETRY_CONFIG).toBe('object');
            expect(typeof ADAPTIVE_RETRY_CONFIG.BASE_DELAY).toBe('number');
            expect(typeof ADAPTIVE_RETRY_CONFIG.MAX_DELAY).toBe('number');
            expect(typeof ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER).toBe('number');
            
            // Validate configuration values
            expect(ADAPTIVE_RETRY_CONFIG.BASE_DELAY).toBeGreaterThan(0);
            expect(ADAPTIVE_RETRY_CONFIG.MAX_DELAY).toBeGreaterThanOrEqual(ADAPTIVE_RETRY_CONFIG.BASE_DELAY);
            expect(ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER).toBeGreaterThan(1);
        }, { timeout: TEST_TIMEOUTS.UNIT });

        test('calculateAdaptiveRetryDelay should calculate initial delay correctly', () => {
            const delay = retrySystem.calculateAdaptiveRetryDelay('TestPlatform');
            expect(delay).toBe(ADAPTIVE_RETRY_CONFIG.BASE_DELAY);
        }, { timeout: TEST_TIMEOUTS.UNIT });

        test('incrementRetryCount should increase the retry count and return a new delay', () => {
            const firstDelay = retrySystem.incrementRetryCount('TestPlatform');
            expect(retrySystem.getRetryCount('TestPlatform')).toBe(1);
            expect(firstDelay).toBe(ADAPTIVE_RETRY_CONFIG.BASE_DELAY * ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER);

            const secondDelay = retrySystem.incrementRetryCount('TestPlatform');
            expect(retrySystem.getRetryCount('TestPlatform')).toBe(2);
            expect(secondDelay).toBe(ADAPTIVE_RETRY_CONFIG.BASE_DELAY * Math.pow(ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER, 2));
        }, { timeout: TEST_TIMEOUTS.UNIT });

        test('resetRetryCount should reset the count for a specific platform', () => {
            retrySystem.incrementRetryCount('TestPlatform');
            retrySystem.incrementRetryCount('TestPlatform');
            expect(retrySystem.getRetryCount('TestPlatform')).toBe(2);

            retrySystem.resetRetryCount('TestPlatform');
            expect(retrySystem.getRetryCount('TestPlatform')).toBe(0);
        }, { timeout: TEST_TIMEOUTS.UNIT });

        test('calculateAdaptiveRetryDelay should respect the MAX_DELAY', () => {
            const platform = 'TestPlatform';
            let delay = 0;

            for (let i = 0; i < 20; i++) {
                delay = retrySystem.incrementRetryCount(platform);
            }

            const finalCalculatedDelay = retrySystem.calculateAdaptiveRetryDelay(platform);
            expect(finalCalculatedDelay).toBe(ADAPTIVE_RETRY_CONFIG.MAX_DELAY);
            expect(delay).toBe(ADAPTIVE_RETRY_CONFIG.MAX_DELAY);
        }, { timeout: TEST_TIMEOUTS.UNIT });

        test('getRetryCount should return 0 for a platform that has not retried', () => {
            expect(retrySystem.getRetryCount('NewPlatform')).toBe(0);
        }, { timeout: TEST_TIMEOUTS.UNIT });

        test('Retry counts should be independent across platforms', () => {
            retrySystem.incrementRetryCount('PlatformA');
            retrySystem.incrementRetryCount('PlatformA');
            retrySystem.incrementRetryCount('PlatformB');

            expect(retrySystem.getRetryCount('PlatformA')).toBe(2);
            expect(retrySystem.getRetryCount('PlatformB')).toBe(1);

            retrySystem.resetRetryCount('PlatformA');
            expect(retrySystem.getRetryCount('PlatformA')).toBe(0);
            expect(retrySystem.getRetryCount('PlatformB')).toBe(1);
        }, { timeout: TEST_TIMEOUTS.UNIT });
    });
});
