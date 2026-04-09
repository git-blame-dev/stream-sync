import { safeSetTimeout, validateTimeout } from './timeout-validator';
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);

type TimeoutOptions = {
    operationName?: string;
    errorMessage?: string;
};

function normalizeTimeoutOptions(operationNameOrOptions: string | TimeoutOptions = 'operation'): TimeoutOptions {
    if (typeof operationNameOrOptions === 'string') {
        return { operationName: operationNameOrOptions };
    }
    return operationNameOrOptions || { operationName: 'operation' };
}

function createTimeoutController(timeoutMs: unknown = 5000, options: TimeoutOptions = {}) {
    const safeTimeout = validateTimeout(timeoutMs, 5000, 'promise timeout');
    const { operationName = 'operation', errorMessage } = options;
    const finalMessage = typeof errorMessage === 'string' && errorMessage.trim().length > 0
        ? errorMessage
        : `${operationName} timeout after ${safeTimeout}ms`;

    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    let cleared = false;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = safeSetTimeout(() => {
            cleared = true;
            reject(new Error(finalMessage));
        }, safeTimeout);
    });

    const cancel = () => {
        if (!cleared && timeoutId !== null) {
            nativeClearTimeout(timeoutId);
            timeoutId = null;
            cleared = true;
        }
    };

    const wrap = async <T>(pendingPromise: Promise<T>): Promise<T> => {
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: unknown = 5000, operationNameOrOptions: string | TimeoutOptions = 'operation'): Promise<T> {
    const options = normalizeTimeoutOptions(operationNameOrOptions);
    const controller = createTimeoutController(timeoutMs, options);
    return controller.wrap(promise);
}

export {
    withTimeout
};
