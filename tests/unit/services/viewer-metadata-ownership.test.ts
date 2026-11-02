import { describe, expect, it } from 'bun:test';
import { InnertubeService } from '../../../src/services/innertube-service';
import { ViewerCountExtractionService } from '../../../src/services/viewer-count-extraction-service';
import { noOpLogger } from '../../helpers/mock-factories';

describe('viewer metadata ownership', () => {
    it('rejects caller cancellation after the owned operation settles but before extraction publishes', async () => {
        const cancellation = new AbortController();
        const owner = new InnertubeService({
            createWithTimeout: async () => ({ getInfo: async (id: string) => ({ page: [{}, { current_video_endpoint: { payload: { videoId: id } } }], basic_info: { id, is_live: true }, primary_info: { view_count: { is_live: true, original_view_count: 8 } } }) })
        }, { logger: noOpLogger });
        const adapter: Pick<InnertubeService, 'withMetadataOperation'> = {
            withMetadataOperation: async (options, operation) => {
                const result = await owner.withMetadataOperation(options, operation);
                cancellation.abort(new Error('synthetic post-operation cancellation'));
                return result;
            }
        };
        const service = new ViewerCountExtractionService(adapter, { logger: noOpLogger });
        try {
            expect(await service.extractViewerCount('test0000000', { signal: cancellation.signal })).toMatchObject({
                success: false, count: 0, error: 'Viewer count extraction failed', errorType: 'AbortError'
            });
            expect(service.stats.successfulExtractions).toBe(0);
            expect(service.stats.failedExtractions).toBe(1);
        } finally {
            await owner.dispose();
        }
    });

    it('retries failed initialization and coalesces waiters without inheriting caller cancellation', async () => {
        let attempts = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const owner = new InnertubeService({
            createWithTimeout: async () => {
                attempts++;
                if (attempts === 1) throw new Error('synthetic import failure');
                await gate;
                return { getInfo: async (id: string) => ({ page: [{}, { current_video_endpoint: { payload: { videoId: id } } }], basic_info: { id }, primary_info: { view_count: { is_live: true, original_view_count: 7 } } }) };
            }
        }, { logger: noOpLogger });
        const service = new ViewerCountExtractionService(owner, { logger: noOpLogger });
        expect(await service.extractViewerCount('test0000001')).toMatchObject({ success: false, error: 'Viewer count extraction failed', errorType: 'Error' });
        const controller = new AbortController();
        const cancelled = service.extractViewerCount('test0000002', { signal: controller.signal });
        const healthy = service.extractViewerCount('test0000003');
        controller.abort(new Error('cancel only this waiter'));
        release();
        expect(await cancelled).toMatchObject({ success: false, error: 'Viewer count extraction failed', errorType: 'AbortError' });
        expect(await healthy).toMatchObject({ success: true, count: 7 });
        expect(attempts).toBe(2);
        await owner.dispose();
    });

    it('uses one shared client and keeps cancellation isolated through the getInfo body', async () => {
        let creations = 0;
        let started!: () => void;
        const reading = new Promise<void>(resolve => { started = resolve; });
        const owner = new InnertubeService({
            createWithTimeout: async () => { throw new Error('raw factory required'); },
            createWithConfig: async config => {
                creations++;
                const fetch = config?.fetch as typeof globalThis.fetch;
                return { getInfo: async (id: string) => {
                    const response = await fetch(`https://metadata.example.test/${id}`);
                    return { page: [{}, { current_video_endpoint: { payload: { videoId: id } } }], basic_info: { id, is_live: true }, primary_info: { view_count: { is_live: true, original_view_count: Number(await response.text()) } } };
                } };
            }
        }, {
            logger: noOpLogger,
            fetch: async (_input, init) => new Response(new ReadableStream({
                start(controller) {
                    const signal = init?.signal;
                    if (String(_input).endsWith('/test0000004')) {
                        signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
                        started();
                    } else {
                        controller.enqueue(new TextEncoder().encode('42'));
                        controller.close();
                    }
                }
            }))
        });
        const service = new ViewerCountExtractionService(owner, { logger: noOpLogger });
        const cancellation = new AbortController();
        const pending = service.extractViewerCount('test0000004', { signal: cancellation.signal });
        await reading;
        const other = service.extractViewerCount('test0000005');
        cancellation.abort(new Error('synthetic cancellation'));
        expect(await pending).toMatchObject({ success: false, error: 'Viewer count extraction failed', errorType: 'AbortError' });
        expect(await other).toMatchObject({ success: true, count: 42 });
        expect(creations).toBe(1);
        await owner.dispose();
    });
});
