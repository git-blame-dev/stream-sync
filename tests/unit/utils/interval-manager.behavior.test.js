const { describe, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { IntervalManager } = require('../../../src/utils/interval-manager');
const testClock = require('../../helpers/test-clock');

describe('IntervalManager behavior', () => {
    let intervalIdCounter;
    let mockSafeSetInterval;
    let clearIntervalSpy;

    beforeEach(() => {
        clearIntervalSpy = spyOn(global, 'clearInterval').mockImplementation(() => {});
        intervalIdCounter = 0;
        mockSafeSetInterval = createMockFn((callback) => {
            intervalIdCounter += 1;
            return { id: `interval-${intervalIdCounter}`, callback };
        });
    });

    afterEach(() => {
        clearIntervalSpy.mockRestore();
        restoreAllMocks();
    });

    it('creates intervals with tracking for out-of-range durations', () => {
        const manager = new IntervalManager('platform', noOpLogger, { safeSetInterval: mockSafeSetInterval });
        const callback = createMockFn();

        expect(() => manager.createInterval('poll', callback, 50)).not.toThrow();
        expect(manager.hasInterval('poll')).toBe(true);
        expect(manager.getActiveIntervals().length).toBe(1);
    });

    it('clears intervals individually and in bulk with stats updates', () => {
        const manager = new IntervalManager('platform', noOpLogger, { safeSetInterval: mockSafeSetInterval });
        manager.createPollingInterval('p1', () => {}, 2000);
        manager.createMonitoringInterval('m1', () => {}, 2000);

        const cleared = manager.clearAllIntervals('polling');
        expect(cleared).toBe(1);
        expect(manager.getActiveIntervals().length).toBe(1);

        manager.cleanup();
        expect(manager.getStatistics().activeCount).toBe(0);
    });

    it('reports health including long-running intervals', () => {
        const manager = new IntervalManager('platform', noOpLogger, { safeSetInterval: mockSafeSetInterval });
        manager.createInterval('old', () => {}, 1000, 'monitoring');
        const info = manager.getIntervalInfo('old');
        info.startTime = new Date(testClock.now() - 7200000).toISOString();

        const health = manager.getHealthCheck();

        expect(health.healthy).toBe(false);
        expect(health.longRunningCount).toBe(1);
        expect(health.longRunningIntervals[0].name).toBe('old');
    });
});
