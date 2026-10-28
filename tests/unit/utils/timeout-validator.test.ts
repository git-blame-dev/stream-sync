import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createMockFn, restoreAllMocks, spyOn } from '../../helpers/bun-mock-utils';
import {
    safeSetInterval,
    safeDelay,
    safeSetTimeout,
    validateExponentialBackoff,
    validateTimeout
} from '../../../src/utils/timeout-validator';

const spyOnGlobal = spyOn as <T extends object, K extends keyof T>(target: T, method: K) => ReturnType<typeof spyOn>;
const safeSetTimeoutWithArgs = safeSetTimeout as (
    callback: Parameters<typeof safeSetTimeout>[0],
    delay: unknown,
    ...args: unknown[]
) => ReturnType<typeof safeSetTimeout>;

describe('Timeout Validator', () => {
    let timeoutSpy: ReturnType<typeof spyOn>;
    let intervalSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        timeoutSpy = spyOnGlobal(globalThis, 'setTimeout');
        intervalSpy = spyOnGlobal(globalThis, 'setInterval');
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('validateTimeout', () => {
        test('clamps values and fallbacks to the signed timer ceiling', () => {
            expect(validateTimeout(2147483647)).toBe(2147483647);
            expect(validateTimeout(2147483648)).toBe(2147483647);
            expect(validateTimeout(NaN, 2147483648)).toBe(2147483647);
            expect(validateTimeout(Infinity, Infinity)).toBe(5000);
        });
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
        test('normalizes non-finite attempts without losing attempt zero', () => {
            for (const attempt of [Infinity, -Infinity, NaN, 0]) {
                expect(validateExponentialBackoff(1000, 2, attempt)).toBe(1000);
            }
        });
        test('should calculate valid exponential backoff delays', () => {
            expect(validateExponentialBackoff(1000, 2, 0)).toBe(1000);
            expect(validateExponentialBackoff(1000, 2, 1)).toBe(2000);
            expect(validateExponentialBackoff(1000, 2, 2)).toBe(4000);
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
        test('abortable waits clean listeners on cancellation and completion', async () => {
            const cancelled = new AbortController();
            cancelled.abort('test cancellation');
            await expect(safeDelay(10, 5000, 'test', cancelled.signal)).rejects.toBe('test cancellation');
            expect(timeoutSpy).not.toHaveBeenCalled();

            const pending = new AbortController();
            const remove = spyOnGlobal(pending.signal, 'removeEventListener');
            const wait = safeDelay(2147483647, 5000, 'test', pending.signal);
            pending.abort('pending cancellation');
            await expect(wait).rejects.toBe('pending cancellation');
            expect(remove).toHaveBeenCalledTimes(1);

            const completed = new AbortController();
            const completedRemove = spyOnGlobal(completed.signal, 'removeEventListener');
            await safeDelay(1, 5000, 'test', completed.signal);
            expect(completedRemove).toHaveBeenCalledTimes(1);
            completed.abort('after completion');
            expect(completedRemove).toHaveBeenCalledTimes(1);
        });
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
            
            safeSetTimeoutWithArgs(mockCallback, 1000, 'arg1', 'arg2');
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
