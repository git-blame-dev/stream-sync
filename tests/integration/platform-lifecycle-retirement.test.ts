import { afterEach, describe, expect, it } from 'bun:test';
import { createHeldTikTokLifecycle } from '../fixtures/platform-lifecycle-held-tiktok';
import { PlatformLifecycleService } from '../../src/services/PlatformLifecycleService';
import { noOpLogger } from '../helpers/mock-factories';
import { getTimerCount, useFakeTimers, useRealTimers } from '../helpers/bun-timers';

const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

afterEach(() => { useRealTimers(); });
describe('platform retirement ownership', () => {
    it('cancels real held TikTok initialization before joining it', async () => {
        useFakeTimers();
        const fixture = createHeldTikTokLifecycle();
        await fixture.lifecycle.initializeAllPlatforms({ tiktok: fixture.Platform });
        await fixture.connecting;
        expect(fixture.client.isConnecting).toBe(true);
        const stopping = fixture.lifecycle.disconnectAll();
        await drain();
        expect(fixture.connector.signal?.aborted).toBe(true);
        await stopping;
        expect(fixture.connector.terminated).toBe(1);
        expect(fixture.connector.disconnects).toBe(1);
        expect(fixture.counters).toEqual({ initialized: 1, cleanups: 1, retries: 0 });
        expect(fixture.lifecycle.getStatus().registeredPlatforms).toEqual([]);
        expect(fixture.lifecycle.getStatus().backgroundInitializations).toBe(0);
        expect(fixture.lifecycle.platformHealth.tiktok?.state).toBe('disconnected');
        expect(getTimerCount()).toBe(0);
    });

    it('starts all cleanups before joining a slow owner and coalesces concurrent shutdown', async () => {
        useFakeTimers();
        let release!: () => void;
        const slow = new Promise<void>(resolve => { release = resolve; });
        const calls: string[] = [];
        const lifecycle = new PlatformLifecycleService({ logger: noOpLogger });
        const instance = (name: string, pending: Promise<void>) => ({
            initialize() {}, on() {}, cleanup() { calls.push(name); return pending; }
        });
        lifecycle.platforms = { twitch: instance('slow', slow), tiktok: instance('fast', Promise.resolve()) };
        const first = lifecycle.disconnectAll();
        const second = lifecycle.disconnectAll();
        await drain();
        expect(calls).toEqual(['slow', 'fast']);
        release();
        await Promise.all([first, second]);
        expect(lifecycle.getAllPlatforms()).toEqual({});
    });

    it('clears a losing background wait timer', async () => {
        useFakeTimers();
        const lifecycle = new PlatformLifecycleService({ logger: noOpLogger });
        lifecycle.backgroundPlatformInits.push({ platform: 'synthetic', promise: Promise.resolve() });
        await lifecycle.waitForBackgroundInits();
        expect(getTimerCount()).toBe(0);
    });
    it('retains cleanup failure health when cancelled background initialization rejects', async () => {
        useFakeTimers();
        const lifecycle = new PlatformLifecycleService({ logger: noOpLogger });
        let rejectInit!: (error: Error) => void;
        const initialized = new Promise<void>((_resolve, reject) => { rejectInit = reject; });
        let cleanups = 0;
        const platform = {
            initialize: () => initialized,
            on() {},
            cleanup() { cleanups++; rejectInit(new Error('synthetic cancellation')); throw new Error('synthetic cleanup failure'); }
        };
        lifecycle.platforms.tiktok = platform;
        await lifecycle.initializePlatformConnection('tiktok', platform, lifecycle.createDefaultEventHandlers('tiktok'), {});
        await lifecycle.disconnectAll();
        expect(cleanups).toBe(1);
        expect(lifecycle.platformHealth.tiktok?.state).toBe('failed');
        expect(lifecycle.platformHealth.tiktok?.lastError).toBe('synthetic cleanup failure');
        expect(lifecycle.backgroundPlatformInits).toEqual([]);
        expect(getTimerCount()).toBe(0);
    });

    it('retires construction admitted just before shutdown without adopting it', async () => {
        const lifecycle = new PlatformLifecycleService({ config: { tiktok: { enabled: true } }, logger: noOpLogger });
        let initialized = 0;
        let cleanups = 0;
        class Platform {
            initialize() { initialized++; }
            on() {}
            cleanup() { cleanups++; }
        }
        const initializing = lifecycle.initializePlatform('tiktok', Platform);
        const stopping = lifecycle.disconnectAll();
        await Promise.all([initializing, stopping]);
        expect(initialized).toBe(0);
        expect(cleanups).toBe(1);
        expect(lifecycle.getAllPlatforms()).toEqual({});
    });

});
