import * as axiosModule from 'axios';
import type { AxiosRequestConfig } from 'axios';
import { TWITCH } from '../core/endpoints';
import { secrets } from '../core/secrets';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { resolveLogger } from '../utils/logger-resolver';
import { loadTokens, saveTokens } from '../utils/token-store';
import { AuthConstants } from '../utils/auth-constants';
import { createHttpRetryExecutor, type RetryExecutor } from '../utils/http-retry-executor';
import { runOAuthFlow } from './oauth-flow';
import { TWITCH_OAUTH_SCOPES } from './twitch-oauth-scopes';

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
}) => Promise<OAuthTokenPayload | null>;

type TwitchAuthOptions = {
    tokenStorePath: unknown;
    clientId: unknown;
    logger?: unknown;
    expectedUsername?: unknown;
    httpClient?: HttpClient;
    oauthFlow?: OAuthFlowRunner;
    retryExecutor?: RetryExecutor;
};

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

    constructor({ tokenStorePath, clientId, logger, expectedUsername = null, httpClient, oauthFlow, retryExecutor }: TwitchAuthOptions) {
        this.#tokenStorePath = typeof tokenStorePath === 'string' ? tokenStorePath : '';
        this.#clientId = typeof clientId === 'string' ? clientId : '';
        this.#logger = resolveLogger(logger, 'TwitchAuth') as ReturnType<typeof resolveLogger>;
        this.#expectedUsername = typeof expectedUsername === 'string' ? expectedUsername : null;
        this.#httpClient = httpClient || axiosModule.default || axiosModule;
        this.#retryExecutor = retryExecutor || createHttpRetryExecutor({ logger: this.#logger });
        if (oauthFlow !== undefined && typeof oauthFlow !== 'function') {
            throw new Error('oauthFlow must be a function when provided');
        }
        this.#oauthFlowRunner = oauthFlow || (async (options) => ensureCamelTokenPayload(await runOAuthFlow({ ...options, persistTokens: false }), 'OAuth flow'));
    }

    async initialize() {
        this.#requireConfig();
        const generation = this.#generation;

        const tokenData = await loadTokens({
            tokenStorePath: this.#tokenStorePath,
            logger: this.#logger
        });
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
        if (generation !== this.#generation) {
            throw new Error('Twitch credential candidate was superseded');
        }
        if (isValidationFailure(validation)) {
            if (validation.status !== 401) {
                throw validation.error;
            }
            const hadRefreshToken = !!normalized.refreshToken;
            const refreshResult = await this.#refreshTokenResult(normalized.refreshToken);
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

    async refreshTokens() {
        const result = await this.#refreshTokenResult();
        return result.refreshed;
    }

    async #refreshTokenResult(refreshToken = secrets.twitch.refreshToken): Promise<TokenRefreshResult> {
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

    getUserId() {
        return this.#userId;
    }

    isReady() {
        return this.#initialized;
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
        if (generation !== this.#generation) {
            throw new Error('Twitch credential candidate was superseded');
        }
        this.#applyTokens(candidate);
        this.#userId = validation.userId;
        this.#initialized = true;
        this.#generation++;
    }

    async #acceptCandidate(candidate: OAuthTokenPayload, generation: number) {
        const validation = await this.#validateToken(candidate.accessToken);
        if (isValidationFailure(validation)) {
            throw validation.error;
        }
        this.#acceptIdentity(validation);
        await this.#commitCandidate(candidate, validation, generation, true);
    }

    async #commitCandidate(candidate: OAuthTokenPayload, validation: TokenValidationSuccess, generation: number, persist: boolean) {
        const commit = this.#commitPromise.then(async () => {
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
        return await this.#oauthFlowRunner({
            clientId: this.#clientId,
            tokenStorePath: this.#tokenStorePath,
            logger: this.#logger
        });
    }

    async #runOAuthAndPersistTokens(failureMessage: string): Promise<OAuthTokenPayload> {
        if (isAuthDisabled()) {
            throw new Error('TWITCH_DISABLE_AUTH is set; interactive authentication is disabled');
        }
        const generation = this.#generation;
        const oauthTokens = await this.#runOAuthFlow();
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

    async #doRefresh(previousRefreshToken: string | null) {
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

            const response = await this.#httpClient.post(
                TWITCH.OAUTH.TOKEN,
                form,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

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
            if (generation !== this.#generation) {
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

    async #validateToken(accessToken: string): Promise<TokenValidationResult> {
        const handler = createTwitchAuthErrorHandler(this.#logger);
        if (!accessToken) {
            return { error: new Error('Access token is missing'), status: null };
        }

        try {
            const response = await this.#retryExecutor.executeWithRetry(
                'twitch-auth-validation',
                () => this.#httpClient.get(
                    TWITCH.OAUTH.VALIDATE,
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`
                        },
                        timeout: TWITCH_VALIDATION_TIMEOUT_MS
                    }
                ),
                3
            );

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
            handler.logOperationalError('Token validation failed', 'twitch-auth', {
                status: typeof httpError.response?.status === 'number' ? httpError.response.status : null,
            });
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
