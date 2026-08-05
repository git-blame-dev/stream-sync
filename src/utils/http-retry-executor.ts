import { resolveLogger } from './logger-resolver';
import { safeDelay, validateExponentialBackoff } from './timeout-validator';

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

type RetryExecutor = {
    executeWithRetry: <T>(scope: string, executeFunction: () => Promise<T>, maxAttempts?: number) => Promise<T>;
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

    async executeWithRetry<T>(scope: string, executeFunction: () => Promise<T>, maxAttempts?: number): Promise<T> {
        const effectiveMaxAttempts = this.resolveMaxAttempts(maxAttempts);

        for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt += 1) {
            try {
                return await executeFunction();
            } catch (error) {
                if (!this.isRetryable(error) || attempt >= effectiveMaxAttempts) {
                    throw error;
                }

                const status = this.getHttpStatus(error);
                const delay = status === 429
                    ? this.getRateLimitDelay(error, attempt)
                    : this.getRetryDelay(attempt);
                this.logger.warn(`HTTP request failed (attempt ${attempt}): ${this.getErrorMessage(error)}`, scope);
                this.logger.info(`Retrying in ${delay / 1000} seconds...`, scope);
                if (delay > 0) {
                    await this.safeDelay(delay, delay, 'HttpRetryExecutor delay');
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
        const status = this.getHttpStatus(error);
        if (status !== undefined) {
            return RETRYABLE_HTTP_STATUSES.has(status);
        }
        if (!error || typeof error !== 'object') {
            return false;
        }

        const transportError = error as { code?: unknown; name?: unknown };
        if (transportError.name === 'AbortError' || transportError.code === 'ERR_CANCELED' || transportError.code === 'ABORT_ERR') {
            return false;
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
        if (Number.isFinite(retryAfterDelay) && retryAfterDelay >= 0) {
            return Math.min(retryAfterDelay, HTTP_RETRY_CONFIG.MAX_DELAY);
        }

        const resetEpoch = Number(this.getHeader(headers, 'ratelimit-reset'));
        const resetDelay = (resetEpoch * 1000) - Date.now();
        if (Number.isFinite(resetDelay) && resetDelay > 0) {
            return Math.min(resetDelay, HTTP_RETRY_CONFIG.MAX_DELAY);
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
        return error instanceof Error ? error.message : String(error);
    }
}

function createHttpRetryExecutor(dependencies?: HttpRetryDependencies): HttpRetryExecutor {
    return new HttpRetryExecutor(dependencies);
}

export {
    HttpRetryExecutor,
    type RetryExecutor,
    createHttpRetryExecutor
};
