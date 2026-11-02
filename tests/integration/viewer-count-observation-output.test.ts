import { expect, test } from 'bun:test';
import { ViewerCountSystem } from '../../src/utils/viewer-count';
import { TwitchViewerCountProvider } from '../../src/utils/viewer-count-providers';
import { OBSViewerCountObserver } from '../../src/observers/obs-viewer-count-observer';
import { noOpLogger as logger } from '../helpers/mock-factories';
import { EventEmitter } from 'node:events';
import { OBSConnectionManager } from '../../src/obs/connection';
import { TikTokPlatform } from '../../src/platforms/tiktok';
import { wireStreamStatusHandlers } from '../../src/viewer-count/stream-status-handler';
import { PlatformLifecycleService } from '../../src/services/PlatformLifecycleService';
import { TwitchPlatform } from '../../src/platforms/twitch';
import { EventBus } from '../../src/core/EventBus';

test('a Twitch platform without a ready count provider reports unavailable', async () => {
    const platform = new TwitchPlatform({ enabled: false, channel: 'synthetic-channel', dataLoggingEnabled: false },
        { logger, twitchAuth: { isReady: () => true } });
    try { expect(await platform.getViewerCount()).toBeNull(); }
    finally { await platform.cleanup(); }
});

test('unknown, failed and recovered observations reach OBS without inventing zero', async () => {
    let failure = false;
    const twitch = new TwitchViewerCountProvider({ getStreamInfo: async () => {
        if (failure) throw new Error('Synthetic network failure');
        return { isLive: true, viewerCount: 7 };
    } }, { channel: 'synthetic-channel' }, logger);
    const store = new ViewerCountSystem({ platforms: { twitch }, logger,
        config: { general: { viewerCountPollingIntervalMs: 60000 } } });
    const texts: unknown[] = [];
    const observer = new OBSViewerCountObserver({ isConnected: () => true,
        call: async (_method, payload) => { texts.push((payload?.inputSettings as { text: string }).text); }
    }, logger, { config: { twitch: { viewerCountEnabled: true, viewerCountSource: 'Synthetic viewers' } },
        getViewerCountSnapshot: name => store.getViewerCountSnapshot(name) });
    store.addObserver(observer);
    try {
        await observer.initialize();
        expect(texts).toEqual(['—']);
        await store.pollPlatform('twitch');
        expect(texts).toEqual(['—', '7']);
        const complete = store.getViewerCountSnapshot('twitch');
        failure = true;
        await store.pollPlatform('twitch');
        expect(texts).toEqual(['—', '7', '—']);
        expect(store.getViewerCountSnapshot('twitch')).toMatchObject({
            count: 7, lastCompleteAt: complete.lastCompleteAt, latestOutcome: 'unavailable'
        });
        failure = false;
        await store.pollPlatform('twitch');
        expect(texts).toEqual(['—', '7', '—', '7']);
    } finally { await store.cleanup(); }
});

test('rejected scalar observations preserve history but mark the current result unavailable', async () => {
    for (const value of [null, undefined, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '7', {}]) {
        const store = new ViewerCountSystem({ platforms: { twitch: { getViewerCount: async () => value } }, logger,
            config: { general: { viewerCountPollingIntervalMs: 60000 } } });
        try {
            await store.updateViewerCount('twitch', 7);
            const complete = store.getViewerCountSnapshot('twitch');
            await store.pollPlatform('twitch');
            expect(store.getViewerCountSnapshot('twitch')).toEqual({ ...complete, latestOutcome: 'unavailable' });
        } finally { await store.cleanup(); }
    }
});

test('OBS reconnection replays the latest offline snapshot and retires its listener', async () => {
    let written = Promise.withResolvers<void>();
    const texts: unknown[] = [];
    class SyntheticSocket extends EventEmitter {
        async connect() { this.emit('Identified'); return { obsWebSocketVersion: 'synthetic' }; }
        async disconnect() { this.emit('ConnectionClosed'); }
        async call(_method: string, payload?: Record<string, unknown>) {
            texts.push((payload?.inputSettings as { text: string }).text);
            written.resolve();
            return {};
        }
    }
    const manager = new OBSConnectionManager({ obs: new SyntheticSocket(),
        config: { enabled: true, address: 'ws://synthetic.invalid', password: 'synthetic-password', connectionTimeoutMs: 1000 } });
    const store = new ViewerCountSystem({ platforms: {}, logger,
        config: { general: { viewerCountPollingIntervalMs: 60000 } } });
    const observer = new OBSViewerCountObserver(manager, logger, {
        config: { twitch: { viewerCountEnabled: true, viewerCountSource: 'Synthetic viewers' } },
        getViewerCountSnapshot: name => store.getViewerCountSnapshot(name)
    });
    store.addObserver(observer);
    try {
        await observer.initialize();
        await manager.connect();
        await written.promise;
        expect(texts).toEqual(['—']);
        await store.updateViewerCount('twitch', 24);
        await manager.disconnect();
        await store.updateStreamStatus('twitch', false);
        expect(texts).toEqual(['—', '24']);
        written = Promise.withResolvers<void>();
        await manager.connect();
        await written.promise;
        expect(texts).toEqual(['—', '24', '0']);
        await store.cleanup();
        await manager.disconnect();
        await manager.connect();
        expect(texts).toEqual(['—', '24', '0']);
    } finally {
        await store.cleanup();
        manager.dispose();
        await manager.disconnect();
    }
});

for (const retirement of ['remote close', 'explicit disconnect'] as const) {
    test(`OBS ${retirement} releases an interrupted counter write before reconnect`, async () => {
        const interrupted = Promise.withResolvers<void>();
        const started = Promise.withResolvers<void>();
        let replayed = Promise.withResolvers<void>();
        const texts: string[] = [];
        let holdNextCount = true;
        let count = 24;
        class SyntheticSocket extends EventEmitter {
            async connect() { this.emit('Identified'); return { obsWebSocketVersion: 'synthetic' }; }
            async disconnect() { this.emit('ConnectionClosed'); }
            async call(_method: string, payload?: Record<string, unknown>) {
                const text = (payload?.inputSettings as { text: string }).text;
                texts.push(text);
                if (text === '24' && holdNextCount) {
                    holdNextCount = false;
                    started.resolve();
                    await interrupted.promise;
                } else replayed.resolve();
                return {};
            }
        }
        const socket = new SyntheticSocket();
        const manager = new OBSConnectionManager({ obs: socket,
            config: { enabled: true, address: 'ws://synthetic.invalid', password: 'synthetic-password', connectionTimeoutMs: 1000 } });
        const store = new ViewerCountSystem({ platforms: { twitch: { getViewerCount: async () => count } }, logger,
            config: { general: { viewerCountPollingIntervalMs: 60000 } } });
        const observer = new OBSViewerCountObserver(manager, logger, {
            config: { twitch: { viewerCountEnabled: true, viewerCountSource: 'Synthetic viewers' } },
            getViewerCountSnapshot: name => store.getViewerCountSnapshot(name)
        });
        store.addObserver(observer);
        let poll: Promise<void> | undefined;
        try {
            await manager.connect();
            await observer.initialize();
            replayed = Promise.withResolvers<void>();
            let settled = false;
            poll = store.pollPlatform('twitch').finally(() => { settled = true; });
            await started.promise;
            if (retirement === 'remote close') socket.emit('ConnectionClosed');
            else await manager.disconnect();
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(settled).toBe(true);
            await manager.connect();
            await replayed.promise;
            count = 7;
            await store.pollPlatform('twitch');
            expect(texts).toEqual(['—', '24', '24', '7']);
            interrupted.resolve();
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(texts).toEqual(['—', '24', '24', '7']);
        } finally {
            interrupted.resolve();
            await poll;
            await store.cleanup();
            manager.dispose();
            await manager.disconnect();
        }
    });
}

test('held OBS writes finish in order and coalesce queued values to the latest state', async () => {
    const held = Promise.withResolvers<void>();
    const texts: unknown[] = [];
    const observer = new OBSViewerCountObserver({ isConnected: () => true, call: async (_method, payload) => {
        const text = (payload?.inputSettings as { text: string }).text;
        if (text === '1') await held.promise;
        texts.push(text);
    } }, logger, { config: { youtube: { viewerCountEnabled: true, viewerCountSource: 'Synthetic viewers' } } });
    try {
        const first = observer.updateObsCount('youtube', 1);
        const second = observer.updateObsCount('youtube', 2);
        const unavailable = observer.onViewerCountUnavailable({ platform: 'youtube' });
        expect(texts).toEqual([]);
        held.resolve();
        await Promise.all([first, second, unavailable]);
        expect(texts).toEqual(['1', '—']);
    } finally { held.resolve(); await observer.cleanup(); }
});

test('an OBS update at the drain completion boundary is not dropped', async () => {
    const texts: unknown[] = [];
    const observer = new OBSViewerCountObserver({ isConnected: () => true, call: async (_method, payload) => {
        texts.push((payload.inputSettings as { text: string }).text);
    } }, logger, { config: { youtube: { viewerCountEnabled: true, viewerCountSource: 'Synthetic viewers' } } });
    try {
        const first = observer.updateObsCount('youtube', 1);
        await Promise.resolve();
        const second = observer.onViewerCountUnavailable({ platform: 'youtube' });
        await Promise.all([first, second]);
        expect(texts).toEqual(['1', '—']);
    } finally { await observer.cleanup(); }
});

test('a fresh event arriving during the live transition remains the current observation', async () => {
    const store = new ViewerCountSystem({ platforms: { tiktok: { viewerCountIsEventDriven: true } }, logger,
        config: { general: { viewerCountPollingIntervalMs: 60000 } } });
    try {
        const online = store.updateStreamStatus('tiktok', true);
        await store.updateViewerCount('tiktok', 42);
        await online;
        expect(store.getViewerCountSnapshot('tiktok')).toMatchObject({ count: 42, latestOutcome: 'complete' });
    } finally { await store.cleanup(); }
});

test('TikTok event counts are not refreshed by cache polling and transport loss remains unknown', async () => {
    const tiktok = new TikTokPlatform({ enabled: false, dataLoggingEnabled: false,
        envFileReadEnabled: false, envFileWriteEnabled: false }, { logger });
    let clock = 100;
    const store = new ViewerCountSystem({ platforms: { tiktok }, logger,
        config: { general: { viewerCountPollingIntervalMs: 60000 } }, timeProvider: { now: () => clock } });
    let receive!: (event?: unknown) => Promise<void>;
    const unbind = wireStreamStatusHandlers({ viewerCountSystem: store,
        eventBus: { subscribe: (_name, handler) => { receive = handler; return () => {}; } } });
    const texts: unknown[] = [];
    const observer = new OBSViewerCountObserver({ isConnected: () => true, call: async (_method, payload) => {
        texts.push((payload.inputSettings as { text: string }).text);
    } }, logger, { config: { tiktok: { viewerCountEnabled: true, viewerCountSource: 'Synthetic viewers' } },
        getViewerCountSnapshot: name => store.getViewerCountSnapshot(name) });
    store.addObserver(observer);
    const status = (isLive: boolean, value?: string) => receive({ platform: 'tiktok', type: 'platform:stream-status',
        data: { isLive, status: value } });
    try {
        await status(true);
        await store.updateViewerCount('tiktok', 8);
        const previous = store.getViewerCountSnapshot('tiktok');
        clock = 200;
        store.startPolling();
        await store.pollPlatform('tiktok');
        expect(store.pollingHandles.tiktok).toBeUndefined();
        expect(store.getViewerCountSnapshot('tiktok')).toEqual(previous);
        await status(false, 'unavailable');
        expect(texts).toEqual(['—', '8', '—']);
        expect(store.getViewerCountSnapshot('tiktok')).toMatchObject({ count: 8, lastCompleteAt: 100, latestOutcome: 'unavailable' });
        await status(true);
        await store.updateViewerCount('tiktok', 0);
        expect(texts.at(-1)).toBe('0');
        await status(false, 'stream-ended');
        expect(store.getViewerCountSnapshot('tiktok')).toMatchObject({ count: 0, latestOutcome: 'complete' });
    } finally { unbind(); await store.cleanup(); await tiktok.cleanup(); }
});

test('retiring a failed platform invalidates its displayed count and a replacement recovers', async () => {
    const bus = new EventBus();
    const lifecycle = new PlatformLifecycleService({ eventBus: bus, logger });
    const makePlatform = (count: number) => {
        const platform = new TwitchPlatform({ enabled: false, channel: 'synthetic-channel', dataLoggingEnabled: false },
            { logger, twitchAuth: { isReady: () => true } });
        platform.viewerCountProvider = new TwitchViewerCountProvider({ getStreamInfo: async () => ({ isLive: true, viewerCount: count }) }, { channel: 'synthetic-channel' }, logger);
        return platform;
    };
    lifecycle.platforms.twitch = makePlatform(42);
    const store = new ViewerCountSystem({ platformProvider: () => lifecycle.getAllPlatforms(), logger,
        config: { general: { viewerCountPollingIntervalMs: 60000 } } });
    const unbind = wireStreamStatusHandlers({ eventBus: bus, viewerCountSystem: store, logger });
    const texts: unknown[] = [];
    let written = Promise.withResolvers<void>();
    const observer = new OBSViewerCountObserver({ isConnected: () => true, call: async (_method, payload) => {
        texts.push((payload.inputSettings as { text: string }).text);
        written.resolve();
    } }, logger, { config: { twitch: { viewerCountEnabled: true, viewerCountSource: 'Synthetic viewers' } },
        getViewerCountSnapshot: name => store.getViewerCountSnapshot(name) });
    store.addObserver(observer);
    try {
        await observer.initialize();
        await store.pollPlatform('twitch');
        const previous = store.getViewerCountSnapshot('twitch');
        written = Promise.withResolvers<void>();
        await lifecycle.markPlatformFailure('twitch', new Error('Synthetic authentication failure'));
        await written.promise;
        expect(lifecycle.getAllPlatforms()).toEqual({});
        expect(texts).toEqual(['—', '42', '—']);
        expect(store.getViewerCountSnapshot('twitch')).toMatchObject({ count: 42,
            lastCompleteAt: previous.lastCompleteAt, latestOutcome: 'unavailable' });
        lifecycle.platforms.twitch = makePlatform(7);
        await store.updateStreamStatus('twitch', true);
        await store.pollPlatform('twitch');
        expect(texts.at(-1)).toBe('7');
    } finally { unbind(); await store.cleanup(); await lifecycle.disconnectAll(); bus.removeAllListeners(); }
});
