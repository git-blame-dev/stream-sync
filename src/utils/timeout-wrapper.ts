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

export type OperationDeadlineContext = {
    signal: AbortSignal;
    remainingBudgetMs: () => number;
};

export type OperationDeadlineOptions = {
    budgetMs?: number | undefined;
    parentAbortSignal?: AbortSignal | undefined;
    operationName?: string;
};

/** The callback must include all owned work, including response body consumption. */
async function withOperationDeadline<T>(
    operation: (context: OperationDeadlineContext) => Promise<T>,
    { budgetMs, parentAbortSignal, operationName = 'operation' }: OperationDeadlineOptions = {}
): Promise<T> {
    parentAbortSignal?.throwIfAborted();
    if (budgetMs !== undefined && (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 2_147_483_647)) {
        throw new RangeError('Operation budget must be positive and within the supported timer range');
    }

    const controller = new AbortController();
    const expiresAt = budgetMs === undefined ? Infinity : performance.now() + budgetMs;
    const remainingBudgetMs = () => Math.max(0, expiresAt - performance.now());
    const expire = () => controller.abort(new Error(`${operationName} deadline exceeded after ${budgetMs}ms`));
    const throwIfCancelled = () => {
        if (remainingBudgetMs() <= 0) expire();
        controller.signal.throwIfAborted();
    };
    const onParentAbort = () => controller.abort(parentAbortSignal?.reason);
    let onAbort: () => void = () => {};
    let timer: ReturnType<typeof safeSetTimeout> | undefined;
    const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    parentAbortSignal?.addEventListener('abort', onParentAbort, { once: true });

    try {
        if (budgetMs !== undefined) {
            timer = safeSetTimeout(expire, budgetMs);
        }
        const pending = Promise.resolve().then(() => {
            throwIfCancelled();
            return operation({ signal: controller.signal, remainingBudgetMs });
        });
        const result = await Promise.race([pending, cancelled]);
        throwIfCancelled();
        return result;
    } finally {
        if (timer !== undefined) globalThis.clearTimeout(timer);
        parentAbortSignal?.removeEventListener('abort', onParentAbort);
        controller.signal.removeEventListener('abort', onAbort);
    }
}

export {
    withTimeout,
    withOperationDeadline
};
