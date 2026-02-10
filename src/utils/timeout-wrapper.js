const { safeSetTimeout, validateTimeout } = require('./timeout-validator');
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);

function normalizeTimeoutOptions(operationNameOrOptions = 'operation') {
    if (typeof operationNameOrOptions === 'string') {
        return { operationName: operationNameOrOptions };
    }
    return operationNameOrOptions || { operationName: 'operation' };
}

function createTimeoutController(timeoutMs = 5000, options = {}) {
    const safeTimeout = validateTimeout(timeoutMs, 5000, 'promise timeout');
    const { operationName = 'operation', errorMessage } = options;
    const finalMessage = typeof errorMessage === 'string' && errorMessage.trim().length > 0
        ? errorMessage
        : `${operationName} timeout after ${safeTimeout}ms`;

    let timeoutId = null;
    let cleared = false;

    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = safeSetTimeout(() => {
            cleared = true;
            reject(new Error(finalMessage));
        }, safeTimeout);
    });

    const cancel = () => {
        if (!cleared && timeoutId) {
            nativeClearTimeout(timeoutId);
            timeoutId = null;
            cleared = true;
        }
    };

    const wrap = async (pendingPromise) => {
        try {
            return await Promise.race([pendingPromise, timeoutPromise]);
        } finally {
            cancel();
        }
    };

    return {
        wrap,
        cancel,
        timeoutPromise,
        timeoutMs: safeTimeout,
        getErrorMessage: () => finalMessage
    };
}

function withTimeout(promise, timeoutMs = 5000, operationNameOrOptions = 'operation') {
    const options = normalizeTimeoutOptions(operationNameOrOptions);
    const controller = createTimeoutController(timeoutMs, options);
    return controller.wrap(promise);
}

module.exports = {
    withTimeout
};
