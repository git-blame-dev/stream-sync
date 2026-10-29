import { describe, expect, it } from 'bun:test';
import { YouTubePlatform } from '../../src/platforms/youtube';
import { InnertubeService } from '../../src/services/innertube-service';
import { YouTubeStreamDetectionService } from '../../src/services/youtube-stream-detection-service';
import { ViewerCountExtractionService } from '../../src/services/viewer-count-extraction-service';
import { noOpLogger } from '../helpers/mock-factories';
import { initializeLoggingConfig } from '../../src/core/logging';
import { withTimeout } from '../../src/utils/timeout-wrapper';

const videoId = 'synthetic_direct_count';

function fixture() {
    initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: false } } });
    let count = 0;
    let unavailable = false;
    let metadataRequests = 0;
    let holdMetadata: (() => Promise<void>) | undefined;
    const owner = new InnertubeService({ createWithTimeout: async () => ({
        getChannel: async () => ({ videos: [{ id: videoId, is_live: true }], getLiveStreams: async () => ({ videos: [] }) }),
        search: async () => ({ videos: [] }),
        getInfo: async (id: string) => {
            expect(id).toBe(videoId);
            metadataRequests++;
            await holdMetadata?.();
            if (unavailable) throw new Error('synthetic metadata unavailable');
            return { basic_info: { id, is_live: true, is_live_content: true, view_count: count } };
        }
    }) }, { logger: noOpLogger });
    const platform = new YouTubePlatform({ username: `UC${'q'.repeat(22)}`, dataLoggingEnabled: false,
        envFileReadEnabled: false, envFileWriteEnabled: false }, {
        logger: noOpLogger, innertubeService: owner,
        streamDetectionService: new YouTubeStreamDetectionService(owner, { logger: noOpLogger }),
        viewerExtractionService: new ViewerCountExtractionService(owner, { logger: noOpLogger })
    });
    return { platform, setCount(value: number) { count = value; }, setUnavailable(value: boolean) { unavailable = value; },
        holdMetadata(callback: () => Promise<void>) { holdMetadata = callback; },
        requests: () => metadataRequests,
        async close() { await platform.cleanup(); await owner.dispose(); } };
}

describe('YouTube direct viewer count through detection and metadata extraction', () => {
    it('forwards measured counts including zero across successive retrievals', async () => {
        const f = fixture();
        try {
            await f.platform.getLiveVideoIds();
            const results: Array<number | null> = [];
            for (const count of [888, 0, 1234]) {
                f.setCount(count);
                results.push(await f.platform.getViewerCount());
            }
            expect(results).toEqual([888, 0, 1234]);
            expect(f.requests()).toBe(3);
        } finally { await f.close(); }
    });

    it('reports unavailable metadata and recovers with the next measured count', async () => {
        const f = fixture();
        try {
            await f.platform.getLiveVideoIds();
            f.setUnavailable(true);
            expect(await f.platform.getViewerCount()).toBeNull();
            f.setUnavailable(false);
            f.setCount(777);
            expect(await f.platform.getViewerCount()).toBe(777);
            expect(f.requests()).toBe(2);
        } finally { await f.close(); }
    });

    it('allows three overlapping direct count requests to reach metadata independently', async () => {
        const f = fixture();
        let release!: () => void;
        let allEntered!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const entered = new Promise<void>(resolve => { allEntered = resolve; });
        const started: Array<Promise<number | null>> = [];
        try {
            await f.platform.getLiveVideoIds();
            f.setCount(888);
            f.holdMetadata(async () => {
                if (f.requests() === 3) allEntered();
                await gate;
            });
            started.push(f.platform.getViewerCount(), f.platform.getViewerCount(), f.platform.getViewerCount());
            await withTimeout(entered, 5000, 'three synthetic metadata requests');
            expect(f.requests()).toBe(3);
            release();
            expect(await Promise.all(started)).toEqual([888, 888, 888]);
            expect(f.requests()).toBe(3);
        } finally {
            release();
            await Promise.allSettled(started);
            await f.close();
        }
    }, 10000);
});
