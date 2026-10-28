type SetTimeoutArguments = Parameters<typeof globalThis.setTimeout>;
type SetTimeoutReturn = ReturnType<typeof globalThis.setTimeout>;
type SetIntervalArguments = Parameters<typeof globalThis.setInterval>;
type SetIntervalReturn = ReturnType<typeof globalThis.setInterval>;
type SetTimeoutAdditionalArguments = SetTimeoutArguments extends [unknown, unknown, ...infer Rest] ? Rest : never[];
type SetIntervalAdditionalArguments = SetIntervalArguments extends [unknown, unknown, ...infer Rest] ? Rest : never[];

// Capture the native implementations once so the lint rule can keep flagging direct usages elsewhere.
const createCurrentSetTimeout = () => (...args: SetTimeoutArguments): SetTimeoutReturn => globalThis.setTimeout(...args);
const createCurrentSetInterval = () => (...args: SetIntervalArguments): SetIntervalReturn => globalThis.setInterval(...args);

let activeSetTimeout = createCurrentSetTimeout();
let activeSetInterval = createCurrentSetInterval();

const MAX_TIMER_DELAY_MS = 2147483647;

function validateTimeout(value: unknown, fallback = 5000, _context = 'timeout'): number {
    const safeFallback = (typeof fallback === 'number' && !isNaN(fallback) && fallback > 0 && isFinite(fallback))
        ? Math.min(fallback, MAX_TIMER_DELAY_MS)
        : 5000;

    if (typeof value === 'number' && !isNaN(value) && value > 0 && isFinite(value)) {
        return Math.min(value, MAX_TIMER_DELAY_MS);
    }
    
    return safeFallback;
}

function validateExponentialBackoff(baseDelay: unknown, multiplier: unknown = 2, attemptNumber: unknown = 0, maxDelay: unknown = 300000): number {
    const safeBase = validateTimeout(baseDelay, 5000, 'baseDelay');
    const safeMultiplier = validateTimeout(multiplier, 2, 'multiplier');
    const safeAttempt = (typeof attemptNumber === 'number' && Number.isFinite(attemptNumber) && attemptNumber >= 0)
        ? attemptNumber 
        : 0;
    const safeMaxDelay = validateTimeout(maxDelay, 300000, 'maxDelay');
    
    const calculation = safeBase * Math.pow(safeMultiplier, safeAttempt);
    const cappedDelay = Math.min(calculation, safeMaxDelay);
    
    return validateTimeout(cappedDelay, safeBase, 'calculated delay');
}

function validateInterval(value: unknown, fallback = 1000, context = 'interval'): number {
    return validateTimeout(value, fallback, context);
}

function safeSetTimeout(callback: SetTimeoutArguments[0], delay: unknown, ...args: SetTimeoutAdditionalArguments): SetTimeoutReturn {
    const safeDelay = validateTimeout(delay, 5000, 'setTimeout delay');
    return activeSetTimeout(callback, safeDelay, ...args);
}

function safeDelay(delay: unknown, fallback = 5000, context = 'delay', signal?: AbortSignal): Promise<void> {
    const safeDelayValue = validateTimeout(delay, fallback, context);
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        const onAbort = () => {
            globalThis.clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            reject(signal?.reason);
        };
        const timer = safeSetTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, safeDelayValue);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function safeSetInterval(callback: SetIntervalArguments[0], interval: unknown, ...args: SetIntervalAdditionalArguments): SetIntervalReturn {
    const safeInterval = validateInterval(interval, 1000, 'setInterval interval');
    return activeSetInterval(callback, safeInterval, ...args);
}

export {
    validateTimeout,
    validateInterval,
    validateExponentialBackoff,
    safeSetTimeout,
    safeSetInterval,
    safeDelay
};
