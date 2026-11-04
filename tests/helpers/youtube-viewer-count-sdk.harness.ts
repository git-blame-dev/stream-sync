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
    const lockup = (videoId: string, ownerId: string) => ({ lockupViewModel: {
        contentId: videoId, contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
        contentImage: { thumbnailViewModel: { image: { sources: [] }, overlays: [{ thumbnailOverlayBadgeViewModel: {
            thumbnailBadges: [{ thumbnailBadgeViewModel: { text: 'LIVE', badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE' } }]
        } }] } },
        metadata: { lockupMetadataViewModel: {
            title: { content: 'Synthetic shelf broadcast' },
            metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: {
                content: 'Synthetic channel', commandRuns: [{ startIndex: 0, length: 17,
                    onTap: { innertubeCommand: { browseEndpoint: { browseId: ownerId } } } }]
            } }] }] } }
        } }
    } });
    const homeContent = new sdk.YTNodes.SectionList({ contents: [{ itemSectionRenderer: { contents: [
        { shelfRenderer: { title: { simpleText: 'Shorts' }, content: { horizontalListRenderer: {
            items: [lockup('test0000008', channelId)]
        } } } },
        { shelfRenderer: { title: { simpleText: 'Live now' }, content: { horizontalListRenderer: {
            visibleItemCount: 4, items: [lockup('test0000004', channelId), lockup('test0000005', `UC${'r'.repeat(22)}`)]
        } } } }
    ] } }] });
    let continuationCalls = 0;
    const shelfDiscovery = await YouTubeLiveStreamService.getLiveStreams({ getChannel: async () => ({
        current_tab: { content: homeContent },
        get videos(): never { throw new Error('flattened homepage must not be read when the Live now shelf exists'); },
        getLiveStreams: async () => ({ videos: [], has_continuation: true,
            getContinuation: async () => { continuationCalls++; return { videos: [] }; } })
    }) }, channelId, { logger });
    assert.deepEqual(shelfDiscovery.videoIds, ['test0000004']);
    assert.equal(shelfDiscovery.streams[0]?.title, 'Synthetic shelf broadcast');
    assert.equal(shelfDiscovery.observationKind, 'partial');
    assert.equal(shelfDiscovery.qualityReason, 'pagination_incomplete');
    assert.equal(continuationCalls, 0);
    const rawCard = (id: string, ownerId?: string) => ({ videoRenderer: {
        videoId: id, title: { simpleText: 'Synthetic tab broadcast' }, thumbnail: { thumbnails: [] },
        thumbnailOverlays: [], ...(ownerId ? { ownerText: { runs: [{ text: 'Synthetic owner',
            navigationEndpoint: { browseEndpoint: { browseId: ownerId } } }] } } : {})
    } });
    const nativeTab = new sdk.YT.Channel({} as never, { data: { contents: { twoColumnBrowseResultsRenderer: {
        tabs: [{ tabRenderer: { title: 'Live', selected: true, content: { richGridRenderer: {
            contents: [{ richItemRenderer: { content: rawCard('test0000007') } }]
        } } } }],
        secondaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: {
            contents: [rawCard('test0000008', `UC${'r'.repeat(22)}`)]
        } }] } }
    } } } });
    assert.equal(nativeTab.videos.length, 2, 'SDK flattens foreign secondaryContents into videos');
    const nativeDiscovery = await YouTubeLiveStreamService.getLiveStreams({ getChannel: async () => ({
        videos: [], getLiveStreams: async () => nativeTab
    }) }, channelId, { logger });
    assert.deepEqual(nativeDiscovery.videoIds, ['test0000007'], 'authorless tab candidate survives; foreign secondary card does not');
    const upcoming = new sdk.YTNodes.Video({
        videoId: 'test0000003', title: { simpleText: 'Synthetic upcoming stream' },
        thumbnail: { thumbnails: [] }, thumbnailOverlays: [],
        ownerText: { runs: [{ text: 'Synthetic channel', navigationEndpoint: { browseEndpoint: { browseId: channelId } } }] },
        upcomingEventData: { startTime: '253402214400' }
    });
    assert.equal(upcoming.is_live, true, 'native SDK infers live without a duration overlay');
    assert.equal(upcoming.is_upcoming, true);
    const inferredLive = new sdk.YTNodes.Video({
        videoId: 'test0000006', title: { simpleText: 'Synthetic current broadcast' },
        thumbnail: { thumbnails: [] }, thumbnailOverlays: [],
        ownerText: { runs: [{ text: 'Synthetic channel', navigationEndpoint: { browseEndpoint: { browseId: channelId } } }] }
    });
    assert.equal(inferredLive.is_live, true, 'SDK current-live getter needs no explicit overlay');
    assert.equal(YouTubeLiveStreamService.isVideoLive(inferredLive), true);
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
        [{ count: '12junk', text: '12 watching now' }, null],
        [{ count: '1.9', text: '1 watching now' }, null],
        [{ count: '1e3', text: '1 watching now' }, null],
        [{ count: '-0.7', text: '0 watching now' }, null],
        [{ count: 1.9, text: '1 watching now' }, null],
        [{ count: -0.7, text: '0 watching now' }, null],
        ...['', ' 12', '12\n', null, true, {}].map(count => [{ count, text: '12 watching now' }, null] as [Scenario, null]),
        [{ count: 12, text: '12 watching now' }, 12],
        [{ count: '9007199254740991' }, Number.MAX_SAFE_INTEGER],
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
