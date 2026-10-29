import { describe, expect, afterEach, beforeEach, it } from 'bun:test';
import { noOpLogger } from '../../helpers/mock-factories';
import { advanceTimersByTime, getTimerCount, useFakeTimers, useRealTimers } from '../../helpers/bun-timers';
import { ViewerCountSystem } from '../../../src/utils/viewer-count';

function createSystem() {
    return new ViewerCountSystem({
        logger: noOpLogger,
        platforms: {},
        config: { general: { viewerCountPollingIntervalMs: 15000 } },
    });
}

describe('ViewerCountSystem cleanup resilience', () => {
    beforeEach(() => useFakeTimers());
    afterEach(() => useRealTimers());

    for (const outcome of ['empty', 'success', 'throw', 'reject'] as const) {
        it(`retires cleanup resources immediately for ${outcome} observers`, async () => {
            const baseline = getTimerCount();
            const system = createSystem();
            await system.initialize();
            expect(getTimerCount()).toBe(baseline + 1);
            const invoked: string[] = [];
            if (outcome !== 'empty') {
                system.addObserver({
                    getObserverId: () => 'synthetic-first',
                    cleanup: () => {
                        invoked.push('first');
                        if (outcome === 'throw') throw new Error('synthetic cleanup throw');
                        if (outcome === 'reject') return Promise.reject(new Error('synthetic cleanup reject'));
                        return Promise.resolve();
                    },
                });
                system.addObserver({ getObserverId: () => 'synthetic-second', cleanup: () => { invoked.push('second'); } });
            }
            await system.cleanup();
            expect(invoked).toEqual(outcome === 'empty' ? [] : ['first', 'second']);
            expect(system.observers.size).toBe(0);
            expect(system.memoryOptimizationInterval).toBeNull();
            expect(system.isPolling).toBe(false);
            expect(getTimerCount()).toBe(baseline);
            await system.cleanup();
            expect(getTimerCount()).toBe(baseline);
        });
    }

    for (const lateOutcome of ['resolve', 'reject'] as const) {
        it(`bounds a hung observer at 5000ms and observes late ${lateOutcome}`, async () => {
            const baseline = getTimerCount();
            const system = createSystem();
            await system.initialize();
            expect(getTimerCount()).toBe(baseline + 1);
            const pending = Promise.withResolvers<void>();
            system.addObserver({ getObserverId: () => 'synthetic-held', cleanup: () => pending.promise });
            let completed = false;
            const cleanup = system.cleanup().then(() => { completed = true; });
            try {
                expect(getTimerCount()).toBe(baseline + 1);
                advanceTimersByTime(4999);
                await Promise.resolve();
                expect(completed).toBe(false);
                expect(system.observers.size).toBe(1);
                advanceTimersByTime(1);
                await cleanup;
                expect(completed).toBe(true);
                expect(system.observers.size).toBe(0);
                expect(system.memoryOptimizationInterval).toBeNull();
                expect(getTimerCount()).toBe(baseline);
                if (lateOutcome === 'reject') pending.reject(new Error('synthetic late rejection'));
                else pending.resolve();
                await pending.promise.catch(() => {});
                expect(getTimerCount()).toBe(baseline);
            } finally {
                pending.resolve();
                await cleanup;
            }
        });
    }

    it('retires independent observers even when cleanup diagnostics throw', async () => {
        const baseline = getTimerCount();
        const system = createSystem();
        const fail = () => { throw new Error('synthetic logger failure'); };
        let secondRetired = false;
        system.addObserver({ getObserverId: () => 'synthetic-failed', cleanup: () => { throw new Error('synthetic cleanup failure'); } });
        system.addObserver({ getObserverId: () => 'synthetic-next', cleanup: () => { secondRetired = true; } });
        system.logger = { debug: fail, info: fail, warn: fail };
        await system.cleanup();
        expect(secondRetired).toBe(true);
        expect(system.observers.size).toBe(0);
        expect(getTimerCount()).toBe(baseline);
    });
});
