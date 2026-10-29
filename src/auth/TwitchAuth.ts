import * as axiosModule from 'axios';
import type { AxiosRequestConfig } from 'axios';
import { TWITCH } from '../core/endpoints';
import { secrets } from '../core/secrets';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { resolveLogger } from '../utils/logger-resolver';
import { loadTokens, saveTokens } from '../utils/token-store';
import { TOKEN_REFRESH_CONFIG, AuthConstants } from '../utils/auth-constants';
import { createHttpRetryExecutor, type RetryExecutor } from '../utils/http-retry-executor';
import { runOAuthFlow } from './oauth-flow';
import { TWITCH_OAUTH_SCOPES } from './twitch-oauth-scopes';
import { safeDelay, safeSetTimeout } from '../utils/timeout-validator';
import { withOperationDeadline } from '../utils/timeout-wrapper';

type AuthRecord = Record<string, unknown>;

type OAuthTokenPayload = {
    accessToken: string;
    refreshToken?: string | null;
    expiresIn?: number | null;
    expiresAt?: number | null;
};

type RefreshTokenPayload = {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number | null;
};

type TokenValidationSuccess = {
    clientId: string;
    userId: string;
    login: string;
    scopes: string[];
    expiresIn: number | null;
};

type TokenValidationFailure = {
    error: unknown;
    status: number | null;
};

type TokenValidationResult = TokenValidationSuccess | TokenValidationFailure;

type TokenRefreshResult = {
    refreshed: boolean;
    error: unknown | null;
};

type HttpClient = {
    get: (url: string, config?: AxiosRequestConfig) => Promise<{ data?: unknown }>;
    post: (url: string, data?: unknown, config?: AxiosRequestConfig) => Promise<{ data?: unknown }>;
};

type OAuthFlowRunner = (options: {
    clientId: string;
    tokenStorePath: string;
    logger: ReturnType<typeof resolveLogger>;
    signal: AbortSignal;
}) => Promise<OAuthTokenPayload | null>;

type TwitchAuthOptions = {
    tokenStorePath: unknown;
    clientId: unknown;
    logger?: unknown;
    expectedUsername?: unknown;
    httpClient?: HttpClient;
    oauthFlow?: OAuthFlowRunner;
    retryExecutor?: RetryExecutor;
    monitoringNow?: () => number;
    networkTimeoutMs?: number;
};

type ValidationInvalidation = {
    reason: 'invalid-token' | 'identity-mismatch' | 'validation-unavailable';
    signal: AbortSignal;
};
type ValidationMonitoringOptions = { onInvalidated: (event: ValidationInvalidation) => void | Promise<void> };
type ValidationMonitor = {
    controller: AbortController;
    task: Promise<void>;
    invalidated: boolean;
    operations: Set<Promise<unknown>>;
    retirement: Promise<void> | null;
};

const VALIDATION_INTERVAL_MS = 60 * 60 * 1000;
const VALIDATION_RETRY_MS = 30 * 1000;
const VALIDATION_OUTAGE_GRACE_MS = 5 * 60 * 1000;
const VALIDATION_RETIREMENT_BUDGET_MS = 5 * 1000;

type HttpErrorShape = {
    response?: {
        status?: unknown;
        data?: {
            error?: unknown;
            error_description?: unknown;
            message?: unknown;
        };
    };
    message?: unknown;
};

const createTwitchAuthErrorHandler = (logger: ReturnType<typeof resolveLogger>) => createPlatformErrorHandler(logger, 'twitch-auth');
const TWITCH_VALIDATION_TIMEOUT_MS = AuthConstants.getStreamingOptimizedTimeout('low', 'tokenValidation');

function asRecord(value: unknown): AuthRecord {
    return value && typeof value === 'object' ? (value as AuthRecord) : {};
}

function asFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asHttpError(error: unknown): HttpErrorShape {
    return error && typeof error === 'object' ? (error as HttpErrorShape) : {};
}

function isValidationFailure(result: TokenValidationResult): result is TokenValidationFailure {
    return 'error' in result;
}

const ensureCamelTokenPayload = (payload: unknown, sourceLabel: string): OAuthTokenPayload | null => {
    if (!payload) {
        return null;
    }

    const payloadRecord = asRecord(payload);

    if (Object.prototype.hasOwnProperty.call(payloadRecord, 'access_token')
        || Object.prototype.hasOwnProperty.call(payloadRecord, 'refresh_token')
        || Object.prototype.hasOwnProperty.call(payloadRecord, 'expires_in')) {
        throw new Error(`${sourceLabel} must return camelCase token fields`);
    }

    if (!Object.prototype.hasOwnProperty.call(payloadRecord, 'accessToken')) {
        throw new Error(`${sourceLabel} must include accessToken`);
    }

    if (typeof payloadRecord.accessToken !== 'string' || payloadRecord.accessToken.trim() === '') {
        throw new Error(`${sourceLabel} must provide string accessToken`);
    }

    if (Object.prototype.hasOwnProperty.call(payloadRecord, 'refreshToken')
        && payloadRecord.refreshToken !== null
        && payloadRecord.refreshToken !== undefined
        && (typeof payloadRecord.refreshToken !== 'string' || !payloadRecord.refreshToken.trim())) {
        throw new Error(`${sourceLabel} must provide string refreshToken when present`);
    }

    if (Object.prototype.hasOwnProperty.call(payloadRecord, 'expiresIn')
        && payloadRecord.expiresIn !== null
        && payloadRecord.expiresIn !== undefined
        && (typeof payloadRecord.expiresIn !== 'number' || !Number.isFinite(payloadRecord.expiresIn))) {
        throw new Error(`${sourceLabel} must provide numeric expiresIn when present`);
    }

    if (Object.prototype.hasOwnProperty.call(payloadRecord, 'expiresAt')
        && payloadRecord.expiresAt !== null
        && payloadRecord.expiresAt !== undefined
        && (typeof payloadRecord.expiresAt !== 'number' || !Number.isFinite(payloadRecord.expiresAt))) {
        throw new Error(`${sourceLabel} must provide numeric expiresAt when present`);
    }

    return {
        accessToken: payloadRecord.accessToken,
        refreshToken: typeof payloadRecord.refreshToken === 'string' ? payloadRecord.refreshToken : null,
        expiresIn: asFiniteNumber(payloadRecord.expiresIn),
        expiresAt: asFiniteNumber(payloadRecord.expiresAt)
    };
};

const parseRefreshResponse = (data: unknown): RefreshTokenPayload => {
    const dataRecord = asRecord(data);

    if (typeof dataRecord.access_token !== 'string' || !dataRecord.access_token.trim()) {
        throw new Error('Token refresh response missing access token');
    }

    const hasRefreshToken = Object.prototype.hasOwnProperty.call(dataRecord, 'refresh_token');
    if (hasRefreshToken && (typeof dataRecord.refresh_token !== 'string' || !dataRecord.refresh_token.trim())) {
        throw new Error('Token refresh response has malformed refresh token');
    }
    const refreshToken = hasRefreshToken && typeof dataRecord.refresh_token === 'string'
        ? dataRecord.refresh_token
        : undefined;

    return {
        accessToken: dataRecord.access_token,
        ...(refreshToken === undefined ? {} : { refreshToken }),
        expiresIn: asFiniteNumber(dataRecord.expires_in)
    };
};

const computeExpiresAt = (normalized: { expiresAt?: number | null; expiresIn?: number | null }): number | null => {
    const expiresAt = asFiniteNumber(normalized.expiresAt);
    if (expiresAt !== null) {
        return expiresAt;
    }

    const expiresIn = asFiniteNumber(normalized.expiresIn);
    if (expiresIn !== null) {
        return Date.now() + (expiresIn * 1000);
    }

    return null;
};

const isAuthDisabled = () => {
    const value = (process.env.TWITCH_DISABLE_AUTH || '').toLowerCase();
    if (!value) {
        return false;
    }
    return ['1', 'true', 'yes', 'on'].includes(value);
};

class TwitchAuth {
    #lifetime = new AbortController();
    #retirement: Promise<void> | null = null;
    #networkTimeoutMs: number;
    #initialized = false;
    #userId: string | null = null;
    #refreshPromise: Promise<TokenRefreshResult> | null = null;
    #generation = 0;
    #commitPromise: Promise<void> = Promise.resolve();
    #tokenStorePath: string;
    #clientId: string;
    #logger: ReturnType<typeof resolveLogger>;
    #expectedUsername: string | null;
    #httpClient: HttpClient;
    #oauthFlowRunner: OAuthFlowRunner;
    #retryExecutor: RetryExecutor;
    #monitoringNow: () => number;
    #lastAcceptedAt = 0;
    #monitor: ValidationMonitor | null = null;

    constructor({ tokenStorePath, clientId, logger, expectedUsername = null, httpClient, oauthFlow, retryExecutor, monitoringNow, networkTimeoutMs = 30_000 }: TwitchAuthOptions) {
        if (!Number.isFinite(networkTimeoutMs) || networkTimeoutMs <= 0 || networkTimeoutMs > 2_147_483_647) {
            throw new RangeError('networkTimeoutMs must be a positive supported timeout');
        }
        this.#networkTimeoutMs = networkTimeoutMs;
        this.#tokenStorePath = typeof tokenStorePath === 'string' ? tokenStorePath : '';
        this.#clientId = typeof clientId === 'string' ? clientId : '';
        this.#logger = resolveLogger(logger, 'TwitchAuth') as ReturnType<typeof resolveLogger>;
        this.#expectedUsername = typeof expectedUsername === 'string' ? expectedUsername : null;
        this.#httpClient = httpClient || axiosModule.default || axiosModule;
        this.#retryExecutor = retryExecutor || createHttpRetryExecutor({ logger: this.#logger });
        this.#monitoringNow = monitoringNow || (() => performance.now());
        if (oauthFlow !== undefined && typeof oauthFlow !== 'function') {
            throw new Error('oauthFlow must be a function when provided');
        }
        this.#oauthFlowRunner = oauthFlow || (async (options) => ensureCamelTokenPayload(await runOAuthFlow({ ...options, persistTokens: false }), 'OAuth flow'));
    }

    async initialize() {
        this.#requireActive();
        this.#requireConfig();
        const generation = this.#generation;

        const tokenData = await loadTokens({
            tokenStorePath: this.#tokenStorePath,
            logger: this.#logger
        });
        this.#requireActive();
        const normalized = ensureCamelTokenPayload(tokenData, 'Token store');
        if (generation !== this.#generation) {
            throw new Error('Twitch credential candidate was superseded');
        }
        const hasToken = normalized && normalized.accessToken;

        if (!hasToken) {
            if (isAuthDisabled()) {
                throw new Error('TWITCH_DISABLE_AUTH is set but no Twitch tokens are available');
            }
            await this.#runOAuthAndPersistTokens('OAuth flow did not return valid Twitch tokens');
            return this.#userId;
        }

        const validation = await this.#validateToken(normalized.accessToken);
        this.#requireActive();
        if (generation !== this.#generation) {
            throw new Error('Twitch credential candidate was superseded');
        }
        if (isValidationFailure(validation)) {
            if (validation.status !== 401) {
                throw validation.error;
            }
            const hadRefreshToken = !!normalized.refreshToken;
            const refreshResult = await this.#refreshTokenResult(normalized.refreshToken);
            this.#requireActive();
            if (refreshResult.refreshed) {
                return this.#userId;
            } else if (hadRefreshToken) {
                if (refreshResult.error !== null) {
                    throw refreshResult.error;
                }
                throw new Error('Twitch authentication failed after refresh');
            }
        }

        if (isValidationFailure(validation)) {
            await this.#runOAuthAndPersistTokens('Twitch authentication failed after refresh');
            return this.#userId;
        }

        if (this.#missingScopes(validation.scopes).length > 0) {
            this.#acceptIdentity(validation, false);
            await this.#runOAuthAndPersistTokens('Twitch authentication failed due to missing scopes');
            return this.#userId;
        }

        this.#acceptIdentity(validation);
        await this.#commitCandidate(normalized, validation, generation, false);
        return this.#userId;
    }

    async refreshTokens(signal?: AbortSignal) {
        this.#requireActive();
        signal?.throwIfAborted();
        // Caller cancellation releases only this waiter; the shared rotation belongs
        // to auth and must remain available to other callers.
        const operation = this.#refreshTokenResult();
        const result = signal ? await withOperationDeadline(() => operation, {
            parentAbortSignal: signal, operationName: 'Twitch refresh caller'
        }) : await operation;
        return result.refreshed;
    }

    async #refreshTokenResult(refreshToken = secrets.twitch.refreshToken): Promise<TokenRefreshResult> {
        this.#requireActive();
        if (this.#refreshPromise) {
            return this.#refreshPromise;
        }
        this.#refreshPromise = this.#doRefresh(refreshToken);
        try {
            return await this.#refreshPromise;
        } finally {
            this.#refreshPromise = null;
        }
    }

    #requireActive() {
        if (this.#lifetime.signal.aborted) throw new Error('Twitch auth is disposed');
    }

    // Irreversible retirement differs from recoverable monitor stop. There is no
    // deadline on this actual persistence join: hung filesystem I/O means drain
    // remains incomplete. The runtime must not replace this owner before it settles.
    dispose(): Promise<void> {
        if (this.#retirement) return this.#retirement;
        let complete!: () => void;
        let fail!: (error: unknown) => void;
        this.#retirement = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
        this.#initialized = false;
        this.#generation++;
        this.#lifetime.abort(new Error('Twitch auth is disposed'));
        void Promise.all([this.stopValidationMonitoring(), this.#commitPromise]).then(() => complete(), fail);
        return this.#retirement;
    }

    getUserId() {
        return this.#userId;
    }

    isReady() {
        return this.#initialized;
    }

    // Invalidation callbacks must honor their signal across asynchronous effects.
    // Explicit validated recovery retires an invalidated monitor; start it again afterward.
    startValidationMonitoring(options: ValidationMonitoringOptions): void {
        this.#requireActive();
        if (this.#monitor) {
            if (this.#monitor.retirement) {
                throw new Error('Twitch validation monitoring is still retiring');
            }
            return;
        }
        if (!this.#initialized || !secrets.twitch.accessToken) {
            throw new Error('Twitch validation monitoring requires accepted credentials');
        }
        if (typeof options?.onInvalidated !== 'function') {
            throw new Error('Twitch validation monitoring requires onInvalidated');
        }
        const monitor: ValidationMonitor = {
            controller: new AbortController(), task: Promise.resolve(), invalidated: false,
            operations: new Set(), retirement: null
        };
        this.#monitor = monitor;
        monitor.task = this.#runValidationMonitor(monitor, options).catch(async () => {
            if (this.#isCurrentMonitor(monitor)) {
                await this.#notifyInvalidation(monitor, options, 'validation-unavailable');
                this.#reportMonitorFailure('Twitch validation monitor stopped unexpectedly');
            }
        });
    }

    // Closes admission synchronously, then joins original HTTP/callback completion
    // (including cooperative finally cleanup), bounded by the retirement budget.
    stopValidationMonitoring(): Promise<void> {
        const monitor = this.#monitor;
        if (!monitor) {
            return Promise.resolve();
        }
        if (monitor.retirement) {
            return monitor.retirement;
        }
        // Install the shared join before abort dispatch can reenter this method.
        monitor.retirement = withOperationDeadline(async () => {
            await monitor.task;
            await Promise.allSettled([...monitor.operations]);
        }, { budgetMs: VALIDATION_RETIREMENT_BUDGET_MS, operationName: 'Twitch validation monitor retirement' })
            .catch(() => {
                this.#reportMonitorFailure('Twitch validation monitor retirement deadline exceeded');
            })
            .finally(() => {
                if (this.#monitor === monitor) {
                    this.#monitor = null;
                }
            });
        monitor.controller.abort();
        return monitor.retirement;
    }

    #isCurrentMonitor(monitor: ValidationMonitor): boolean {
        return !this.#lifetime.signal.aborted && this.#monitor === monitor && !monitor.controller.signal.aborted;
    }

    #reportMonitorFailure(message: string) {
        try {
            this.#logger.warn(message, 'twitch-auth');
        } catch {
            // Diagnostics must never strand retirement or the notification task.
        }
    }

    async #notifyInvalidation(monitor: ValidationMonitor, options: ValidationMonitoringOptions, reason: ValidationInvalidation['reason']) {
        if (!this.#isCurrentMonitor(monitor)) {
            return;
        }
        this.#initialized = false;
        monitor.invalidated = true;
        const generation = this.#generation;
        // The monitor never refreshes or opens OAuth. Lifecycle recovery must explicitly
        // accept a validated candidate and retire the old Twitch session first.
        try {
            const callback = this.#trackMonitorOperation(monitor, Promise.resolve().then(() => {
                if (this.#isCurrentMonitor(monitor) && generation === this.#generation) {
                    return options.onInvalidated({ reason, signal: monitor.controller.signal });
                }
            }).catch(() => {
                this.#reportMonitorFailure('Twitch validation invalidation callback failed');
            }));
            await this.#untilMonitorStopped(monitor, callback);
        } catch {
            if (this.#isCurrentMonitor(monitor)) {
                this.#reportMonitorFailure('Twitch validation invalidation callback failed');
            }
        }
    }

    #trackMonitorOperation<T>(monitor: ValidationMonitor, operation: Promise<T>): Promise<T> {
        monitor.operations.add(operation);
        void operation.then(
            () => { monitor.operations.delete(operation); },
            () => { monitor.operations.delete(operation); }
        );
        return operation;
    }

    async #untilMonitorStopped<T>(monitor: ValidationMonitor, operation: Promise<T>): Promise<T> {
        const signal = monitor.controller.signal;
        signal.throwIfAborted();
        let onAbort!: () => void;
        const stopped = new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(signal.reason);
            signal.addEventListener('abort', onAbort, { once: true });
        });
        try {
            return await Promise.race([operation, stopped]);
        } finally {
            signal.removeEventListener('abort', onAbort);
        }
    }

    async #monitorValidation(monitor: ValidationMonitor, accessToken: string, budgetMs: number): Promise<TokenValidationResult> {
        const request = new AbortController();
        const signal = monitor.controller.signal;
        const onAbort = () => request.abort();
        signal.addEventListener('abort', onAbort, { once: true });
        const timer = safeSetTimeout(() => request.abort(), budgetMs);
        let rejectAborted!: () => void;
        const aborted = new Promise<TokenValidationFailure>(resolve => {
            rejectAborted = () => resolve({ error: new Error('Twitch monitor validation interrupted'), status: null });
            request.signal.addEventListener('abort', rejectAborted, { once: true });
        });
        try {
            const validation = this.#trackMonitorOperation(monitor, this.#validateToken(accessToken, request.signal, monitor));
            return await Promise.race([validation, aborted]);
        } finally {
            globalThis.clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            request.signal.removeEventListener('abort', rejectAborted);
        }
    }

    async #runValidationMonitor(monitor: ValidationMonitor, options: ValidationMonitoringOptions) {
        let nextAt = this.#lastAcceptedAt + VALIDATION_INTERVAL_MS;
        let outageStartedAt: number | null = null;
        let generation = this.#generation;
        while (this.#isCurrentMonitor(monitor)) {
            const delay = nextAt - this.#monitoringNow();
            if (delay > 0) {
                await safeDelay(delay, delay, 'Twitch validation monitoring', monitor.controller.signal);
            }
            if (!this.#isCurrentMonitor(monitor)) {
                return;
            }
            if (generation !== this.#generation) {
                generation = this.#generation;
                outageStartedAt = null;
                nextAt = this.#lastAcceptedAt + VALIDATION_INTERVAL_MS;
                continue;
            }
            const remainingGrace = outageStartedAt === null ? VALIDATION_OUTAGE_GRACE_MS
                : outageStartedAt + VALIDATION_OUTAGE_GRACE_MS - this.#monitoringNow();
            if (remainingGrace <= 0) {
                await this.#notifyInvalidation(monitor, options, 'validation-unavailable');
                return;
            }
            const token = secrets.twitch.accessToken;
            if (!token) {
                await this.#notifyInvalidation(monitor, options, 'invalid-token');
                return;
            }
            const validationStartedAt = this.#monitoringNow();
            const validation = await this.#monitorValidation(monitor, token, Math.min(TWITCH_VALIDATION_TIMEOUT_MS, remainingGrace));
            if (!this.#isCurrentMonitor(monitor)) {
                return;
            }
            if (generation !== this.#generation || token !== secrets.twitch.accessToken) {
                generation = this.#generation;
                outageStartedAt = null;
                nextAt = this.#lastAcceptedAt + VALIDATION_INTERVAL_MS;
                continue;
            }
            if (!isValidationFailure(validation)) {
                try {
                    this.#acceptIdentity(validation);
                    if (validation.userId !== this.#userId) {
                        throw new Error('Twitch token user identity mismatch');
                    }
                } catch {
                    await this.#notifyInvalidation(monitor, options, 'identity-mismatch');
                    return;
                }
                outageStartedAt = null;
                nextAt = this.#monitoringNow() + VALIDATION_INTERVAL_MS;
                continue;
            }
            if (validation.status !== null && validation.status < 500 && validation.status !== 429 && validation.status !== 408) {
                await this.#notifyInvalidation(monitor, options, 'invalid-token');
                return;
            }
            outageStartedAt ??= validationStartedAt;
            nextAt = Math.min(this.#monitoringNow() + VALIDATION_RETRY_MS, outageStartedAt + VALIDATION_OUTAGE_GRACE_MS);
        }
    }

    #requireConfig(): string {
        if (!this.#expectedUsername) {
            throw new Error('expectedUsername is required for Twitch authentication');
        }
        if (!this.#clientId) {
            throw new Error('clientId is required for Twitch authentication');
        }
        if (!secrets.twitch.clientSecret) {
            throw new Error('clientSecret is required for Twitch authentication');
        }

        return this.#expectedUsername;
    }

    #applyTokens({ accessToken, refreshToken }: { accessToken: string | null; refreshToken?: string | null }) {
        secrets.twitch.accessToken = accessToken || null;
        if (refreshToken !== undefined) {
            secrets.twitch.refreshToken = refreshToken || null;
        }
    }

    #acceptIdentity(validation: TokenValidationSuccess, requireScopes = true) {
        if (validation.clientId !== this.#clientId) {
            throw new Error('Twitch token client mismatch');
        }
        if (validation.login.toLowerCase() !== this.#expectedUsername?.toLowerCase()) {
            throw new Error('Twitch token login mismatch');
        }
        if (requireScopes && this.#missingScopes(validation.scopes).length) {
            throw new Error('Twitch authentication failed due to missing scopes');
        }
    }

    #publishCandidate(candidate: OAuthTokenPayload, validation: TokenValidationSuccess, generation: number) {
        this.#requireActive();
        if (generation !== this.#generation) {
            throw new Error('Twitch credential candidate was superseded');
        }
        this.#applyTokens(candidate);
        this.#userId = validation.userId;
        this.#initialized = true;
        this.#generation++;
        this.#lastAcceptedAt = this.#monitoringNow();
        if (this.#monitor?.invalidated) {
            void this.stopValidationMonitoring();
        }
    }

    async #acceptCandidate(candidate: OAuthTokenPayload, generation: number) {
        this.#requireActive();
        if (generation !== this.#generation) throw new Error('Twitch credential candidate was superseded');
        const validation = await this.#validateToken(candidate.accessToken);
        this.#requireActive();
        if (isValidationFailure(validation)) {
            throw validation.error;
        }
        this.#acceptIdentity(validation);
        await this.#commitCandidate(candidate, validation, generation, true);
    }

    async #commitCandidate(candidate: OAuthTokenPayload, validation: TokenValidationSuccess, generation: number, persist: boolean) {
        this.#requireActive();
        const commit = this.#commitPromise.then(async () => {
            this.#requireActive();
            if (generation !== this.#generation) {
                throw new Error('Twitch credential candidate was superseded');
            }
            if (persist) {
                await this.#persistTokens(candidate);
            }
            this.#publishCandidate(candidate, validation, generation);
        });
        this.#commitPromise = commit.catch(() => undefined);
        await commit;
    }

    async #persistTokens(normalized: OAuthTokenPayload) {
        await saveTokens(
            {
                tokenStorePath: this.#tokenStorePath,
                logger: this.#logger
            },
            {
                accessToken: normalized.accessToken,
                ...(normalized.refreshToken === undefined ? {} : { refreshToken: normalized.refreshToken }),
                expiresAt: computeExpiresAt(normalized)
            }
        );
    }

    async #runOAuthFlow(): Promise<OAuthTokenPayload | null> {
        this.#requireActive();
        return await withOperationDeadline(({ signal }) => this.#oauthFlowRunner({
            clientId: this.#clientId,
            tokenStorePath: this.#tokenStorePath,
            logger: this.#logger,
            signal
        }), { parentAbortSignal: this.#lifetime.signal,
            budgetMs: TOKEN_REFRESH_CONFIG.OAUTH_TIMEOUT_MS + 30_000,
            operationName: 'Twitch OAuth' });
    }

    async #runOAuthAndPersistTokens(failureMessage: string): Promise<OAuthTokenPayload> {
        this.#requireActive();
        if (isAuthDisabled()) {
            throw new Error('TWITCH_DISABLE_AUTH is set; interactive authentication is disabled');
        }
        const generation = this.#generation;
        const oauthTokens = await this.#runOAuthFlow();
        this.#requireActive();
        if (generation !== this.#generation) throw new Error('Twitch credential candidate was superseded');
        const oauthNormalized = ensureCamelTokenPayload(oauthTokens, 'OAuth flow');
        if (!oauthNormalized || !oauthNormalized.accessToken) {
            throw new Error(failureMessage);
        }
        if (!oauthNormalized.refreshToken) {
            throw new Error(`${failureMessage}: OAuth flow did not return a refresh token`);
        }
        await this.#acceptCandidate(oauthNormalized, generation);
        return oauthNormalized;
    }

    #refreshRequest<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
        this.#requireActive();
        const controller = new AbortController();
        const signal = AbortSignal.any([this.#lifetime.signal, controller.signal]);
        // Admit the single non-idempotent POST synchronously, preserving refresh
        // coalescing semantics. Its result alone cannot admit a candidate.
        const request = operation(signal);
        void request.catch(() => {});
        return withOperationDeadline(async ({ signal: deadlineSignal }) => {
            const onAbort = () => controller.abort(deadlineSignal.reason);
            deadlineSignal.addEventListener('abort', onAbort, { once: true });
            try { return await request; }
            finally { deadlineSignal.removeEventListener('abort', onAbort); }
        }, { parentAbortSignal: this.#lifetime.signal, budgetMs: this.#networkTimeoutMs,
            operationName: 'Twitch token refresh' });
    }

    async #doRefresh(previousRefreshToken: string | null) {
        this.#requireActive();
        const generation = this.#generation;
        if (!previousRefreshToken) {
            return { refreshed: false, error: null };
        }

        const clientSecret = secrets.twitch.clientSecret;
        if (!clientSecret) {
            return { refreshed: false, error: null };
        }

        const handler = createTwitchAuthErrorHandler(this.#logger);

        try {
            const form = new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: previousRefreshToken,
                client_id: this.#clientId,
                client_secret: clientSecret
            }).toString();

            const response = await this.#refreshRequest(signal => this.#httpClient.post(
                TWITCH.OAUTH.TOKEN,
                form,
                {
                    signal,
                    timeout: this.#networkTimeoutMs,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            ));
            this.#requireActive();
            if (generation !== this.#generation) throw new Error('Twitch credential candidate was superseded');

            const data = response && response.data ? response.data : null;
            const normalized = parseRefreshResponse(data);

            const refreshToken = normalized.refreshToken === undefined
                ? previousRefreshToken
                : normalized.refreshToken;
            await this.#acceptCandidate({
                accessToken: normalized.accessToken,
                refreshToken,
                expiresIn: normalized.expiresIn
            }, generation);
            return { refreshed: true, error: null };
        } catch (error) {
            const httpError = asHttpError(error);
            if (this.#lifetime.signal.aborted || generation !== this.#generation) {
                return { refreshed: false, error: new Error('Twitch credential candidate was superseded') };
            }
            if (this.#isTerminalRefreshError(httpError)) {
                try {
                    await this.#runOAuthAndPersistTokens('OAuth flow did not return valid Twitch tokens');
                    return { refreshed: true, error: null };
                } catch (oauthError) {
                    handler.logOperationalError('OAuth flow failed after terminal refresh error', 'twitch-auth');
                    return { refreshed: false, error: oauthError };
                }
            }
            handler.logOperationalError('Token refresh failed', 'twitch-auth', {
                status: typeof httpError.response?.status === 'number' ? httpError.response.status : null,
            });
            return { refreshed: false, error };
        }
    }

    #isTerminalRefreshError(error: HttpErrorShape) {
        const errorCode = typeof error.response?.data?.error === 'string' ? error.response.data.error : '';
        const message = (typeof error.response?.data?.error_description === 'string' ? error.response.data.error_description : '')
            || (typeof error.response?.data?.message === 'string' ? error.response.data.message : '')
            || (typeof error.message === 'string' ? error.message : '')
            || '';
        const normalized = message.toLowerCase();

        if (errorCode === 'invalid_grant') {
            return true;
        }

        if (normalized.includes('50 valid access tokens')) {
            return true;
        }

        return false;
    }

    async #validateToken(accessToken: string, signal?: AbortSignal, monitor?: ValidationMonitor): Promise<TokenValidationResult> {
        const handler = createTwitchAuthErrorHandler(this.#logger);
        if (!accessToken) {
            return { error: new Error('Access token is missing'), status: null };
        }

        try {
            this.#requireActive();
            const response = await withOperationDeadline(({ signal: requestSignal }) => this.#retryExecutor.executeWithRetry(
                'twitch-auth-validation',
                () => {
                    const request = this.#httpClient.get(
                        TWITCH.OAUTH.VALIDATE,
                        {
                            headers: {
                                Authorization: `Bearer ${accessToken}`
                            },
                            timeout: TWITCH_VALIDATION_TIMEOUT_MS,
                            signal: requestSignal
                        }
                    );
                    return monitor ? this.#trackMonitorOperation(monitor, request) : request;
                },
                signal ? 1 : 3,
                { signal: requestSignal }
            ), { parentAbortSignal: signal ? AbortSignal.any([signal, this.#lifetime.signal]) : this.#lifetime.signal,
                budgetMs: TWITCH_VALIDATION_TIMEOUT_MS, operationName: 'Twitch token validation' });

            const data = asRecord(response && response.data ? response.data : null);
            if (typeof data.user_id !== 'string' || !data.user_id.trim()
                || typeof data.login !== 'string' || !data.login.trim()
                || typeof data.client_id !== 'string' || !data.client_id.trim()
                || !Array.isArray(data.scopes) || !data.scopes.every(scope => typeof scope === 'string' && scope.trim())) {
                return { error: new Error('Token validation response missing user data'), status: null };
            }

            return {
                clientId: data.client_id,
                userId: data.user_id,
                login: data.login,
                scopes: data.scopes as string[],
                expiresIn: asFiniteNumber(data.expires_in)
            };
        } catch (error) {
            const httpError = asHttpError(error);
            if (!signal) {
                handler.logOperationalError('Token validation failed', 'twitch-auth', {
                    status: typeof httpError.response?.status === 'number' ? httpError.response.status : null,
                });
            }
            return {
                error,
                status: typeof httpError.response?.status === 'number' ? httpError.response.status : null
            };
        }
    }

    #missingScopes(scopes: string[] | null | undefined): string[] {
        const actual = new Set(scopes || []);
        return TWITCH_OAUTH_SCOPES.filter(scope => !actual.has(scope));
    }
}

export { TwitchAuth };
