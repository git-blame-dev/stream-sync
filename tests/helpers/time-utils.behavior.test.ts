import { describe, expect, it } from 'bun:test';

import { resolveDelay, scheduleInterval, scheduleTimeout, waitForDelay } from './time-utils';

describe('time-utils behavior', () => {
    it('resolves configured and fallback delays', () => {
        expect(resolveDelay(25)).toBe(25);
        expect(resolveDelay(undefined)).toBe(1);
        expect(resolveDelay(-5)).toBe(1);
        expect(resolveDelay(0, 7)).toBe(7);
    });

    it('waits for non-positive and positive delays', async () => {
        await expect(waitForDelay(0)).resolves.toBeUndefined();
        await expect(waitForDelay(1)).resolves.toBeUndefined();
    });

    it('schedules timeout callbacks with normalized delays', async () => {
        await new Promise<void>((resolve) => {
            scheduleTimeout(() => {
                resolve();
            }, undefined);
        });
    });

    it('schedules interval callbacks and allows clearing', async () => {
        await new Promise<void>((resolve, reject) => {
            let intervalId: ReturnType<typeof setInterval> | undefined;
            intervalId = scheduleInterval(() => {
                if (intervalId !== undefined) {
                    clearInterval(intervalId);
                }
                resolve();
            }, 1);

            scheduleTimeout(() => {
                if (intervalId !== undefined) {
                    clearInterval(intervalId);
                }
                reject(new Error('interval callback did not execute'));
            }, 50);
        });
    });
});
