import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import {
    advanceTimersByTime, clearAllTimers, getTimerCount, installTimerTracking,
    restoreTimerTracking, runAllTimers, runOnlyPendingTimers, setSystemTime,
    useFakeTimers, useRealTimers,
} from './bun-timers';

describe('bun-timers scoped observation', () => {
    beforeEach(() => { useRealTimers(); restoreTimerTracking(); });
    afterEach(() => {
        restoreTimerTracking();
        useRealTimers();
        setSystemTime();
    });

    it('observes timeout completion before any reset', () => {
        useFakeTimers();
        const state = installTimerTracking();
        const schedule = global.setTimeout;
        const calls: string[] = [];
        const timeout = schedule((value: string) => { calls.push(value); }, 10, 'synthetic');
        expect(state.activeTimers.has(timeout)).toBe(true);
        advanceTimersByTime(10);
        expect(calls).toEqual(['synthetic']);
        expect(state.activeTimers.has(timeout)).toBe(false);
        expect(getTimerCount()).toBe(0);
    });

    it('restoring observation does not cancel timers owned by the caller', () => {
        useFakeTimers();
        const state = installTimerTracking();
        const schedule = global.setTimeout;
        let calls = 0;
        const timeout = schedule(() => { calls++; }, 10);
        restoreTimerTracking();
        try {
            expect(getTimerCount()).toBe(1);
            advanceTimersByTime(10);
            expect(calls).toBe(1);
            expect(state.activeTimers.has(timeout)).toBe(false);
            expect(getTimerCount()).toBe(0);
        } finally { clearTimeout(timeout); }
    });

    it('captures the current timer owner on reinstall and restores its exact reference', () => {
        const timerSpy = vi.spyOn(global, 'setTimeout');
        const currentOwner = global.setTimeout;
        try {
            installTimerTracking();
            const schedule = global.setTimeout;
            const timeout = schedule(() => {}, 60000);
            expect(timerSpy).toHaveBeenCalledTimes(1);
            clearTimeout(timeout);
            restoreTimerTracking();
            expect(global.setTimeout).toBe(currentOwner);
        } finally { restoreTimerTracking(); timerSpy.mockRestore(); }
    });

    it('installs once and observes caller cancellation of both timer kinds', () => {
        const state = installTimerTracking();
        expect(installTimerTracking()).toBe(state);
        const scheduleTimeout = global.setTimeout;
        const scheduleInterval = global.setInterval;
        const timeout = scheduleTimeout(() => {}, 60000);
        const interval = scheduleInterval(() => {}, 60000);
        expect(state.activeTimers.has(timeout)).toBe(true);
        expect(state.activeTimers.has(interval)).toBe(true);
        clearTimeout(timeout);
        clearInterval(interval);
        expect(state.activeTimers.has(timeout)).toBe(false);
        expect(state.activeTimers.has(interval)).toBe(false);
    });

    it('switches clock modes without cancelling a native timer owned by the caller', () => {
        const state = installTimerTracking();
        const schedule = global.setTimeout;
        const timeout = schedule(() => {}, 60000);
        try {
            useFakeTimers();
            expect(state.activeTimers.has(timeout)).toBe(true);
            useRealTimers();
            expect(state.activeTimers.has(timeout)).toBe(true);
        } finally { clearTimeout(timeout); }
        expect(state.activeTimers.has(timeout)).toBe(false);
    });

    it('exposes native fake timer helpers', () => {
        useFakeTimers();
        setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        const schedule = global.setTimeout;
        schedule(() => {}, 250);
        expect(getTimerCount()).toBe(1);
        advanceTimersByTime(250);
        runOnlyPendingTimers();
        runAllTimers();
        expect(getTimerCount()).toBe(0);
        clearAllTimers();
    });
});
