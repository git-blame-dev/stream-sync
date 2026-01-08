
jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: jest.fn(() => ({
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    }))
}));

const {
    AuthError,
    TokenRefreshError,
    ApiCallError,
    ConfigError,
    NetworkError,
    AuthErrorFactory,
    ErrorRecoveryStrategy,
    ErrorMonitor,
    ErrorHandler
} = require('../../../src/utils/auth-errors');

describe('auth-errors behavior', () => {
    it('categorizes HTTP errors by status', () => {
        const error401 = { response: { status: 401 }, config: { url: '/x', method: 'GET' } };
        const error429 = { response: { status: 429 }, config: { url: '/y', method: 'POST' } };
        const err401 = AuthErrorFactory.categorizeError(error401, { operation: 'token_refresh' });
        const err429 = AuthErrorFactory.categorizeError(error429, {});

        expect(err401).toBeInstanceOf(TokenRefreshError);
        expect(err401.needsRefresh).toBe(true);
        expect(err429).toBeInstanceOf(ApiCallError);
        expect(err429.retryable).toBe(true);
    });

    it('categorizes network errors by code', () => {
        const err = AuthErrorFactory.categorizeError({ code: 'ECONNREFUSED', message: 'fail' });

        expect(err).toBeInstanceOf(NetworkError);
        expect(err.retryable).toBe(true);
    });

    it('categorizes config errors by message', () => {
        const err = AuthErrorFactory.categorizeError(new Error('Missing required token'), {});

        expect(err).toBeInstanceOf(ConfigError);
        expect(err.recoverable).toBe(false);
    });

    it('creates token refresh error based on status codes', () => {
        const err400 = AuthErrorFactory.createTokenRefreshError({ response: { status: 400 } }, { attempt: 1 });
        const err401 = AuthErrorFactory.createTokenRefreshError({ response: { status: 401 } }, { attempt: 2 });

        expect(err400.needsNewTokens).toBe(true);
        expect(err401.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('returns retry strategy for network and rate limit errors', async () => {
        const netError = new NetworkError('net', { code: 'ECONNRESET' });
        const strategy = ErrorRecoveryStrategy.getStrategy(netError);

        expect(strategy.type).toBe('retry');

        const rateLimited = new ApiCallError('rate', { originalError: { response: { status: 429, headers: { 'retry-after': '1' } } } });
        const backoff = ErrorRecoveryStrategy.getStrategy(rateLimited);

        expect(backoff.type).toBe('rate_limit_backoff');
    });

    it('tracks error monitor stats and cleanup', async () => {
        const monitor = new ErrorMonitor();
        const networkError = new NetworkError('net');

        monitor.recordError(new AuthError('a'), { duration: 10 });
        monitor.recordError(networkError);
        monitor.recordRecovery(networkError, true, { duration: 5 });

        const stats = monitor.getStats();

        expect(stats.totalErrors).toBe(2);
        expect(stats.errorTypes['AuthError:AUTH_ERROR']).toBe(1);
        expect(stats.recoveryRates['NetworkError:NETWORK_ERROR'].successes).toBe(1);
        expect(stats.performanceImpact['AuthError:AUTH_ERROR'].avgMs).toBe(10);

        monitor.cleanup();
    });

    it('routes errors through ErrorHandler for recoverable network errors', async () => {
        const logger = { debug: jest.fn(), warn: jest.fn() };
        const handler = new ErrorHandler(logger);
        const err = new NetworkError('retryable', { retryable: true, recoverable: true });

        await handler.handleError(err, { operation: async () => 'ok' });
        const stats = handler.getStats();

        expect(stats.totalErrors).toBe(1);
        expect(logger.warn).toHaveBeenCalled();
    });
});
