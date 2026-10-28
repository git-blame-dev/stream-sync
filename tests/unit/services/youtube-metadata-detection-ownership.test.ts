import { describe, expect, it } from 'bun:test';
import { DependencyFactory } from '../../../src/utils/dependency-factory';
import { YouTubeStreamDetectionService } from '../../../src/services/youtube-stream-detection-service';
import { InnertubeService } from '../../../src/services/innertube-service';
import { noOpLogger } from '../../helpers/mock-factories';

const channel = 'UCabcdefghijklmnopqrstuv';
const config = {
    general: { ignoreSelfMessages: false },
    twitch: { ignoreSelfMessages: false },
    youtube: { ignoreSelfMessages: false },
    tiktok: { ignoreSelfMessages: false }
};

describe('YouTube metadata detection ownership', () => {
    for (const boundaryAction of ['cleanup', 'caller cancellation'] as const) {
        it(`rejects settled metadata success when ${boundaryAction} precedes the consumer continuation`, async () => {
            const owner = new InnertubeService({
                createWithTimeout: async () => ({
                    getInfo: async () => ({}),
                    getChannel: async () => ({ videos: [{ id: 'synthetic_live', is_live: true }] })
                })
            }, { logger: noOpLogger });
            const caller = new AbortController();
            let atCompletion!: () => void;
            const scheduler: Pick<InnertubeService, 'withMetadataOperation'> = {
                withMetadataOperation(context, operation) {
                    const completed = owner.withMetadataOperation(context, operation);
                    // Register before the consumer awaits this same, real owner promise.
                    void completed.then(() => atCompletion());
                    return completed;
                }
            };
            const detection = new YouTubeStreamDetectionService(scheduler, { logger: noOpLogger });
            detection._circuitBreaker.consecutiveFailures = 2;
            detection._circuitBreaker.lastFailureTime = 123;
            atCompletion = () => {
                if (boundaryAction === 'cleanup') void detection.cleanup();
                else caller.abort(new Error('synthetic completion-boundary cancellation'));
            };
            const result = await detection.detectLiveStreams(channel, { signal: caller.signal });
            expect(result.success).toBe(false);
            expect(result.observationKind).toBe('unavailable');
            expect(result.videoIds).toEqual([]);
            expect(detection._circuitBreaker.consecutiveFailures).toBe(2);
            expect(detection._circuitBreaker.lastFailureTime).toBe(123);
            expect(detection.isActive()).toBe(boundaryAction !== 'cleanup');
            expect(detection.getUsageMetrics()).toMatchObject(boundaryAction === 'cleanup'
                ? { totalRequests: 0, successfulRequests: 0, failedRequests: 0 }
                : { totalRequests: 1, successfulRequests: 0, failedRequests: 1 });
            await owner.dispose();
            expect(detection.getUsageMetrics()).toMatchObject({ successfulRequests: 0 });
        });
    }

    for (const scenario of ['channel', 'live', 'search', 'deadline'] as const) {
        const stage = scenario === 'deadline' ? 'search' : scenario;
        it(`cancels the complete ${scenario} response-body continuation without publishing empty success`, async () => {
            let started!: () => void;
            let aborted!: () => void;
            const reading = new Promise<void>(resolve => { started = resolve; });
            const stopped = new Promise<void>(resolve => { aborted = resolve; });
            const calls: string[] = [];
            const owner = new InnertubeService({
                createWithTimeout: async () => { throw new Error('raw creation required'); },
                createWithConfig: async options => {
                    const fetch = options?.fetch as typeof globalThis.fetch;
                    const read = async (step: string) => (await fetch(`https://metadata.example.test/${step}`)).text();
                    return {
                        getInfo: async () => ({ basic_info: { is_live: true, view_count: 3 } }),
                        getChannel: async () => {
                            await read('channel');
                            return { videos: stage === 'live' ? [{ id: 'synthetic_live', is_live: true }] : [], getLiveStreams: async () => {
                                if (stage === 'search') throw new Error('synthetic parser failure');
                                await read('live');
                                return { videos: [] };
                            } };
                        },
                        search: async () => { await read('search'); return { videos: [] }; }
                    };
                }
            }, {
                logger: noOpLogger,
                fetch: async (input, init) => {
                    const step = String(input).split('/').at(-1)!;
                    calls.push(step);
                    return new Response(new ReadableStream({
                        start(controller) {
                            if (step === stage) {
                                const signal = init?.signal;
                                signal?.addEventListener('abort', () => {
                                    controller.error(signal.reason);
                                    aborted();
                                }, { once: true });
                                started();
                            } else {
                                controller.enqueue(new TextEncoder().encode('synthetic response'));
                                controller.close();
                            }
                        }
                    }));
                }
            });
            const detection = new YouTubeStreamDetectionService(owner, { logger: noOpLogger });
            const cancellation = new AbortController();
            const pending = detection.detectLiveStreams(channel, {
                signal: cancellation.signal, debug: true, timeoutMs: scenario === 'deadline' ? 30 : 2000
            });
            await reading;
            if (scenario !== 'deadline') cancellation.abort(new Error('synthetic body cancellation'));
            expect(await pending).toMatchObject(scenario === 'deadline'
                ? { success: false, observationKind: 'unavailable', videoIds: [], message: 'Detection timeout - please try again', debug: { errorType: 'DOMException' } }
                : { success: false, observationKind: 'unavailable', videoIds: [], debug: { errorMessage: 'synthetic body cancellation' } });
            await stopped;
            await owner.dispose();
            expect(calls).toEqual(stage === 'channel' ? ['channel'] : stage === 'live' ? ['channel', 'live'] : ['channel', 'search']);
            expect(detection.getUsageMetrics()).toMatchObject({ totalRequests: 1, successfulRequests: 0, failedRequests: 1 });
        });
    }

    it('stops detection during shared initialization without retiring the viewer owner or late-created client', async () => {
        let started!: () => void;
        let release!: () => void;
        const initializing = new Promise<void>(resolve => { started = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        let creations = 0;
        const deps = new DependencyFactory().createYoutubeDependencies({ streamDetectionMethod: 'youtubei' }, {
            logger: noOpLogger, config,
            Innertube: { create: async () => {
                creations++;
                started();
                await gate;
                return {
                    getInfo: async () => ({ basic_info: { is_live: true, view_count: 9 } }),
                    getChannel: async () => ({ videos: [] })
                };
            } }
        });
        const detection = deps.streamDetectionService as YouTubeStreamDetectionService;
        const pending = detection.detectLiveStreams(channel);
        await initializing;
        await detection.cleanup();
        expect(await pending).toMatchObject({ success: false });
        release();
        expect(await deps.viewerExtractionService.extractViewerCount('synthetic_viewer')).toMatchObject({ success: true, count: 9 });
        expect(creations).toBe(1);
        expect(detection.isActive()).toBe(false);
        expect(await detection.detectLiveStreams(channel)).toMatchObject({ success: false });
        expect(detection.getUsageMetrics()).toMatchObject({ totalRequests: 0, successfulRequests: 0, failedRequests: 0 });
        await deps.innertubeService.dispose();
    });

    it('joins late SDK creation on shared-owner disposal without starting detection continuations', async () => {
        let started!: () => void;
        let release!: () => void;
        const initializing = new Promise<void>(resolve => { started = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        let channelRequests = 0;
        const deps = new DependencyFactory().createYoutubeDependencies({ streamDetectionMethod: 'youtubei' }, {
            logger: noOpLogger, config,
            Innertube: { create: async () => {
                started();
                await gate;
                return {
                    getInfo: async () => ({}),
                    getChannel: async () => { channelRequests++; return { videos: [] }; }
                };
            } }
        });
        const detection = deps.streamDetectionService as YouTubeStreamDetectionService;
        const pending = detection.detectLiveStreams(channel);
        await initializing;
        const disposal = deps.innertubeService.dispose();
        release();
        expect(await pending).toMatchObject({ success: false });
        await disposal;
        expect(channelRequests).toBe(0);
        expect(await detection.detectLiveStreams(channel)).toMatchObject({ success: false });
        expect(detection.getUsageMetrics()).toMatchObject({ totalRequests: 2, failedRequests: 2, successfulRequests: 0 });
    });

    it('returns a capability failure rather than empty success when the shared client lacks getChannel', async () => {
        const deps = new DependencyFactory().createYoutubeDependencies({ streamDetectionMethod: 'youtubei' }, {
            logger: noOpLogger, config,
            Innertube: { create: async () => ({ getInfo: async () => ({}) }) }
        });
        const detection = deps.streamDetectionService as YouTubeStreamDetectionService;
        expect(await detection.detectLiveStreams(channel, { debug: true })).toMatchObject({
            success: false, debug: { errorMessage: 'Innertube client requires getChannel for stream detection' }
        });
        await deps.innertubeService.dispose();
    });

    it('evicts rejected SDK creation instead of poisoning subsequent detection requests', async () => {
        let attempts = 0;
        const deps = new DependencyFactory().createYoutubeDependencies({ streamDetectionMethod: 'youtubei' }, {
            logger: noOpLogger, config,
            Innertube: { create: async () => {
                if (++attempts === 1) throw new Error('synthetic SDK initialization failure');
                return { getInfo: async () => ({}),
                    getChannel: async () => ({ videos: [], getLiveStreams: async () => ({ videos: [] }) }),
                    search: async () => ({ videos: [] }) };
            } }
        });
        const detection = deps.streamDetectionService as YouTubeStreamDetectionService;
        expect(await detection.detectLiveStreams(channel)).toMatchObject({ success: false });
        expect(await detection.detectLiveStreams(channel)).toMatchObject({ success: true, videoIds: [] });
        expect(attempts).toBe(2);
        expect(detection.getUsageMetrics()).toMatchObject({ totalRequests: 2, successfulRequests: 1, failedRequests: 1 });
        await deps.innertubeService.dispose();
    });

    it('retries lazy import failure and coalesces detection/viewer initialization with isolated waiter cancellation', async () => {
        let imports = 0;
        let creations = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const deps = new DependencyFactory().createYoutubeDependencies({ streamDetectionMethod: 'youtubei' }, {
            logger: noOpLogger,
            config,
            Innertube: async () => {
                imports++;
                if (imports === 1) throw new Error('synthetic lazy import failure');
                await gate;
                return { create: async (options?: Record<string, unknown>) => {
                    creations++;
                    expect(typeof options?.fetch).toBe('function');
                    expect(options?.retrieve_player).toBe(false);
                    return {
                        getInfo: async () => ({ basic_info: { is_live: true, view_count: 18 } }),
                        getChannel: async () => ({ videos: [{ id: 'synthetic_live', is_live: true }] })
                    };
                } };
            }
        });
        const detection = deps.streamDetectionService as YouTubeStreamDetectionService;
        expect(await detection.detectLiveStreams(channel, { debug: true })).toMatchObject({
            success: false, debug: { errorMessage: 'synthetic lazy import failure' }
        });
        expect(detection.client).toBe(deps.innertubeService);
        const cancellation = new AbortController();
        const cancelled = detection.detectLiveStreams(channel, { signal: cancellation.signal });
        const healthy = detection.detectLiveStreams(channel);
        const viewer = deps.viewerExtractionService.extractViewerCount('synthetic_live');
        cancellation.abort(new Error('cancel only waiter A'));
        release();
        expect(await cancelled).toMatchObject({ success: false });
        expect(await healthy).toMatchObject({ success: true, videoIds: ['synthetic_live'] });
        expect(await viewer).toMatchObject({ success: true, count: 18 });
        expect(imports).toBe(2);
        expect(creations).toBe(1);
        expect(detection.getUsageMetrics()).toMatchObject({ totalRequests: 3, successfulRequests: 1, failedRequests: 2 });
        await deps.innertubeService.dispose();
    });
});
