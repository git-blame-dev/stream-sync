
// Capture the native implementations once so the lint rule can keep flagging direct usages elsewhere.
const createCurrentSetTimeout = () => (...args) => globalThis.setTimeout(...args);
const createCurrentSetInterval = () => (...args) => globalThis.setInterval(...args);

let activeSetTimeout = createCurrentSetTimeout();
let activeSetInterval = createCurrentSetInterval();

function validateTimeout(value, fallback = 5000, context = 'timeout') {
    const safeFallback = (typeof fallback === 'number' && !isNaN(fallback) && fallback > 0 && isFinite(fallback))
        ? fallback
        : 5000;

    // Check if value is a valid positive number
    if (typeof value === 'number' && !isNaN(value) && value > 0 && isFinite(value)) {
        return value;
    }
    
    return safeFallback;
}

function validateExponentialBackoff(baseDelay, multiplier = 2, attemptNumber = 0, maxDelay = 300000) {
    const safeBase = validateTimeout(baseDelay, 5000, 'baseDelay');
    const safeMultiplier = validateTimeout(multiplier, 2, 'multiplier');
    const safeAttempt = (typeof attemptNumber === 'number' && !isNaN(attemptNumber) && attemptNumber >= 0) 
        ? attemptNumber 
        : 0;
    const safeMaxDelay = validateTimeout(maxDelay, 300000, 'maxDelay');
    
    const calculation = safeBase * Math.pow(safeMultiplier, safeAttempt);
    const cappedDelay = Math.min(calculation, safeMaxDelay);
    
    // Final safety check
    return validateTimeout(cappedDelay, safeBase, 'calculated delay');
}

function validateInterval(value, fallback = 1000, context = 'interval') {
    return validateTimeout(value, fallback, context);
}

function safeSetTimeout(callback, delay, ...args) {
    const safeDelay = validateTimeout(delay, 5000, 'setTimeout delay');
    return activeSetTimeout(callback, safeDelay, ...args);
}

function safeDelay(delay, fallback = 5000, context = 'delay') {
    const safeDelayValue = validateTimeout(delay, fallback, context);
    return new Promise((resolve) => safeSetTimeout(resolve, safeDelayValue));
}

function safeSetInterval(callback, interval, ...args) {
    const safeInterval = validateInterval(interval, 1000, 'setInterval interval');
    return activeSetInterval(callback, safeInterval, ...args);
}

module.exports = {
    validateTimeout,
    validateExponentialBackoff,
    safeSetTimeout,
    safeSetInterval,
    safeDelay
};
