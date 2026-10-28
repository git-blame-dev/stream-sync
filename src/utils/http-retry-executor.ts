import { resolveLogger } from './logger-resolver';
import { safeDelay, validateExponentialBackoff } from './timeout-validator';
import { sanitizeLogText } from '../core/logger/safe-log-serializer';

const HTTP_RETRY_CONFIG = {
    BASE_DELAY: 2000,
    MAX_DELAY: 60000,
    BACKOFF_MULTIPLIER: 1.3,
    DEFAULT_MAX_ATTEMPTS: 3
} as const;

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_TRANSPORT_CODES = new Set([
    'EAI_AGAIN',
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ETIMEDOUT',
    'ERR_NETWORK'
]);

type HttpHeaders = Record<string, unknown> & {
    get?: (name: string) => unknown;
};

type HttpRetryDependencies = {
    logger?: unknown;
    safeDelay?: typeof safeDelay;
    validateExponentialBackoff?: typeof validateExponentialBackoff;
};

type HttpRetryOptions = {
    signal?: AbortSignal;
    remainingBudgetMs?: () => number;
};

type RetryExecutor = {
    executeWithRetry: <T>(scope: string, executeFunction: () => Promise<T>, maxAttempts?: number, options?: HttpRetryOptions) => Promise<T>;
};

class HttpRetryExecutor implements RetryExecutor {
    private readonly logger: ReturnType<typeof resolveLogger>;
    private readonly safeDelay: typeof safeDelay;
    private readonly validateExponentialBackoff: typeof validateExponentialBackoff;

    constructor(dependencies: HttpRetryDependencies = {}) {
        this.logger = resolveLogger(dependencies.logger, 'HttpRetryExecutor');
        this.safeDelay = dependencies.safeDelay || safeDelay;
        this.validateExponentialBackoff = dependencies.validateExponentialBackoff || validateExponentialBackoff;
    }

    async executeWithRetry<T>(scope: string, executeFunction: () => Promise<T>, maxAttempts?: number, options: HttpRetryOptions = {}): Promise<T> {
        const effectiveMaxAttempts = this.resolveMaxAttempts(maxAttempts);

        for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt += 1) {
            options.signal?.throwIfAborted();
            if (options.remainingBudgetMs && options.remainingBudgetMs() <= 0) {
                throw new Error(`${scope} operation budget exhausted`);
            }
            try {
                const result = await executeFunction();
                options.signal?.throwIfAborted();
                if (options.remainingBudgetMs && options.remainingBudgetMs() <= 0) {
                    throw new Error(`${scope} operation budget exhausted`);
                }
                return result;
            } catch (error) {
                options.signal?.throwIfAborted();
                if (!this.isRetryable(error) || attempt >= effectiveMaxAttempts) {
                    throw error;
                }

                const delay = this.getRateLimitDelay(error, attempt);
                if (options.remainingBudgetMs && delay >= options.remainingBudgetMs()) {
                    throw error;
                }
                if (!Number.isFinite(delay) || delay > 2_147_483_647) {
                    throw new RangeError('HTTP retry delay exceeds the supported timer range', { cause: error });
                }
                this.logger.warn(sanitizeLogText(`HTTP request failed (attempt ${attempt}): ${this.getErrorMessage(error)}`), sanitizeLogText(scope));
                this.logger.info(`Retrying in ${delay / 1000} seconds...`, sanitizeLogText(scope));
                if (delay > 0) {
                    await this.safeDelay(delay, delay, 'HttpRetryExecutor delay', options.signal);
                    options.signal?.throwIfAborted();
                }
            }
        }

        throw new Error(`HTTP retry loop exited unexpectedly for ${scope}`);
    }

    private resolveMaxAttempts(maxAttempts: number | undefined): number {
        if (typeof maxAttempts !== 'number' || !Number.isFinite(maxAttempts) || maxAttempts <= 0) {
            return HTTP_RETRY_CONFIG.DEFAULT_MAX_ATTEMPTS;
        }
        return Math.max(1, Math.floor(maxAttempts));
    }

    private isRetryable(error: unknown): boolean {
        if (!error || typeof error !== 'object') {
            return false;
        }
        const transportError = error as { code?: unknown; name?: unknown };
        if (transportError.name === 'AbortError' || transportError.code === 'ERR_CANCELED' || transportError.code === 'ABORT_ERR') {
            return false;
        }
        const status = this.getHttpStatus(error);
        if (status !== undefined) {
            return RETRYABLE_HTTP_STATUSES.has(status);
        }
        return typeof transportError.code === 'string'
            && RETRYABLE_TRANSPORT_CODES.has(transportError.code.toUpperCase());
    }

    private getHttpStatus(error: unknown): number | undefined {
        if (!error || typeof error !== 'object') {
            return undefined;
        }
        const value = error as { status?: unknown; response?: { status?: unknown } };
        const status = value.response?.status ?? value.status;
        return typeof status === 'number' && status > 0 ? status : undefined;
    }

    private getRateLimitDelay(error: unknown, attempt: number): number {
        const response = (error as { response?: { headers?: unknown } }).response;
        const headers = response?.headers as HttpHeaders | undefined;
        const retryAfter = this.getHeader(headers, 'retry-after');
        const retryAfterDelay = typeof retryAfter === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(retryAfter)
            ? Number(retryAfter) * 1000
            : typeof retryAfter === 'number'
                ? retryAfter * 1000
                : Date.parse(String(retryAfter)) - Date.now();
        if (!Number.isNaN(retryAfterDelay) && retryAfterDelay >= 0) {
            return retryAfterDelay;
        }

        const resetEpoch = Number(this.getHeader(headers, 'ratelimit-reset'));
        const resetDelay = (resetEpoch * 1000) - Date.now();
        if (!Number.isNaN(resetDelay) && resetDelay > 0) {
            return resetDelay;
        }

        return this.getRetryDelay(attempt);
    }

    private getHeader(headers: HttpHeaders | undefined, name: string): unknown {
        if (!headers) {
            return undefined;
        }

        const directKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
        return directKey ? headers[directKey] : headers.get?.(name);
    }

    private getRetryDelay(attempt: number): number {
        return this.validateExponentialBackoff(
            HTTP_RETRY_CONFIG.BASE_DELAY,
            HTTP_RETRY_CONFIG.BACKOFF_MULTIPLIER,
            attempt - 1,
            HTTP_RETRY_CONFIG.MAX_DELAY
        );
    }

    private getErrorMessage(error: unknown): string {
        if (error instanceof Error) return error.message;
        if (typeof error === 'string') return error;
        const status = this.getHttpStatus(error);
        return status === undefined ? 'HTTP request failed' : `HTTP status ${status}`;
    }
}

function createHttpRetryExecutor(dependencies?: HttpRetryDependencies): HttpRetryExecutor {
    return new HttpRetryExecutor(dependencies);
}

export {
    HttpRetryExecutor,
    type RetryExecutor,
    type HttpRetryOptions,
    createHttpRetryExecutor
};
