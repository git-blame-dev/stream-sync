const { describe, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const testClock = require('../../helpers/test-clock');
const TwitchTokenRefresh = require('../../../src/utils/twitch-token-refresh');

describe('TwitchTokenRefresh behavior edges', () => {
    const baseConfig = {
        clientId: 'testClientId',
        clientSecret: 'testClientSecret',
        accessToken: 'testOldAccessToken',
        refreshToken: 'testRefreshToken',
        tokenStorePath: '/test/token-store.json'
    };

    let dateNowSpy;

    const noOpLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

    const createMockErrorHandler = () => ({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn()
    });

    beforeEach(() => {
        dateNowSpy = spyOn(Date, 'now').mockImplementation(() => testClock.now());
    });

    afterEach(() => {
        restoreAllMocks();
        if (dateNowSpy) {
            dateNowSpy.mockRestore();
        }
    });

    it('returns null when refresh token is missing', async () => {
        const refresh = new TwitchTokenRefresh({ ...baseConfig, refreshToken: null });
        refresh.platformErrorHandler = createMockErrorHandler();
        refresh.logger = noOpLogger;

        const result = await refresh.refreshToken(null);

        expect(result).toBeNull();
    });

    it('returns null when refresh request returns non-200', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createMockErrorHandler();
        refresh.logger = noOpLogger;
        refresh.makeRequest = createMockFn().mockResolvedValue({
            statusCode: 500,
            body: 'bad'
        });

        const result = await refresh.refreshToken(baseConfig.refreshToken);

        expect(result).toBeNull();
    });

    it('returns false when updating config with invalid token data', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createMockErrorHandler();
        refresh.logger = noOpLogger;

        const success = await refresh.updateConfig({ access_token: null });

        expect(success).toBe(false);
    });

    it('returns null when refresh request throws', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createMockErrorHandler();
        refresh.logger = noOpLogger;
        refresh.makeRequest = createMockFn().mockRejectedValue(new Error('network boom'));

        const result = await refresh.refreshToken(baseConfig.refreshToken);

        expect(result).toBeNull();
    });

    it('throws when config file updates exhaust retries', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createMockErrorHandler();
        refresh.logger = noOpLogger;
        refresh._retryAttempts = 2;
        refresh._retryDelay = 0;
        refresh.persistTokens = createMockFn().mockRejectedValue(new Error('fs fail'));

        await expect(refresh._persistTokensWithRetry({ access_token: 'tok' })).rejects.toThrow('fs fail');
        expect(refresh.persistTokens).toHaveBeenCalledTimes(2);
    });

    it('returns true from ensureValidToken when refresh fails', async () => {
        const refresh = new TwitchTokenRefresh({ ...baseConfig, accessToken: 'old', refreshToken: 'missing' });
        refresh.platformErrorHandler = createMockErrorHandler();
        refresh.logger = noOpLogger;
        refresh.needsRefresh = createMockFn().mockResolvedValue(true);
        refresh.refreshToken = createMockFn().mockResolvedValue(null);

        const result = await refresh.ensureValidToken();

        expect(result).toBe(true);
    });

    it('returns null when refresh response has malformed JSON', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createMockErrorHandler();
        refresh.logger = noOpLogger;
        refresh.makeRequest = createMockFn().mockResolvedValue({
            statusCode: 200,
            body: '{invalid-json'
        });

        const result = await refresh.refreshToken(baseConfig.refreshToken);

        expect(result).toBeNull();
    });

    it('returns true when config update throws during ensureValidToken', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createMockErrorHandler();
        refresh.logger = noOpLogger;
        refresh.needsRefresh = createMockFn().mockResolvedValue(true);
        refresh.refreshToken = createMockFn().mockResolvedValue({
            access_token: 'new-access',
            refresh_token: 'new-refresh'
        });
        refresh.updateConfig = createMockFn().mockRejectedValue(new Error('persist fail'));

        const result = await refresh.ensureValidToken();

        expect(result).toBe(true);
    });

    it('returns true when refresh token missing during ensureValidToken', async () => {
        const refresh = new TwitchTokenRefresh({ ...baseConfig, refreshToken: null });
        refresh.platformErrorHandler = createMockErrorHandler();
        refresh.logger = noOpLogger;

        const result = await refresh.ensureValidToken();

        expect(result).toBe(true);
    });

    it('returns null on rate limit response', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.platformErrorHandler = createMockErrorHandler();
        refresh.logger = noOpLogger;
        refresh.makeRequest = createMockFn().mockResolvedValue({
            statusCode: 429,
            body: JSON.stringify({ message: 'rate limited' })
        });
        refresh._sleep = createMockFn().mockResolvedValue();

        const result = await refresh.refreshToken(baseConfig.refreshToken);

        expect(result).toBeNull();
    });

    it('cleans up refresh timers and resets stats on cleanup', () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.errorHandler = { cleanup: createMockFn() };
        refresh.logger = noOpLogger;
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
        refresh.errorHandler = { getStats: createMockFn(() => ({ handled: 1 })) };

        const stats = refresh.getRefreshStats();

        expect(stats.successCount).toBe(2);
        expect(stats.failureCount).toBe(1);
        expect(stats.isRefreshing).toBe(false);
        expect(stats.retryConfiguration.maxAttempts).toBeDefined();
        expect(stats.errorStats).toEqual({ handled: 1 });
    });

    it('retries config file update with backoff before succeeding', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.logger = noOpLogger;
        refresh._retryAttempts = 2;
        refresh._retryDelay = 10;
        refresh.persistTokens = createMockFn()
            .mockRejectedValueOnce(new Error('fs fail'))
            .mockResolvedValueOnce();
        refresh._sleep = createMockFn().mockResolvedValue();

        await refresh._persistTokensWithRetry({ access_token: 'tok' });

        expect(refresh.persistTokens).toHaveBeenCalledTimes(2);
        expect(refresh._sleep).toHaveBeenCalledTimes(1);
        expect(refresh._sleep.mock.calls[0][0]).toBe(10);
    });

    describe('needsRefresh validation behavior', () => {
        it('returns true when access token is missing', async () => {
            const refresh = new TwitchTokenRefresh({ ...baseConfig, accessToken: null });
            refresh.logger = noOpLogger;

            const needs = await refresh.needsRefresh(null);

            expect(needs).toBe(true);
        });

        it('returns false when token expiry is far in the future', async () => {
            const refresh = new TwitchTokenRefresh(baseConfig);
            refresh.logger = noOpLogger;
            refresh.config.tokenExpiresAt = testClock.now() + (2 * 60 * 60 * 1000);
            refresh.makeRequest = createMockFn();

            const needs = await refresh.needsRefresh('token');

            expect(needs).toBe(false);
            expect(refresh.makeRequest).not.toHaveBeenCalled();
        });

        it('returns true when token expiry is within threshold', async () => {
            const refresh = new TwitchTokenRefresh(baseConfig);
            refresh.logger = noOpLogger;
            refresh.config.tokenExpiresAt = testClock.now() + (5 * 60 * 1000);
            refresh.makeRequest = createMockFn();

            const needs = await refresh.needsRefresh('token');

            expect(needs).toBe(true);
            expect(refresh.makeRequest).not.toHaveBeenCalled();
        });

        it('returns true when expiration metadata is missing', async () => {
            const refresh = new TwitchTokenRefresh(baseConfig);
            refresh.logger = noOpLogger;
            refresh.config.tokenExpiresAt = null;
            refresh.makeRequest = createMockFn();

            const needs = await refresh.needsRefresh('token');

            expect(needs).toBe(true);
            expect(refresh.makeRequest).not.toHaveBeenCalled();
        });
    });

    it('returns true from ensureValidToken when needsRefresh throws', async () => {
        const refresh = new TwitchTokenRefresh(baseConfig);
        refresh.logger = noOpLogger;
        refresh.platformErrorHandler = createMockErrorHandler();
        refresh.needsRefresh = createMockFn().mockRejectedValue(new Error('boom'));

        const result = await refresh.ensureValidToken();

        expect(result).toBe(true);
    });
});
