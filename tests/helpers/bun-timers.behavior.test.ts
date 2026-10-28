import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import {
    advanceTimersByTime,
    clearAllTimers,
    clearTrackedTimers,
    getTimerCount,
    installTimerTracking,
    restoreTimerTracking,
    runAllTimers,
    runOnlyPendingTimers,
    setSystemTime,
    useFakeTimers,
    useRealTimers
} from './bun-timers';

describe('bun-timers behavior', () => {
    beforeEach(() => {
        useRealTimers();
        restoreTimerTracking();
    });

    afterEach(() => {
        clearTrackedTimers();
        restoreTimerTracking();
        try {
            clearAllTimers();
        } catch {
            // Ignore when fake timers are not active.
        }
        useRealTimers();
        setSystemTime();
        installTimerTracking();
    });

    it('retires tracked handles before each fake and real mode transition', () => {
        const state = installTimerTracking();
        const trackedTimeout = global.setTimeout;
        const trackedInterval = global.setInterval;
        trackedTimeout(() => {}, 60000);
        trackedInterval(() => {}, 60000);
        useFakeTimers();
        expect(state.activeTimers.size).toBe(0);
        const fakeTimeout = global.setTimeout;
        const fakeInterval = global.setInterval;
        let calls = 0;
        fakeTimeout(() => { calls += 1; }, 10);
        fakeInterval(() => { calls += 1; }, 10);
        expect(state.activeTimers.size).toBe(2);
        useRealTimers();
        expect(state.activeTimers.size).toBe(0);
        useFakeTimers();
        const nextTimeout = global.setTimeout;
        const nextInterval = global.setInterval;
        nextTimeout(() => { calls += 1; }, 10);
        nextInterval(() => { calls += 1; }, 10);
        clearTrackedTimers();
        advanceTimersByTime(10);
        expect(calls).toBe(0);
        expect(getTimerCount()).toBe(0);
    });

    it('captures the current timer owner on reinstall and restores its exact reference', () => {
        installTimerTracking();
        restoreTimerTracking();
        const timerSpy = vi.spyOn(global, 'setTimeout');
        const currentOwner = global.setTimeout;
        try {
            installTimerTracking();
            const trackedTimeout = global.setTimeout;
            trackedTimeout(() => {}, 60000);
            expect(timerSpy).toHaveBeenCalledTimes(1);
            restoreTimerTracking();
            expect(global.setTimeout).toBe(currentOwner);
        } finally {
            restoreTimerTracking();
            timerSpy.mockRestore();
        }
    });

    it('installs tracking once and tracks timeout and interval lifecycle', () => {
        const installedState = installTimerTracking();
        const secondInstallState = installTimerTracking();
        const trackedSetTimeout = global.setTimeout;
        const trackedSetInterval = global.setInterval;

        expect(secondInstallState).toBe(installedState);

        const timeoutId = trackedSetTimeout(() => {}, 50);
        const intervalId = trackedSetInterval(() => {}, 50);

        expect(installedState.activeTimers.has(timeoutId)).toBe(true);
        expect(installedState.activeTimers.has(intervalId)).toBe(true);

        clearTimeout(timeoutId);
        clearInterval(intervalId);

        expect(installedState.activeTimers.size).toBe(0);
    });

    it('clears tracked timers and tolerates uninstalled state', () => {
        clearTrackedTimers();

        const installedState = installTimerTracking();
        const trackedSetTimeout = global.setTimeout;
        const trackedSetInterval = global.setInterval;
        trackedSetTimeout(() => {}, 1000);
        trackedSetInterval(() => {}, 1000);

        expect(installedState.activeTimers.size).toBeGreaterThan(0);

        clearTrackedTimers();

        expect(installedState.activeTimers.size).toBe(0);
    });

    it('exposes fake timer helpers through vi wrappers', () => {
        useFakeTimers();
        setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        const nativeSetTimeout = global.setTimeout;

        nativeSetTimeout(() => {}, 250);

        expect(getTimerCount()).toBe(1);

        advanceTimersByTime(250);
        runOnlyPendingTimers();
        runAllTimers();
        clearAllTimers();

        expect(getTimerCount()).toBe(0);
    });
});
