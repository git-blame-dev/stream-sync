const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const AuthErrorHandler = require('../../../src/utils/auth-error-handler');

describe('auth-error-handler behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let handler;

    beforeEach(() => {
        handler = new AuthErrorHandler({ debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() });
    });

    it('categorizes errors and determines refreshability', () => {
        const analysis = handler.analyzeError({ message: 'Token expired', response: { status: 401 } });
        expect(analysis.category).toBe('authentication');
        expect(handler.isRefreshableError({ response: { status: 401 } })).toBe(true);
        expect(handler.isRefreshableError('connection refused')).toBe(true);
    });

    it('analyzes refresh errors and returns retry strategies', () => {
        const refreshAnalysis = handler.analyzeRefreshError({ response: { status: 429, headers: { 'retry-after': 2 }, data: {} } });
        expect(refreshAnalysis.category).toBe('rate_limited');

        const strategy = handler.createRetryStrategy(refreshAnalysis, 0, 3);
        expect(strategy.shouldRetry).toBe(true);
        expect(strategy.delay).toBe(2000);
    });

    it('logs user-facing errors and delegates event processing errors', () => {
        handler.errorHandler = { handleEventProcessingError: createMockFn(), logOperationalError: createMockFn() };
        handler.logUserFacingError('network_error', { stage: 'refresh' });
        handler.handleEventProcessingError(new Error('boom'), 'auth');
        const platformHandler = handler.errorHandler;

        expect(platformHandler.logOperationalError).toHaveBeenCalled();
        expect(platformHandler.handleEventProcessingError).toHaveBeenCalled();
    });
});
