const { TWITCH } = require('../core/endpoints');
const { secrets } = require('../core/secrets');
const { loadTokens, saveTokens } = require('../utils/token-store');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { resolveLogger } = require('../utils/logger-resolver');
const { TWITCH_OAUTH_SCOPES } = require('./twitch-oauth-scopes');

const createTwitchAuthErrorHandler = (logger) => createPlatformErrorHandler(logger, 'twitch-auth');

const logAuthError = (handler, message, error, payload = null) => {
    if (error instanceof Error) {
        handler.handleEventProcessingError(error, 'twitch-auth', payload, message, 'twitch-auth');
        return;
    }
    handler.logOperationalError(message, 'twitch-auth', payload || error);
};

const ensureCamelTokenPayload = (payload, sourceLabel) => {
    if (!payload) {
        return null;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'access_token')
        || Object.prototype.hasOwnProperty.call(payload, 'refresh_token')
        || Object.prototype.hasOwnProperty.call(payload, 'expires_in')) {
        throw new Error(`${sourceLabel} must return camelCase token fields`);
    }

    if (!Object.prototype.hasOwnProperty.call(payload, 'accessToken')) {
        throw new Error(`${sourceLabel} must include accessToken`);
    }

    return {
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        expiresIn: payload.expiresIn,
        expiresAt: payload.expiresAt
    };
};

const parseRefreshResponse = (data) => {
    if (!data || !data.access_token) {
        throw new Error('Token refresh response missing access token');
    }

    const hasRefreshToken = Object.prototype.hasOwnProperty.call(data, 'refresh_token');

    return {
        accessToken: data.access_token,
        refreshToken: hasRefreshToken ? data.refresh_token : undefined,
        expiresIn: Number.isFinite(data.expires_in) ? data.expires_in : null
    };
};

const computeExpiresAt = (normalized) => {
    if (Number.isFinite(normalized.expiresAt)) {
        return normalized.expiresAt;
    }
    if (Number.isFinite(normalized.expiresIn)) {
        return Date.now() + (normalized.expiresIn * 1000);
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
    #userId = null;
    #refreshPromise = null;
    #tokenStorePath;
    #clientId;
    #logger;
    #expectedUsername;
    #httpClient;
    #oauthFlow;

    constructor({ tokenStorePath, clientId, logger, expectedUsername = null, httpClient, oauthFlow }) {
        this.#tokenStorePath = tokenStorePath;
        this.#clientId = clientId;
        this.#logger = resolveLogger(logger, 'TwitchAuth');
        this.#expectedUsername = expectedUsername;
        this.#httpClient = httpClient || require('axios');
        this.#oauthFlow = oauthFlow || require('./oauth-flow');
    }

    async initialize() {
        this.#requireConfig();

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
        if (validation.error) {
            const refreshed = await this.refreshTokens();
            if (refreshed) {
                validation = await this.#validateToken();
            }
        }

        if (validation.error) {
            await this.#runOAuthAndPersistTokens('Twitch authentication failed after refresh');
            validation = await this.#validateToken();
        }

        if (validation.error) {
            throw new Error('Twitch authentication failed');
        }

        if (this.#missingScopes(validation.scopes).length > 0) {
            await this.#runOAuthAndPersistTokens('Twitch authentication failed due to missing scopes');
            validation = await this.#validateToken();
        }

        if (validation.error || this.#missingScopes(validation.scopes).length > 0) {
            throw new Error('Twitch authentication failed due to missing scopes');
        }

        const login = validation.login || '';
        if (login.toLowerCase() !== this.#expectedUsername.toLowerCase()) {
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

    #requireConfig() {
        if (!this.#expectedUsername) {
            throw new Error('expectedUsername is required for Twitch authentication');
        }
        if (!this.#clientId) {
            throw new Error('clientId is required for Twitch authentication');
        }
        if (!secrets.twitch.clientSecret) {
            throw new Error('clientSecret is required for Twitch authentication');
        }
    }

    #applyTokens({ accessToken, refreshToken }) {
        secrets.twitch.accessToken = accessToken || null;
        if (refreshToken !== undefined) {
            secrets.twitch.refreshToken = refreshToken || null;
        }
    }

    async #persistTokens(normalized) {
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

    async #runOAuthFlow() {
        return await this.#oauthFlow.runOAuthFlow({
            clientId: this.#clientId,
            tokenStorePath: this.#tokenStorePath,
            logger: this.#logger
        });
    }

    async #runOAuthAndPersistTokens(failureMessage) {
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

        const handler = createTwitchAuthErrorHandler(this.#logger);

        try {
            const form = new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: secrets.twitch.refreshToken,
                client_id: this.#clientId,
                client_secret: secrets.twitch.clientSecret
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
            if (this.#isTerminalRefreshError(error)) {
                try {
                    await this.#runOAuthAndPersistTokens('OAuth flow did not return valid Twitch tokens');
                    return true;
                } catch (oauthError) {
                    logAuthError(handler, 'OAuth flow failed after terminal refresh error', oauthError);
                    return false;
                }
            }
            logAuthError(handler, 'Token refresh failed', error, {
                status: error?.response?.status,
                error: error?.response?.data?.error
            });
            return false;
        }
    }

    #isTerminalRefreshError(error) {
        const errorCode = error?.response?.data?.error;
        const message = error?.response?.data?.error_description
            || error?.response?.data?.message
            || error?.message
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

    async #validateToken() {
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

            const data = response && response.data ? response.data : null;
            if (!data || !data.user_id || !data.login) {
                return { error: new Error('Token validation response missing user data'), status: null };
            }

            return {
                userId: data.user_id.toString(),
                login: data.login,
                scopes: Array.isArray(data.scopes) ? data.scopes : [],
                expiresIn: Number.isFinite(data.expires_in) ? data.expires_in : null
            };
        } catch (error) {
            logAuthError(handler, 'Token validation failed', error, {
                status: error?.response?.status,
                message: error?.message
            });
            return { error, status: error?.response?.status || null };
        }
    }

    #missingScopes(scopes) {
        const actual = new Set(scopes || []);
        return TWITCH_OAUTH_SCOPES.filter(scope => !actual.has(scope));
    }
}

module.exports = TwitchAuth;
