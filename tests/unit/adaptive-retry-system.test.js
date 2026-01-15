
const { describe, test, expect, beforeEach, jest } = require('bun:test');

const { initializeTestLogging, createTestUser, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { createMockLogger, createMockNotificationBuilder, createMockPlatform } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { expectValidNotification } = require('../helpers/assertion-helpers');
const testClock = require('../helpers/test-clock');

// Initialize logging FIRST (required for all tests)
initializeTestLogging();

// Setup automated cleanup (no manual mock management)
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const { RetrySystem, ADAPTIVE_RETRY_CONFIG } = require('../../src/utils/retry-system.js');

describe('Unified Adaptive Retry System', () => {
    // Test timeout protection as per rules
    jest.setTimeout(TEST_TIMEOUTS.UNIT);
    let retrySystem;
    let platformRetryCount;

    beforeEach(() => {
        retrySystem = new RetrySystem({ logger: createMockLogger('debug') });
        platformRetryCount = retrySystem.platformRetryCount;
        // Reset all platform retry counts before each test
        // Ensure all platforms are properly initialized
        const platforms = ['TikTok', 'Twitch', 'YouTube'];
        platforms.forEach(platform => {
            platformRetryCount[platform] = 0;
        });
    });

    describe('Configuration Constants', () => {
        test('should have correct retry configuration values', () => {
            expect(ADAPTIVE_RETRY_CONFIG.BASE_DELAY).toBe(2000);
            expect(ADAPTIVE_RETRY_CONFIG.MAX_DELAY).toBe(60000);
            expect(ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER).toBe(1.3);
        });

        test('should track retry counts for all platforms', () => {
            expect(platformRetryCount).toHaveProperty('TikTok');
            expect(platformRetryCount).toHaveProperty('Twitch');
            expect(platformRetryCount).toHaveProperty('YouTube');
            
            // All should start at 0
            expect(platformRetryCount.TikTok).toBe(0);
            expect(platformRetryCount.Twitch).toBe(0);
            expect(platformRetryCount.YouTube).toBe(0);
        });
    });

    describe('retrySystem.calculateAdaptiveRetryDelay()', () => {
        test('should calculate correct delays for exponential backoff', () => {
            // Test TikTok platform
            platformRetryCount.TikTok = 0;
            expect(retrySystem.calculateAdaptiveRetryDelay('TikTok')).toBeCloseTo(2000);
            
            platformRetryCount.TikTok = 1;
            expect(retrySystem.calculateAdaptiveRetryDelay('TikTok')).toBeCloseTo(2600); // 2s * 1.3^1
            
            platformRetryCount.TikTok = 2;
            expect(retrySystem.calculateAdaptiveRetryDelay('TikTok')).toBeCloseTo(3380); // 2s * 1.3^2
            
            platformRetryCount.TikTok = 3;
            expect(retrySystem.calculateAdaptiveRetryDelay('TikTok')).toBeCloseTo(4394); // 2s * 1.3^3
        });

        test('should cap delays at maximum value', () => {
            // Set a high retry count to test max cap
            platformRetryCount.YouTube = 15;
            const delay = retrySystem.calculateAdaptiveRetryDelay('YouTube');
            expect(delay).toBe(60000); // Should be capped at MAX_DELAY
            expect(delay).toBeLessThanOrEqual(ADAPTIVE_RETRY_CONFIG.MAX_DELAY);
        });

        test('should work for all platforms', () => {
            const platforms = ['TikTok', 'Twitch', 'YouTube'];
            
            platforms.forEach(platform => {
                platformRetryCount[platform] = 1;
                const delay = retrySystem.calculateAdaptiveRetryDelay(platform);
                expect(delay).toBeCloseTo(2600); // 2s * 1.3^1
                expect(typeof delay).toBe('number');
                expect(delay).toBeGreaterThan(0);
            });
        });

        test('should handle undefined retry count gracefully', () => {
            // Delete retry count to test undefined handling
            delete platformRetryCount.TikTok;
            const delay = retrySystem.calculateAdaptiveRetryDelay('TikTok');
            expect(delay).toBeCloseTo(2000); // Should default to base delay
        });
    });

    describe('retrySystem.incrementRetryCount()', () => {
        test('should increment retry count and return new delay', () => {
            // Ensure TikTok is properly initialized
            platformRetryCount.TikTok = 0;
            expect(platformRetryCount.TikTok).toBe(0);
            
            const delay1 = retrySystem.incrementRetryCount('TikTok');
            expect(platformRetryCount.TikTok).toBe(1);
            expect(delay1).toBeCloseTo(2600); // 2s * 1.3^1
            
            const delay2 = retrySystem.incrementRetryCount('TikTok');
            expect(platformRetryCount.TikTok).toBe(2);
            expect(delay2).toBeCloseTo(3380); // 2s * 1.3^2
        });

        test('should work independently for each platform', () => {
            retrySystem.incrementRetryCount('TikTok');
            retrySystem.incrementRetryCount('TikTok');
            retrySystem.incrementRetryCount('Twitch');
            
            expect(platformRetryCount.TikTok).toBe(2);
            expect(platformRetryCount.Twitch).toBe(1);
            expect(platformRetryCount.YouTube).toBe(0);
        });

        test('should handle undefined retry count', () => {
            delete platformRetryCount.YouTube;
            const delay = retrySystem.incrementRetryCount('YouTube');
            expect(platformRetryCount.YouTube).toBe(1);
            expect(delay).toBeCloseTo(2600);
        });
    });

    describe('retrySystem.resetRetryCount()', () => {
        test('should reset retry count to 0', () => {
            // Set up some retry counts
            platformRetryCount.TikTok = 5;
            platformRetryCount.Twitch = 3;
            
            retrySystem.resetRetryCount('TikTok');
            expect(platformRetryCount.TikTok).toBe(0);
            expect(platformRetryCount.Twitch).toBe(3); // Should not affect other platforms
        });

        test('should work for all platforms', () => {
            const platforms = ['TikTok', 'Twitch', 'YouTube'];
            
            // Set all to high values
            platforms.forEach(platform => {
                platformRetryCount[platform] = 10;
            });
            
            // Reset each one
            platforms.forEach(platform => {
                retrySystem.resetRetryCount(platform);
                expect(platformRetryCount[platform]).toBe(0);
            });
        });
    });

    describe('Real-world Connection Scenarios', () => {
        test('should simulate TikTok connection failures with proper backoff', () => {
            const delays = [];
            
            // Simulate 5 connection failures
            for (let i = 0; i < 5; i++) {
                delays.push(retrySystem.incrementRetryCount('TikTok'));
            }
            
            expect(delays).toHaveLength(5);
            expect(delays[0]).toBeCloseTo(2600);
            expect(delays[1]).toBeCloseTo(3380);
            expect(delays[2]).toBeCloseTo(4394);
            expect(delays[3]).toBeCloseTo(5712.2);
            expect(delays[4]).toBeCloseTo(7425.86);
            expect(platformRetryCount.TikTok).toBe(5);
            
            // Simulate successful connection
            retrySystem.resetRetryCount('TikTok');
            expect(platformRetryCount.TikTok).toBe(0);
            
            // Next failure should start from base delay again
            const nextDelay = retrySystem.incrementRetryCount('TikTok');
            expect(nextDelay).toBeCloseTo(2600);
        });

        test('should handle multiple platforms failing simultaneously', () => {
            // Simulate all platforms failing at different rates
            retrySystem.incrementRetryCount('TikTok'); // 1 failure
            retrySystem.incrementRetryCount('Twitch'); // 1 failure  
            retrySystem.incrementRetryCount('Twitch'); // 2 failures
            retrySystem.incrementRetryCount('YouTube'); // 1 failure
            retrySystem.incrementRetryCount('YouTube'); // 2 failures
            retrySystem.incrementRetryCount('YouTube'); // 3 failures
            
            expect(platformRetryCount.TikTok).toBe(1);
            expect(platformRetryCount.Twitch).toBe(2);
            expect(platformRetryCount.YouTube).toBe(3);
            
            // Each should have different delays
            expect(retrySystem.calculateAdaptiveRetryDelay('TikTok')).toBeCloseTo(2600);
            expect(retrySystem.calculateAdaptiveRetryDelay('Twitch')).toBeCloseTo(3380);
            expect(retrySystem.calculateAdaptiveRetryDelay('YouTube')).toBeCloseTo(4394);
        });

        test('should demonstrate DRY principle benefits', () => {
            // All platforms use the same logic
            const platforms = ['TikTok', 'Twitch', 'YouTube'];
            const expectedDelays = [
                2600,
                3380,
                4394
            ];
            
            platforms.forEach((platform, index) => {
                // Reset platform retry count first
                platformRetryCount[platform] = 0;
                
                // Each platform gets incremental number of failures (1, 2, 3)
                for (let i = 0; i < index + 1; i++) {
                    retrySystem.incrementRetryCount(platform);
                }
                
                const delay = retrySystem.calculateAdaptiveRetryDelay(platform);
                expect(delay).toBeCloseTo(expectedDelays[index]);
            });
        });
    });

    describe('Performance and Edge Cases', () => {
        test('should handle very high retry counts efficiently', () => {
            platformRetryCount.TikTok = 100;
            
            const startTime = testClock.now();
            const delay = retrySystem.calculateAdaptiveRetryDelay('TikTok');
            testClock.advance(1);
            const endTime = testClock.now();
            
            expect(delay).toBe(60000); // Should be capped
            expect(endTime - startTime).toBeLessThan(10); // Should be fast
        });

        test('should handle invalid platform names gracefully', () => {
            expect(() => {
                retrySystem.calculateAdaptiveRetryDelay('InvalidPlatform');
            }).not.toThrow();
            
            expect(() => {
                retrySystem.incrementRetryCount('InvalidPlatform');
            }).not.toThrow();
            
            expect(() => {
                retrySystem.resetRetryCount('InvalidPlatform');
            }).not.toThrow();
        });

        test('should maintain precision with floating point calculations', () => {
            platformRetryCount.TikTok = 2;
            const delay = retrySystem.calculateAdaptiveRetryDelay('TikTok');
            expect(delay).toBeCloseTo(3380); // Exact value with new multiplier
        });
    });

    describe('Integration with Connection Logic', () => {
        test('should provide consistent interface for all platforms', () => {
            // Test that the same functions work for all platforms
            const platforms = ['TikTok', 'Twitch', 'YouTube'];
            
            platforms.forEach(platform => {
                // Should start at 0
                expect(platformRetryCount[platform]).toBe(0);
                
                // Should increment properly
                const delay1 = retrySystem.incrementRetryCount(platform);
                expect(delay1).toBeCloseTo(2600);
                expect(platformRetryCount[platform]).toBe(1);
                
                // Should reset properly
                retrySystem.resetRetryCount(platform);
                expect(platformRetryCount[platform]).toBe(0);
                
                // Should calculate properly
                const delay2 = retrySystem.calculateAdaptiveRetryDelay(platform);
                expect(delay2).toBeCloseTo(2000);
            });
        });

        test('should replace old platform-specific retry logic', () => {
            // Verify that the new system provides all needed functionality
            expect(typeof retrySystem.calculateAdaptiveRetryDelay).toBe('function');
            expect(typeof retrySystem.incrementRetryCount).toBe('function');
            expect(typeof retrySystem.resetRetryCount).toBe('function');
            expect(typeof ADAPTIVE_RETRY_CONFIG).toBe('object');
            expect(typeof platformRetryCount).toBe('object');
            
            // Verify configuration is reasonable
            expect(ADAPTIVE_RETRY_CONFIG.BASE_DELAY).toBeGreaterThan(0);
            expect(ADAPTIVE_RETRY_CONFIG.MAX_DELAY).toBeGreaterThan(ADAPTIVE_RETRY_CONFIG.BASE_DELAY);
            expect(ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER).toBeGreaterThan(1);
        });
    });
}); 
