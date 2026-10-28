import { describe, expect, it } from 'bun:test';
import { InnertubeService } from '../../../src/services/innertube-service';
import { ViewerCountExtractionService } from '../../../src/services/viewer-count-extraction-service';
import { noOpLogger } from '../../helpers/mock-factories';

describe('viewer metadata ownership', () => {
    it('retries failed initialization and coalesces waiters without inheriting caller cancellation', async () => {
        let attempts = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const owner = new InnertubeService({
            createWithTimeout: async () => {
                attempts++;
                if (attempts === 1) throw new Error('synthetic import failure');
                await gate;
                return { getInfo: async () => ({ video_details: { concurrent_viewers: 7 } }) };
            }
        }, { logger: noOpLogger });
        const service = new ViewerCountExtractionService(owner, { logger: noOpLogger });
        expect(await service.extractViewerCount('first')).toMatchObject({ success: false, error: 'synthetic import failure' });
        const controller = new AbortController();
        const cancelled = service.extractViewerCount('second', { signal: controller.signal });
        const healthy = service.extractViewerCount('third');
        controller.abort(new Error('cancel only this waiter'));
        release();
        expect(await cancelled).toMatchObject({ success: false, error: 'cancel only this waiter' });
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
                    return { basic_info: { is_live: true, view_count: Number(await response.text()) } };
                } };
            }
        }, {
            logger: noOpLogger,
            fetch: async (_input, init) => new Response(new ReadableStream({
                start(controller) {
                    const signal = init?.signal;
                    if (String(_input).endsWith('/cancelled')) {
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
        const pending = service.extractViewerCount('cancelled', { signal: cancellation.signal });
        await reading;
        const other = service.extractViewerCount('healthy');
        cancellation.abort(new Error('synthetic cancellation'));
        expect(await pending).toMatchObject({ success: false, error: 'synthetic cancellation' });
        expect(await other).toMatchObject({ success: true, count: 42 });
        expect(creations).toBe(1);
        await owner.dispose();
    });
});
