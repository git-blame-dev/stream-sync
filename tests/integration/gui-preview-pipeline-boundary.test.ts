import { describe, it, expect } from 'bun:test';
import { get, createServer, type ClientRequest, type IncomingMessage } from 'node:http';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Socket } from 'node:net';
import {
    buildPreviewConfig, buildPreviewScenarioEvents, createPreviewPipeline,
    createPreviewIngestAdapters, runGuiPreview,
} from '../../scripts/local/gui-preview';
import { EventBus } from '../../src/core/EventBus';
import { createGuiTransportService } from '../../src/services/gui/gui-transport-service';
import { createTikTokGiftAnimationResolver } from '../../src/services/tiktok-gift-animation/resolver';
import { DEMO_CHARACTER_CATALOG } from '../../gui/src/demo/demo-catalog';
import { zipFixture } from '../helpers/bounded-zip-fixture';
import { safeDelay } from '../../src/utils/timeout-validator';
import { waitForDelay } from '../helpers/time-utils';
import { useFakeTimers, useRealTimers, advanceTimersByTime, getTimerCount } from '../helpers/bun-timers';

type RecordValue = Record<string, any>;
const quiet = { debug() { }, info() { }, warn() { }, error() { }, console() { } };

async function until(condition: () => boolean, description: string) {
    for (let attempt = 0; attempt < 1000; attempt++) {
        if (condition()) return;
        await waitForDelay(1);
    }
    throw new Error(`Missing ${description}`);
}
async function flush() { for (let turn = 0; turn < 100; turn++) await Promise.resolve(); }
function deferred() {
    let resolve = () => { };
    return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}
function isolatedConfig() {
    const config = buildPreviewConfig() as RecordValue;
    expect(config.general.envFileReadEnabled).toBe(false);
    expect(config.general.envFileWriteEnabled).toBe(false);
    config.logging.file.enabled = false;
    config.logging.chat.enabled = false;
    config.gui.port = 0;
    config.gui.enableOperator = false;
    return config;
}

// A deadline bounds failed I/O; fake-scheduler callers drive registered time.
async function bounded<T>(work: Promise<T>, description: string): Promise<T> {
    const controller = new AbortController();
    const cancelled = new Error('Owned deadline cancelled');
    const deadline = safeDelay(2000, 2000, description, controller.signal).then(
        () => ({ kind: 'deadline' as const }),
        error => { if (error !== cancelled) throw error; return { kind: 'cancelled' as const }; },
    );
    const outcome = work.then(value => ({ kind: 'value' as const, value }), error => ({ kind: 'error' as const, error }));
    try {
        const result = await Promise.race([outcome, deadline]);
        if (result.kind === 'value') return result.value;
        if (result.kind === 'error') throw result.error;
        throw new Error(`Timed out: ${description}`);
    } finally { controller.abort(cancelled); await deadline; }
}

async function readHttp(url: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const work = (async () => {
        const response = await fetch(url, { ...init, signal: controller.signal });
        return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
    })();
    try { return await bounded(work, 'preview HTTP response body'); }
    finally { controller.abort(); await bounded(Promise.allSettled([work]), 'HTTP request cancellation'); }
}

// Native HTTP is the GUI boundary. Readiness is observed immediately, including
// stdout-created readers, and close joins native termination before detaching.
function connectFeed(baseUrl: string) {
    const packets: RecordValue[] = [];
    let response: IncomingMessage | undefined;
    let failure: unknown;
    let ended = false;
    let closing = false;
    let requestClosed = false;
    let responseClosed = false;
    let callbacks = 0;
    let resolveReady = () => { };
    let rejectReady = (_error: unknown) => { };
    const readiness = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const readyOutcome = readiness.then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
    let resolveClosed = () => { };
    const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
    const finishClose = () => { if (requestClosed && (!response || responseClosed)) resolveClosed(); };
    const fail = (error: unknown) => { failure ??= error; rejectReady(error); };
    const readyController = new AbortController();
    const readyCancelled = new Error('Feed readiness deadline cancelled');
    let buffer = '';
    const onData = (chunk: string) => {
        callbacks++;
        buffer += chunk;
        let separator: number;
        while ((separator = buffer.indexOf('\n\n')) !== -1) {
            const packet = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            const data = packet.split('\n').find(line => line.startsWith('data:'));
            if (data) {
                try { packets.push(JSON.parse(data.slice(5))); }
                catch (error) { fail(error); }
            }
        }
    };
    const onError = (error: Error) => { callbacks++; fail(error); };
    const onEnd = () => { callbacks++; ended = true; };
    const onResponseClose = () => { callbacks++; responseClosed = true; finishClose(); };
    const onResponse = (incoming: IncomingMessage) => {
        callbacks++;
        response = incoming;
        incoming.once('close', onResponseClose);
        incoming.on('error', onError);
        if (closing) { incoming.destroy(); return; }
        if (incoming.statusCode !== 200) { fail(new Error(`SSE status ${incoming.statusCode}`)); incoming.destroy(); return; }
        readyController.abort(readyCancelled);
        incoming.setEncoding('utf8');
        incoming.on('data', onData);
        incoming.on('end', onEnd);
        resolveReady();
    };
    const request: ClientRequest = get(`${baseUrl}/gui/events`, { agent: false }, onResponse);
    const onRequestClose = () => {
        callbacks++; requestClosed = true;
        rejectReady(new Error('Preview feed closed before readiness'));
        finishClose();
    };
    request.on('error', onError);
    request.once('close', onRequestClose);
    const readyDeadline = safeDelay(1000, 1000, 'feed readiness', readyController.signal).then(
        () => { const error = new Error('Preview feed readiness timeout'); fail(error); request.destroy(error); },
        error => { if (error !== readyCancelled) { fail(error); request.destroy(); } },
    );
    const ready = bounded(readyOutcome, 'preview feed readiness').then(result => {
        if (!result.ok) throw result.error;
    });
    // Cache and observe the public readiness promise as well as the native state.
    const observedReady = ready.then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
    let closePromise: Promise<void> | undefined;
    return {
        packets,
        ready() { return ready; },
        assertHealthy() { expect(failure).toBeUndefined(); expect(ended).toBe(false); },
        get callbacks() { return callbacks; },
        get terminated() { return requestClosed && (!response || responseClosed); },
        close() {
            if (closePromise) return closePromise;
            closing = true;
            rejectReady(new Error('Preview feed closed before readiness'));
            readyController.abort(readyCancelled);
            response?.destroy(); request.destroy();
            closePromise = (async () => {
                try { await bounded(closed, 'preview feed close'); await readyOutcome; await readyDeadline; await observedReady; }
                finally {
                    request.off('response', onResponse); request.off('error', onError);
                    request.off('close', onRequestClose);
                    response?.off('data', onData); response?.off('end', onEnd);
                    response?.off('error', onError); response?.off('close', onResponseClose);
                }
            })();
            return closePromise;
        },
    };
}

async function driveFake<T>(work: Promise<T>, description: string) {
    let result: { ok: true; value: T } | { ok: false; error: unknown } | undefined;
    const joined = work.then(value => { result = { ok: true, value }; }, error => { result = { ok: false, error }; });
    for (let turn = 0; turn < 1000 && !result; turn++) {
        await yieldTurn(); advanceTimersByTime(10); await flush();
    }
    if (!result) throw new Error(`Fake scheduler did not settle: ${description}`);
    await joined;
    if (!result.ok) throw result.error;
    return result.value;
}

function startCommand(options: Parameters<typeof runGuiPreview>[0]) {
    const cancellation = new AbortController();
    const shutdown = deferred();
    const keptOpen = deferred();
    const cancelled = new Error('Synthetic preview command cancelled');
    let settled = false;
    const run = runGuiPreview({
        ...options,
        // Existing public delay input, with real scheduling and owned cancellation.
        // Zero stays immediate, exactly as createPreviewDelay specifies.
        delay: ms => ms === 0 ? Promise.resolve() : safeDelay(ms, ms, 'preview test lifetime', cancellation.signal),
        waitForShutdownImpl: async () => { keptOpen.resolve(); await shutdown.promise; },
    });
    const outcome = run.then(() => ({ ok: true as const }), error => ({ ok: false as const, error })).then(result => { settled = true; return result; });
    return {
        outcome, shutdown, keptOpen, cancelled,
        get settled() { return settled; },
        waitFor<T>(milestone: Promise<T>, description: string) {
            return bounded(Promise.race([milestone, outcome.then(result => {
                if (!result.ok) throw result.error;
                throw new Error(`Command completed before ${description}`);
            })]), description);
        },
        async close(fakeTimers = false) {
            // Signal both owned inputs before joining; stopping the server first
            // would strand the script's getSseClientCount connection gate.
            cancellation.abort(cancelled); shutdown.resolve(); keptOpen.resolve();
            if (fakeTimers) {
                for (let turn = 0; turn < 1000 && !settled; turn++) {
                    advanceTimersByTime(1000); await flush(); await yieldTurn();
                }
            }
            if (fakeTimers && !settled) throw new Error('Fake scheduler did not retire preview command');
            return await bounded(outcome, 'preview command retirement');
        },
    };
}

async function composition(afterPipeline?: (root: string, bus: EventBus) => void) {
    const root = await mkdtemp(join(tmpdir(), 'synthetic-preview-'));
    let pipeline: ReturnType<typeof createPreviewPipeline> | undefined;
    let service: ReturnType<typeof createGuiTransportService> | undefined;
    let feed: ReturnType<typeof connectFeed> | undefined;
    const dispose = async () => {
        try { await feed?.close(); }
        finally {
            try { await service?.stop(); }
            finally {
                try { await pipeline?.dispose(); }
                finally { await rm(root, { recursive: true, force: true }); }
            }
        }
    };
    try {
        const config = isolatedConfig();
        const bus = new EventBus();
        const activePipeline = createPreviewPipeline({ config, logger: quiet, eventBus: bus });
        pipeline = activePipeline;
        afterPipeline?.(root, bus);
        const activeService = createGuiTransportService({ config, logger: quiet, eventBus: bus, assetsRoot: root, runtimeAssetRoots: [root] });
        service = activeService;
        await activeService.start();
        const address = activeService.getAddress();
        if (!address || typeof address === 'string') throw new Error('Missing native preview address');
        const baseUrl = `http://127.0.0.1:${address.port}`;
        feed = connectFeed(baseUrl); await feed.ready();
        const adapters = createPreviewIngestAdapters({ config, logger: quiet, emitPlatformEvent: event => activePipeline.emitIngestEvent(event) });
        return { root, config, bus, pipeline: activePipeline, service: activeService, feed, baseUrl, adapters, dispose };
    } catch (error) { await dispose(); throw error; }
}

describe('GUI preview actual owner boundary integration', () => {
    it('delivers all scenario row types, native avatars and member roles over HTTP with the product default no-op resolver', async () => {
        const h = await composition();
        const effects: unknown[] = [];
        const off = h.bus.subscribe('display:gift-animation', value => { effects.push(value); });
        try {
            for (const event of buildPreviewScenarioEvents()) await h.adapters[event.adapter].ingest(event.rawEvent);
            const required = ['chat', 'command', 'greeting', 'farewell', 'platform:follow', 'platform:gift', 'platform:raid', 'platform:share', 'platform:paypiggy', 'platform:giftpaypiggy', 'platform:envelope'];
            await until(() => required.every(type => h.feed.packets.some(row => row.type === type)), 'all preview HTTP rows');
            h.feed.assertHealthy();
            const avatars = new Map(h.feed.packets.filter(row => row.type === 'chat').map(row => [row.platform, row.avatarUrl]));
            expect(Object.fromEntries(avatars)).toEqual({ twitch: DEMO_CHARACTER_CATALOG.Goku, youtube: DEMO_CHARACTER_CATALOG.Ichigo, tiktok: DEMO_CHARACTER_CATALOG.Naruto });
            const youtube = h.feed.packets.find(row => row.type === 'chat' && row.platform === 'youtube');
            expect(youtube).toMatchObject({ presentationRole: 'member', presentationOverride: { theme: 'red', effects: ['particles'] } });
            expect(h.feed.packets.find(row => row.type === 'chat' && row.platform === 'twitch')).toMatchObject({
                badgeImages: [
                    { label: 'Moderator', source: 'twitch' },
                    { label: 'Founder', source: 'twitch' },
                    { label: 'Prime Gaming', source: 'twitch' },
                ],
            });
            expect(effects).toEqual([]);
        } finally { off(); await h.dispose(); }
        expect(h.service.isActive()).toBe(false);
        expect(h.bus.eventNames()).toEqual([]);
    });

    it.each(['matching ACK', 'retirement'] as const)('keeps exact chat rows progressing while a real 126-frame gift is pending, then joins %s', async completion => {
        const root = await mkdtemp(join(tmpdir(), 'synthetic-preview-animation-'));
        try {
            let resolver: ReturnType<typeof createTikTokGiftAnimationResolver> | undefined;
            let pipeline: ReturnType<typeof createPreviewPipeline> | undefined;
            let service: ReturnType<typeof createGuiTransportService> | undefined;
            let feed: ReturnType<typeof connectFeed> | undefined;
            const bus = new EventBus();
            try {
                const bytes = Buffer.from('000000186674797069736f6d0000000069736f6d', 'hex');
                const archive = zipFixture([
                    {
                        name: 'config.json', body: Buffer.from(JSON.stringify({
                            portrait: {
                                path: 'output.mp4', videoW: 960, videoH: 864, w: 480, h: 854,
                                rgbFrame: [0, 0, 480, 854], aFrame: [480, 0, 480, 854], f: 126,
                            }
                        })), method: 8
                    },
                    { name: 'output.mp4', body: bytes, method: 8 },
                ]);
                const downloads: string[] = [];
                resolver = createTikTokGiftAnimationResolver({
                    logger: quiet, cacheDirectory: root,
                    // Resolver documents downloadArchive as its external download boundary.
                    // Extraction, profile parsing, duration, media validation and cache remain real.
                    async downloadArchive(url, output, context) {
                        downloads.push(url);
                        await writeFile(output, archive, { flag: 'wx', signal: context?.signal });
                        return { bytes: archive.length };
                    },
                });
                const config = isolatedConfig();
                const activePipeline = createPreviewPipeline({ config, logger: quiet, eventBus: bus, giftAnimationResolver: resolver });
                pipeline = activePipeline;
                service = createGuiTransportService({ config, logger: quiet, eventBus: bus, assetsRoot: root, runtimeAssetRoots: [root] });
                await service.start();
                const address = service.getAddress();
                if (!address || typeof address === 'string') throw new Error('Missing native address');
                const baseUrl = `http://127.0.0.1:${address.port}`;
                feed = connectFeed(baseUrl); await feed.ready();
                const adapters = createPreviewIngestAdapters({ config, logger: quiet, emitPlatformEvent: event => activePipeline.emitIngestEvent(event) });
                const effects: RecordValue[] = [];
                const off = bus.subscribe('display:gift-animation', value => { effects.push(value as RecordValue); });
                try {
                    const gift = buildPreviewScenarioEvents().find(event => event.adapter === 'tiktok' && event.rawEvent.eventType === 'GIFT')!;
                    const rawGift = structuredClone(gift.rawEvent) as RecordValue;
                    rawGift.data.asset = { videoResourceList: [{ videoTypeName: 'h264', videoUrl: { urlList: ['https://cdn.synthetic.invalid/preview-gift.zip'] } }] };
                    await adapters.tiktok.ingest(rawGift);
                    await until(() => effects.length === 1 && feed!.packets.some(packet => packet.__guiEvent === 'effect'), 'actual gift admission and HTTP effect');
                    const effect = effects[0]!;
                    expect(effect.durationMs).toBe(4200); // 126 frames / production default 30 fps.
                    expect(effect.animationConfig).toMatchObject({ profileName: 'portrait', renderHeight: 854 });
                    expect(await readFile(effect.mediaFilePath)).toEqual(bytes);
                    expect(downloads).toEqual(['https://cdn.synthetic.invalid/preview-gift.zip']);
                    const packet = feed.packets.find(value => value.__guiEvent === 'effect')!;
                    expect(packet).toMatchObject({ durationMs: 4200, playbackId: effect.playbackId, effectType: 'tiktok-gift-animation' });
                    const media = await readHttp(`${baseUrl}${packet.assetUrl}`);
                    expect(media.status).toBe(200);
                    expect(media.body).toEqual(bytes);

                    // The product preview queue intentionally uses zero row cadence/no-op
                    // delays. Preserve that policy and witness progress before any ACK.
                    const chatEvents = [0, 1].map(index => ({
                        eventType: 'CHAT', data: {
                            user: { uniqueId: `synthetic-progress-${index}`, nickname: `Synthetic progress ${index}`, userId: `synthetic-progress-${index}` },
                            comment: `Synthetic pending gift row ${index}`, msgId: `synthetic-progress-message-${index}`,
                            timestamp: '2024-01-01T00:00:00.000Z', common: { createTime: 1704067200000 },
                        },
                    }));
                    for (const event of chatEvents) await adapters.tiktok.ingest(event);
                    await until(() => feed!.packets.filter(row => row.type === 'chat').length === 2, 'two exact chat rows while gift pending');
                    expect(feed.packets.filter(row => row.type === 'chat').map(row => [row.username, row.text])).toEqual([
                        ['Synthetic progress 0', 'Synthetic pending gift row 0'],
                        ['Synthetic progress 1', 'Synthetic pending gift row 1'],
                    ]);
                    expect(bus.listenerCount('display:gift-animation-settled')).toBe(1);
                    bus.emit('display:gift-animation-settled', { playbackId: '00000000-0000-4000-8000-000000000001', reason: 'ended' });
                    await flush();
                    expect(bus.listenerCount('display:gift-animation-settled')).toBe(1);
                    const ack = () => readHttp(`${baseUrl}/api/v1/gui/gift-animations/ack`, {
                        method: 'POST', headers: { origin: baseUrl, 'x-stream-sync-request': '1', 'content-type': 'application/json' },
                        body: JSON.stringify({ playbackId: effect.playbackId, reason: 'ended' }),
                    });
                    if (completion === 'matching ACK') {
                        expect(JSON.parse((await ack()).body.toString())).toEqual({ first: true });
                        await until(() => bus.listenerCount('display:gift-animation-settled') === 0, 'matching ACK waiter completion');
                        expect(JSON.parse((await ack()).body.toString())).toEqual({ first: false });
                    } else {
                        await pipeline.dispose();
                        expect(bus.listenerCount('display:gift-animation-settled')).toBe(0);
                        bus.emit('display:gift-animation-settled', { playbackId: effect.playbackId, reason: 'ended' });
                        await flush();
                        expect(feed.packets.filter(row => row.type === 'chat')).toHaveLength(2);
                    }
                    expect(effects).toHaveLength(1);
                    feed.assertHealthy();
                    // Retirement joins actual queue/effects owners and cancels any held waiter.
                    await pipeline.dispose();
                    await flush();
                    expect(effects).toHaveLength(1);
                } finally { off(); }
            } finally {
                try { await feed?.close(); } finally {
                    try { await service?.stop(); } finally {
                        try { await pipeline?.dispose(); } finally {
                            try { await resolver?.dispose(); } finally {
                                await rm(root, { recursive: true, force: true });
                            }
                        }
                    }
                }
            }
            expect(bus.eventNames()).toEqual([]);
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it('routes public canonical chat and follow input through actual runtime services into exact HTTP rows', async () => {
        const h = await composition();
        try {
            h.pipeline.emitIngestEvent({
                type: 'platform:chat-message', platform: 'twitch', data: {
                    username: 'Synthetic canonical chatter', userId: 'synthetic-canonical-chatter',
                    avatarUrl: 'https://cdn.synthetic.invalid/chat-avatar.png', timestamp: '2024-01-01T00:00:00.000Z',
                    message: { text: 'Synthetic canonical chat' },
                }
            });
            h.pipeline.emitIngestEvent({
                type: 'platform:follow', platform: 'youtube', data: {
                    username: 'Synthetic canonical follower', userId: 'synthetic-canonical-follower',
                    avatarUrl: 'https://cdn.synthetic.invalid/follow-avatar.png', timestamp: '2024-01-01T00:00:01.000Z',
                }
            });
            await until(() => h.feed.packets.some(row => row.type === 'chat') && h.feed.packets.some(row => row.type === 'platform:follow'), 'canonical runtime HTTP rows');
            expect(h.feed.packets.filter(row => row.type === 'chat')).toMatchObject([{
                type: 'chat', platform: 'twitch', username: 'Synthetic canonical chatter',
                text: 'Synthetic canonical chat', avatarUrl: 'https://cdn.synthetic.invalid/chat-avatar.png',
            }]);
            expect(h.feed.packets.filter(row => row.type === 'platform:follow')).toMatchObject([{
                type: 'platform:follow', platform: 'youtube', username: 'Synthetic canonical follower',
                avatarUrl: 'https://cdn.synthetic.invalid/follow-avatar.png',
            }]);
            h.feed.assertHealthy();
        } finally { await h.dispose(); }
        expect(h.bus.eventNames()).toEqual([]);
    });

    it('acknowledges the public preview VFX callback and retires routing idempotently', async () => {
        const h = await composition();
        const acknowledgements: unknown[] = [];
        const offs = ['vfx:command-executed', 'vfx:effect-completed'].map(name => h.bus.subscribe(name, value => { acknowledgements.push(value); }));
        try {
            h.bus.emit('vfx:command-received', { correlationId: 'synthetic-preview-correlation' });
            await flush();
            expect(acknowledgements).toEqual([
                { correlationId: 'synthetic-preview-correlation', type: 'vfx:command-executed' },
                { correlationId: 'synthetic-preview-correlation', type: 'vfx:effect-completed' },
            ]);
            await h.pipeline.dispose(); await h.pipeline.dispose();
            h.bus.emit('vfx:command-received', { correlationId: 'synthetic-retired' });
            await flush();
            expect(acknowledgements).toHaveLength(2);
        } finally { offs.forEach(off => off()); await h.dispose(); }
        expect(h.bus.eventNames()).toEqual([]);
    });
    it('runs the real command only after HTTP connection, reports URLs, owns controls/funding and joins keep-open cleanup', async () => {
        const root = await mkdtemp(join(tmpdir(), 'synthetic-preview-command-'));
        try {
            const bus = new EventBus();
            const waiting = deferred();
            const writes: string[] = [];
            const ingested: unknown[] = [];
            const off = bus.subscribe('platform:event', event => { ingested.push(event); });
            let service: ReturnType<typeof createGuiTransportService> | undefined;
            let feed: ReturnType<typeof connectFeed> | undefined;
            let funding: RecordValue | undefined;
            let baseUrl = '';
            const command = startCommand({
                baseConfig: { logging: { file: { enabled: false }, chat: { enabled: false } } },
                logger: quiet, eventBus: bus, durationMs: 250, intervalMs: 5, keepOpen: true,
                // The script exposes concrete owner instances as UnknownRecord. The
                // cast restores transport types without changing any instance or return.
                createGuiTransportServiceImpl(options) {
                    funding = options.fundingGoal;
                    service = createGuiTransportService({
                        ...(options as unknown as Parameters<typeof createGuiTransportService>[0]),
                        config: { ...options.config, gui: { ...(options.config.gui as RecordValue), port: 0 } },
                        assetsRoot: root,
                    });
                    return service;
                },
                stdout: {
                    write(text) {
                        writes.push(text);
                        if (text.startsWith('Dock URL: ')) baseUrl = text.trim().slice('Dock URL: '.length).replace(/\/dock$/, '');
                        if (text.includes('Waiting for a GUI page')) waiting.resolve();
                    }
                },
            });
            try {
                await command.waitFor(waiting.promise, 'GUI connection gate');
                expect(ingested).toEqual([]);
                expect(service?.isActive()).toBe(true);
                feed = connectFeed(baseUrl); await command.waitFor(feed.ready(), 'GUI feed readiness');
                await command.waitFor(command.keptOpen.promise, 'keep-open');
                expect(command.settled).toBe(false);
                expect(ingested.slice(0, 16).map(event => (event as RecordValue).type)).toEqual([
                    'platform:chat-message', 'platform:chat-message', 'platform:chat-message', 'platform:gift',
                    'platform:chat-message', 'platform:chat-message', 'platform:chat-message', 'platform:follow',
                    'platform:chat-message', 'platform:chat-message', 'platform:raid', 'platform:chat-message',
                    'platform:share', 'platform:paypiggy', 'platform:giftpaypiggy', 'platform:envelope',
                ]);
                await until(() => feed!.packets.filter(row => row.type === 'chat').length >= 4, 'scheduled command HTTP chat rows');
                feed.assertHealthy();
                const state = await readHttp(`${baseUrl}/api/v1/operator/state`);
                expect(state.status).toBe(200);
                expect(state.body.length).toBeGreaterThan(0);
                expect(funding).toBeDefined();
                await funding!.setTotal(0);
                await expect(funding!.adjust(-1)).rejects.toThrow('cannot be negative');
                await funding!.setLabel('  Synthetic controller  ');
                expect(funding!.snapshot).toMatchObject({ label: 'Synthetic controller', labelOverridden: true });
                await funding!.resetLabel();
                expect(funding!.snapshot).toMatchObject({ label: '🎮 New Controller', labelOverridden: false });
                for (const route of ['Dock', 'Notifications', 'Overlay', 'Operator', 'Goal']) {
                    expect(writes).toContain(`${route} URL: ${baseUrl}/${route.toLowerCase()}\n`);
                }
                expect(writes.some(text => text.includes('gui:preview:gift-animation'))).toBe(true);
                expect(writes.some(text => text.includes('server remains running until Ctrl+C'))).toBe(true);
                expect(writes).not.toContain('GUI preview finished\n');
                command.shutdown.resolve();
                expect(await bounded(command.outcome, 'keep-open completion')).toEqual({ ok: true });
                expect(service?.isActive()).toBe(false);
                expect(bus.listenerCount('platform:event')).toBe(1); // This test's observer only.
            } finally {
                try { await command.close(); }
                finally {
                    try { await feed?.close(); }
                    finally { off(); await rm(root, { recursive: true, force: true }); }
                }
            }
            expect(bus.eventNames()).toEqual([]);
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it('retires actual pipeline when native transport binding fails', async () => {
        const root = await mkdtemp(join(tmpdir(), 'synthetic-preview-bind-'));
        try {
            const blocker = createServer();
            const bus = new EventBus();
            let service: ReturnType<typeof createGuiTransportService> | undefined;
            try {
                await bounded(new Promise<void>((resolve, reject) => { blocker.once('error', reject); blocker.listen(0, '127.0.0.1', resolve); }), 'native blocker bind');
                const address = blocker.address();
                if (!address || typeof address === 'string') throw new Error('Missing blocker address');
                const command = startCommand({
                    logger: quiet, eventBus: bus, durationMs: 1, intervalMs: 1,
                    createGuiTransportServiceImpl(options) {
                        service = createGuiTransportService({
                            ...(options as unknown as Parameters<typeof createGuiTransportService>[0]),
                            config: { ...options.config, gui: { ...(options.config.gui as RecordValue), port: address.port } }, assetsRoot: root,
                        });
                        return service;
                    },
                    stdout: { write() { } },
                });
                try {
                    await expect(command.waitFor(deferred().promise, 'unreached startup milestone')).rejects.toMatchObject({ code: 'EADDRINUSE' });
                } finally { await command.close(); }
                expect(service?.isActive()).toBe(false);
                expect(service?.getAddress()).toBeNull();
                expect(bus.eventNames()).toEqual([]);
            } finally {
                await service?.stop();
                await bounded(new Promise<void>(resolve => blocker.close(() => resolve())), 'native blocker retirement');
                await rm(root, { recursive: true, force: true });
            }
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it('reports a native HTTP close failure while retiring the actual command pipeline', async () => {
        const root = await mkdtemp(join(tmpdir(), 'synthetic-preview-close-'));
        try {
            const bus = new EventBus();
            const errors: unknown[][] = [];
            let service: ReturnType<typeof createGuiTransportService> | undefined;
            let feed: ReturnType<typeof connectFeed> | undefined;
            const command = startCommand({
                logger: { ...quiet, error: (...args: unknown[]) => { errors.push(args); } },
                eventBus: bus, durationMs: 10, intervalMs: 2,
                createGuiTransportServiceImpl(options) {
                    service = createGuiTransportService({
                        ...(options as unknown as Parameters<typeof createGuiTransportService>[0]),
                        config: { ...options.config, gui: { ...(options.config.gui as RecordValue), port: 0 } }, assetsRoot: root,
                        createServer(listener) {
                            const server = createServer(listener);
                            const close = server.close.bind(server);
                            // Native HTTP is external to the transport. Close the real socket
                            // before surfacing its synthetic error; no SUT method is replaced.
                            server.close = callback => close(() => callback?.(new Error('synthetic native close failure')));
                            return server;
                        },
                    });
                    return service;
                },
                stdout: {
                    write(text) {
                        if (text.startsWith('Dock URL: ')) {
                            feed = connectFeed(text.trim().slice('Dock URL: '.length).replace(/\/dock$/, ''));
                        }
                    }
                },
            });
            try {
                const result = await bounded(command.outcome, 'native close command');
                expect(result).toEqual({ ok: true });
                expect(feed).toBeDefined();
                await feed!.ready();
                expect(service?.isActive()).toBe(false);
                expect(bus.eventNames()).toEqual([]);
                expect(JSON.stringify(errors)).toContain('synthetic native close failure');
            } finally {
                try { await command.close(); }
                finally {
                    try { await feed?.close(); }
                    finally {
                        try { await service?.stop(); }
                        finally { await rm(root, { recursive: true, force: true }); }
                    }
                }
            }
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it('waits for the real final notification exit before command completion and retires native timers', async () => {
        const root = await mkdtemp(join(tmpdir(), 'synthetic-preview-exit-'));
        try {
            const bus = new EventBus();
            const writes: string[] = [];
            const lifecycle: RecordValue[] = [];
            const off = bus.subscribe('display:notification-lifecycle', value => { lifecycle.push(value as RecordValue); });
            let feed: ReturnType<typeof connectFeed> | undefined;
            let service: ReturnType<typeof createGuiTransportService> | undefined;
            useFakeTimers();
            const command = startCommand({
                logger: quiet, eventBus: bus, scenario: 'notifications', durationMs: 20, intervalMs: 2,
                createGuiTransportServiceImpl(options) {
                    service = createGuiTransportService({
                        ...(options as unknown as Parameters<typeof createGuiTransportService>[0]),
                        config: { ...options.config, gui: { ...(options.config.gui as RecordValue), port: 0 } }, assetsRoot: root,
                    });
                    return service;
                },
                stdout: {
                    write(text) {
                        writes.push(text);
                        if (text.startsWith('Dock URL: ')) feed = connectFeed(text.trim().slice('Dock URL: '.length).replace(/\/dock$/, ''));
                    }
                },
            });
            try {
                // Yield native I/O independently of the fake scheduler. Advance only
                // through registered timers; no captured timer callback is invoked.
                for (let turn = 0; turn < 1000 && !command.settled && !writes.some(text => text.includes('Waiting for platform:envelope')); turn++) {
                    await yieldTurn(); advanceTimersByTime(10); await flush();
                }
                if (command.settled) expect(await command.outcome).toEqual({ ok: true });
                expect(writes.some(text => text.includes('Waiting for platform:envelope'))).toBe(true);
                expect(feed).toBeDefined();
                await command.waitFor(feed!.ready(), 'notification GUI readiness');
                expect(command.settled).toBe(false);
                expect(lifecycle.some(event => event.type === 'platform:envelope' && event.phase === 'exit-started')).toBe(false);
                for (let turn = 0; turn < 1000 && !command.settled; turn++) {
                    advanceTimersByTime(1000); await flush(); await yieldTurn();
                }
                expect(command.settled).toBe(true);
                expect(await bounded(command.outcome, 'final notification completion')).toEqual({ ok: true });
                expect(lifecycle.filter(event => event.type === 'platform:envelope' && event.phase === 'exit-started')).toHaveLength(1);
                expect(writes).toContain('GUI preview finished\n');
                expect(service?.isActive()).toBe(false);
                expect(getTimerCount()).toBe(0);
            } finally {
                try { await command.close(true); }
                finally {
                    try { await feed?.close(); }
                    finally {
                        try { await service?.stop(); }
                        finally { off(); useRealTimers(); await rm(root, { recursive: true, force: true }); }
                    }
                }
            }
            expect(bus.eventNames()).toEqual([]);
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it('cleans the first acquired root and real pipeline when fixture setup exits before transport acquisition', async () => {
        let root: string | undefined;
        let bus: EventBus | undefined;
        const failure = new Error('Synthetic early fixture acquisition exit');
        await expect(composition((directory, acquiredBus) => {
            root = directory; bus = acquiredBus;
            expect(bus.listenerCount('platform:event')).toBeGreaterThan(0);
            throw failure;
        })).rejects.toBe(failure);
        expect(root).toBeDefined();
        expect(bus?.eventNames()).toEqual([]);
        await expect(access(root!)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it.each(['refused', 'non-200', 'close before headers', 'no headers'] as const)('joins native SSE readiness and close after %s', async mode => {
        const server = createServer((_request, response) => {
            if (mode === 'non-200') { response.writeHead(503); response.end('Synthetic unavailable'); }
            // The third case deliberately holds this external HTTP response.
        });
        let feed: ReturnType<typeof connectFeed> | undefined;
        try {
            await bounded(new Promise<void>((resolve, reject) => {
                server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
            }), 'synthetic feed server bind');
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('Missing native feed address');
            if (mode === 'refused') await bounded(new Promise<void>(resolve => server.close(() => resolve())), 'refused server close');
            feed = connectFeed(`http://127.0.0.1:${address.port}`);
            // Attach immediately, as every stdout-created reader does internally.
            const ready = feed.ready().then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
            if (mode === 'close before headers') await feed.close();
            const result = await bounded(ready, 'synthetic readiness failure');
            expect(result.ok).toBe(false);
            if (result.ok) throw new Error('Unexpected ready feed');
            if (mode === 'refused') expect(result.error).toMatchObject({ code: 'ECONNREFUSED' });
            else expect(String(result.error)).toContain(mode === 'non-200' ? 'SSE status 503' : mode === 'no headers' ? 'Preview feed readiness timeout' : 'closed before readiness');
            const firstClose = feed.close();
            expect(feed.close()).toBe(firstClose);
            await firstClose;
            expect(feed.terminated).toBe(true);
            const callbacks = feed.callbacks;
            await yieldTurn(); await yieldTurn();
            expect(feed.callbacks).toBe(callbacks);
        } finally {
            try { await feed?.close(); }
            finally { await bounded(new Promise<void>(resolve => server.close(() => resolve())), 'synthetic feed server retirement'); }
        }
    });

    it.each(['early exit', 'feed rejection'] as const)('cancels and joins the actual command before client connection after %s', async mode => {
        const root = await mkdtemp(join(tmpdir(), 'synthetic-preview-early-exit-'));
        try {
            let service: ReturnType<typeof createGuiTransportService> | undefined;
            let command: ReturnType<typeof startCommand> | undefined;
            let feed: ReturnType<typeof connectFeed> | undefined;
            const bus = new EventBus();
            const waiting = deferred();
            const socketClosures: Promise<void>[] = [];
            const acceptedSockets = new Set<Socket>();
            const failure = new Error('Synthetic pre-connection assertion exit');
            const fakeClock = mode === 'early exit';
            if (fakeClock) useFakeTimers();
            const join = <T>(work: Promise<T>, description: string) => fakeClock ? driveFake(work, description) : bounded(work, description);
            try {
                command = startCommand({
                    logger: quiet, eventBus: bus, durationMs: 10, intervalMs: 2, keepOpen: true,
                    createGuiTransportServiceImpl(options) {
                        service = createGuiTransportService({
                            ...(options as unknown as Parameters<typeof createGuiTransportService>[0]),
                            config: { ...options.config, gui: { ...(options.config.gui as RecordValue), port: 0 } }, assetsRoot: root,
                            createServer(listener) {
                                const server = createServer(listener);
                                server.on('connection', socket => {
                                    acceptedSockets.add(socket);
                                    socketClosures.push(new Promise<void>(resolve => socket.once('close', () => { acceptedSockets.delete(socket); resolve(); })));
                                });
                                return server;
                            },
                        });
                        return service;
                    },
                    stdout: { write(text) { if (text.includes('Waiting for a GUI page')) waiting.resolve(); } },
                });
                const active = command;
                const exercise = (async () => {
                    try {
                        await join(active.waitFor(waiting.promise, 'early-exit connection gate'), 'early-exit connection gate');
                        expect(service?.getSseClientCount()).toBe(0);
                        if (mode === 'feed rejection') {
                            const address = service!.getAddress();
                            if (!address || typeof address === 'string') throw new Error('Missing native preview address');
                            // Actual HTTP 404, while the command remains at its zero-client gate.
                            feed = connectFeed(`http://127.0.0.1:${address.port}/synthetic-missing`);
                            await join(active.waitFor(feed.ready(), 'rejected GUI readiness'), 'rejected GUI readiness');
                        }
                        throw failure;
                    } finally {
                        const result = await active.close(fakeClock);
                        expect(result).toEqual({ ok: false, error: active.cancelled });
                    }
                })();
                if (mode === 'early exit') await expect(exercise).rejects.toBe(failure);
                else await expect(exercise).rejects.toThrow('SSE status 404');
                expect(command.settled).toBe(true);
                expect(service?.isActive()).toBe(false);
                expect(bus.eventNames()).toEqual([]);
                await feed?.close();
                for (const socket of acceptedSockets) socket.destroy();
                await join(bounded(Promise.all(socketClosures), 'accepted native socket close'), 'accepted native socket close');
                expect(acceptedSockets.size).toBe(0);
                if (feed) expect(feed.terminated).toBe(true);
                if (fakeClock) expect(getTimerCount()).toBe(0);
            } finally {
                try { await command?.close(fakeClock); }
                finally {
                    try { await feed?.close(); }
                    finally {
                        try { await service?.stop(); }
                        finally {
                            try {
                                for (const socket of acceptedSockets) socket.destroy();
                                await join(bounded(Promise.all(socketClosures), 'accepted sockets cleanup'), 'accepted sockets cleanup');
                            } finally { waiting.resolve(); useRealTimers(); await rm(root, { recursive: true, force: true }); }
                        }
                    }
                }
            }
            await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it('propagates a later stdout failure instead of waiting for an unreached keep-open milestone', async () => {
        const root = await mkdtemp(join(tmpdir(), 'synthetic-preview-later-failure-'));
        try {
            let command: ReturnType<typeof startCommand> | undefined;
            let service: ReturnType<typeof createGuiTransportService> | undefined;
            let feed: ReturnType<typeof connectFeed> | undefined;
            const bus = new EventBus();
            const failure = new Error('Synthetic stdout failure before keep-open');
            try {
                command = startCommand({
                    logger: quiet, eventBus: bus, durationMs: 10, intervalMs: 2, keepOpen: true,
                    createGuiTransportServiceImpl(options) {
                        service = createGuiTransportService({
                            ...(options as unknown as Parameters<typeof createGuiTransportService>[0]),
                            config: { ...options.config, gui: { ...(options.config.gui as RecordValue), port: 0 } }, assetsRoot: root,
                        });
                        return service;
                    },
                    stdout: {
                        write(text) {
                            if (text.startsWith('Dock URL: ')) feed = connectFeed(text.trim().slice('Dock URL: '.length).replace(/\/dock$/, ''));
                            if (text.includes('server remains running')) throw failure;
                        }
                    },
                });
                await expect(command.waitFor(command.keptOpen.promise, 'unreached keep-open')).rejects.toBe(failure);
                expect(await command.outcome).toEqual({ ok: false, error: failure });
                expect(feed).toBeDefined();
                await feed!.ready();
                expect(service?.isActive()).toBe(false);
                expect(bus.eventNames()).toEqual([]);
            } finally {
                try { await command?.close(); }
                finally {
                    try { await feed?.close(); }
                    finally {
                        try { await service?.stop(); }
                        finally { await rm(root, { recursive: true, force: true }); }
                    }
                }
            }
            await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally { await rm(root, { recursive: true, force: true }); }
    });

});
