import * as axiosModule from 'axios';
import type { AxiosRequestConfig } from 'axios';
import { TWITCH } from '../core/endpoints';
import { secrets } from '../core/secrets';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { resolveLogger } from '../utils/logger-resolver';
import { loadTokens, saveTokens } from '../utils/token-store';
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
    tokenStorePath: string;
    clientId: string;
    logger?: unknown;
    expectedUsername?: string | null;
    httpClient?: HttpClient;
    oauthFlow?: OAuthFlowRunner;
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

const logAuthError = (
    handler: ReturnType<typeof createPlatformErrorHandler>,
    message: string,
    error: unknown,
    payload: Record<string, unknown> | null = null
) => {
    if (error instanceof Error) {
        handler.handleEventProcessingError(error, 'twitch-auth', payload, message, 'twitch-auth');
        return;
    }
    handler.logOperationalError(message, 'twitch-auth', payload || error);
};

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
        && typeof payloadRecord.refreshToken !== 'string') {
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
    const refreshToken = hasRefreshToken && typeof dataRecord.refresh_token === 'string'
        ? dataRecord.refresh_token
        : undefined;

    return {
        accessToken: dataRecord.access_token,
        refreshToken,
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
    #refreshPromise: Promise<boolean> | null = null;
    #tokenStorePath: string;
    #clientId: string;
    #logger: ReturnType<typeof resolveLogger>;
    #expectedUsername: string | null;
    #httpClient: HttpClient;
    #oauthFlowRunner: OAuthFlowRunner;

    constructor({ tokenStorePath, clientId, logger, expectedUsername = null, httpClient, oauthFlow }: TwitchAuthOptions) {
        this.#tokenStorePath = tokenStorePath;
        this.#clientId = clientId;
        this.#logger = resolveLogger(logger, 'TwitchAuth') as ReturnType<typeof resolveLogger>;
        this.#expectedUsername = expectedUsername;
        this.#httpClient = httpClient || axiosModule.default || axiosModule;
        if (oauthFlow !== undefined && typeof oauthFlow !== 'function') {
            throw new Error('oauthFlow must be a function when provided');
        }
        this.#oauthFlowRunner = oauthFlow || runOAuthFlow;
    }

    async initialize() {
        const expectedUsername = this.#requireConfig();

        const tokenData = await loadTokens({
            tokenStorePath: this.#tokenStorePath,
            logger: this.#logger
        });
        const normalized = ensureCamelTokenPayload(tokenData, 'Token store');
        const hasToken = normalized && normalized.accessToken;

        if (hasToken) {
            this.#applyTokens(normalized);
        } else {
            this.#applyTokens({ accessToken: null, refreshToken: null });
        }

        if (!hasToken) {
            if (isAuthDisabled()) {
                throw new Error('TWITCH_DISABLE_AUTH is set but no Twitch tokens are available');
            }
            await this.#runOAuthAndPersistTokens('OAuth flow did not return valid Twitch tokens');
        }

        let validation = await this.#validateToken();
        if (isValidationFailure(validation)) {
            const refreshed = await this.refreshTokens();
            if (refreshed) {
                validation = await this.#validateToken();
            }
        }

        if (isValidationFailure(validation)) {
            await this.#runOAuthAndPersistTokens('Twitch authentication failed after refresh');
            validation = await this.#validateToken();
        }

        if (isValidationFailure(validation)) {
            throw new Error('Twitch authentication failed');
        }

        if (this.#missingScopes(validation.scopes).length > 0) {
            await this.#runOAuthAndPersistTokens('Twitch authentication failed due to missing scopes');
            validation = await this.#validateToken();
        }

        if (isValidationFailure(validation) || this.#missingScopes(validation.scopes).length > 0) {
            throw new Error('Twitch authentication failed due to missing scopes');
        }

        const login = validation.login || '';
        if (login.toLowerCase() !== expectedUsername.toLowerCase()) {
            throw new Error(`Twitch token login mismatch for ${this.#expectedUsername}`);
        }

        this.#userId = validation.userId;
        this.#initialized = true;
        return this.#userId;
    }

    async refreshTokens() {
        if (this.#refreshPromise) {
            return this.#refreshPromise;
        }
        this.#refreshPromise = this.#doRefresh();
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

    async #persistTokens(normalized: OAuthTokenPayload) {
        await saveTokens(
            {
                tokenStorePath: this.#tokenStorePath,
                logger: this.#logger
            },
            {
                accessToken: normalized.accessToken,
                refreshToken: normalized.refreshToken,
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
        const oauthTokens = await this.#runOAuthFlow();
        const oauthNormalized = ensureCamelTokenPayload(oauthTokens, 'OAuth flow');
        if (!oauthNormalized || !oauthNormalized.accessToken) {
            throw new Error(failureMessage);
        }
        this.#applyTokens(oauthNormalized);
        await this.#persistTokens(oauthNormalized);
        return oauthNormalized;
    }

    async #doRefresh() {
        if (!secrets.twitch.refreshToken) {
            return false;
        }

        const clientSecret = secrets.twitch.clientSecret;
        if (!clientSecret) {
            return false;
        }

        const handler = createTwitchAuthErrorHandler(this.#logger);

        try {
            const form = new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: secrets.twitch.refreshToken,
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

            this.#applyTokens({
                accessToken: normalized.accessToken,
                refreshToken: normalized.refreshToken === undefined ? undefined : normalized.refreshToken
            });
            await this.#persistTokens({
                accessToken: normalized.accessToken,
                refreshToken: normalized.refreshToken === undefined ? secrets.twitch.refreshToken : normalized.refreshToken,
                expiresIn: normalized.expiresIn
            });
            return true;
        } catch (error) {
            const httpError = asHttpError(error);
            if (this.#isTerminalRefreshError(httpError)) {
                try {
                    await this.#runOAuthAndPersistTokens('OAuth flow did not return valid Twitch tokens');
                    return true;
                } catch (oauthError) {
                    logAuthError(handler, 'OAuth flow failed after terminal refresh error', oauthError);
                    return false;
                }
            }
            logAuthError(handler, 'Token refresh failed', error, {
                status: typeof httpError.response?.status === 'number' ? httpError.response.status : null,
                error: typeof httpError.response?.data?.error === 'string' ? httpError.response.data.error : null
            });
            return false;
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

    async #validateToken(): Promise<TokenValidationResult> {
        const handler = createTwitchAuthErrorHandler(this.#logger);
        if (!secrets.twitch.accessToken) {
            return { error: new Error('Access token is missing'), status: null };
        }

        try {
            const response = await this.#httpClient.get(
                TWITCH.OAUTH.VALIDATE,
                {
                    headers: {
                        Authorization: `Bearer ${secrets.twitch.accessToken}`
                    }
                }
            );

            const data = asRecord(response && response.data ? response.data : null);
            if (!data.user_id || !data.login) {
                return { error: new Error('Token validation response missing user data'), status: null };
            }

            return {
                userId: String(data.user_id),
                login: String(data.login),
                scopes: Array.isArray(data.scopes)
                    ? data.scopes.filter((scope): scope is string => typeof scope === 'string')
                    : [],
                expiresIn: asFiniteNumber(data.expires_in)
            };
        } catch (error) {
            const httpError = asHttpError(error);
            logAuthError(handler, 'Token validation failed', error, {
                status: typeof httpError.response?.status === 'number' ? httpError.response.status : null,
                message: typeof httpError.message === 'string' ? httpError.message : null
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
