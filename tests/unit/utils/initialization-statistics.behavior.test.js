const { describe, expect, it, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const testClock = require('../../helpers/test-clock');

const { InitializationStatistics } = require('../../../src/utils/initialization-statistics');

describe('InitializationStatistics behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('tracks successful initialization timing and metrics', () => {
        const stats = new InitializationStatistics('twitch', noOpLogger);

        testClock.set(1000);
        const attemptId = stats.startInitializationAttempt({ reason: 'boot' });
        testClock.set(2000);
        stats.recordSuccess(attemptId, { connectionTime: 50, serviceInitTime: 30 });

        const summary = stats.getStatistics();

        expect(summary.successfulAttempts).toBe(1);
        expect(summary.averageInitializationTime).toBe(1000);
        expect(summary.performanceMetrics.connectionEstablishmentTime.average).toBe(50);
        expect(stats.consecutiveFailures).toBe(0);
    });

    it('records failures and tracks error statistics', () => {
        const stats = new InitializationStatistics('youtube', noOpLogger);

        testClock.set(1000);
        const attemptId = stats.startInitializationAttempt();
        testClock.set(1050);
        const error = new Error('connect failed');

        stats.recordFailure(attemptId, error, { phase: 'connect' });

        expect(stats.failedAttempts).toBe(1);
        expect(stats.errorTypes.get('Error')).toBe(1);
        expect(stats.consecutiveFailures).toBe(1);
    });

    it('identifies unhealthy state after repeated failures', () => {
        const stats = new InitializationStatistics('platform', noOpLogger);

        testClock.set(10);
        for (let i = 0; i < 5; i++) {
            const attemptId = stats.startInitializationAttempt();
            testClock.advance(10);
            stats.recordFailure(attemptId, new Error('boom'));
        }

        const summary = stats.getStatistics();
        const analysis = stats.getErrorAnalysis();

        expect(summary.isHealthy).toBe(false);
        expect(analysis.recommendedAction).toContain('CRITICAL');
        expect(analysis.mostCommonError).toBe('Error');
    });

    it('resets statistics to defaults', () => {
        const stats = new InitializationStatistics('platform', noOpLogger);

        testClock.set(1000);
        const attemptId = stats.startInitializationAttempt();
        testClock.set(1020);
        stats.recordSuccess(attemptId);
        stats.reset();

        const summary = stats.getStatistics();
        expect(summary.totalAttempts).toBe(0);
        expect(stats.errorTypes.size).toBe(0);
        expect(stats.isCurrentlyInitializing).toBe(false);
    });
});
