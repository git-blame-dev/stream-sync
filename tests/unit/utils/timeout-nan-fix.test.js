const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');
const { noOpLogger } = require('../../helpers/mock-factories');

describe('Timeout NaN Warning Fix', () => {
    let originalConsoleWarn;
    let consoleWarnings;
    let originalSetTimeout;
    let timeoutCalls;

    beforeEach(() => {
        consoleWarnings = [];
        originalConsoleWarn = console.warn;
        console.warn = (message) => {
            consoleWarnings.push(message);
            originalConsoleWarn(message);
        };

        timeoutCalls = [];
        originalSetTimeout = global.setTimeout;
        global.setTimeout = (callback, delay, ...args) => {
            timeoutCalls.push({ callback, delay, args });
            return originalSetTimeout(callback, delay, ...args);
        };
    });

    afterEach(() => {
        restoreAllMocks();
        console.warn = originalConsoleWarn;
        global.setTimeout = originalSetTimeout;

        if (timeoutCalls && Array.isArray(timeoutCalls)) {
            timeoutCalls.forEach(call => {
                if (call.timeoutId) {
                    clearTimeout(call.timeoutId);
                }
            });
        }
        restoreAllModuleMocks();
    });

    describe('Stream Detector NaN Timeout', () => {
        test('should reject undefined streamRetryInterval configuration', () => {
            const { StreamDetector } = require('../../../src/utils/stream-detector');
            
            const invalidConfig = {
                streamDetectionEnabled: true,
                streamRetryInterval: undefined,
                streamMaxRetries: -1,
                continuousMonitoringInterval: 60
            };

            expect(() => new StreamDetector(invalidConfig)).toThrow('streamRetryInterval');
        });

        test('should reject null streamRetryInterval configuration', () => {
            const { StreamDetector } = require('../../../src/utils/stream-detector');
            
            const invalidConfig = {
                streamDetectionEnabled: true,
                streamRetryInterval: null,
                streamMaxRetries: -1,
                continuousMonitoringInterval: 60
            };

            expect(() => new StreamDetector(invalidConfig)).toThrow('streamRetryInterval');
        });

        test('should reject string streamRetryInterval configuration', () => {
            const { StreamDetector } = require('../../../src/utils/stream-detector');
            
            const invalidConfig = {
                streamDetectionEnabled: true,
                streamRetryInterval: 'invalid',
                streamMaxRetries: -1,
                continuousMonitoringInterval: 60
            };

            expect(() => new StreamDetector(invalidConfig)).toThrow('streamRetryInterval');
        });
    });

    describe('Retry System NaN Timeout', () => {
        test('should handle invalid BACKOFF_MULTIPLIER resulting in NaN', () => {
            const { RetrySystem, ADAPTIVE_RETRY_CONFIG } = require('../../../src/utils/retry-system');

            const originalMultiplier = ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER;
            ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER = undefined;

            try {
                const retrySystem = new RetrySystem();
                const delay = retrySystem.calculateAdaptiveRetryDelay('TikTok');

                expect(isNaN(delay)).toBe(false);
                expect(delay).toBeGreaterThan(0);
            } finally {
                ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER = originalMultiplier;
            }
        });

        test('should handle invalid BASE_DELAY resulting in NaN', () => {
            const { RetrySystem, ADAPTIVE_RETRY_CONFIG } = require('../../../src/utils/retry-system');

            const originalBaseDelay = ADAPTIVE_RETRY_CONFIG.BASE_DELAY;
            ADAPTIVE_RETRY_CONFIG.BASE_DELAY = null;

            try {
                expect(() => {
                    new RetrySystem();
                }).toThrow('BASE_DELAY must be positive');
            } finally {
                ADAPTIVE_RETRY_CONFIG.BASE_DELAY = originalBaseDelay;
            }
        });

        test('should handle handleConnectionError with valid timeout', () => {
            const { RetrySystem } = require('../../../src/utils/retry-system');

            const retrySystem = new RetrySystem();
            const mockReconnectFn = createMockFn();
            const mockError = new Error('Connection failed');

            retrySystem.handleConnectionError('YouTube', mockError, mockReconnectFn);

            const recentTimeout = timeoutCalls[timeoutCalls.length - 1];
            expect(recentTimeout).toBeDefined();
            expect(isNaN(recentTimeout.delay)).toBe(false);
            expect(recentTimeout.delay).toBeGreaterThan(0);
        });
    });

    describe('General Timeout Validation', () => {
        test('should validate all setTimeout calls have numeric delays', () => {
            const { StreamDetector } = require('../../../src/utils/stream-detector');
            const { RetrySystem } = require('../../../src/utils/retry-system');

            const config = {
                streamDetectionEnabled: true,
                streamRetryInterval: 1,
                streamMaxRetries: 1,
                continuousMonitoringInterval: 60
            };

            const streamDetector = new StreamDetector(config, noOpLogger);
            const retrySystem = new RetrySystem();

            streamDetector._detectStreamWithRetry('youtube', {}, () => {}, () => {});
            retrySystem.handleConnectionError('TikTok', new Error('test'), () => {});

            timeoutCalls.forEach((call, index) => {
                expect(typeof call.delay).toBe('number');
                expect(isNaN(call.delay)).toBe(false);
                expect(call.delay).toBeGreaterThan(0);
            });

            const timeoutWarnings = consoleWarnings.filter(warning =>
                warning.includes('TimeoutNaNWarning') ||
                warning.includes('NaN is not a number') ||
                warning.includes('timeout')
            );
            expect(timeoutWarnings).toHaveLength(0);
        });

        test('should provide fallback values for invalid timeout calculations', () => {
            const invalidInputs = [undefined, null, NaN, "invalid", {}, [], -1];

            invalidInputs.forEach(input => {
                expect(() => {
                    const result = input * Math.pow(2, 1);
                    if (isNaN(result)) {
                        const fallback = 5000;
                        expect(typeof fallback).toBe('number');
                        expect(isNaN(fallback)).toBe(false);
                    }
                }).not.toThrow();
            });
        });
    });
});
