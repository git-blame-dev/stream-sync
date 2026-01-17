const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const { InitializationStatistics } = require('../../../src/utils/initialization-statistics');

describe('InitializationStatistics behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('tracks successful initialization timing and metrics', () => {
        const stats = new InitializationStatistics('twitch', noOpLogger);
        const times = [1000, 2000];
        const nowSpy = spyOn(Date, 'now').mockImplementation(() => times.shift());

        const attemptId = stats.startInitializationAttempt({ reason: 'boot' });
        stats.recordSuccess(attemptId, { connectionTime: 50, serviceInitTime: 30 });

        const summary = stats.getStatistics();

        expect(summary.successfulAttempts).toBe(1);
        expect(summary.averageInitializationTime).toBe(1000);
        expect(summary.performanceMetrics.connectionEstablishmentTime.average).toBe(50);
        expect(stats.consecutiveFailures).toBe(0);

        nowSpy.mockRestore();
    });

    it('records failures and tracks error statistics', () => {
        const stats = new InitializationStatistics('youtube', noOpLogger);
        const times = [0, 0, 50];
        const nowSpy = spyOn(Date, 'now').mockImplementation(() => times.shift());

        const attemptId = stats.startInitializationAttempt();
        const error = new Error('connect failed');

        stats.recordFailure(attemptId, error, { phase: 'connect' });

        expect(stats.failedAttempts).toBe(1);
        expect(stats.errorTypes.get('Error')).toBe(1);
        expect(stats.consecutiveFailures).toBe(1);

        nowSpy.mockRestore();
    });

    it('identifies unhealthy state after repeated failures', () => {
        const stats = new InitializationStatistics('platform', noOpLogger);
        const nowSpy = spyOn(Date, 'now');
        let current = 0;
        nowSpy.mockImplementation(() => {
            current += 10;
            return current;
        });

        for (let i = 0; i < 5; i++) {
            const attemptId = stats.startInitializationAttempt();
            stats.recordFailure(attemptId, new Error('boom'));
        }

        const summary = stats.getStatistics();
        const analysis = stats.getErrorAnalysis();

        expect(summary.isHealthy).toBe(false);
        expect(analysis.recommendedAction).toContain('CRITICAL');
        expect(analysis.mostCommonError).toBe('Error');

        nowSpy.mockRestore();
    });

    it('resets statistics to defaults', () => {
        const stats = new InitializationStatistics('platform', noOpLogger);
        const times = [0, 0, 20, 20];
        const nowSpy = spyOn(Date, 'now').mockImplementation(() => times.shift());

        const attemptId = stats.startInitializationAttempt();
        stats.recordSuccess(attemptId);
        stats.reset();

        const summary = stats.getStatistics();
        expect(summary.totalAttempts).toBe(0);
        expect(stats.errorTypes.size).toBe(0);
        expect(stats.isCurrentlyInitializing).toBe(false);

        nowSpy.mockRestore();
    });
});
