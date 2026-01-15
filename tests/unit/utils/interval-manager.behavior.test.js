const { describe, test, expect, beforeEach, afterAll, it } = require('bun:test');
const { createMockFn, spyOn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

let intervalId = 0;

mockModule('../../../src/utils/timeout-validator', () => {
    let intervalId = 0;
    return {
        safeSetInterval: createMockFn((callback) => {
            intervalId += 1;
            return { id: `interval-${intervalId}`, callback };
        })
    };
});

const { safeSetInterval } = require('../../../src/utils/timeout-validator');
const { IntervalManager } = require('../../../src/utils/interval-manager');
const testClock = require('../../helpers/test-clock');

describe('IntervalManager behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let logger;
    const clearIntervalSpy = spyOn(global, 'clearInterval').mockImplementation(() => {});

    beforeEach(() => {
        logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn() };
    });

    afterAll(() => {
        clearIntervalSpy.mockRestore();
    });

    it('creates intervals with tracking and warns on out-of-range durations', () => {
        const manager = new IntervalManager('platform', logger);
        const callback = createMockFn();

        expect(() => manager.createInterval('poll', callback, 50)).not.toThrow();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('outside recommended range'),
            'platform'
        );
        expect(manager.hasInterval('poll')).toBe(true);
        expect(manager.getActiveIntervals().length).toBe(1);
    });

    it('clears intervals individually and in bulk with stats updates', () => {
        const manager = new IntervalManager('platform', logger);
        manager.createPollingInterval('p1', () => {}, 2000);
        manager.createMonitoringInterval('m1', () => {}, 2000);

        const cleared = manager.clearAllIntervals('polling');
        expect(cleared).toBe(1);
        expect(manager.getActiveIntervals().length).toBe(1);

        manager.cleanup();
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('cleared'),
            'platform'
        );
        expect(manager.getStatistics().activeCount).toBe(0);
    });

    it('reports health including long-running intervals', () => {
        const manager = new IntervalManager('platform', logger);
        manager.createInterval('old', () => {}, 1000, 'monitoring');
        // force start time to 2 hours ago to trigger long-running detection
        const info = manager.getIntervalInfo('old');
        info.startTime = new Date(testClock.now() - 7200000).toISOString();

        const health = manager.getHealthCheck();

        expect(health.healthy).toBe(false);
        expect(health.longRunningCount).toBe(1);
        expect(health.longRunningIntervals[0].name).toBe('old');
    });
});
