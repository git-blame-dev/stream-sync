const { describe, test, expect, beforeEach } = require('bun:test');
const { noOpLogger } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const testClock = require('../helpers/test-clock');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const { RetrySystem, ADAPTIVE_RETRY_CONFIG } = require('../../src/utils/retry-system.js');

describe('Unified Adaptive Retry System', () => {
    let retrySystem;
    let platformRetryCount;

    beforeEach(() => {
        retrySystem = new RetrySystem({ logger: noOpLogger });
        platformRetryCount = retrySystem.platformRetryCount;
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

            expect(platformRetryCount.TikTok).toBe(0);
            expect(platformRetryCount.Twitch).toBe(0);
            expect(platformRetryCount.YouTube).toBe(0);
        });
    });

    describe('retrySystem.calculateAdaptiveRetryDelay()', () => {
        test('should calculate correct delays for exponential backoff', () => {
            platformRetryCount.TikTok = 0;
            expect(retrySystem.calculateAdaptiveRetryDelay('TikTok')).toBeCloseTo(2000);

            platformRetryCount.TikTok = 1;
            expect(retrySystem.calculateAdaptiveRetryDelay('TikTok')).toBeCloseTo(2600);

            platformRetryCount.TikTok = 2;
            expect(retrySystem.calculateAdaptiveRetryDelay('TikTok')).toBeCloseTo(3380);

            platformRetryCount.TikTok = 3;
            expect(retrySystem.calculateAdaptiveRetryDelay('TikTok')).toBeCloseTo(4394);
        });

        test('should cap delays at maximum value', () => {
            platformRetryCount.YouTube = 15;
            const delay = retrySystem.calculateAdaptiveRetryDelay('YouTube');
            expect(delay).toBe(60000);
            expect(delay).toBeLessThanOrEqual(ADAPTIVE_RETRY_CONFIG.MAX_DELAY);
        });

        test('should work for all platforms', () => {
            const platforms = ['TikTok', 'Twitch', 'YouTube'];

            platforms.forEach(platform => {
                platformRetryCount[platform] = 1;
                const delay = retrySystem.calculateAdaptiveRetryDelay(platform);
                expect(delay).toBeCloseTo(2600);
                expect(typeof delay).toBe('number');
                expect(delay).toBeGreaterThan(0);
            });
        });

        test('should handle undefined retry count gracefully', () => {
            delete platformRetryCount.TikTok;
            const delay = retrySystem.calculateAdaptiveRetryDelay('TikTok');
            expect(delay).toBeCloseTo(2000);
        });
    });

    describe('retrySystem.incrementRetryCount()', () => {
        test('should increment retry count and return new delay', () => {
            platformRetryCount.TikTok = 0;
            expect(platformRetryCount.TikTok).toBe(0);

            const delay1 = retrySystem.incrementRetryCount('TikTok');
            expect(platformRetryCount.TikTok).toBe(1);
            expect(delay1).toBeCloseTo(2600);

            const delay2 = retrySystem.incrementRetryCount('TikTok');
            expect(platformRetryCount.TikTok).toBe(2);
            expect(delay2).toBeCloseTo(3380);
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
            platformRetryCount.TikTok = 5;
            platformRetryCount.Twitch = 3;

            retrySystem.resetRetryCount('TikTok');
            expect(platformRetryCount.TikTok).toBe(0);
            expect(platformRetryCount.Twitch).toBe(3);
        });

        test('should work for all platforms', () => {
            const platforms = ['TikTok', 'Twitch', 'YouTube'];

            platforms.forEach(platform => {
                platformRetryCount[platform] = 10;
            });

            platforms.forEach(platform => {
                retrySystem.resetRetryCount(platform);
                expect(platformRetryCount[platform]).toBe(0);
            });
        });
    });

    describe('Real-world Connection Scenarios', () => {
        test('should simulate TikTok connection failures with proper backoff', () => {
            const delays = [];

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

            retrySystem.resetRetryCount('TikTok');
            expect(platformRetryCount.TikTok).toBe(0);

            const nextDelay = retrySystem.incrementRetryCount('TikTok');
            expect(nextDelay).toBeCloseTo(2600);
        });

        test('should handle multiple platforms failing simultaneously', () => {
            retrySystem.incrementRetryCount('TikTok');
            retrySystem.incrementRetryCount('Twitch');
            retrySystem.incrementRetryCount('Twitch');
            retrySystem.incrementRetryCount('YouTube');
            retrySystem.incrementRetryCount('YouTube');
            retrySystem.incrementRetryCount('YouTube');

            expect(platformRetryCount.TikTok).toBe(1);
            expect(platformRetryCount.Twitch).toBe(2);
            expect(platformRetryCount.YouTube).toBe(3);

            expect(retrySystem.calculateAdaptiveRetryDelay('TikTok')).toBeCloseTo(2600);
            expect(retrySystem.calculateAdaptiveRetryDelay('Twitch')).toBeCloseTo(3380);
            expect(retrySystem.calculateAdaptiveRetryDelay('YouTube')).toBeCloseTo(4394);
        });

        test('should demonstrate DRY principle benefits', () => {
            const platforms = ['TikTok', 'Twitch', 'YouTube'];
            const expectedDelays = [2600, 3380, 4394];

            platforms.forEach((platform, index) => {
                platformRetryCount[platform] = 0;

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

            expect(delay).toBe(60000);
            expect(endTime - startTime).toBeLessThan(10);
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
            expect(delay).toBeCloseTo(3380);
        });
    });

    describe('Integration with Connection Logic', () => {
        test('should provide consistent interface for all platforms', () => {
            const platforms = ['TikTok', 'Twitch', 'YouTube'];

            platforms.forEach(platform => {
                expect(platformRetryCount[platform]).toBe(0);

                const delay1 = retrySystem.incrementRetryCount(platform);
                expect(delay1).toBeCloseTo(2600);
                expect(platformRetryCount[platform]).toBe(1);

                retrySystem.resetRetryCount(platform);
                expect(platformRetryCount[platform]).toBe(0);

                const delay2 = retrySystem.calculateAdaptiveRetryDelay(platform);
                expect(delay2).toBeCloseTo(2000);
            });
        });

        test('should replace old platform-specific retry logic', () => {
            expect(typeof retrySystem.calculateAdaptiveRetryDelay).toBe('function');
            expect(typeof retrySystem.incrementRetryCount).toBe('function');
            expect(typeof retrySystem.resetRetryCount).toBe('function');
            expect(typeof ADAPTIVE_RETRY_CONFIG).toBe('object');
            expect(typeof platformRetryCount).toBe('object');

            expect(ADAPTIVE_RETRY_CONFIG.BASE_DELAY).toBeGreaterThan(0);
            expect(ADAPTIVE_RETRY_CONFIG.MAX_DELAY).toBeGreaterThan(ADAPTIVE_RETRY_CONFIG.BASE_DELAY);
            expect(ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER).toBeGreaterThan(1);
        });
    });
}); 
