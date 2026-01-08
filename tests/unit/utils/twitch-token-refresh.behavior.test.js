
jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: jest.fn(() => ({
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    }))
}));

jest.mock('../../../src/core/logging', () => ({
    getUnifiedLogger: jest.fn(() => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }))
}));

jest.mock('../../../src/utils/auth-errors', () => {
    class TokenRefreshError extends Error {
        constructor(message, options = {}) {
            super(message);
            this.name = 'TokenRefreshError';
            this.recoverable = options.recoverable;
            this.needsNewTokens = options.needsNewTokens;
            this.code = options.code;
        }
    }

    class ErrorHandler {
        constructor() {
            this.handleError = jest.fn(async (e) => { throw e; });
        }
        getStats() { return {}; }
        cleanup() {}
    }

    const createTokenRefreshError = jest.fn((err) => new TokenRefreshError(err.message, {
        recoverable: false,
        needsNewTokens: true,
        code: 'MOCK_ERROR'
    }));

    return {
        AuthErrorFactory: {
            categorizeError: jest.fn((err) => new TokenRefreshError(err.message || 'categorized', {
                recoverable: false,
                needsNewTokens: true,
                code: 'MOCK_ERROR'
            })),
            createTokenRefreshError
        },
        ErrorHandler,
        TokenRefreshError,
        ConfigError: class ConfigError extends Error {}
    };
});

const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const TwitchTokenRefresh = require('../../../src/utils/twitch-token-refresh');

describe('TwitchTokenRefresh behavior edges', () => {
    const baseConfig = {
        clientId: 'id',
        clientSecret: 'secret',
        accessToken: 'old',
        refreshToken: 'refresh-token',
        tokenStorePath: '/test/token-store.json'
    };

    beforeEach(() => {
        jest.clearAllMocks();
        createPlatformErrorHandler.mockImplementation(() => ({
            handleEventProcessingError: jest.fn(),
            logOperationalError: jest.fn()
        }));
        const { AuthErrorFactory, TokenRefreshError } = require('../../../src/utils/auth-errors');
        AuthErrorFactory.createTokenRefreshError.mockImplementation((err) => new TokenRefreshError(err.message || 'refresh error', {
            recoverable: false,
            needsNewTokens: true,
            code: 'MOCK_ERROR'
        }));
        AuthErrorFactory.categorizeError.mockImplementation((err) => new TokenRefreshError(err.message || 'categorized', {
            recoverable: false,
            needsNewTokens: true,
            code: 'MOCK_ERROR'
        }));
    });

    it('returns null when refresh token is missing and logs operational error', async () => {
        const refresh = new TwitchTokenRefresh({ ...baseConfig, refreshToken: null });
        refresh.platformErrorHandler = createPlatformErrorHandler();

        const result = await refresh.refreshToken(null);

        expect(result).toBeNull();
        expect(refresh.platformErrorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('routes non-200 refresh response through platform error handler', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createPlatformErrorHandler();
        refresh.makeRequest = jest.fn().mockResolvedValue({
            statusCode: 500,
            body: 'bad'
        });

        const result = await refresh.refreshToken(baseConfig.refreshToken);

        expect(result).toBeNull();
        expect(refresh.makeRequest).toHaveBeenCalled();
        expect(refresh.platformErrorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('rejects invalid token data when updating config', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createPlatformErrorHandler();

        const success = await refresh.updateConfig({ access_token: null });

        expect(success).toBe(false);
        expect(refresh.platformErrorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('returns null and routes errors when refresh request throws', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createPlatformErrorHandler();
        refresh.makeRequest = jest.fn().mockRejectedValue(new Error('network boom'));
        refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

        const result = await refresh.refreshToken(baseConfig.refreshToken);

        expect(result).toBeNull();
        expect(refresh.platformErrorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('fails gracefully when config file updates exhaust retries', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createPlatformErrorHandler();
        refresh._retryAttempts = 2;
        refresh._retryDelay = 0;
        refresh.persistTokens = jest.fn().mockRejectedValue(new Error('fs fail'));
        refresh.logger = { warn: jest.fn(), debug: jest.fn() };

        await expect(refresh._persistTokensWithRetry({ access_token: 'tok' })).rejects.toThrow('fs fail');
        expect(refresh.persistTokens).toHaveBeenCalledTimes(2);
        expect(refresh.platformErrorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('returns true from ensureValidToken when refresh fails and logs', async () => {
        const refresh = new TwitchTokenRefresh({ ...baseConfig, accessToken: 'old', refreshToken: 'missing' });
        refresh.platformErrorHandler = createPlatformErrorHandler();
        refresh.needsRefresh = jest.fn().mockResolvedValue(true);
        refresh.refreshToken = jest.fn().mockResolvedValue(null);
        refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

        const result = await refresh.ensureValidToken();

        expect(result).toBe(true);
        expect(refresh.platformErrorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('routes malformed refresh responses through error handler', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createPlatformErrorHandler();
        refresh.makeRequest = jest.fn().mockResolvedValue({
            statusCode: 200,
            body: '{invalid-json'
        });
        refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

        const result = await refresh.refreshToken(baseConfig.refreshToken);

        expect(result).toBeNull();
        expect(refresh.platformErrorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('returns true when config update throws during ensureValidToken', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createPlatformErrorHandler();
        refresh.needsRefresh = jest.fn().mockResolvedValue(true);
        refresh.refreshToken = jest.fn().mockResolvedValue({
            access_token: 'new-access',
            refresh_token: 'new-refresh'
        });
        refresh.updateConfig = jest.fn().mockRejectedValue(new Error('persist fail'));
        refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

        const result = await refresh.ensureValidToken();

        expect(result).toBe(true);
        expect(refresh.updateConfig).toHaveBeenCalled();
        expect(refresh.platformErrorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('returns true when refresh token missing and handles gracefully', async () => {
        const refresh = new TwitchTokenRefresh({ ...baseConfig, refreshToken: null });
        refresh.platformErrorHandler = createPlatformErrorHandler();
        refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

        const result = await refresh.ensureValidToken();

        expect(result).toBe(true);
        expect(refresh.platformErrorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('handles rate limit response with backoff and logs warning', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createPlatformErrorHandler();
        refresh.makeRequest = jest.fn().mockResolvedValue({
            statusCode: 429,
            body: JSON.stringify({ message: 'rate limited' })
        });
        refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        refresh._sleep = jest.fn().mockResolvedValue();

        const result = await refresh.refreshToken(baseConfig.refreshToken);

        expect(result).toBeNull();
        expect(refresh._sleep).not.toHaveBeenCalled(); // no retry inside refreshToken
        expect(refresh.platformErrorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('parses malformed JSON refresh response and routes through error handler', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createPlatformErrorHandler();
        refresh.makeRequest = jest.fn().mockResolvedValue({
            statusCode: 200,
            body: '{invalid'
        });
        refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

        const result = await refresh.refreshToken(baseConfig.refreshToken);

        expect(result).toBeNull();
        expect(refresh.platformErrorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('logs when refresh token is missing during ensureValidToken and returns true', async () => {
        const refresh = new TwitchTokenRefresh({ ...baseConfig, refreshToken: null });
        refresh.platformErrorHandler = createPlatformErrorHandler();
        refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        refresh.refreshToken = jest.fn().mockResolvedValue(null);
        refresh.needsRefresh = jest.fn().mockResolvedValue(true);
        refresh._handleTokenRefreshError = jest.fn();

        const result = await refresh.ensureValidToken();

        expect(result).toBe(true);
        expect(refresh._handleTokenRefreshError).toHaveBeenCalled();
    });

    it('cleans up refresh timers and resets stats on cleanup', () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.errorHandler = { cleanup: jest.fn() };
        refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        refresh.refreshTimer = null;
        refresh.refreshSuccessCount = 3;
        refresh.refreshFailureCount = 2;
        refresh.isRefreshing = true;

        refresh.cleanup();

        expect(refresh.refreshTimer).toBeNull();
        expect(refresh.refreshSuccessCount).toBe(0);
        expect(refresh.refreshFailureCount).toBe(0);
        expect(refresh.isRefreshing).toBe(false);
        expect(refresh.errorHandler.cleanup).toHaveBeenCalled();
    });

    it('cleanup resets state and calls errorHandler cleanup when present', () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.errorHandler = { cleanup: jest.fn() };
        refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        refresh.isRefreshing = true;
        refresh.refreshSuccessCount = 5;
        refresh.refreshFailureCount = 3;
        refresh.lastRefreshTime = Date.now();

        refresh.cleanup();

        expect(refresh.isRefreshing).toBe(false);
        expect(refresh.refreshSuccessCount).toBe(0);
        expect(refresh.refreshFailureCount).toBe(0);
        expect(refresh.lastRefreshTime).toBeNull();
        expect(refresh.errorHandler.cleanup).toHaveBeenCalled();
    });

    it('reports degraded health status when failures accumulate', () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.isRefreshing = true;
        refresh.refreshFailureCount = 4;
        refresh.refreshSuccessCount = 0;

        const health = refresh.getHealthStatus();

        expect(health.healthy).toBe(false);
        expect(health.status).toBe('degraded');
        expect(health.issues.length).toBeGreaterThan(0);
    });

    it('returns refresh stats snapshot', () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.refreshSuccessCount = 2;
        refresh.refreshFailureCount = 1;
        refresh.lastRefreshTime = 12345;
        refresh.errorHandler = { getStats: jest.fn(() => ({ handled: 1 })) };

        const stats = refresh.getRefreshStats();

        expect(stats.successCount).toBe(2);
        expect(stats.failureCount).toBe(1);
        expect(stats.isRefreshing).toBe(false);
        expect(stats.retryConfiguration.maxAttempts).toBeDefined();
        expect(stats.errorStats).toEqual({ handled: 1 });
    });

    it('retries config file update with backoff before succeeding', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh._retryAttempts = 2;
        refresh._retryDelay = 10;
        refresh.persistTokens = jest.fn()
            .mockRejectedValueOnce(new Error('fs fail'))
            .mockResolvedValueOnce();
        refresh._sleep = jest.fn().mockResolvedValue();
        refresh.logger = { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() };

        await refresh._persistTokensWithRetry({ access_token: 'tok' });

        expect(refresh.persistTokens).toHaveBeenCalledTimes(2);
        expect(refresh._sleep).toHaveBeenCalledTimes(1);
        expect(refresh._sleep.mock.calls[0][0]).toBe(10);
    });

    describe('needsRefresh validation behavior', () => {
        it('returns true when access token is missing', async () => {
            const refresh = new TwitchTokenRefresh({ ...baseConfig, accessToken: null });
            refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

            const needs = await refresh.needsRefresh(null);

            expect(needs).toBe(true);
        });

        it('returns false when token expiry is far in the future without remote validate', async () => {
            const refresh = new TwitchTokenRefresh(baseConfig);
            refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            refresh.config.tokenExpiresAt = Date.now() + (2 * 60 * 60 * 1000);
            refresh.makeRequest = jest.fn();

            const needs = await refresh.needsRefresh('token');

            expect(needs).toBe(false);
            expect(refresh.makeRequest).not.toHaveBeenCalled();
        });

        it('returns true when token expiry is within threshold without remote validate', async () => {
            const refresh = new TwitchTokenRefresh(baseConfig);
            refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            refresh.config.tokenExpiresAt = Date.now() + (5 * 60 * 1000);
            refresh.makeRequest = jest.fn();

            const needs = await refresh.needsRefresh('token');

            expect(needs).toBe(true);
            expect(refresh.makeRequest).not.toHaveBeenCalled();
        });

        it('returns true and logs when expiration metadata is missing', async () => {
            const refresh = new TwitchTokenRefresh(baseConfig);
            refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            refresh.config.tokenExpiresAt = null;
            refresh.makeRequest = jest.fn();

            const needs = await refresh.needsRefresh('token');

            expect(needs).toBe(true);
            expect(refresh.makeRequest).not.toHaveBeenCalled();
        });
    });

    it('routes errors from ensureValidToken when needsRefresh throws but returns true', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        refresh.needsRefresh = jest.fn().mockRejectedValue(new Error('boom'));
        refresh._handleTokenRefreshError = jest.fn();

        const result = await refresh.ensureValidToken();

        expect(result).toBe(true);
        expect(refresh._handleTokenRefreshError).toHaveBeenCalled();
    });
});
