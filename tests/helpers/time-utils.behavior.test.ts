import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { advanceTimersByTime, getTimerCount, setSystemTime, useFakeTimers, useRealTimers } from './bun-timers';
import { resolveDelay, scheduleInterval, scheduleTimeout, waitForDelay } from './time-utils';

describe('time-utils behavior', () => {
    beforeEach(() => {
        useFakeTimers();
    });

    afterEach(() => {
        useRealTimers();
        setSystemTime();
    });

    it('resolves configured and fallback delays', () => {
        expect(resolveDelay(25)).toBe(25);
        expect(resolveDelay(undefined)).toBe(1);
        expect(resolveDelay(-5)).toBe(1);
        expect(resolveDelay(0, 7)).toBe(7);
    });

    it('waits until a positive delay is due and resolves non-positive delays without timers', async () => {
        await expect(waitForDelay(0)).resolves.toBeUndefined();
        await expect(waitForDelay(-1)).resolves.toBeUndefined();
        expect(getTimerCount()).toBe(0);
        let completed = false;
        const waiting = waitForDelay(25).then(() => { completed = true; });
        advanceTimersByTime(24);
        await Promise.resolve();
        expect(completed).toBe(false);
        advanceTimersByTime(1);
        await waiting;
        expect(completed).toBe(true);
        expect(getTimerCount()).toBe(0);
    });

    it('executes normalized timeout callbacks when due and cancels pending work', () => {
        const calls: unknown[][] = [];
        scheduleTimeout((...args) => { calls.push(args); }, undefined, 'synthetic argument');
        const cancelled = scheduleTimeout(() => { calls.push(['cancelled']); }, 2);
        clearTimeout(cancelled);
        expect(calls).toEqual([]);
        advanceTimersByTime(1);
        expect(calls).toEqual([['synthetic argument']]);
        advanceTimersByTime(10);
        expect(calls).toHaveLength(1);
        expect(getTimerCount()).toBe(0);
    });

    it('executes repeated interval callbacks only until cleared without a fallback timer', () => {
        const calls: unknown[][] = [];
        const interval = scheduleInterval((...args) => { calls.push(args); }, 5, 'synthetic interval');
        advanceTimersByTime(4);
        expect(calls).toEqual([]);
        advanceTimersByTime(6);
        expect(calls).toEqual([['synthetic interval'], ['synthetic interval']]);
        clearInterval(interval);
        advanceTimersByTime(20);
        expect(calls).toHaveLength(2);
        expect(getTimerCount()).toBe(0);
    });
});
