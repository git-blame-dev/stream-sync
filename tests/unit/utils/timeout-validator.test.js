
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const {
    validateTimeout,
    validateExponentialBackoff,
    validateInterval,
    safeSetTimeout,
    safeSetInterval,
    __setTimerImplementations,
    __resetTimerImplementations
} = require('../../../src/utils/timeout-validator');

describe('Timeout Validator', () => {
    let originalSetTimeout;
    let originalSetInterval;
    let timeoutCalls;
    let intervalCalls;

    beforeEach(() => {
        timeoutCalls = [];
        intervalCalls = [];
        originalSetTimeout = global.setTimeout;
        originalSetInterval = global.setInterval;

        __setTimerImplementations({
            setTimeoutImpl: (callback, delay, ...args) => {
                timeoutCalls.push({ callback, delay, args });
                return originalSetTimeout(callback, delay, ...args);
            },
            setIntervalImpl: (callback, delay, ...args) => {
                intervalCalls.push({ callback, delay, args });
                return originalSetInterval(callback, delay, ...args);
            }
        });
    });

    afterEach(() => {
        restoreAllMocks();
        __resetTimerImplementations();
    });

    describe('validateTimeout', () => {
        test('should return valid positive numbers unchanged', () => {
            expect(validateTimeout(1000)).toBe(1000);
            expect(validateTimeout(5000)).toBe(5000);
            expect(validateTimeout(0.5)).toBe(0.5);
        });

        test('should reject invalid values and return fallback', () => {
            expect(validateTimeout(undefined)).toBe(5000);
            expect(validateTimeout(null)).toBe(5000);
            expect(validateTimeout(NaN)).toBe(5000);
            expect(validateTimeout(-100)).toBe(5000);
            expect(validateTimeout(0)).toBe(5000);
            expect(validateTimeout("invalid")).toBe(5000);
            expect(validateTimeout({})).toBe(5000);
            expect(validateTimeout([])).toBe(5000);
            expect(validateTimeout(Infinity)).toBe(5000);
        });

        test('should use custom fallback values', () => {
            expect(validateTimeout(undefined, 10000)).toBe(10000);
            expect(validateTimeout(NaN, 1500)).toBe(1500);
        });
    });

    describe('validateExponentialBackoff', () => {
        test('should calculate valid exponential backoff delays', () => {
            expect(validateExponentialBackoff(1000, 2, 0)).toBe(1000); // 1000 * 2^0 = 1000
            expect(validateExponentialBackoff(1000, 2, 1)).toBe(2000); // 1000 * 2^1 = 2000
            expect(validateExponentialBackoff(1000, 2, 2)).toBe(4000); // 1000 * 2^2 = 4000
        });

        test('should cap delays at maxDelay', () => {
            const result = validateExponentialBackoff(10000, 2, 10, 50000);
            expect(result).toBe(50000); // Should be capped at 50000
        });

        test('should handle invalid inputs gracefully', () => {
            // Invalid base delay
            expect(validateExponentialBackoff(undefined, 2, 1)).toBeGreaterThan(0);
            expect(validateExponentialBackoff(NaN, 2, 1)).toBeGreaterThan(0);
            
            // Invalid multiplier
            expect(validateExponentialBackoff(1000, undefined, 1)).toBeGreaterThan(0);
            expect(validateExponentialBackoff(1000, NaN, 1)).toBeGreaterThan(0);
            
            // Invalid attempt number
            expect(validateExponentialBackoff(1000, 2, undefined)).toBe(1000);
            expect(validateExponentialBackoff(1000, 2, NaN)).toBe(1000);
            expect(validateExponentialBackoff(1000, 2, -1)).toBe(1000);
        });

        test('should never return NaN', () => {
            const testCases = [
                { base: undefined, mult: undefined, attempt: undefined },
                { base: null, mult: null, attempt: null },
                { base: NaN, mult: NaN, attempt: NaN },
                { base: "invalid", mult: "invalid", attempt: "invalid" },
                { base: {}, mult: [], attempt: Infinity }
            ];

            testCases.forEach(testCase => {
                const result = validateExponentialBackoff(
                    testCase.base, 
                    testCase.mult, 
                    testCase.attempt
                );
                expect(isNaN(result)).toBe(false);
                expect(result).toBeGreaterThan(0);
            });
        });
    });

    describe('validateInterval', () => {
        test('should validate interval values with different default', () => {
            expect(validateInterval(2000)).toBe(2000);
            expect(validateInterval(undefined)).toBe(1000); // Default for intervals
            expect(validateInterval(NaN)).toBe(1000);
        });

        test('should use custom fallback for intervals', () => {
            expect(validateInterval(undefined, 3000)).toBe(3000);
        });
    });

    describe('safeSetTimeout', () => {
        test('should call setTimeout with validated delay', () => {
            const mockCallback = createMockFn();
            
            safeSetTimeout(mockCallback, 2000);
            expect(timeoutCalls).toHaveLength(1);
            expect(timeoutCalls[0].delay).toBe(2000);
        });

        test('should fix invalid delays', () => {
            const mockCallback = createMockFn();
            
            safeSetTimeout(mockCallback, NaN);
            expect(timeoutCalls).toHaveLength(1);
            expect(isNaN(timeoutCalls[0].delay)).toBe(false);
            expect(timeoutCalls[0].delay).toBeGreaterThan(0);
        });

        test('should pass through additional arguments', () => {
            const mockCallback = createMockFn();
            
            safeSetTimeout(mockCallback, 1000, 'arg1', 'arg2');
            expect(timeoutCalls).toHaveLength(1);
            expect(timeoutCalls[0].args).toEqual(['arg1', 'arg2']);
        });
    });

    describe('safeSetInterval', () => {
        test('should call setInterval with validated interval', () => {
            const mockCallback = createMockFn();
            
            safeSetInterval(mockCallback, 1500);
            expect(intervalCalls).toHaveLength(1);
            expect(intervalCalls[0].delay).toBe(1500);
        });

        test('should fix invalid intervals', () => {
            const mockCallback = createMockFn();
            
            safeSetInterval(mockCallback, undefined);
            expect(intervalCalls).toHaveLength(1);
            expect(isNaN(intervalCalls[0].delay)).toBe(false);
            expect(intervalCalls[0].delay).toBeGreaterThan(0);
        });
    });

    describe('Integration with actual components', () => {
        test('should prevent NaN timeouts in stream detector pattern', () => {
            // Simulate the problematic calculation from stream-detector
            const invalidConfig = undefined;
            const attemptNumber = 1;
            
            const safeDelay = validateExponentialBackoff(invalidConfig, 2, attemptNumber, 300000);
            
            expect(isNaN(safeDelay)).toBe(false);
            expect(safeDelay).toBeGreaterThan(0);
            expect(safeDelay).toBeLessThanOrEqual(300000);
        });

        test('should prevent NaN timeouts in retry system pattern', () => {
            // Simulate retry system calculation with corrupted config
            const corruptedConfig = {
                BASE_DELAY: NaN,
                BACKOFF_MULTIPLIER: undefined,
                MAX_DELAY: "invalid"
            };
            
            const safeDelay = validateExponentialBackoff(
                corruptedConfig.BASE_DELAY,
                corruptedConfig.BACKOFF_MULTIPLIER,
                2,
                corruptedConfig.MAX_DELAY
            );
            
            expect(isNaN(safeDelay)).toBe(false);
            expect(safeDelay).toBeGreaterThan(0);
        });
    });
});
