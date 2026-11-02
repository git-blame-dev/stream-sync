import { afterEach, describe, it, expect } from 'bun:test';
import { noOpLogger } from '../../helpers/mock-factories';
import { ViewerCountExtractionService } from '../../../src/services/viewer-count-extraction-service';
import { InnertubeService } from '../../../src/services/innertube-service';

type VideoInfo = Record<string, unknown>;
const id = (index: number) => `test${String(index).padStart(7, '0')}`;
const live = (videoId: string, count: number): VideoInfo => ({ page: [{}, { current_video_endpoint: { payload: { videoId } } }], basic_info: { id: videoId, is_live: true }, primary_info: { view_count: { is_live: true, original_view_count: count } } });
const owners: InnertubeService[] = [];
function fixture(getInfo: (id: string) => Promise<VideoInfo> = async videoId => live(videoId, 12), options: ConstructorParameters<typeof ViewerCountExtractionService>[1] = {}) {
    const owner = new InnertubeService({ createWithTimeout: async () => ({ getInfo }) }, { logger: noOpLogger });
    owners.push(owner);
    return { owner, service: new ViewerCountExtractionService(owner, { logger: noOpLogger, ...options }) };
}
afterEach(async () => { await Promise.all(owners.splice(0).map(owner => owner.dispose())); });

describe('real extraction and metadata owners', () => {
    it('normalizes timeout configuration without accepting invalid updates', () => {
        const { service } = fixture(undefined, { timeout: Infinity });
        expect(service.config).toEqual({ timeout: 8000 });
        service.updateConfig({ timeout: 4500 });
        for (const timeout of [1.5, 0, -1, 2147483648, '100']) service.updateConfig({ timeout });
        service.updateConfig(null);
        expect(service.config).toEqual({ timeout: 4500 });
    });
    it('rejects invalid IDs before SDK admission', async () => {
        const admissions: string[] = [];
        const { service } = fixture(async videoId => { admissions.push(videoId); return live(videoId, 12); });
        for (const invalid of ['', 'short', 'too-long-synthetic', 'test000000!', 'test0000001\n', ' test000001', 'https://example.test/video']) {
            expect(await service.extractViewerCount(invalid)).toMatchObject({ success: false, count: 0, errorType: 'TypeError' });
        }
        expect(admissions).toEqual([]);
    });
    it('requires the requested video identity before accepting a count', async () => {
        for (const returnedId of [undefined, id(2), {}, 1]) {
            const { service } = fixture(async () => ({ ...live(id(1), 12), basic_info: { id: returnedId, is_live: true } }));
            expect(await service.extractViewerCount(id(1))).toMatchObject({ success: false, count: 0, errorType: 'TypeError' });
        }
    });
    for (const page of [undefined, [], [{}, {}], [{}, { current_video_endpoint: { payload: { videoId: id(2) } } }],
        [{}, { current_video_endpoint: { payload: { videoId: {} } } }], [{}, { current_video_endpoint: { payload: { videoId: '' } } }]]) {
        it(`rejects absent or invalid count-bearing next identity: ${JSON.stringify(page)}`, async () => {
            const { service } = fixture(async () => ({ ...live(id(1), 12), page }));
            expect(await service.extractViewerCount(id(1))).toMatchObject({ success: false, count: 0, errorType: 'TypeError' });
        });
    }
    it('keeps safe source metadata without provider content', async () => {
        const { service } = fixture(async videoId => ({ ...live(videoId, 10000001), private: 'synthetic-private' }));
        const result = await service.extractViewerCount(id(1));
        expect(result).toMatchObject({ success: true, count: 10000001, strategy: 'original_view_count', metadata: { source: 'original_view_count' } });
        expect(JSON.stringify(result.metadata)).not.toContain('synthetic-private');
        expect(JSON.stringify(result.metadata)).not.toContain('10000001');
    });
    it('refills bounded slots before a slow earlier request settles and preserves input order', async () => {
        const ids = Array.from({ length: 12 }, (_, index) => id(index));
        const gates = ids.map(() => Promise.withResolvers<VideoInfo>());
        const entered = ids.map(() => Promise.withResolvers<void>());
        let active = 0;
        let maximum = 0;
        const admissions: string[] = [];
        const { service } = fixture(async videoId => {
            const index = ids.indexOf(videoId);
            admissions.push(videoId);
            maximum = Math.max(maximum, ++active);
            entered[index]!.resolve();
            try { return await gates[index]!.promise; } finally { active--; }
        });
        const pending = service.extractViewerCountsBatch(ids, { maxConcurrency: 999 });
        try {
            await Promise.all(entered.slice(0, 5).map(item => item.promise));
            expect(admissions).toEqual(ids.slice(0, 5));
            gates[1]!.resolve(live(ids[1]!, 1));
            await entered[5]!.promise;
            expect(admissions).toEqual(ids.slice(0, 6));
            expect(active).toBe(5);
            // Request zero is still held while every later slot makes progress.
            for (let index = 2; index < ids.length; index++) {
                await entered[index]!.promise;
                gates[index]!.resolve(live(ids[index]!, index));
            }
            gates[0]!.resolve(live(ids[0]!, 0));
            const results = await pending;
            expect(maximum).toBe(5);
            expect(active).toBe(0);
            expect(results.map(result => [result.videoId, result.count, result.success])).toEqual(ids.map((videoId, index) => [videoId, index, true]));
        } finally { gates.forEach(gate => gate.resolve({})); await pending; }
    });
    it('settles serial failures without losing batch members', async () => {
        const gate = Promise.withResolvers<VideoInfo>();
        const entered = Promise.withResolvers<void>();
        const admissions: string[] = [];
        const { service } = fixture(async videoId => {
            admissions.push(videoId);
            if (videoId === id(1)) { entered.resolve(); return gate.promise; }
            throw new TypeError('synthetic-private-provider-failure');
        });
        const pending = service.extractViewerCountsBatch([id(1), id(2)], { maxConcurrency: 1 });
        try {
            await entered.promise;
            expect(admissions).toEqual([id(1)]);
            gate.resolve(live(id(1), 1));
            expect(await pending).toMatchObject([{ success: true, count: 1, videoId: id(1) }, { success: false, count: 0, videoId: id(2), errorType: 'TypeError' }]);
            expect(service.getStats()).toMatchObject({ totalRequests: 2, successfulExtractions: 1, failedExtractions: 1, errorsByType: { TypeError: 1 } });
        } finally { gate.resolve({}); await pending; }
    });
    it('aggregates empty input without admitting SDK work', async () => {
        let calls = 0;
        const { service } = fixture(async () => { calls++; return {}; });
        expect(await service.getAggregatedViewerCount([])).toEqual({ success: true, totalCount: 0, successfulStreams: 0, failedStreams: 0, streams: [] });
        expect(calls).toBe(0);
    });
    it('aggregates unique complete streams including exact zero', async () => {
        const admissions: string[] = [];
        const { service } = fixture(async videoId => { admissions.push(videoId); return live(videoId, videoId === id(1) ? 14 : 0); });
        expect(await service.getAggregatedViewerCount([id(1), id(2), id(1)])).toEqual({
            success: true, totalCount: 14, successfulStreams: 2, failedStreams: 0,
            streams: [{ videoId: id(1), count: 14, success: true, strategy: 'original_view_count' }, { videoId: id(2), count: 0, success: true, strategy: 'original_view_count' }]
        });
        expect(admissions).toEqual([id(1), id(2)]);
    });
    for (const mode of ['missing', 'invalid', 'throws'] as const) {
        it(`makes mixed aggregation unavailable for ${mode} metadata`, async () => {
            const { service } = fixture(async videoId => {
                if (videoId === id(1)) return live(videoId, 14);
                if (mode === 'throws') throw new Error('synthetic SDK failure');
                return mode === 'missing' ? { basic_info: { id: videoId } } : live(videoId, Infinity);
            });
            expect(await service.getAggregatedViewerCount([id(1), id(2)])).toMatchObject({ success: false, totalCount: 0, successfulStreams: 1, failedStreams: 1,
                streams: [{ videoId: id(1), count: 14, success: true }, { videoId: id(2), count: 0, success: false }] });
        });
    }
    it('rejects unsafe aggregate sums', async () => {
        const { service } = fixture(async videoId => live(videoId, Number.MAX_SAFE_INTEGER));
        expect(await service.getAggregatedViewerCount([id(1), id(2)])).toMatchObject({ success: false, totalCount: 0, successfulStreams: 2, failedStreams: 0, error: 'Unsafe aggregate viewer count' });
    });
    for (const mode of ['cancel', 'deadline', 'retire'] as const) {
        it(`fences held SDK results on ${mode} and joins actual settlement during retirement`, async () => {
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<VideoInfo>();
            let admissions = 0;
            const { owner, service } = fixture(async () => { admissions++; entered.resolve(); return release.promise; });
            const controller = new AbortController();
            const pending = service.extractViewerCount(id(1), { signal: controller.signal, timeout: mode === 'deadline' ? 10 : 8000 });
            let disposal: Promise<void> | undefined;
            let disposed = false;
            try {
                await entered.promise;
                if (mode === 'cancel') controller.abort();
                if (mode === 'retire') disposal = owner.dispose().then(() => { disposed = true; });
                expect(await pending).toMatchObject({ success: false, count: 0, errorType: mode === 'cancel' ? 'AbortError' : mode === 'deadline' ? 'TimeoutError' : 'Error' });
                disposal ??= owner.dispose().then(() => { disposed = true; });
                expect(await service.extractViewerCount(id(2))).toMatchObject({ success: false, count: 0 });
                expect(disposed).toBe(false);
                expect(admissions).toBe(1);
                release.resolve(live(id(1), 999));
                await disposal;
                expect(disposed).toBe(true);
                expect(service.getStats()).toMatchObject({ totalRequests: 2, successfulExtractions: 0, failedExtractions: 2 });
            } finally { release.resolve({}); await pending; await owner.dispose(); }
        });
    }
});

it('keeps source metadata and one safe failure cause without progress diagnostics', async () => {
    const diagnostics: unknown[] = [];
    const capture = (...args: unknown[]) => { diagnostics.push(args); };
    const logger = { ...noOpLogger, debug: capture, warn: capture, error: capture };
    const { service } = fixture(async videoId => {
        if (videoId === id(3)) throw new TypeError('synthetic-private-request-body');
        return live(videoId, 12);
    }, { logger });
    expect(await service.getAggregatedViewerCount([id(1), id(2)])).toMatchObject({ success: true, totalCount: 24 });
    expect(diagnostics).toEqual([]);
    expect(await service.extractViewerCount(id(3))).toMatchObject({ success: false, errorType: 'TypeError' });
    expect(diagnostics).toHaveLength(1);
    expect(JSON.stringify(diagnostics)).toContain('request (TypeError)');
    expect(JSON.stringify(diagnostics)).not.toContain('synthetic-private');
});
