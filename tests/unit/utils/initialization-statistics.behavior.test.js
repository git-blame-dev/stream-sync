const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, spyOn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: createMockFn(() => ({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn()
    }))
}));

const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const { InitializationStatistics } = require('../../../src/utils/initialization-statistics');

describe('InitializationStatistics behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let logger;
    let handler;

    beforeEach(() => {
        logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn() };
        handler = { handleEventProcessingError: createMockFn(), logOperationalError: createMockFn() };
        createPlatformErrorHandler.mockReturnValue(handler);
    });

    it('tracks successful initialization timing and metrics', () => {
        const stats = new InitializationStatistics('twitch', logger);
        const times = [1000, 2000];
        const nowSpy = spyOn(Date, 'now').mockImplementation(() => times.shift());

        const attemptId = stats.startInitializationAttempt({ reason: 'boot' });
        stats.recordSuccess(attemptId, { connectionTime: 50, serviceInitTime: 30 });

        const summary = stats.getStatistics();

        expect(summary.successfulAttempts).toBe(1);
        expect(summary.averageInitializationTime).toBe(1000);
        expect(summary.performanceMetrics.connectionEstablishmentTime.average).toBe(50);
        expect(stats.consecutiveFailures).toBe(0);
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('Initialization successful'),
            'twitch'
        );

        nowSpy.mockRestore();
    });

    it('records failures with error handler routing and error tracking', () => {
        const stats = new InitializationStatistics('youtube', logger);
        const times = [0, 0, 50];
        const nowSpy = spyOn(Date, 'now').mockImplementation(() => times.shift());

        const attemptId = stats.startInitializationAttempt();
        const error = new Error('connect failed');

        stats.recordFailure(attemptId, error, { phase: 'connect' });

        expect(stats.failedAttempts).toBe(1);
        expect(stats.errorTypes.get('Error')).toBe(1);
        expect(stats.consecutiveFailures).toBe(1);

        expect(handler.handleEventProcessingError).toHaveBeenCalledWith(
            error,
            'initialization',
            expect.objectContaining({ attemptId }),
            expect.stringContaining('Initialization failed')
        );

        nowSpy.mockRestore();
    });

    it('identifies unhealthy state after repeated failures', () => {
        const stats = new InitializationStatistics('platform', logger);
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
        const stats = new InitializationStatistics('platform', logger);
        const times = [0, 0, 20, 20];
        const nowSpy = spyOn(Date, 'now').mockImplementation(() => times.shift());

        const attemptId = stats.startInitializationAttempt();
        stats.recordSuccess(attemptId);
        stats.reset();

        const summary = stats.getStatistics();
        expect(summary.totalAttempts).toBe(0);
        expect(stats.errorTypes.size).toBe(0);
        expect(stats.isCurrentlyInitializing).toBe(false);
        expect(logger.debug).toHaveBeenCalledWith('Initialization statistics reset', 'platform');

        nowSpy.mockRestore();
    });
});
