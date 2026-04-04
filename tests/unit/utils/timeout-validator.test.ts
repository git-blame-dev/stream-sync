
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const {
    validateTimeout,
    validateExponentialBackoff,
    safeSetTimeout,
    safeSetInterval
} = require('../../../src/utils/timeout-validator.ts');

export {};

describe('Timeout Validator', () => {
    let timeoutSpy;
    let intervalSpy;

    beforeEach(() => {
        timeoutSpy = spyOn(globalThis, 'setTimeout');
        intervalSpy = spyOn(globalThis, 'setInterval');
    });

    afterEach(() => {
        restoreAllMocks();
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

        test('should fall back to default when custom fallback is invalid', () => {
            expect(validateTimeout(undefined, NaN)).toBe(5000);
            expect(validateTimeout(undefined, 0)).toBe(5000);
            expect(validateTimeout(undefined, -100)).toBe(5000);
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
            expect(result).toBe(50000);
        });

        test('should handle invalid inputs gracefully', () => {
            expect(validateExponentialBackoff(undefined, 2, 1)).toBeGreaterThan(0);
            expect(validateExponentialBackoff(NaN, 2, 1)).toBeGreaterThan(0);

            expect(validateExponentialBackoff(1000, undefined, 1)).toBeGreaterThan(0);
            expect(validateExponentialBackoff(1000, NaN, 1)).toBeGreaterThan(0);

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

    describe('safeSetTimeout', () => {
        test('should call setTimeout with validated delay', () => {
            const mockCallback = createMockFn();
            
            safeSetTimeout(mockCallback, 2000);
            expect(timeoutSpy).toHaveBeenCalled();
            expect(timeoutSpy.mock.calls[0][1]).toBe(2000);
        });

        test('should fix invalid delays', () => {
            const mockCallback = createMockFn();
            
            safeSetTimeout(mockCallback, NaN);
            expect(timeoutSpy).toHaveBeenCalled();
            expect(isNaN(timeoutSpy.mock.calls[0][1])).toBe(false);
            expect(timeoutSpy.mock.calls[0][1]).toBeGreaterThan(0);
        });

        test('should pass through additional arguments', () => {
            const mockCallback = createMockFn();
            
            safeSetTimeout(mockCallback, 1000, 'arg1', 'arg2');
            expect(timeoutSpy).toHaveBeenCalled();
            expect(timeoutSpy.mock.calls[0].slice(2)).toEqual(['arg1', 'arg2']);
        });
    });

    describe('safeSetInterval', () => {
        test('should call setInterval with validated interval', () => {
            const mockCallback = createMockFn();
            
            safeSetInterval(mockCallback, 1500);
            expect(intervalSpy).toHaveBeenCalled();
            expect(intervalSpy.mock.calls[0][1]).toBe(1500);
        });

        test('should fix invalid intervals', () => {
            const mockCallback = createMockFn();
            
            safeSetInterval(mockCallback, undefined);
            expect(intervalSpy).toHaveBeenCalled();
            expect(isNaN(intervalSpy.mock.calls[0][1])).toBe(false);
            expect(intervalSpy.mock.calls[0][1]).toBeGreaterThan(0);
        });
    });

    describe('Integration with actual components', () => {
        test('should prevent NaN timeouts in stream detector pattern', () => {
            const invalidConfig = undefined;
            const attemptNumber = 1;

            const safeDelay = validateExponentialBackoff(invalidConfig, 2, attemptNumber, 300000);

            expect(isNaN(safeDelay)).toBe(false);
            expect(safeDelay).toBeGreaterThan(0);
            expect(safeDelay).toBeLessThanOrEqual(300000);
        });

        test('should prevent NaN timeouts in retry system pattern', () => {
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
