import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { YouTubePlatform } from '../../src/platforms/youtube';
import { InnertubeService } from '../../src/services/innertube-service';
import { YouTubeStreamDetectionService } from '../../src/services/youtube-stream-detection-service';
import { ViewerCountExtractionService } from '../../src/services/viewer-count-extraction-service';
import { noOpLogger } from '../helpers/mock-factories';

type Stream = { id: string; count: number; premiere?: boolean };
function fixture(streams: Stream[]) {
    const failures = new Set<string>();
    const chatFailures = new Set<string>();
    const chats = new Map<string, EventEmitter>();
    const owner = new InnertubeService({ createWithTimeout: async () => ({
        getChannel: async () => ({ videos: streams.map(s => ({ id: s.id,
            ...(s.premiere ? { is_live_content: true, badges: [{ label: 'LIVE' }] } : { is_live: true }) })), getLiveStreams: async () => ({ videos: streams.map(s => ({ id: s.id, ...(s.premiere ? { is_live_content: true, badges: [{ label: 'LIVE' }] } : { is_live: true }) })) }) }),
        search: async () => ({ videos: [] }),
        getInfo: async (id: string) => {
            if (failures.has(id)) throw new Error('synthetic metadata unavailable');
            const stream = streams.find(s => s.id === id)!;
            return { page: [{}, { current_video_endpoint: { payload: { videoId: id } } }], basic_info: { id, channel_id: `UC${'q'.repeat(22)}`, is_live: true, is_live_content: true, view_count: stream.count },
                primary_info: { view_count: { is_live: true, original_view_count: stream.count } },
                livechat: { continuation: 'SYNTHETIC_CHAT_CONTINUATION', is_replay: false },
                getLiveChat: () => {
                    if (chatFailures.has(id)) throw new Error('synthetic chat unavailable');
                    const chat = Object.assign(new EventEmitter(), { start(this: EventEmitter) { this.emit('start', {}); }, stop() {}, applyFilter() {} });
                    chats.set(id, chat);
                    return chat;
                } };
        }
    }) }, { logger: noOpLogger });
    const platform = new YouTubePlatform({ username: `UC${'q'.repeat(22)}`, maxStreams: 5,
        dataLoggingEnabled: false, envFileReadEnabled: false, envFileWriteEnabled: false }, {
        logger: noOpLogger, innertubeService: owner,
        streamDetectionService: new YouTubeStreamDetectionService(owner, { logger: noOpLogger }),
        viewerExtractionService: new ViewerCountExtractionService(owner, { logger: noOpLogger })
    });
    return { platform, failures, chatFailures, chats, async close() { await platform.cleanup(); await owner.dispose(); } };
}
const streams = (counts: number[]) => counts.map((count, index) => ({ id: `test000000${index}`, count }));

describe('YouTube detected membership and metadata aggregation', () => {
    it.each([
        [[140, 920, 26], 1086], [[1234], 1234], [[45000, 32000, 18000, 5000], 100000],
        [[500, 0, 250], 750], [[2500, 150], 2650], [[5000, 2000, 1500, 800], 9300],
        [[1200, 45, 38, 52], 1335], [[400, 600], 1000], [[123], 123],
        [[1500, 800, 1200, 600], 4100], [[2000, 1500, 900], 4400],
        [[1800, 1200, 900], 3900], [[2500, 1800], 4300], [[3000, 1500, 800, 1200], 6500],
        [[15000, 850, 42], 15892], [[0], 0], [[1000, 2000], 3000], [[4000, 1000], 5000],
        [[1000, 500], 1500]
    ] as Array<[number[], number]>)('returns complete counts %p as %i', async (counts, expected) => {
        const f = fixture(streams(counts));
        try {
            await f.platform.getLiveVideoIds();
            expect(await f.platform.getViewerCount()).toBe(expected);
        } finally { await f.close(); }
    });

    it('returns unavailable for partial and all metadata failures and recovers', async () => {
        const f = fixture(streams([300, 200, 700]));
        try {
            await f.platform.getLiveVideoIds();
            f.failures.add('test0000001');
            expect(await f.platform.getViewerCount()).toBeNull();
            f.failures.add('test0000000'); f.failures.add('test0000002');
            expect(await f.platform.getViewerCount()).toBeNull();
            f.failures.clear();
            expect(await f.platform.getViewerCount()).toBe(1200);
        } finally { await f.close(); }
    });

    it('returns zero for confirmed empty discovery', async () => {
        const f = fixture([]);
        try { await f.platform.getLiveVideoIds(); expect(await f.platform.getViewerCount()).toBe(0); }
        finally { await f.close(); }
    });

    it('counts live content including a premiere-shaped item with failed and recovered chat', async () => {
        const input = streams([3500, 800, 1200, 400]);
        const f = fixture(input.map((stream, index) => ({ ...stream, premiere: index === 1 })));
        try {
            for (const stream of input) f.chatFailures.add(stream.id);
            await f.platform.checkMultiStream();
            expect(f.platform.getDetectedStreamIds()).toHaveLength(4);
            expect(f.platform.getActiveYouTubeVideoIds()).toEqual([]);
            expect(await f.platform.getViewerCount()).toBe(5900);
            f.chatFailures.clear();
            await f.platform.requestImmediateYouTubeStreamRefresh();
            expect(f.platform.getActiveYouTubeVideoIds()).toHaveLength(4);
            expect(await f.platform.getViewerCount()).toBe(5900);
            f.chats.get('test0000001')!.emit('end');
            expect(await f.platform.getViewerCount()).toBe(5900);
            await f.platform.requestImmediateYouTubeStreamRefresh();
            expect(await f.platform.getViewerCount()).toBe(5900);
        } finally { await f.close(); }
    });

    it('counts both ready and failed chats and keeps the total through interruption and recovery', async () => {
        const f = fixture(streams([4000, 1000]));
        try {
            f.chatFailures.add('test0000001');
            await f.platform.checkMultiStream();
            expect(f.platform.getActiveYouTubeVideoIds()).toEqual(['test0000000']);
            expect(await f.platform.getViewerCount()).toBe(5000);
            f.chats.get('test0000000')!.emit('end');
            expect(await f.platform.getViewerCount()).toBe(5000);
            f.chatFailures.clear();
            await f.platform.requestImmediateYouTubeStreamRefresh();
            expect(f.platform.getActiveYouTubeVideoIds()).toHaveLength(2);
            expect(await f.platform.getViewerCount()).toBe(5000);
        } finally { await f.close(); }
    });

    it('retrieves three successive actual observations', async () => {
        const f = fixture(streams([2500]));
        try {
            await f.platform.getLiveVideoIds();
            expect([await f.platform.getViewerCount(), await f.platform.getViewerCount(), await f.platform.getViewerCount()]).toEqual([2500, 2500, 2500]);
        } finally { await f.close(); }
    });
});
