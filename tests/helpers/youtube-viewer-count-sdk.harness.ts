// Exercise the installed SDK in an isolated process with synthetic HTTP responses.
import { strict as assert } from 'node:assert';
import type { Innertube } from 'youtubei.js';
import { InnertubeFactory } from '../../src/factories/innertube-factory';
import { InnertubeService } from '../../src/services/innertube-service';
import { YouTubeLiveStreamService } from '../../src/services/youtube-live-stream-service';
import { ViewerCountExtractionService } from '../../src/services/viewer-count-extraction-service';

assert.equal(process.env.YOUTUBE_SDK_RETIREMENT_CHILD, '1');
const sdk = await import(import.meta.resolve('youtubei.js'));
InnertubeFactory.configure({ importer: async () => sdk });
const logger = { error: () => {}, debug: () => {}, warn: () => {} };
const requestedId = 'test0000001';
type Scenario = { count?: unknown; unlabeled?: string; text?: string; live?: boolean; playerLive?: boolean; upcoming?: boolean; end?: string; returnedId?: string; nextIdentity?: unknown; omitNextIdentity?: boolean };
let scenario: Scenario = {};
const requests: string[] = [];
const owner = new InnertubeService<Innertube>({
    createWithTimeout: async (_timeout, config) => {
        const client = await InnertubeFactory.createWithConfig(config) as Innertube;
        assert.ok(client instanceof sdk.Innertube);
        return client;
    }
}, {
    logger,
    creationConfig: { generate_session_locally: true, retrieve_innertube_config: false, enable_session_cache: false, fail_fast: true },
    fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        requests.push(url.pathname);
        const body = JSON.parse(String(init?.body));
        assert.equal(body.videoId, requestedId);
        assert.equal(body.context.client.clientName, 'WEB');
        if (url.pathname.endsWith('/player')) {
            return Response.json({
                playabilityStatus: { status: 'OK' },
                videoDetails: { videoId: scenario.returnedId ?? requestedId, title: 'Synthetic stream', channelId: 'UC_SYNTHETIC', shortDescription: '', lengthSeconds: '0', viewCount: '900000', isLive: scenario.playerLive ?? true, isUpcoming: scenario.upcoming ?? false, isLiveContent: true },
                microformat: { playerMicroformatRenderer: { title: { simpleText: 'Synthetic stream' }, description: { simpleText: '' }, thumbnail: { thumbnails: [] }, liveBroadcastDetails: { startTimestamp: '2020-01-01T00:00:00Z', ...(scenario.end ? { endTimestamp: scenario.end } : {}) } } }
            });
        }
        assert.ok(url.pathname.endsWith('/next'), 'no unhandled network requests');
        return Response.json({ ...(scenario.omitNextIdentity ? {} : { currentVideoEndpoint: { watchEndpoint: { videoId: scenario.nextIdentity ?? requestedId } } }), contents: { twoColumnWatchNextResults: {
            results: { results: { contents: [{ videoPrimaryInfoRenderer: {
                title: { runs: [{ text: 'Synthetic stream' }] },
                viewCount: { videoViewCountRenderer: { isLive: scenario.live ?? true,
                    ...(scenario.count !== undefined ? { originalViewCount: scenario.count } : {}),
                    ...(scenario.unlabeled !== undefined ? { unlabeledViewCountValue: { simpleText: scenario.unlabeled } } : {}),
                    viewCount: { simpleText: scenario.text ?? '1.2K watching now' }
                } }
            } }] } }, secondaryResults: { secondaryResults: { results: [] } }
        } } });
    }
});
const service = new ViewerCountExtractionService(owner, { logger });
let checks = 0;
try {
    const channelId = `UC${'q'.repeat(22)}`;
    const upcoming = new sdk.YTNodes.Video({
        videoId: 'test0000003', title: { simpleText: 'Synthetic upcoming stream' },
        thumbnail: { thumbnails: [] }, thumbnailOverlays: [],
        ownerText: { runs: [{ text: 'Synthetic channel', navigationEndpoint: { browseEndpoint: { browseId: channelId } } }] },
        upcomingEventData: { startTime: '253402214400' }
    });
    assert.equal(upcoming.is_live, true, 'native SDK infers live without a duration overlay');
    assert.equal(upcoming.is_upcoming, true);
    const discovered = await YouTubeLiveStreamService.getLiveStreams({
        getChannel: async () => ({ videos: [upcoming], getLiveStreams: async () => ({ videos: [upcoming] }) })
    }, channelId, { logger });
    assert.deepEqual(discovered.videoIds, [], 'upcoming native SDK videos must never enter live membership');
    assert.equal(discovered.observationKind, 'complete');
    for (const [input, expected] of [
        [{ count: '1234', unlabeled: '1,234', text: '1,2 k spectateurs' }, 1234],
        [{ count: '0', text: '0 watching now' }, 0],
        [{ unlabeled: '2,345', text: '2.3K watching now' }, 2345],
        [{ text: '345 watching now' }, 345],
        [{ text: '900000 views' }, null],
        [{ count: '12', live: false, text: '12 watching now' }, null],
        [{ count: '12', playerLive: false }, null],
        [{ count: '12', upcoming: true }, null],
        [{ count: '12', end: '2020-01-01T01:00:00Z' }, null],
        [{ count: '12', returnedId: 'test0000002' }, null],
        [{ count: '12', nextIdentity: 'test0000002' }, null],
        [{ count: '12', nextIdentity: {} }, null],
        [{ count: '12', nextIdentity: '' }, null],
        [{ count: '12', omitNextIdentity: true }, null],
        [{ count: '9007199254740992' }, null],
        [{ count: '12', unlabeled: '13' }, null],
        [{ unlabeled: '12junk', text: '12 watching now' }, null]
    ] as Array<[Scenario, number | null]>) {
        scenario = input;
        const result = await service.extractViewerCount(requestedId);
        assert.equal(result.success, expected !== null, JSON.stringify(input));
        assert.equal(result.count, expected ?? 0, JSON.stringify(input));
        checks++;
    }
    assert.equal(owner.stats.instancesCreated, 1);
    assert.equal(requests.filter(path => path.endsWith('/player')).length, checks);
    assert.equal(requests.filter(path => path.endsWith('/next')).length, checks);
} finally { await owner.dispose(); }
console.log(`YOUTUBE_VIEWER_COUNT_SDK_OK checks=${checks}`);
