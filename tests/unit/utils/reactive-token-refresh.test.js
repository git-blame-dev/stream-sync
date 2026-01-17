const { describe, test, expect, beforeEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const ReactiveTokenRefresh = require('../../../src/utils/reactive-token-refresh');
const { TokenRefreshError, NetworkError } = require('../../../src/utils/auth-errors');

describe('ReactiveTokenRefresh', () => {
    let mockErrorHandler;
    let mockPlatformErrorHandler;
    let mockAuthErrorFactory;
    let MockErrorHandlerClass;

    beforeEach(() => {
        mockErrorHandler = {
            handleError: createMockFn(async (error) => { throw error; }),
            getStats: createMockFn(() => ({})),
            cleanup: createMockFn()
        };
        MockErrorHandlerClass = createMockFn(() => mockErrorHandler);

        mockPlatformErrorHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };

        mockAuthErrorFactory = {
            categorizeError: createMockFn((error) => error),
            createTokenRefreshError: createMockFn((error) => new TokenRefreshError(error.message, {
                category: 'refresh_error',
                code: error.code,
                recoverable: false
            }))
        };
    });

    function createReactiveRefresh(config, extraDeps = {}) {
        return new ReactiveTokenRefresh(config, {
            logger: noOpLogger,
            ErrorHandler: MockErrorHandlerClass,
            createPlatformErrorHandler: () => mockPlatformErrorHandler,
            AuthErrorFactory: mockAuthErrorFactory,
            ...extraDeps
        });
    }

    test('returns successful response without refresh when API call succeeds', async () => {
        const config = { accessToken: 'testOldToken', refreshToken: 'testRefreshToken' };
        const reactive = createReactiveRefresh(config);
        const apiCall = createMockFn().mockResolvedValue({ ok: true });

        const result = await reactive.wrapApiCall(apiCall, 'fetch-data');

        expect(result).toEqual({ success: true, response: { ok: true }, refreshed: false });
        expect(reactive.metrics.totalCalls).toBe(1);
        expect(reactive.metrics.refreshAttempts).toBe(0);
    });

    test('attempts refresh on 401 and retries successfully with updated tokens', async () => {
        const refreshInstance = {
            refreshToken: createMockFn().mockResolvedValue({
                access_token: 'testNewToken',
                refresh_token: 'testNewRefresh'
            }),
            updateConfig: createMockFn().mockResolvedValue(true)
        };
        const TwitchTokenRefresh = createMockFn(() => refreshInstance);
        const config = { accessToken: 'testOldToken', refreshToken: 'testRefreshToken' };
        const reactive = createReactiveRefresh(config, { TwitchTokenRefresh });
        const apiCall = createMockFn()
            .mockRejectedValueOnce({ response: { status: 401 } })
            .mockResolvedValueOnce({ ok: true });

        const result = await reactive.wrapApiCall(apiCall, 'needs-refresh');

        expect(result).toEqual({ success: true, response: { ok: true }, refreshed: true });
        expect(config.accessToken).toBe('testNewToken');
        expect(config.refreshToken).toBe('testNewRefresh');
        expect(reactive.metrics.refreshAttempts).toBe(1);
        expect(reactive.metrics.successfulRefreshes).toBe(1);
    });

    test('fails gracefully when refresh API returns null', async () => {
        const refreshInstance = {
            refreshToken: createMockFn().mockResolvedValue(null),
            updateConfig: createMockFn()
        };
        const TwitchTokenRefresh = createMockFn(() => refreshInstance);
        const config = { accessToken: 'testOldToken', refreshToken: 'testRefreshToken' };
        const reactive = createReactiveRefresh(config, { TwitchTokenRefresh });
        const apiCall = createMockFn().mockRejectedValue({ response: { status: 401 } });

        await expect(reactive.wrapApiCall(apiCall, 'null-refresh')).rejects.toBeInstanceOf(TokenRefreshError);
        expect(reactive.metrics.failedRefreshes).toBe(1);
    });

    test('fails when refresh returns identical token', async () => {
        const refreshInstance = {
            refreshToken: createMockFn().mockResolvedValue({
                access_token: 'testSameToken',
                refresh_token: 'testRefreshToken'
            }),
            updateConfig: createMockFn().mockResolvedValue(false)
        };
        const TwitchTokenRefresh = createMockFn(() => refreshInstance);
        const config = { accessToken: 'testSameToken', refreshToken: 'testRefreshToken' };
        const reactive = createReactiveRefresh(config, { TwitchTokenRefresh });
        const apiCall = createMockFn().mockRejectedValue({ response: { status: 401 } });

        await expect(reactive.wrapApiCall(apiCall, 'same-token')).rejects.toBeInstanceOf(TokenRefreshError);
        expect(reactive.metrics.failedRefreshes).toBeGreaterThanOrEqual(1);
    });

    test('does not retry refresh more than once on repeated 401', async () => {
        const refreshInstance = {
            refreshToken: createMockFn().mockResolvedValue({
                access_token: 'testNewToken',
                refresh_token: 'testNewRefresh'
            }),
            updateConfig: createMockFn().mockResolvedValue(true)
        };
        const TwitchTokenRefresh = createMockFn(() => refreshInstance);
        const config = { accessToken: 'testOldToken', refreshToken: 'testRefreshToken' };
        const reactive = createReactiveRefresh(config, { TwitchTokenRefresh });
        const apiCall = createMockFn()
            .mockRejectedValueOnce({ response: { status: 401 } })
            .mockRejectedValueOnce({ response: { status: 401 } });

        await expect(reactive.wrapApiCall(apiCall, 'retry-401')).rejects.toBeInstanceOf(Error);
        expect(reactive.metrics.refreshAttempts).toBe(1);
        expect(reactive.metrics.failedRefreshes).toBe(0);
    });

    test('surfaces error when no refresh token is available', async () => {
        const config = { accessToken: 'testOld', refreshToken: null };
        const reactive = createReactiveRefresh(config);
        const apiCall = createMockFn().mockRejectedValue({ response: { status: 401 } });

        await expect(reactive.wrapApiCall(apiCall, 'missing-refresh')).rejects.toBeInstanceOf(TokenRefreshError);
        expect(reactive.metrics.refreshAttempts).toBe(0);
        expect(reactive.metrics.failedRefreshes).toBe(0);
    });

    test('bubbles network errors without attempting refresh', async () => {
        const config = { accessToken: 'testOld', refreshToken: 'testRefresh' };
        const networkError = new NetworkError('network down', { code: 'ECONNRESET' });
        mockAuthErrorFactory.categorizeError.mockImplementation(() => networkError);
        const reactive = createReactiveRefresh(config);
        const apiCall = createMockFn().mockRejectedValue(networkError);

        await expect(reactive.wrapApiCall(apiCall, 'network-call')).rejects.toBe(networkError);
        expect(reactive.metrics.refreshAttempts).toBe(0);
    });

    test('throws when retry after refresh still returns 401', async () => {
        const refreshInstance = {
            refreshToken: createMockFn().mockResolvedValue({
                access_token: 'testNewToken',
                refresh_token: 'testNewRefresh'
            }),
            updateConfig: createMockFn().mockResolvedValue(true)
        };
        const TwitchTokenRefresh = createMockFn(() => refreshInstance);
        const config = { accessToken: 'testOld', refreshToken: 'testRefresh' };
        const reactive = createReactiveRefresh(config, { TwitchTokenRefresh });
        const apiCall = createMockFn()
            .mockRejectedValueOnce({ response: { status: 401 } })
            .mockRejectedValueOnce({ response: { status: 401 } });

        await expect(reactive.wrapApiCall(apiCall, 'retry-still-401')).rejects.toBeInstanceOf(Error);
    });

    test('throws when retry after refresh fails with non-401 error', async () => {
        const refreshInstance = {
            refreshToken: createMockFn().mockResolvedValue({
                access_token: 'testNewToken',
                refresh_token: 'testNewRefresh'
            }),
            updateConfig: createMockFn().mockResolvedValue(true)
        };
        const TwitchTokenRefresh = createMockFn(() => refreshInstance);
        const config = { accessToken: 'testOld', refreshToken: 'testRefresh' };
        const reactive = createReactiveRefresh(config, { TwitchTokenRefresh });
        const retryError = new Error('upstream 500');
        const apiCall = createMockFn()
            .mockRejectedValueOnce({ response: { status: 401 } })
            .mockRejectedValueOnce(retryError);

        await expect(reactive.wrapApiCall(apiCall, 'retry-non-401')).rejects.toBe(retryError);
    });

    test('returns handled result when error handler resolves', async () => {
        mockErrorHandler.handleError.mockImplementation(async () => ({ handled: true }));
        const config = { accessToken: 'testOld', refreshToken: 'testRefresh' };
        const reactive = createReactiveRefresh(config);
        const apiCall = createMockFn().mockRejectedValue(new Error('boom'));

        const result = await reactive.wrapApiCall(apiCall, 'handled-error');

        expect(result).toEqual({ handled: true });
    });

    test('routes refresh failures through error handling and increments metrics', async () => {
        const TwitchTokenRefresh = createMockFn(() => ({
            refreshToken: createMockFn().mockRejectedValue(new Error('refresh failed'))
        }));
        const config = { accessToken: 'testOld', refreshToken: 'testRefresh' };
        const reactive = createReactiveRefresh(config, { TwitchTokenRefresh });
        const apiCall = createMockFn().mockRejectedValue({ response: { status: 401 } });

        const caught = await reactive.wrapApiCall(apiCall, 'refresh-failure').catch(err => err);
        expect(caught).toBeInstanceOf(TokenRefreshError);
        expect(reactive.metrics.failedRefreshes).toBe(1);
    });

    test('logs operational errors for non-Error refresh issues', () => {
        const config = { accessToken: 'testOld', refreshToken: 'testRefresh' };
        const reactive = createReactiveRefresh(config);

        reactive._logReactiveRefreshError('op-error', null, { context: true }, 'reactive-token-refresh', 'token-refresh');

        expect(mockPlatformErrorHandler.logOperationalError).toHaveBeenCalled();
    });

    test('reports metrics and resets cleanly', () => {
        const config = { accessToken: 'testOld', refreshToken: 'testRefresh' };
        const reactive = createReactiveRefresh(config);
        reactive.metrics = { totalCalls: 5, refreshAttempts: 2, successfulRefreshes: 1, failedRefreshes: 1 };

        const metrics = reactive.getMetrics();
        expect(metrics.refreshSuccessRate).toBeGreaterThan(0);

        reactive.resetMetrics();
        expect(reactive.metrics.totalCalls).toBe(0);
        expect(mockErrorHandler.cleanup).toHaveBeenCalled();
    });

    test('creates platform error handler when logging refresh errors without existing handler', () => {
        let handlerCreated = false;
        const config = { accessToken: 'testOld', refreshToken: 'testRefresh' };
        const reactive = new ReactiveTokenRefresh(config, {
            logger: noOpLogger,
            ErrorHandler: MockErrorHandlerClass,
            createPlatformErrorHandler: () => {
                handlerCreated = true;
                return mockPlatformErrorHandler;
            },
            AuthErrorFactory: mockAuthErrorFactory
        });
        reactive.platformErrorHandler = null;
        const error = new Error('refresh boom');

        reactive._logReactiveRefreshError('msg', error, { ctx: true }, 'reactive-token-refresh', 'token-refresh');

        expect(handlerCreated).toBe(true);
        expect(mockPlatformErrorHandler.handleEventProcessingError).toHaveBeenCalledWith(
            error,
            'token-refresh',
            { ctx: true },
            'msg',
            'reactive-token-refresh'
        );
    });
});
