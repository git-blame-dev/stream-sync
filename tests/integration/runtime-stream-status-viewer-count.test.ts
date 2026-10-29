import { expect, test, spyOn } from 'bun:test';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import { TwitchApiClient } from '../../src/utils/api-clients/twitch-api-client';
import { EnhancedHttpClient } from '../../src/utils/enhanced-http-client';
import { TwitchViewerCountProvider } from '../../src/utils/viewer-count-providers';
import { secrets } from '../../src/core/secrets';
import { noOpLogger } from '../helpers/mock-factories';
import { useFakeTimers, useRealTimers, advanceTimersByTime, getTimerCount } from '../helpers/bun-timers';

for (const ending of ['online', 'offline', 'cleanup'] as const) {
    test(`real root fences held offline continuation after ${ending}`, async () => {
        const h = await createMainPresentationFixture();
        h.config.twitch.viewerCountEnabled = true;
        h.config.twitch.viewerCountSource = 'synthetic-viewers';
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const original = h.socket.call.bind(h.socket);
        const writes: string[] = [];
        let held = false;
        const wire = spyOn(h.socket, 'call').mockImplementation(async (method, data = {}) => {
            const result = await original(method, data);
            if (method === 'SetInputSettings' && data.inputName === 'synthetic-viewers') {
                const text = String((data.inputSettings as { text: unknown }).text);
                writes.push(text);
                if (text === '0' && !held) { held = true; entered.resolve(); await release.promise; }
            }
            return result;
        });
        let offline: Promise<void> | undefined;
        try {
            await h.start();
            const store = h.runtime.viewerCountSystem;
            const counts: number[] = [];
            store.addObserver({ getObserverId: () => 'synthetic-recording', onViewerCountUpdate: update => { counts.push(update.count); } });
            await store.updateViewerCount('twitch', 42);
            offline = store.updateStreamStatus('twitch', false);
            await entered.promise;
            await store.updateStreamStatus('youtube', true);
            expect(store.isStreamLive('youtube')).toBe(true);
            await store.updateStreamStatus('twitch', true);
            await store.updateViewerCount('twitch', 7);
            if (ending === 'offline') await store.updateStreamStatus('twitch', false);
            if (ending === 'cleanup') await store.cleanup();
            const before = [...writes];
            const countsBefore = [...counts];
            release.resolve(); await offline;
            expect(writes).toEqual(before);
            expect(counts).toEqual(countsBefore);
            expect(store.getViewerCount('twitch')).toBe(ending === 'online' ? 7 : 0);
            expect(store.getViewerCountSnapshot('twitch').hasCompleteObservation).toBe(ending !== 'cleanup');
            expect(store.isStreamLive('twitch')).toBe(ending !== 'offline');
        } finally { release.resolve(); await offline; wire.mockRestore(); await h.dispose(); }
    });
}

test('root event routing updates actual store and OBS; rejects malformed status', async () => {
    const h = await createMainPresentationFixture();
    h.config.twitch.viewerCountEnabled = true;
    h.config.twitch.viewerCountSource = 'synthetic-viewers';
    const written = Promise.withResolvers<void>();
    const original = h.socket.call.bind(h.socket);
    const wire = spyOn(h.socket, 'call').mockImplementation(async (method, data = {}) => {
        const result = await original(method, data);
        if (method === 'SetInputSettings' && data.inputName === 'synthetic-viewers'
            && (data.inputSettings as { text: string }).text === '0') written.resolve();
        return result;
    });
    try {
        await h.start();
        await h.runtime.viewerCountSystem.updateViewerCount('twitch', 42);
        h.bus.emit('platform:event', { platform: 'twitch', type: 'platform:stream-status', data: { isLive: 'synthetic-invalid' } });
        expect(h.runtime.viewerCountSystem.isStreamLive('twitch')).toBe(true);
        expect(h.runtime.viewerCountSystem.getViewerCount('twitch')).toBe(42);
        h.bus.emit('platform:event', { platform: 'twitch', type: 'platform:stream-status', data: { isLive: false } });
        await written.promise;
        expect(h.runtime.viewerCountSystem.isStreamLive('twitch')).toBe(false);
        expect(h.socket.writes.at(-1)?.inputSettings).toEqual({ text: '0' });
    } finally { wire.mockRestore(); await h.dispose(); }
});

test('pre-transition HTTP poll is retired and active cadence survives stale status ACK', async () => {
    const h = await createMainPresentationFixture();
    h.config.twitch.viewerCountEnabled = true;
    h.config.twitch.viewerCountSource = 'synthetic-viewers';
    const entered = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Record<string, unknown>>();
    const offlineEntered = Promise.withResolvers<void>();
    const releaseOffline = Promise.withResolvers<void>();
    const tick = Promise.withResolvers<void>();
    let gets = 0;
    const http = new EnhancedHttpClient({ logger: noOpLogger, axios: {
        get: async () => { if (++gets === 1) { entered.resolve(); return response.promise; }
            return { data: { data: [{ viewer_count: 9 }] } }; },
        post: async () => ({}), put: async () => ({}), delete: async () => ({})
    } });
    const provider = new TwitchViewerCountProvider(new TwitchApiClient(null, {}, noOpLogger, { enhancedHttpClient: http }), null,
        { channel: 'synthetic-channel' }, null, noOpLogger);
    const original = h.socket.call.bind(h.socket);
    const wire = spyOn(h.socket, 'call').mockImplementation(async (method, data = {}) => {
        const result = await original(method, data);
        if (method === 'SetInputSettings' && data.inputName === 'synthetic-viewers') {
            const text = (data.inputSettings as { text: string }).text;
            if (text === '0') { offlineEntered.resolve(); await releaseOffline.promise; }
            if (text === '9') tick.resolve();
        }
        return result;
    });
    let poll: Promise<void> | undefined;
    let offline: Promise<void> | undefined;
    const token = secrets.twitch.accessToken;
    try {
        await h.start(); secrets.twitch.accessToken = 'synthetic-token';
        const store = h.runtime.viewerCountSystem;
        store.platformProvider = () => ({ twitch: provider });
        poll = store.pollPlatform('twitch'); await entered.promise;
        offline = store.updateStreamStatus('twitch', false); await offlineEntered.promise;
        await store.updateStreamStatus('twitch', true);
        await store.updateViewerCount('twitch', 7);
        response.resolve({ data: { data: [{ viewer_count: 99 }] } }); await poll;
        expect(store.getViewerCount('twitch')).toBe(7);
        useFakeTimers();
        const baseline = getTimerCount();
        store.pollingIntervalMs = 1000;
        store.startPolling(); await tick.promise;
        releaseOffline.resolve(); await offline;
        const next = Promise.withResolvers<void>();
        store.addObserver({ getObserverId: () => 'synthetic-cadence', onViewerCountUpdate: update => {
            if (update.platform === 'twitch' && update.count === 9) next.resolve();
        } });
        advanceTimersByTime(1000); await next.promise;
        expect(gets).toBe(3);
        expect(store.getViewerCount('twitch')).toBe(9);
        store.stopPolling(); expect(getTimerCount()).toBe(baseline);
    } finally {
        response.resolve({ data: { data: [] } }); releaseOffline.resolve();
        await poll; await offline; useRealTimers(); secrets.twitch.accessToken = token;
        wire.mockRestore(); await h.dispose();
    }
});
