import { describe, test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { InnertubeService } from '../../../../../src/services/innertube-service';
import { YouTubeConnectionManager } from '../../../../../src/platforms/youtube/youtube-connection-manager';
import { createYouTubeConnectionFactory } from '../../../../../src/platforms/youtube/connections/youtube-connection-factory';
import { noOpLogger } from '../../../../helpers/mock-factories';
import { YouTubePlatform } from '../../../../../src/platforms/youtube';

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(yes => { resolve = yes; });
    return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

function fixture(options: { fail?: 'on' | 'start'; timeoutMs?: number; message?: () => Promise<void>;
    hold?: 'create' | 'create-cleanup' | 'getInfo' | 'getLiveChat'; setupBody?: boolean; stageDelayMs?: number;
    reenter?: 'on' | 'start';
} = {}) {
    const manager = new YouTubeConnectionManager(noOpLogger);
    const calls: string[] = [], signals = new Map<string, AbortSignal>();
    const chats: Array<EventEmitter & { start(): void; stop(): void; applyFilter(): void }> = [];
    const entered = deferred(), release = deferred();
    const service = new InnertubeService({ createWithTimeout: async (_timeout, config) => {
        if (options.hold === 'create-cleanup') {
            try { await (await (config!.fetch as (input: string) => Promise<Response>)('https://synthetic.invalid/initialization')).json(); }
            finally { entered.resolve(); await release.promise; }
        }
        if (options.hold === 'create') { entered.resolve(); await release.promise; }
        if (options.stageDelayMs) await delay(options.stageDelayMs);
        const fetch = config!.fetch as (input: string) => Promise<Response>;
        return { getInfo: async (id: string) => {
            if (options.hold === 'getInfo') { entered.resolve(); await release.promise; }
            if (options.stageDelayMs) await delay(options.stageDelayMs);
            if (options.setupBody) await (await fetch('https://synthetic.invalid/setup-body')).json();
            const chat = new EventEmitter();
            const sdk = Object.assign(chat, {
                start() {
                    calls.push(`start:${id}`);
                    expect(manager.getConnection(id)).not.toBeNull();
                    if (options.reenter === 'start') void manager.removeConnection(id);
                    if (options.fail === 'start') throw new Error('synthetic start failure');
                    chat.emit('start', { header: { view_selector: { sub_menu_items: [{ continuation: 'top' }, { continuation: 'live' }] } } });
                    void fetch(`https://synthetic.invalid/${id}`).then(response => response.json()).catch(() => {});
                },
                stop() { calls.push(`stop:${id}`); },
                applyFilter() { calls.push(`filter:${id}`); }
            });
            const on = sdk.on.bind(sdk);
            sdk.on = (event, handler) => {
                calls.push(`on:${id}`);
                expect(manager.getConnection(id)).not.toBeNull();
                if (options.reenter === 'on') void manager.removeConnection(id);
                if (options.fail === 'on') throw new Error('synthetic listener failure');
                return on(event, handler);
            };
            chats.push(sdk);
            return { getLiveChat: async () => {
                if (options.hold === 'getLiveChat') { entered.resolve(); await release.promise; }
                if (options.stageDelayMs) await delay(options.stageDelayMs);
                return sdk;
            } };
        } };
    } }, { logger: noOpLogger, fetch: async (input, init) => {
        signals.set(new URL(String(input)).pathname.slice(1), init!.signal!);
        return new Response(new ReadableStream({ start(controller) {
            init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason), { once: true });
        } }));
    } });
    const platform = {
        logger: noOpLogger, config: { chatMode: 'live' },
        isCurrentYouTubeConnection: (id: string, attempt: number) => manager.isCurrentAttempt(id, attempt),
        setYouTubeConnectionReady: (id: string, attempt: number) => manager.setConnectionReady(id, attempt),
        disconnectFromYouTubeStream: (id: string, reason: string, settings?: { expectedAttemptId?: number }) => manager.disconnectFromStream(id, reason, settings?.expectedAttemptId),
        handleChatMessage: options.message ?? (async () => {}),
        logRawPlatformData: async () => {},
        _validateVideoForConnection: () => ({ shouldConnect: true }),
        _handleProcessingError: () => { throw new Error('synthetic reporter'); },
        _extractMessagesFromChatItem: () => [], _shouldSkipMessage: () => false,
        _resolveChatItemAuthorName: () => 'Synthetic author'
    };
    const factory = createYouTubeConnectionFactory({ platform, innertubeService: service,
        innertubeCreationTimeoutMs: options.timeoutMs ?? 1000 });
    const connect = (id: string) => manager.connectToStream(id, async (videoId, attemptId, context) => {
        const connection = await factory.createConnection(videoId, context);
        await factory.setupConnectionEventListeners(connection, videoId, attemptId);
        return connection;
    });
    return { manager, service, chats, calls, signals, connect, entered, release };
}

describe('managed YouTube chat ownership', () => {
    test('adopts before binding/start, preserves early READY, and polling escapes the setup deadline', async () => {
        const f = fixture({ timeoutMs: 20 });
        try {
            expect(await f.connect('synthetic-a')).toBe(true);
            expect(f.manager.getConnectionStatus('synthetic-a')?.state).toBe('ready');
            expect(f.calls).toContain('filter:synthetic-a');
            await delay(50);
            expect(f.signals.get('synthetic-a')!.aborted).toBe(false);
        } finally { await f.manager.cleanupAllConnections(); await f.service.dispose(); }
        expect(f.calls.filter(call => call === 'stop:synthetic-a')).toHaveLength(1);
    });

    for (const fail of ['on', 'start'] as const) test(`${fail} failure retires the exact resource despite a throwing reporter`, async () => {
        const f = fixture({ fail });
        try {
            expect(await f.connect('synthetic-failure')).toBe(false);
            expect(f.manager.hasConnection('synthetic-failure')).toBe(false);
            expect(f.calls.filter(call => call === 'stop:synthetic-failure')).toHaveLength(1);
        } finally { await f.manager.cleanupAllConnections(); await f.service.dispose(); }
    });

    test('independent streams use fresh clients and retirement detaches only owned listeners', async () => {
        const f = fixture();
        try {
            expect(await f.connect('synthetic-a')).toBe(true);
            expect(await f.connect('synthetic-b')).toBe(true);
            expect(f.service.stats.instancesCreated).toBe(2);
            let sdkObserver = 0;
            f.chats[0]!.on('start', () => { sdkObserver++; });
            await f.manager.removeConnection('synthetic-a');
            expect(f.signals.get('synthetic-a')!.aborted).toBe(true);
            expect(f.signals.get('synthetic-b')!.aborted).toBe(false);
            f.chats[0]!.emit('start', {});
            f.chats[0]!.emit('end'); await flush();
            expect(sdkObserver).toBe(1);
            expect(f.manager.isConnectionReady('synthetic-b')).toBe(true);
            expect(f.manager.getActiveVideoIds()).toEqual(['synthetic-b']);
            expect(await f.service.withMetadataOperation({}, async () => 'metadata alive')).toBe('metadata alive');
        } finally { await f.manager.cleanupAllConnections(); await f.service.dispose(); }
    });

    test('event callback actual finally completion is joined, not only its cancellation race', async () => {
        const entered = deferred(), cleaning = deferred(), finish = deferred();
        const f = fixture({ message: async () => {
            entered.resolve();
            try {
                await new Promise<void>((_resolve, reject) => {
                    const signal = f.signals.get('synthetic-callback')!;
                    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
                });
            } finally { cleaning.resolve(); await finish.promise; }
        } });
        try {
            await f.connect('synthetic-callback');
            f.chats[0]!.emit('chat-update', { author: { id: 'synthetic-author', name: 'Synthetic' }, text: 'Synthetic message' });
            await entered.promise;
            const removal = f.manager.removeConnection('synthetic-callback');
            await cleaning.promise;
            let retired = false;
            void removal.then(() => { retired = true; });
            await flush(); expect(retired).toBe(false);
            finish.resolve(); await removal;
            expect(retired).toBe(true);
        } finally { finish.resolve(); await f.manager.cleanupAllConnections(); await f.service.dispose(); }
    });

    for (const hold of ['create', 'getInfo', 'getLiveChat'] as const) test(`cancel during ${hold} prevents late adoption and stops only the acquired chat`, async () => {
        const f = fixture({ hold });
        const connecting = f.connect('synthetic-pending');
        try {
            await f.entered.promise;
            const cleanup = f.manager.cleanupAllConnections();
            expect(f.manager.hasConnection('synthetic-pending')).toBe(false);
            f.release.resolve();
            await cleanup;
            expect(await connecting).toBe(false);
            await flush();
            expect(f.calls.filter(call => call.startsWith('start:'))).toHaveLength(0);
            expect(f.calls.filter(call => call.startsWith('stop:'))).toHaveLength(hold === 'getLiveChat' ? 1 : 0);
        } finally { f.release.resolve(); await f.manager.cleanupAllConnections(); await f.service.dispose(); await connecting; }
    });

    test('one complete setup budget spans creation, info and getLiveChat rather than restarting per stage', async () => {
        const f = fixture({ stageDelayMs: 20, timeoutMs: 50 });
        try {
            expect(await f.connect('synthetic-budget')).toBe(false);
            expect(f.calls.filter(call => call.startsWith('start:'))).toHaveLength(0);
            expect(f.calls.filter(call => call.startsWith('stop:'))).toHaveLength(1);
        } finally { await f.manager.cleanupAllConnections(); await f.service.dispose(); }
    });

    test('cancellation during client creation joins actual SDK initialization finally cleanup', async () => {
        const f = fixture({ hold: 'create-cleanup' });
        const connecting = f.connect('synthetic-initializing');
        try {
            await flush();
            expect(f.signals.has('initialization')).toBe(true);
            const cleanup = f.manager.cleanupAllConnections();
            await f.entered.promise;
            let retired = false;
            void cleanup.then(() => { retired = true; });
            await flush();
            expect(retired).toBe(false);
            f.release.resolve(); await cleanup;
            expect(await connecting).toBe(false);
        } finally { f.release.resolve(); await f.manager.cleanupAllConnections(); await f.service.dispose(); await connecting; }
    });

    test('setup deadline aborts the SDK response body through the owner scope', async () => {
        const f = fixture({ setupBody: true, timeoutMs: 20 });
        try {
            expect(await f.connect('synthetic-setup-body')).toBe(false);
            expect(f.signals.get('setup-body')!.aborted).toBe(true);
            expect(f.chats).toHaveLength(0);
        } finally { await f.manager.cleanupAllConnections(); await f.service.dispose(); }
    });

    for (const reenter of ['on', 'start'] as const) test(`synchronous retirement during ${reenter} cannot start or retain a retired resource`, async () => {
        const f = fixture({ reenter });
        try {
            expect(await f.connect('synthetic-reentrant')).toBe(false);
            expect(f.manager.hasConnection('synthetic-reentrant')).toBe(false);
            expect(f.calls.filter(call => call === 'stop:synthetic-reentrant')).toHaveLength(1);
        } finally { await f.manager.cleanupAllConnections(); await f.service.dispose(); }
    });

    test('root adapter lazily rejects missing ownership and uses the real owner for acquired chat', async () => {
        const dependencies = {
            logger: noOpLogger,
            streamDetectionService: { detectLiveStreams: async () => ({ success: true, videoIds: [] }) }
        };
        const missing = new YouTubePlatform({ enabled: true, username: 'synthetic-channel' }, dependencies);
        expect(await missing.connectToYouTubeStream('synthetic-missing')).toBe(false);
        await missing.cleanup();
        const emitter = new EventEmitter();
        const sent: unknown[] = [];
        const chat = Object.assign(emitter, { start() { emitter.emit('start', {}); }, stop() {},
            sendMessage: async (message: unknown) => { sent.push(message); return true; }
        });
        const service = new InnertubeService({ createWithTimeout: async () => ({ getInfo: async () => ({
            basic_info: { id: 'synthetic-root', is_live: true },
            page: [{}, { current_video_endpoint: { payload: { videoId: 'synthetic-root' } } }],
            livechat: { continuation: 'SYNTHETIC_CHAT_CONTINUATION', is_replay: false }, getLiveChat: async () => chat
        }) }) }, { logger: noOpLogger });
        const root = new YouTubePlatform({ enabled: true, username: 'synthetic-channel' }, { ...dependencies, innertubeService: service });
        const events: unknown[] = [];
        root.on('platform:event', event => { events.push(event); });
        try {
            expect(await root.connectToYouTubeStream('synthetic-root')).toBe(true);
            expect(root.connectionManager.isConnectionReady('synthetic-root')).toBe(true);
            expect(await root.sendMessage('Synthetic outgoing message')).toBe(true);
            expect(sent).toEqual(['Synthetic outgoing message']);
            chat.emit('chat-update', { author: { id: 'synthetic-author', name: 'Synthetic' }, text: 'Synthetic live message' });
            await flush();
            const liveEvents = events.length;
            await root.connectionManager.removeConnection('synthetic-root');
            chat.emit('start', {}); chat.emit('end');
            chat.emit('chat-update', { author: { id: 'synthetic-author', name: 'Synthetic' }, text: 'Synthetic late message' });
            await flush();
            expect(events.length).toBe(liveEvents);
        } finally { await root.cleanup(); await service.dispose(); }
    });
});
