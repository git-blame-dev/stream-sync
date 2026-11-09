import { afterEach, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { ViewerCountSystem } from '../../src/utils/viewer-count';
import { TwitchViewerCountProvider } from '../../src/utils/viewer-count-providers';
import { TwitchPlatform } from '../../src/platforms/twitch';
import { TikTokPlatform } from '../../src/platforms/tiktok';
import { OBSViewerCountObserver } from '../../src/observers/obs-viewer-count-observer';
import { EventBus } from '../../src/core/EventBus';
import { PlatformEventRouter } from '../../src/services/PlatformEventRouter';
import { PlatformLifecycleService } from '../../src/services/PlatformLifecycleService';
import { wireStreamStatusHandlers } from '../../src/viewer-count/stream-status-handler';
import { noOpLogger as logger } from '../helpers/mock-factories';
import { advanceTimersByTime, setSystemTime, useFakeTimers, useRealTimers } from '../helpers/bun-timers';

function observeCounts(store: ViewerCountSystem, platform: string) {
    const texts: string[] = [];
    const observer = new OBSViewerCountObserver({ isConnected: () => true, call: async (_method, payload) => {
        texts.push((payload.inputSettings as { text: string }).text);
    } }, logger, { config: { [platform]: { viewerCountEnabled: true, viewerCountSource: 'Synthetic viewers' } },
        getViewerCountSnapshot: name => store.getViewerCountSnapshot(name) });
    store.addObserver(observer);
    return { texts, observer };
}

let pendingBoundary: string | undefined;
afterEach(() => {
    // A native test timeout omits its await site; expose only a fixed category.
    const unresolved = pendingBoundary;
    pendingBoundary = undefined;
    expect(unresolved, 'viewer-count test left an asynchronous boundary pending').toBeUndefined();
});
// Flush the real in-process event bus and observer continuations without advancing polling time.
async function drainEvents() {
    pendingBoundary = 'event-loop-drain';
    await new Promise<void>(resolve => setImmediate(resolve));
    pendingBoundary = undefined;
}

test('Twitch offline polling restores OBS after an online event was missed during disconnection', async () => {
    useFakeTimers();
    let live = false;
    let requests = 0;
    const platform = new TwitchPlatform({ enabled: false, channel: 'synthetic-channel', dataLoggingEnabled: false },
        { logger, twitchAuth: { isReady: () => true } });
    platform.viewerCountProvider = new TwitchViewerCountProvider({ getStreamInfo: async () => {
        requests++;
        return { isLive: live, viewerCount: live ? 23 : 0 };
    } }, { channel: 'synthetic-channel' }, logger);
    const store = new ViewerCountSystem({ platforms: { twitch: platform }, logger,
        config: { general: { viewerCountPollingIntervalMs: 60000 }, twitch: { enabled: true } } });
    const { texts } = observeCounts(store, 'twitch');
    try {
        store.startPolling();
        await drainEvents();
        await store.updateStreamStatus('twitch', false);
        expect(store.pollingHandles.twitch).toBeDefined();
        expect(texts.at(-1)).toBe('0');
        const offlineRequests = requests;
        // The transport misses stream.online. Helix is now the only source of recovery.
        live = true;
        advanceTimersByTime(59999);
        await drainEvents();
        expect(requests).toBe(offlineRequests);
        advanceTimersByTime(1);
        await drainEvents();
        expect(requests).toBe(offlineRequests + 1);
        expect(store.getViewerCountSnapshot('twitch')).toMatchObject({ count: 23, latestOutcome: 'complete' });
        expect(texts.at(-1)).toBe('23');
        store.stopPolling();
        advanceTimersByTime(60000);
        await drainEvents();
        expect(requests).toBe(offlineRequests + 1);
    } finally { pendingBoundary = 'store-cleanup'; await store.cleanup();
        pendingBoundary = 'platform-cleanup'; await platform.cleanup();
        pendingBoundary = undefined; useRealTimers(); }
});

for (const invalid of ['count', 'timestamp'] as const) {
    test(`a current TikTok invalid ${invalid} passes lifecycle validation, makes OBS unavailable and recovers`, async () => {
        useFakeTimers();
        setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
        const bus = new EventBus();
        const platform = new TikTokPlatform({ enabled: false, dataLoggingEnabled: false,
            envFileReadEnabled: false, envFileWriteEnabled: false }, { logger, eventBus: bus });
        const lifecycle = new PlatformLifecycleService({ eventBus: bus, logger });
        platform.handlers = lifecycle.createDefaultEventHandlers('tiktok');
        const connection = new EventEmitter();
        platform.connection = connection as unknown as NonNullable<TikTokPlatform['connection']>;
        platform.connectionActive = true;
        const store = new ViewerCountSystem({ platforms: { tiktok: platform }, logger,
            config: { general: { viewerCountPollingIntervalMs: 60000 } } });
        const router = new PlatformEventRouter({ eventBus: bus, runtime: {
            updateViewerCount: (name, count) => store.updateViewerCount(name, count)
        }, config: {}, notificationManager: {}, logger });
        const unbind = wireStreamStatusHandlers({ eventBus: bus, viewerCountSystem: store, logger });
        const { texts } = observeCounts(store, 'tiktok');
        const statusEvents: unknown[] = [];
        const unsubscribeStatus = bus.subscribe('platform:event', event => {
            if (!event || typeof event !== 'object') return;
            const envelope = event as { type?: unknown; data?: unknown };
            if (envelope.type === 'platform:stream-status') statusEvents.push(envelope.data);
        });
        const valid = { viewerCount: 17, common: { createTime: 1767225600000 } };
        try {
            platform.setupEventListeners();
            connection.emit(platform.WebcastEvent.ROOM_USER, valid);
            await drainEvents();
            expect(texts.at(-1)).toBe('17');
            const complete = store.getViewerCountSnapshot('tiktok');
            setSystemTime(new Date('2026-01-03T00:00:00.000Z'));
            connection.emit(platform.WebcastEvent.ROOM_USER, invalid === 'count'
                ? { ...valid, viewerCount: null } : { viewerCount: 25 });
            await drainEvents();
            expect(store.getViewerCountSnapshot('tiktok')).toEqual({ ...complete, latestOutcome: 'unavailable' });
            expect(texts.at(-1)).toBe('—');
            expect(statusEvents).toEqual([{ isLive: true, status: 'unavailable',
                timestamp: '2026-01-03T00:00:00.000Z' }]);
            connection.emit(platform.WebcastEvent.ROOM_USER, { ...valid, viewerCount: 0 });
            await drainEvents();
            expect(store.getViewerCountSnapshot('tiktok')).toMatchObject({ count: 0, latestOutcome: 'complete' });
            expect(texts.at(-1)).toBe('0');
            expect(store.getViewerCountSnapshot('tiktok').lastCompleteAt).toBe(Date.parse('2026-01-03T00:00:00.000Z'));
            // A callback captured by the retired registration cannot invalidate or refresh the replacement.
            const retired = connection.listeners(platform.WebcastEvent.ROOM_USER)[0] as (data: unknown) => Promise<void>;
            platform.connection = new EventEmitter() as unknown as NonNullable<TikTokPlatform['connection']>;
            platform.setupEventListeners();
            const recovered = store.getViewerCountSnapshot('tiktok');
            const writes = texts.length;
            await retired(invalid === 'count' ? { ...valid, viewerCount: null } : { viewerCount: 25 });
            await retired({ ...valid, viewerCount: 99 });
            await drainEvents();
            expect(store.getViewerCountSnapshot('tiktok')).toEqual(recovered);
            expect(texts).toHaveLength(writes);
            expect(statusEvents).toHaveLength(1);
        } finally { unsubscribeStatus(); unbind(); router.dispose();
            pendingBoundary = 'store-cleanup'; await store.cleanup();
            pendingBoundary = 'platform-cleanup'; await platform.cleanup();
            pendingBoundary = undefined; lifecycle.dispose(); bus.removeAllListeners(); useRealTimers(); }
    });
}

test('Twitch unavailability retires a held offline reconciliation before accepting the next poll', async () => {
    const held = Promise.withResolvers<{ isLive: boolean; viewerCount: number }>();
    const requested = Promise.withResolvers<void>();
    let hold = true;
    const platform = new TwitchPlatform({ enabled: false, channel: 'synthetic-channel', dataLoggingEnabled: false },
        { logger, twitchAuth: { isReady: () => true } });
    platform.viewerCountProvider = new TwitchViewerCountProvider({ getStreamInfo: async () => {
        if (hold) { requested.resolve(); return held.promise; }
        return { isLive: true, viewerCount: 7 };
    } }, { channel: 'synthetic-channel' }, logger);
    const store = new ViewerCountSystem({ platforms: { twitch: platform }, logger,
        config: { general: { viewerCountPollingIntervalMs: 60000 } } });
    const { texts } = observeCounts(store, 'twitch');
    let pending: Promise<void> | undefined;
    try {
        await store.updateStreamStatus('twitch', false);
        const offline = store.getViewerCountSnapshot('twitch');
        pending = store.pollPlatform('twitch');
        await requested.promise;
        await store.updateStreamStatus('twitch', false, { countUnavailable: true });
        held.resolve({ isLive: true, viewerCount: 99 });
        await pending;
        expect(store.getViewerCountSnapshot('twitch')).toEqual({ ...offline, latestOutcome: 'unavailable' });
        expect(texts.at(-1)).toBe('—');
        hold = false;
        await store.pollPlatform('twitch');
        expect(texts.at(-1)).toBe('7');
    } finally { held.resolve({ isLive: false, viewerCount: 0 }); await pending; await store.cleanup(); await platform.cleanup(); }
});
