import { strict as assert } from 'node:assert';
import { setTimeout as delay } from 'node:timers/promises';
import type { Innertube } from 'youtubei.js';
import { InnertubeFactory } from '../../src/factories/innertube-factory';
import { InnertubeService } from '../../src/services/innertube-service';
import { YouTubeConnectionManager } from '../../src/platforms/youtube/youtube-connection-manager';
import { createYouTubeConnectionFactory } from '../../src/platforms/youtube/connections/youtube-connection-factory';

assert.equal(process.env.YOUTUBE_SDK_RETIREMENT_CHILD, '1');
const sdk = await import(import.meta.resolve('youtubei.js'));
InnertubeFactory.configure({ importer: async () => sdk });
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(yes => { resolve = yes; });
    return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const ids = ['SYNTHETIC_A', 'SYNTHETIC_B'];
const ready = new Map(ids.map(id => [id, deferred()]));
const bodies = new Map(ids.map(id => [id, { entered: deferred(), aborted: deferred(), finish: deferred(), signal: undefined as AbortSignal | undefined }]));
const requests = new Map<string, number>();
const continuations = new Map<string, string[]>();
const config = { dataLoggingEnabled: false, chatMode: 'live' };
const modeHeader = (id: string, selected: string, nextStep: number) => ({ liveChatHeaderRenderer: {
    viewSelector: { sortFilterSubMenuRenderer: {
        subMenuItems: ['TOP', 'LIVE'].map(selection => ({ title: `Synthetic ${selection}`, selected: selection === selected,
            continuation: { reloadContinuationData: { continuation: `${id}:${selection}:${nextStep}` } } }))
    } }
} });
let checks = 0;

const service = new InnertubeService<Innertube>({
    createWithTimeout: async (_timeout, config) => {
        const client = await InnertubeFactory.createWithConfig(config);
        assert.ok(client instanceof sdk.Innertube);
        return client as Innertube;
    }
}, { logger, creationConfig: {
    generate_session_locally: true, retrieve_innertube_config: false, enable_session_cache: false, fail_fast: true
}, fetch: async (input, init) => {
    const endpoint = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const payload = JSON.parse(String(init?.body)) as Record<string, string>;
    if (endpoint.endsWith('/player')) return Response.json({
        playabilityStatus: { status: 'OK' },
        videoDetails: { videoId: payload.videoId, channelId: 'UC_SYNTHETIC', title: 'Synthetic live title',
            isLive: true, isLiveContent: true, lengthSeconds: '0', viewCount: '1', thumbnail: { thumbnails: [] } }
    });
    if (endpoint.endsWith('/next')) return Response.json({ contents: { twoColumnWatchNextResults: {
        results: { results: { contents: [] } }, secondaryResults: { secondaryResults: { results: [] } },
        conversationBar: { liveChatRenderer: {
            continuations: [{ reloadContinuationData: { continuation: `${payload.videoId}:INITIAL` } }],
            clientMessages: { reconnectMessage: { simpleText: 'Synthetic reconnect' }, unableToReconnectMessage: { simpleText: 'Synthetic unavailable' },
                fatalError: { simpleText: 'Synthetic error' }, reconnectedMessage: { simpleText: 'Synthetic ready' }, genericError: { simpleText: 'Synthetic failure' } }
        } }
    } } });
    if (endpoint.endsWith('/updated_metadata')) return Response.json({ actions: [{ updateTitleAction: { title: { simpleText: 'Synthetic live title' } } }] });
    if (endpoint.endsWith('/live_chat/get_live_chat')) {
        const [id, mode, step] = payload.continuation!.split(':');
        assert.ok(id && ids.includes(id));
        requests.set(id, (requests.get(id) ?? 0) + 1);
        const chain = continuations.get(id) ?? [];
        chain.push(payload.continuation!);
        continuations.set(id, chain);
        // Each stream initially selects the opposite of its configured mode.
        const initialMode = id === 'SYNTHETIC_A' ? 'TOP' : 'LIVE';
        if (mode === 'INITIAL') return Response.json({ continuationContents: { liveChatContinuation: {
            header: modeHeader(id, initialMode, 1), actions: [],
            continuations: [{ timedContinuationData: { continuation: `${id}:${initialMode}:1`, timeoutMs: 1000 } }]
        } } });
        assert.ok(mode === 'TOP' || mode === 'LIVE');
        if (step === '1') return Response.json({ continuationContents: { liveChatContinuation: {
            // Model a filter reload that refreshes its selected-mode header.
            header: modeHeader(id, mode, 2), actions: [],
            continuations: [{ timedContinuationData: { continuation: `${id}:${mode}:2`, timeoutMs: 1000 } }]
        } } });
        const body = bodies.get(id)!;
        body.signal = init!.signal!;
        return new Response(new ReadableStream({ start(controller) {
            body.signal!.addEventListener('abort', () => {
                body.aborted.resolve();
                // Synthetic external body cleanup is cooperative but deferred.
                // The actual SDK execute/body pipeline must remain joined.
                void body.finish.promise.then(() => controller.error(body.signal!.reason));
            }, { once: true });
            body.entered.resolve();
        } }));
    }
    throw new Error('Unexpected synthetic SDK endpoint');
} });
const manager = new YouTubeConnectionManager(logger);
const callbacks: string[] = [];
const factory = createYouTubeConnectionFactory({ innertubeService: service, innertubeCreationTimeoutMs: 1000,
    platform: {
        logger, config,
        isCurrentYouTubeConnection: (id, attempt) => manager.isCurrentAttempt(id, attempt),
        setYouTubeConnectionReady: (id, attempt) => { manager.setConnectionReady(id, attempt); callbacks.push(id); ready.get(id)!.resolve(); },
        disconnectFromYouTubeStream: (id, reason, options) => manager.disconnectFromStream(id, reason, options?.expectedAttemptId),
        handleChatMessage() {}, logRawPlatformData: async () => {},
        _validateVideoForConnection: (_id, info) => ({ shouldConnect: !!info }),
        _handleProcessingError: () => { throw new Error('Unexpected synthetic chat processing failure'); },
        _extractMessagesFromChatItem: () => [], _shouldSkipMessage: () => false, _resolveChatItemAuthorName: () => 'Synthetic'
    }
});
try {
    for (const id of ids) {
        config.chatMode = id === 'SYNTHETIC_A' ? 'live' : 'top';
        assert.equal(await manager.connectToStream(id, async (videoId, attempt, context) => {
            const connection = await factory.createConnection(videoId, context);
            assert.equal(manager.getConnection(videoId), connection);
            await factory.setupConnectionEventListeners(connection, videoId, attempt);
            return connection;
        }), true);
        await ready.get(id)!.promise;
        await bodies.get(id)!.entered.promise;
        const desiredMode = id === 'SYNTHETIC_A' ? 'LIVE' : 'TOP';
        assert.deepEqual(continuations.get(id)!.slice(1), [`${id}:${desiredMode}:1`, `${id}:${desiredMode}:2`],
            'first and subsequent post-header requests must use the configured mode chain');
        checks++;
    }
    assert.equal(service.stats.instancesCreated, 2);
    assert.equal(manager.getReadyConnectionCount(), 2);
    checks++;

    const removal = manager.removeConnection('SYNTHETIC_A');
    await bodies.get('SYNTHETIC_A')!.aborted.promise;
    let retired = false;
    void removal.then(() => { retired = true; });
    await flush();
    assert.equal(retired, false);
    assert.equal(bodies.get('SYNTHETIC_B')!.signal!.aborted, false);
    checks++;

    assert.equal(await service.withMetadataOperation({}, async client => (await client.getInfo('SYNTHETIC_METADATA')).basic_info.title), 'Synthetic live title');
    assert.equal(service.stats.instancesCreated, 3);
    checks++;

    bodies.get('SYNTHETIC_A')!.finish.resolve(); await removal;
    assert.equal(retired, true);
    assert.equal(manager.isConnectionReady('SYNTHETIC_B'), true);
    checks++;

    const before = [requests.get('SYNTHETIC_A'), callbacks.length];
    await delay(2100);
    assert.deepEqual([requests.get('SYNTHETIC_A'), callbacks.length], before);
    checks++;

    bodies.get('SYNTHETIC_B')!.finish.resolve();
    await manager.cleanupAllConnections(); await service.dispose();
    assert.equal(manager.getConnectionCount(), 0);
    assert.equal(bodies.get('SYNTHETIC_B')!.signal!.aborted, true);
    checks++;
    assert.equal(checks, 8);
    console.log(`YOUTUBE_MANAGED_CHAT_SDK_OK checks=${checks}`);
} finally {
    for (const body of bodies.values()) body.finish.resolve();
    await manager.cleanupAllConnections(); await service.dispose();
}
