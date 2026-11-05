import { strict as assert } from 'node:assert';
import type { Innertube } from 'youtubei.js';
import { InnertubeFactory } from '../../src/factories/innertube-factory';
import { InnertubeService } from '../../src/services/innertube-service';
import { YouTubePlatform } from '../../src/platforms/youtube';
import { YouTubeStreamDetectionService } from '../../src/services/youtube-stream-detection-service';
import { initializeLoggingConfig } from '../../src/core/logging';

assert.equal(process.env.YOUTUBE_SDK_RETIREMENT_CHILD, '1');
const sdk: typeof import('youtubei.js') = await import(import.meta.resolve('youtubei.js'));
InnertubeFactory.configure({ importer: async () => sdk });
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(yes => { resolve = yes; });
    return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const ids = ['SYNTHETIC_A', 'SYNTHETIC_B'];
const bodies = new Map(ids.map(id => [id, { entered: deferred(), aborted: deferred(), finish: deferred(), signal: undefined as AbortSignal | undefined }]));
const batches = new Map(ids.map(id => [id, { entered: deferred(), release: deferred(), signal: undefined as AbortSignal | undefined }]));
const requests = new Map<string, number>();
const continuations = new Map<string, string[]>();
initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: false } } });
const config = { dataLoggingEnabled: false, chatMode: 'live', envFileReadEnabled: false, envFileWriteEnabled: false };
const modeHeader = (id: string, selected: string, nextStep: number) => ({ liveChatHeaderRenderer: {
    viewSelector: { sortFilterSubMenuRenderer: {
        subMenuItems: ['TOP', 'LIVE'].map(selection => ({ title: `Synthetic ${selection}`, selected: selection === selected,
            continuation: { reloadContinuationData: { continuation: `${id}:${selection}:${nextStep}` } } }))
    } }
} });
const timestamp = '2024-01-01T00:00:00.000Z';
const avatarUrl = 'https://synthetic.example.invalid/avatar.png';
const emoteUrl = 'https://synthetic.example.invalid/emote.png';
const rawActions = (id: string) => {
    const author = { authorName: { simpleText: `Synthetic ${id}` }, authorExternalChannelId: `UC_${id}`,
        authorPhoto: { thumbnails: [{ url: avatarUrl, width: 48, height: 48 }] }, authorBadges: [],
        timestampUsec: '1704067200000000', contextMenuEndpoint: {},
        contextMenuAccessibility: { accessibilityData: { label: 'Synthetic message menu' } } };
    return [
        { addChatItemAction: { item: { liveChatTextMessageRenderer: { ...author, id: `${id}_TEXT`, message: { runs: [
            { text: 'Synthetic hello ' },
            { emoji: { emojiId: 'SYNTHETIC/emote', shortcuts: [':synthetic:'], isCustomEmoji: true,
                image: { thumbnails: [{ url: emoteUrl, width: 48, height: 48 }] } } }
        ] } } } } },
        { addChatItemAction: { item: { liveChatPaidMessageRenderer: { ...author, id: `${id}_PAID`,
            message: { runs: [{ text: 'Synthetic paid message' }] }, purchaseAmountText: { simpleText: 'USD 12.34' } } } } }
    ];
};
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
        playabilityStatus: { status: 'UNPLAYABLE', reason: 'Synthetic unavailable playback' },
        videoDetails: { videoId: payload.videoId, channelId: 'UC_SYNTHETIC', title: 'Synthetic live title',
            isLive: true, isLiveContent: true, lengthSeconds: '0', viewCount: '1', thumbnail: { thumbnails: [] } }
    });
    if (endpoint.endsWith('/next')) return Response.json({ currentVideoEndpoint: { watchEndpoint: { videoId: payload.videoId } }, contents: { twoColumnWatchNextResults: {
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
        if (step === '2') {
            const batch = batches.get(id)!;
            batch.signal = init!.signal!;
            batch.entered.resolve();
            await batch.release.promise;
            return Response.json({ continuationContents: { liveChatContinuation: {
                actions: rawActions(id),
                continuations: [{ timedContinuationData: { continuation: `${id}:${mode}:3`, timeoutMs: 1000 } }]
            } } });
        }
        assert.equal(step, '3');
        const body = bodies.get(id)!;
        body.signal = init!.signal!;
        return new Response(new ReadableStream({ start(controller) {
            body.signal!.addEventListener('abort', () => {
                body.aborted.resolve();
                // Synthetic external body cleanup is cooperative but deferred.
                // The actual SDK execute/body pipeline must remain joined.
                void body.finish.promise.then(() => controller.error(body.signal!.reason));
            }, { once: true });
        }, pull() {
            // A zero-sized queue makes this a barrier for the SDK's actual body reader.
            body.entered.resolve();
            return body.finish.promise;
        } }, { highWaterMark: 0 }));
    }
    throw new Error('Unexpected synthetic SDK endpoint');
} });
const platform = new YouTubePlatform(config, {
    logger, innertubeService: service,
    streamDetectionService: new YouTubeStreamDetectionService(service, { logger })
});
const manager = platform.connectionManager;
const factory = platform._youtubeConnectionFactory;
const callbacks: string[] = [];
const events: Array<{ type: string; data: Record<string, unknown> }> = [];
const connected: string[] = [];
platform.on('platform:event', event => {
    if (event.type === 'platform:chat-connected') connected.push(String(event.data.videoId));
    else events.push(event);
});
const sdkItems: Array<{ id: string; type: string }> = [];
const assertIngress = (streamIds: string[]) => {
    assert.deepEqual(sdkItems, streamIds.flatMap(id => [
        { id: `${id}_TEXT`, type: 'LiveChatTextMessage' }, { id: `${id}_PAID`, type: 'LiveChatPaidMessage' }
    ]));
    assert.equal(events.length, streamIds.length * 2, 'exact canonical event count at the next continuation barrier');
    for (const [index, id] of streamIds.entries()) {
        const mode = id === 'SYNTHETIC_A' ? 'LIVE' : 'TOP';
        assert.deepEqual(continuations.get(id), [`${id}:INITIAL`, `${id}:${mode}:1`, `${id}:${mode}:2`, `${id}:${mode}:3`]);
        const text = events[index * 2]!;
        assert.equal(text.type, 'platform:chat-message');
        // Chat's public canonical contract has no message ID; SDK IDs above prove its parser seam.
        assert.deepEqual({ platform: text.data.platform, username: text.data.username, userId: text.data.userId,
            avatarUrl: text.data.avatarUrl, timestamp: text.data.timestamp, message: text.data.message }, {
            platform: 'youtube', username: `Synthetic ${id}`, userId: `UC_${id}`, avatarUrl, timestamp,
            message: { text: 'Synthetic hello :synthetic:', parts: [
                { type: 'text', text: 'Synthetic hello ' },
                { type: 'emote', platform: 'youtube', emoteId: 'SYNTHETIC/emote', imageUrl: emoteUrl }
            ] }
        });
        const paid = events[index * 2 + 1]!;
        assert.equal(paid.type, 'platform:gift');
        assert.deepEqual(paid.data, { type: 'platform:gift', platform: 'youtube', id: `${id}_PAID`,
            username: `Synthetic ${id}`, userId: `UC_${id}`, avatarUrl, timestamp,
            giftType: 'Super Chat', giftCount: 1, amount: 12.34, currency: 'USD', message: 'Synthetic paid message' });
    }
};

try {
    for (const id of ids) {
        platform.config.chatMode = id === 'SYNTHETIC_A' ? 'live' : 'top';
        assert.equal(await manager.connectToStream(id, async (videoId, attempt, context) => {
            const connection = await factory.createConnection(videoId, context);
            assert.equal(manager.getConnection(videoId), connection);
            connection.on('start', () => { callbacks.push(videoId); });
            connection.on('chat-update', action => {
                assert.ok(action instanceof sdk.YTNodes.AddChatItemAction);
                const item = action.item;
                assert.ok(item instanceof sdk.YTNodes.LiveChatTextMessage || item instanceof sdk.YTNodes.LiveChatPaidMessage);
                sdkItems.push({ id: item.id, type: item.type });
            });
            await factory.setupConnectionEventListeners(connection, videoId, attempt);
            return connection;
        }), true);
        await batches.get(id)!.entered.promise;
        const desiredMode = id === 'SYNTHETIC_A' ? 'LIVE' : 'TOP';
        assert.deepEqual(continuations.get(id)!.slice(1), [`${id}:${desiredMode}:1`, `${id}:${desiredMode}:2`],
            'first and subsequent post-header requests must use the configured mode chain');
        checks++;
    }
    assert.equal(events.length, 0, 'headers do not emit messages');
    assert.deepEqual(connected, ids, 'filter reloads announce readiness exactly once per stream');
    assert.equal(manager.getReadyConnectionCount(), ids.length);
    batches.get('SYNTHETIC_A')!.release.resolve();
    await bodies.get('SYNTHETIC_A')!.entered.promise;
    assertIngress(['SYNTHETIC_A']);
    checks++;
    assert.equal(service.stats.instancesCreated, 2);
    assert.equal(manager.getReadyConnectionCount(), 2);
    checks++;

    const removal = manager.removeConnection('SYNTHETIC_A');
    await bodies.get('SYNTHETIC_A')!.aborted.promise;
    let retired = false;
    void removal.then(() => { retired = true; });
    await flush();
    assert.equal(retired, false);
    assert.equal(batches.get('SYNTHETIC_B')!.signal!.aborted, false);
    assert.equal(manager.isConnectionReady('SYNTHETIC_B'), true);
    checks++;

    assert.equal(await service.withMetadataOperation({}, async client => (await client.getInfo('SYNTHETIC_METADATA')).basic_info.title), 'Synthetic live title');
    assert.equal(service.stats.instancesCreated, 3);
    checks++;

    bodies.get('SYNTHETIC_A')!.finish.resolve(); await removal;
    assert.equal(retired, true);
    assert.equal(manager.isConnectionReady('SYNTHETIC_B'), true);
    checks++;

    const before = [requests.get('SYNTHETIC_A'), callbacks.filter(id => id === 'SYNTHETIC_A').length];
    batches.get('SYNTHETIC_B')!.release.resolve();
    await bodies.get('SYNTHETIC_B')!.entered.promise;
    assertIngress(ids);
    assert.equal(bodies.get('SYNTHETIC_B')!.signal!.aborted, false);
    assert.deepEqual([requests.get('SYNTHETIC_A'), callbacks.filter(id => id === 'SYNTHETIC_A').length], before);
    checks++;

    bodies.get('SYNTHETIC_B')!.finish.resolve();
    await platform.cleanup(); await service.dispose();
    assert.equal(manager.getConnectionCount(), 0);
    assert.equal(bodies.get('SYNTHETIC_B')!.signal!.aborted, true);
    checks++;
    assertIngress(ids);
    assert.equal(checks, 9);
    console.log(`YOUTUBE_MANAGED_CHAT_SDK_OK checks=${checks}`);
} finally {
    for (const batch of batches.values()) batch.release.resolve();
    for (const body of bodies.values()) body.finish.resolve();
    await platform.cleanup(); await service.dispose();
}
