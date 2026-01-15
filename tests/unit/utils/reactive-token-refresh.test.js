
const { describe, test, expect, beforeEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: createMockFn(() => ({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn()
    }))
}));

const mockHandleError = createMockFn(async (error) => { throw error; });
const mockCategorizeError = createMockFn((error) => error);

mockModule('../../../src/utils/auth-errors', () => {
    const TokenRefreshError = class extends Error {
        constructor(message, options = {}) {
            super(message);
            this.name = 'TokenRefreshError';
            this.category = options.category;
            this.code = options.code;
            this.needsNewTokens = options.needsNewTokens;
            this.recoverable = options.recoverable;
        }
    };

    const NetworkError = class extends Error {
        constructor(message, options = {}) {
            super(message);
            this.name = 'NetworkError';
            this.code = options.code;
        }
    };

    const AuthError = class extends Error {};

    const AuthErrorFactory = {
        categorizeError: mockCategorizeError,
        createTokenRefreshError: createMockFn((error) => new TokenRefreshError(error.message, {
            category: 'refresh_error',
            code: error.code,
            recoverable: false
        }))
    };

    class ErrorHandler {
        constructor() {
            this.handleError = mockHandleError;
        }
        getStats() { return {}; }
        cleanup() {}
    }

    return {
        AuthErrorFactory,
        TokenRefreshError,
        NetworkError,
        AuthError,
        ErrorHandler
    };
});

const { AuthErrorFactory, TokenRefreshError, NetworkError } = require('../../../src/utils/auth-errors');
const ReactiveTokenRefresh = require('../../../src/utils/reactive-token-refresh');
const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');

describe('ReactiveTokenRefresh', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    const logger = {
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn()
    };

    beforeEach(() => {
        mockHandleError.mockImplementation(async (error) => { throw error; });
        mockCategorizeError.mockImplementation((error) => error);
        AuthErrorFactory.createTokenRefreshError.mockImplementation((error) => new TokenRefreshError(error.message, {
            category: 'refresh_error',
            code: error.code,
            recoverable: false
        }));
        createPlatformErrorHandler.mockImplementation(() => ({
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        }));
    });

    it('returns successful response without refresh when API call succeeds', async () => {
        const config = { accessToken: 'old', refreshToken: 'refresh' };
        const TwitchTokenRefresh = createMockFn();
        const reactive = new ReactiveTokenRefresh(config, { logger, TwitchTokenRefresh });
        const apiCall = createMockFn().mockResolvedValue({ ok: true });

        const result = await reactive.wrapApiCall(apiCall, 'fetch-data');

        expect(result).toEqual({ success: true, response: { ok: true }, refreshed: false });
        expect(reactive.metrics.totalCalls).toBe(1);
        expect(reactive.metrics.refreshAttempts).toBe(0);
    });

    it('attempts refresh on 401 and retries successfully with updated tokens', async () => {
        const refreshInstance = {
            refreshToken: createMockFn().mockResolvedValue({
                access_token: 'new-token',
                refresh_token: 'new-refresh'
            }),
            updateConfig: createMockFn().mockResolvedValue(true)
        };
        const TwitchTokenRefresh = createMockFn(() => refreshInstance);
        const config = { accessToken: 'old-token', refreshToken: 'refresh-token' };
        const reactive = new ReactiveTokenRefresh(config, { logger, TwitchTokenRefresh });
        const apiCall = createMockFn()
            .mockRejectedValueOnce({ response: { status: 401 } })
            .mockResolvedValueOnce({ ok: true });

        const result = await reactive.wrapApiCall(apiCall, 'needs-refresh');

        expect(refreshInstance.refreshToken).toHaveBeenCalledWith('refresh-token');
        expect(refreshInstance.updateConfig).toHaveBeenCalled();
        expect(result).toEqual({ success: true, response: { ok: true }, refreshed: true });
        expect(config.accessToken).toBe('new-token');
        expect(config.refreshToken).toBe('new-refresh');
        expect(reactive.metrics.refreshAttempts).toBe(1);
        expect(reactive.metrics.successfulRefreshes).toBe(1);
    });

    it('fails gracefully when refresh API returns null', async () => {
        const refreshInstance = {
            refreshToken: createMockFn().mockResolvedValue(null),
            updateConfig: createMockFn()
        };
        const TwitchTokenRefresh = createMockFn(() => refreshInstance);
        const config = { accessToken: 'old-token', refreshToken: 'refresh-token' };
        const reactive = new ReactiveTokenRefresh(config, { logger, TwitchTokenRefresh });
        const apiCall = createMockFn().mockRejectedValue({ response: { status: 401 } });

        await expect(reactive.wrapApiCall(apiCall, 'null-refresh')).rejects.toBeInstanceOf(TokenRefreshError);
        expect(refreshInstance.refreshToken).toHaveBeenCalled();
        expect(reactive.metrics.failedRefreshes).toBe(1);
    });

    it('fails when refresh returns identical token or config update fails', async () => {
        const refreshInstance = {
            refreshToken: createMockFn().mockResolvedValue({
                access_token: 'same-token',
                refresh_token: 'refresh-token'
            }),
            updateConfig: createMockFn().mockResolvedValue(false)
        };
        const TwitchTokenRefresh = createMockFn(() => refreshInstance);
        const config = { accessToken: 'same-token', refreshToken: 'refresh-token' };
        const reactive = new ReactiveTokenRefresh(config, { logger, TwitchTokenRefresh });
        const apiCall = createMockFn().mockRejectedValue({ response: { status: 401 } });

        await expect(reactive.wrapApiCall(apiCall, 'same-token')).rejects.toBeInstanceOf(TokenRefreshError);
        expect(reactive.metrics.failedRefreshes).toBeGreaterThanOrEqual(1);
    });

    it('does not retry refresh more than once on repeated 401', async () => {
        const refreshInstance = {
            refreshToken: createMockFn().mockResolvedValue({
                access_token: 'new-token',
                refresh_token: 'new-refresh'
            }),
            updateConfig: createMockFn().mockResolvedValue(true)
        };
        const TwitchTokenRefresh = createMockFn(() => refreshInstance);
        const config = { accessToken: 'old-token', refreshToken: 'refresh-token' };
        const reactive = new ReactiveTokenRefresh(config, { logger, TwitchTokenRefresh });
        const apiCall = createMockFn()
            .mockRejectedValueOnce({ response: { status: 401 } })
            .mockRejectedValueOnce({ response: { status: 401 } });

        await expect(reactive.wrapApiCall(apiCall, 'retry-401')).rejects.toBeInstanceOf(Error);
        expect(refreshInstance.refreshToken).toHaveBeenCalledTimes(1);
        expect(reactive.metrics.refreshAttempts).toBe(1);
        expect(reactive.metrics.failedRefreshes).toBe(0);
    });

    it('surfaces friendly error when no refresh token is available', async () => {
        const config = { accessToken: 'old', refreshToken: null };
        const reactive = new ReactiveTokenRefresh(config, { logger, TwitchTokenRefresh: createMockFn() });
        reactive.platformErrorHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
        const apiCall = createMockFn().mockRejectedValue({ response: { status: 401 } });

        await expect(reactive.wrapApiCall(apiCall, 'missing-refresh')).rejects.toBeInstanceOf(TokenRefreshError);
        expect(reactive.metrics.refreshAttempts).toBe(0);
        expect(reactive.metrics.failedRefreshes).toBe(0);
    });

    it('bubbles network errors without attempting refresh', async () => {
        const config = { accessToken: 'old', refreshToken: 'refresh' };
        const networkError = new NetworkError('network down', { code: 'ECONNRESET' });
        AuthErrorFactory.categorizeError.mockImplementation(() => networkError);
        const reactive = new ReactiveTokenRefresh(config, { logger, TwitchTokenRefresh: createMockFn() });
        reactive.platformErrorHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
        const apiCall = createMockFn().mockRejectedValue(networkError);

        await expect(reactive.wrapApiCall(apiCall, 'network-call')).rejects.toBe(networkError);
        expect(reactive.metrics.refreshAttempts).toBe(0);
        expect(mockHandleError).toHaveBeenCalled();
    });

    it('throws when retry after refresh still returns 401', async () => {
        const refreshInstance = {
            refreshToken: createMockFn().mockResolvedValue({
                access_token: 'new-token',
                refresh_token: 'new-refresh'
            }),
            updateConfig: createMockFn().mockResolvedValue(true)
        };
        const TwitchTokenRefresh = createMockFn(() => refreshInstance);
        const reactive = new ReactiveTokenRefresh({ accessToken: 'old', refreshToken: 'refresh' }, { logger, TwitchTokenRefresh });
        const apiCall = createMockFn()
            .mockRejectedValueOnce({ response: { status: 401 } })
            .mockRejectedValueOnce({ response: { status: 401 } });

        await expect(reactive.wrapApiCall(apiCall, 'retry-still-401')).rejects.toBeInstanceOf(Error);
        expect(refreshInstance.refreshToken).toHaveBeenCalledTimes(1);
    });

    it('logs and throws when retry after refresh fails with non-401 error', async () => {
        const refreshInstance = {
            refreshToken: createMockFn().mockResolvedValue({
                access_token: 'new-token',
                refresh_token: 'new-refresh'
            }),
            updateConfig: createMockFn().mockResolvedValue(true)
        };
        const TwitchTokenRefresh = createMockFn(() => refreshInstance);
        const reactive = new ReactiveTokenRefresh({ accessToken: 'old', refreshToken: 'refresh' }, { logger, TwitchTokenRefresh });
        reactive.platformErrorHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
        const retryError = new Error('upstream 500');
        const apiCall = createMockFn()
            .mockRejectedValueOnce({ response: { status: 401 } })
            .mockRejectedValueOnce(retryError);

        await expect(reactive.wrapApiCall(apiCall, 'retry-non-401')).rejects.toBe(retryError);
        expect(refreshInstance.refreshToken).toHaveBeenCalledTimes(1);
        expect(reactive.platformErrorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('returns handled result when error handler resolves', async () => {
        mockHandleError.mockImplementation(async () => ({ handled: true }));
        const reactive = new ReactiveTokenRefresh({ accessToken: 'old', refreshToken: 'refresh' }, { logger, TwitchTokenRefresh: createMockFn() });
        const apiCall = createMockFn().mockRejectedValue(new Error('boom'));

        const result = await reactive.wrapApiCall(apiCall, 'handled-error');

        expect(result).toEqual({ handled: true });
    });

    it('routes refresh failures through platform error handler and metrics', async () => {
        const errorHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
        createPlatformErrorHandler.mockReturnValueOnce(errorHandler);
        const TwitchTokenRefresh = createMockFn(() => ({
            refreshToken: createMockFn().mockRejectedValue(new Error('refresh failed'))
        }));
        const reactive = new ReactiveTokenRefresh(
            { accessToken: 'old', refreshToken: 'refresh' },
            { logger, TwitchTokenRefresh }
        );
        const apiCall = createMockFn().mockRejectedValue({ response: { status: 401 } });

        const caught = await reactive.wrapApiCall(apiCall, 'refresh-failure').catch(err => err);
        expect(caught).toBeInstanceOf(TokenRefreshError);
        expect(errorHandler.handleEventProcessingError).toHaveBeenCalled();
        expect(reactive.metrics.failedRefreshes).toBe(1);
    });

    it('logs operational errors for non-Error refresh issues', () => {
        const errorHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
        createPlatformErrorHandler.mockReturnValueOnce(errorHandler);
        const reactive = new ReactiveTokenRefresh(
            { accessToken: 'old', refreshToken: 'refresh' },
            { logger, TwitchTokenRefresh: createMockFn() }
        );

        reactive._logReactiveRefreshError('op-error', null, { context: true }, 'reactive-token-refresh', 'token-refresh');

        expect(errorHandler.logOperationalError).toHaveBeenCalled();
    });

    it('reports metrics and resets cleanly', () => {
        const reactive = new ReactiveTokenRefresh({ accessToken: 'old', refreshToken: 'refresh' }, { logger, TwitchTokenRefresh: createMockFn() });
        reactive.metrics = { totalCalls: 5, refreshAttempts: 2, successfulRefreshes: 1, failedRefreshes: 1 };
        reactive.errorHandler.cleanup = createMockFn();

        const metrics = reactive.getMetrics();
        expect(metrics.refreshSuccessRate).toBeGreaterThan(0);

        reactive.resetMetrics();
        expect(reactive.metrics.totalCalls).toBe(0);
        expect(reactive.errorHandler.cleanup).toHaveBeenCalled();
    });

    it('creates platform error handler when logging refresh errors without existing handler', () => {
        const handler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
        createPlatformErrorHandler.mockReturnValueOnce(handler);
        const reactive = new ReactiveTokenRefresh({ accessToken: 'old', refreshToken: 'refresh' }, { logger, TwitchTokenRefresh: createMockFn() });
        reactive.platformErrorHandler = null;
        const error = new Error('refresh boom');

        reactive._logReactiveRefreshError('msg', error, { ctx: true }, 'reactive-token-refresh', 'token-refresh');

        expect(createPlatformErrorHandler).toHaveBeenCalled();
        const createdHandler = createPlatformErrorHandler.mock.results[createPlatformErrorHandler.mock.calls.length - 1].value;
        expect(createdHandler.handleEventProcessingError).toHaveBeenCalledWith(error, 'token-refresh', { ctx: true }, 'msg', 'reactive-token-refresh');
    });
});
