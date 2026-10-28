// Run directly with Bun, outside bun:test's global SDK mock preload.
import { strict as assert } from 'node:assert';
import type { Innertube } from 'youtubei.js';
import { InnertubeFactory } from '../../src/factories/innertube-factory';
import { InnertubeService } from '../../src/services/innertube-service';

const sdkUrl = import.meta.resolve('youtubei.js');
assert.equal(process.env.YOUTUBE_SDK_RETIREMENT_CHILD, '1', 'run through the isolated SDK child owner');
let checks = 0;
const sdk = await import(sdkUrl);
assert.equal(typeof sdk.Innertube.create, 'function');
InnertubeFactory.configure({ importer: async () => sdk });
const logger = { error: () => {}, debug: () => {}, warn: () => {} };
const fixture = () => ({
    metadata: { channelMetadataRenderer: { title: 'Synthetic channel', externalId: 'UC_SYNTHETIC' } },
    contents: { twoColumnBrowseResultsRenderer: { tabs: [
        { tabRenderer: { title: 'Home', selected: true, endpoint: { browseEndpoint: { browseId: 'UC_SYNTHETIC' } } } },
        { tabRenderer: { title: 'Live', endpoint: { commandMetadata: { webCommandMetadata: { url: '/@synthetic/streams', apiUrl: '/youtubei/v1/browse' } }, browseEndpoint: { browseId: 'UC_SYNTHETIC', params: 'synthetic-streams' } } } }
    ] } }
});
let entered!: () => void;
const bodyEntered = new Promise<void>(resolve => { entered = resolve; });
const cancel = new AbortController();
let heldLiveResponse = false;
const createClient = async (config?: Record<string, unknown>) => {
    const client = await InnertubeFactory.createWithConfig(config);
    assert.ok(client instanceof sdk.Innertube, 'must exercise actual SDK, not global mock');
    return client as Innertube;
};
const factory = {
    createWithConfig: createClient,
    createWithTimeout: async (_timeout?: number, config?: Record<string, unknown>) => createClient(config)
};
const service = new InnertubeService<Innertube>(factory, {
    logger,
    creationConfig: { generate_session_locally: true, retrieve_innertube_config: false, enable_session_cache: false, fail_fast: true },
    fetch: async (_input, init) => {
        const payload = JSON.parse(String(init?.body));
        if (payload.params === 'synthetic-streams' && !heldLiveResponse) {
            heldLiveResponse = true;
            const signal = init!.signal!;
            return new Response(new ReadableStream({ start(controller) {
                signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
                entered();
            } }));
        }
        return Response.json(fixture());
    }
});
// A per-operation continuation must retain its own signal after awaited SDK work.
const a = service.withMetadataOperation({ signal: cancel.signal }, async client => {
    assert.ok(client.session.http);
    const channel = await client.getChannel('UC_SYNTHETIC');
    const streams = await channel.getLiveStreams();
    return streams.metadata?.title;
}).catch(error => error);
const b = service.withMetadataOperation({}, async client => {
    const channel = await client.getChannel('UC_SYNTHETIC');
    await bodyEntered;
    const streams = await channel.getLiveStreams();
    return streams.metadata?.title;
});
await bodyEntered;
cancel.abort(new Error('synthetic cancelled chain'));
assert.match((await a).message, /synthetic cancelled chain/);
assert.equal(await b, 'Synthetic channel');
assert.equal(service.stats.instancesCreated, 1);
checks += 1;
const chatA = await service.createChatClient();
const chatB = await service.createChatClient();
assert.notEqual(chatA.client, chatB.client);
checks += 1;
let chatEntered!: () => void;
const chatStarted = new Promise<void>(resolve => { chatEntered = resolve; });
let chatSignal!: AbortSignal;
// Start a real SDK body read from inside a short metadata scope. run() must escape it.
const setupCancel = new AbortController();
const scopedChatService = new InnertubeService<Innertube>(factory, {
    logger,
    creationConfig: { generate_session_locally: true, retrieve_innertube_config: false, enable_session_cache: false, fail_fast: true },
    fetch: async (_input, init) => {
        chatSignal = init!.signal!;
        return new Response(new ReadableStream({ start(controller) {
            chatSignal.addEventListener('abort', () => controller.error(chatSignal.reason), { once: true });
            chatEntered();
        } }));
    }
});
const scopedChat = await scopedChatService.createChatClient();
let chatWork!: Promise<unknown>;
await scopedChatService.withMetadataOperation({ signal: setupCancel.signal }, async () => {
    chatWork = scopedChat.run(client => client.actions.execute('/browse', {})).catch(error => error);
    await chatStarted;
});
setupCancel.abort(new Error('synthetic setup retired'));
assert.equal(chatSignal.aborted, false);
checks += 1;
await scopedChat.dispose();
assert.match(String(await chatWork), /disposed/);
checks += 1;
await scopedChatService.dispose();
await chatA.dispose();
assert.throws(() => chatA.run(client => client.getChannel('UC_SYNTHETIC')), /disposed/);
checks += 1;
assert.equal(await chatB.run(async client => (await client.getChannel('UC_SYNTHETIC')).metadata?.title), 'Synthetic channel');
checks += 1;
await chatB.dispose();
await service.dispose();
assert.equal(service.dispose(), service.dispose());
checks += 1;

// Actual Session initialization remains cancellable before a client can be published.
let initEntered!: () => void;
const initializing = new Promise<void>(resolve => { initEntered = resolve; });
let initSignal!: AbortSignal;
const remote = new InnertubeService<Innertube>(factory, {
    logger,
    creationConfig: { generate_session_locally: false, enable_session_cache: false, fail_fast: true },
    fetch: async (_input, init) => {
        initSignal = init!.signal!;
        return new Response(new ReadableStream({ start(controller) {
            initSignal.addEventListener('abort', () => controller.error(initSignal.reason), { once: true });
            initEntered();
        } }));
    }
});
const pendingInit = remote.withMetadataOperation({}, async client => client.session.context.client.clientName).catch(error => error);
await initializing;
await remote.dispose();
assert.ok(initSignal.aborted);
assert.match(String(await pendingInit), /disposed/);
assert.equal(remote.stats.instancesCreated, 0);
checks += 1;

// A native per-request deadline covers SDK JSON-body consumption, not just headers.
const budget = new InnertubeService<Innertube>(factory, {
    logger, requestTimeoutMs: 20,
    creationConfig: { generate_session_locally: true, retrieve_innertube_config: false, enable_session_cache: false, fail_fast: true },
    fetch: async (_input, init) => new Response(new ReadableStream({ start(controller) {
        const signal = init!.signal!;
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    } }))
});
// Use a long operation budget to distinguish the native request deadline.
await assert.rejects(budget.withMetadataOperation({ timeoutMs: 2000 }, async client => client.actions.execute('/browse', {})), /timed out|timeout/i);
await budget.dispose();
checks += 1;
assert.equal(checks, 9);
console.log(`YOUTUBE_OWNED_SDK_OK checks=${checks}`);
