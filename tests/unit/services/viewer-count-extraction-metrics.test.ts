import { expect, test, spyOn } from 'bun:test';
import { ViewerCountExtractionService } from '../../../src/services/viewer-count-extraction-service';
import { InnertubeService } from '../../../src/services/innertube-service';
import { noOpLogger as logger } from '../../helpers/mock-factories';
import { setSystemTime, useFakeTimers, useRealTimers } from '../../helpers/bun-timers';

const orders = [[0, 1], [1, 0], [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
test.each(orders.map(order => ({ order })))('completed mean excludes pending samples in order %p', async ({ order }) => {
    let clock = 100;
    useFakeTimers();
    setSystemTime(new Date(1700000000000));
    const monotonic = spyOn(performance, 'now').mockImplementation(() => clock);
    const entered = Promise.withResolvers<void>();
    const held = Array.from({ length: order.length }, () => Promise.withResolvers<Record<string, unknown>>());
    let admissions = 0;
    const owner = new InnertubeService({ createWithTimeout: async () => ({ getInfo: async (id: string) => {
        if (++admissions === order.length) entered.resolve();
        return held[Number(id.at(-1))]!.promise;
    } }) }, { logger });
    const service = new ViewerCountExtractionService(owner, { logger });
    const abort = new AbortController();
    try {
        expect(service.getStats().averageResponseTime).toBe(0);
        const requests = held.map((_, index) => service.extractViewerCount(`test000000${index}`, index === 2 ? { signal: abort.signal } : {}));
        await entered.promise;
        let total = 0;
        for (const [step, index] of order.entries()) {
            clock = 110 + step * 10;
            setSystemTime(new Date(1700000000000 - step * 100000));
            if (index === 2) abort.abort();
            held[index]!.resolve(index === 1 ? {} : { page: [{}, { current_video_endpoint: { payload: { videoId: `test000000${index}` } } }], basic_info: { id: `test000000${index}` }, primary_info: { view_count: { is_live: true, original_view_count: 12 } } });
            const result = await requests[index]!;
            total += 10 + step * 10;
            expect(result.responseTime).toBe(10 + step * 10);
            expect(service.getStats().averageResponseTime).toBe(Math.round(total / (step + 1)));
            expect(service.getStats().totalRequests).toBe(order.length);
        }
        expect(service.getStats()).toMatchObject({ successfulExtractions: 1, failedExtractions: order.length - 1, averageResponseTime: order.length === 3 ? 20 : 15, startTime: 1700000000000, uptime: order.length * 10 });
    } finally {
        for (const pending of held) pending.resolve({});
        try { await owner.dispose(); }
        finally { monotonic.mockRestore(); useRealTimers(); }
    }
});

test('sequential fractional samples retain unrounded accumulation', async () => {
    let clock = 100;
    const monotonic = spyOn(performance, 'now').mockImplementation(() => clock);
    const durations = [1, 2, 1, 0.4];
    const owner = new InnertubeService({ createWithTimeout: async () => ({ getInfo: async (id: string) => {
        clock += durations.shift()!;
        return { page: [{}, { current_video_endpoint: { payload: { videoId: id } } }], basic_info: { id }, primary_info: { view_count: { is_live: true, original_view_count: 0 } } };
    } }) }, { logger });
    const service = new ViewerCountExtractionService(owner, { logger });
    try {
        for (let i = 0; i < 4; i++) await service.extractViewerCount('test0000000');
        expect(service.getStats().averageResponseTime).toBe(1);
        expect(service.getStats().successfulExtractions).toBe(4);
    } finally { monotonic.mockRestore(); await owner.dispose(); }
});
