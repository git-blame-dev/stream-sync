import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

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
