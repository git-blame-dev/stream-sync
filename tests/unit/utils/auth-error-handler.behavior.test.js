const { describe, expect, beforeEach, it } = require('bun:test');
const { noOpLogger } = require('../../helpers/mock-factories');

const AuthErrorHandler = require('../../../src/utils/auth-error-handler');

describe('auth-error-handler behavior', () => {
    let handler;

    beforeEach(() => {
        handler = new AuthErrorHandler(noOpLogger);
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

    it('handles user-facing errors without throwing', () => {
        expect(() => handler.logUserFacingError('network_error', { stage: 'refresh' })).not.toThrow();
        expect(() => handler.logUserFacingError('unknown_category')).not.toThrow();
    });

    it('handles event processing errors without throwing', () => {
        expect(() => handler.handleEventProcessingError(new Error('boom'), 'auth')).not.toThrow();
    });
});
