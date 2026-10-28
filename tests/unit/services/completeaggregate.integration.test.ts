import { describe, expect, it } from 'bun:test';
import { InnertubeService } from '../../../src/services/innertube-service';
import { ViewerCountExtractionService } from '../../../src/services/viewer-count-extraction-service';
import { noOpLogger } from '../../helpers/mock-factories';

function setup(counts: Record<string, number | Error>) {
    const requests: string[] = [];
    const owner = new InnertubeService({
        createWithTimeout: async () => ({
            getInfo: async (id: string) => {
                requests.push(id);
                const count = counts[id];
                if (count instanceof Error) throw count;
                return { basic_info: { is_live: true, view_count: count } };
            }
        })
    }, { logger: noOpLogger });
    const service = new ViewerCountExtractionService(owner, { logger: noOpLogger });
    return { owner, service, requests };
}

describe('complete unique viewer aggregates through owned metadata and real extraction', () => {
    it('does not publish a successful subtotal when one SDK request fails', async () => {
        const { owner, service } = setup({ 'test-a': 10, 'test-b': new Error('synthetic SDK failure') });
        try {
            const result = await service.getAggregatedViewerCount(['test-a', 'test-b']);
            expect(result).toMatchObject({ success: false, totalCount: 0, successfulStreams: 1, failedStreams: 1 });
            expect(result.streams).toEqual([
                { videoId: 'test-a', count: 10, success: true, strategy: 'basic_info' },
                { videoId: 'test-b', count: 0, success: false, error: 'synthetic SDK failure' }
            ]);
        } finally {
            await owner.dispose();
        }
    });

    it('captures unique exact IDs in first-seen order, including across batches', async () => {
        const { owner, service, requests } = setup({ 'test-b': 7, 'test-a': 3, ' test-a ': 2 });
        try {
            const ids = ['test-b', 'test-a', 'test-b', ' test-a ', 'test-a'];
            const result = await service.getAggregatedViewerCount(ids, { maxConcurrency: 1 });
            expect(result).toMatchObject({ success: true, totalCount: 12, successfulStreams: 3, failedStreams: 0 });
            expect(requests).toEqual(['test-b', 'test-a', ' test-a ']);
            expect(result.streams.map(stream => stream.videoId)).toEqual(requests);
            expect(ids).toEqual(['test-b', 'test-a', 'test-b', ' test-a ', 'test-a']);
        } finally {
            await owner.dispose();
        }
    });

    it('rejects an unsafe sum while retaining valid per-member diagnostics', async () => {
        const { owner, service } = setup({ 'test-a': Number.MAX_SAFE_INTEGER, 'test-b': 1 });
        try {
            expect(await service.getAggregatedViewerCount(['test-a', 'test-b'])).toMatchObject({
                success: false, totalCount: 0, successfulStreams: 2, failedStreams: 0,
                error: 'Unsafe aggregate viewer count'
            });
        } finally {
            await owner.dispose();
        }
    });

    for (const count of [Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, -1, 1.5]) {
        it(`rejects invalid individual count ${String(count)} without publishing a subtotal`, async () => {
            const { owner, service } = setup({ 'test-a': 10, 'test-b': count });
            try {
                expect(await service.extractViewerCount('test-b')).toMatchObject({ success: false, count: 0 });
                const result = await service.getAggregatedViewerCount(['test-a', 'test-b']);
                expect(result).toMatchObject({ success: false, totalCount: 0, successfulStreams: 1, failedStreams: 1 });
                expect(result.streams[1]).toMatchObject({ videoId: 'test-b', success: false, count: 0 });
            } finally {
                await owner.dispose();
            }
        });
    }

    it('accepts zero, the largest safe count, and the empty arithmetic identity', async () => {
        const { owner, service, requests } = setup({ 'test-zero': 0, 'test-max': Number.MAX_SAFE_INTEGER });
        try {
            expect(await service.getAggregatedViewerCount([])).toMatchObject({
                success: true, totalCount: 0, successfulStreams: 0, failedStreams: 0, streams: []
            });
            expect(requests).toEqual([]);
            expect(await service.extractViewerCount('test-zero')).toMatchObject({ success: true, count: 0 });
            expect(await service.getAggregatedViewerCount(['test-zero', 'test-max'])).toMatchObject({
                success: true, totalCount: Number.MAX_SAFE_INTEGER, successfulStreams: 2, failedStreams: 0
            });
        } finally {
            await owner.dispose();
        }
    });
});
