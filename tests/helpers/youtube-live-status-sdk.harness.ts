// Run directly with Bun: bun:test's preload replaces the SDK with a mock.
import { strict as assert } from 'node:assert';
import sdkPackage from 'youtubei.js/package.json';
import type { Innertube } from 'youtubei.js';
import { InnertubeService } from '../../src/services/innertube-service';

assert.equal(process.env.YOUTUBE_SDK_RETIREMENT_CHILD, '1', 'run through the isolated SDK child owner');
assert.equal(sdkPackage.version, '18.3.0');
const sdk: typeof import('youtubei.js') = await import(import.meta.resolve('youtubei.js'));
sdk.Log.setLevel(sdk.Log.Level.NONE);
const start = '2040-01-01T12:00:00Z';
const end = '2040-01-01T13:00:00Z';
type Fixture = {
    id?: string;
    isLive?: boolean;
    isLiveContent?: boolean;
    isPostLiveDvr?: boolean;
    isUpcoming?: boolean;
    startTimestamp?: string;
    endTimestamp?: string;
    unavailable?: boolean;
};
const fixtures = new Map<string, Fixture>([
    ['SYNTHETIC_LIVE', { isLive: true, isLiveContent: true, startTimestamp: start }],
    ['SYNTHETIC_ENDED', { isLive: false, isLiveContent: true, isPostLiveDvr: true, startTimestamp: start, endTimestamp: end }],
    ['SYNTHETIC_MISSING_FLAG', { isLiveContent: true }],
    ['SYNTHETIC_UNAVAILABLE', { unavailable: true }],
    ['SYNTHETIC_INVALID_END', { isLive: false, isLiveContent: true, endTimestamp: 'synthetic-invalid-timestamp' }],
    ['SYNTHETIC_CONTRADICTORY', { isLive: true, isLiveContent: true, endTimestamp: end }],
    ['SYNTHETIC_MISMATCH', { id: 'SYNTHETIC_OTHER_VIDEO', isLive: false, isLiveContent: true, endTimestamp: end }],
    ['SYNTHETIC_UPCOMING', { isLive: false, isLiveContent: true, isUpcoming: true }]
]);
const requests: Array<{ endpoint: string; videoId: string }> = [];
const logger = { debug() {}, error() {}, warn() {} };
const service = new InnertubeService<Innertube>({
    createWithTimeout: async (_timeout, config) => {
        assert.equal(config?.retrieve_player, false);
        const client = await sdk.Innertube.create(config);
        assert.ok(client instanceof sdk.Innertube, 'must use the native SDK class');
        return client;
    }
}, {
    logger,
    creationConfig: {
        generate_session_locally: true, retrieve_innertube_config: false,
        enable_session_cache: false, fail_fast: true
    } satisfies Parameters<typeof sdk.Innertube.create>[0],
    fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        assert.equal(url.origin, 'https://www.youtube.com');
        assert.ok(['/youtubei/v1/player', '/youtubei/v1/next'].includes(url.pathname), 'unexpected SDK endpoint');
        const payload = JSON.parse(String(init?.body)) as { videoId?: unknown };
        assert.equal(typeof payload.videoId, 'string');
        const videoId = payload.videoId as string;
        const fixture = fixtures.get(videoId);
        assert.ok(fixture, 'unexpected synthetic video ID');
        requests.push({ endpoint: url.pathname, videoId });
        if (url.pathname === '/youtubei/v1/next') return Response.json({});
        if (fixture.unavailable) return Response.json({
            playabilityStatus: { status: 'ERROR', reason: 'Synthetic unavailable playback' }
        });
        return Response.json({
            playabilityStatus: { status: 'OK' },
            videoDetails: {
                videoId: fixture.id ?? videoId, channelId: 'UC_SYNTHETIC_STATUS',
                title: 'Synthetic broadcast', lengthSeconds: '0', viewCount: '1', thumbnail: { thumbnails: [] },
                ...(fixture.isLive === undefined ? {} : { isLive: fixture.isLive }),
                isLiveContent: fixture.isLiveContent,
                isPostLiveDvr: fixture.isPostLiveDvr, isUpcoming: fixture.isUpcoming
            },
            microformat: { playerMicroformatRenderer: {
                title: { simpleText: 'Synthetic broadcast' }, description: { simpleText: 'Synthetic description' },
                thumbnail: { thumbnails: [] }, lengthSeconds: '0', viewCount: '1',
                externalChannelId: 'UC_SYNTHETIC_STATUS', ownerChannelName: 'Synthetic channel',
                liveBroadcastDetails: {
                    startTimestamp: fixture.startTimestamp, endTimestamp: fixture.endTimestamp
                }
            } }
        });
    }
});
const getInfo = (id: string) => service.withMetadataOperation({}, async client => {
    const info = await client.getInfo(id, { client: 'WEB' });
    assert.ok(info instanceof sdk.YT.VideoInfo, 'must use native getInfo and VideoInfo parsing');
    return info;
});
let checks = 0;
try {
    const live = await getInfo('SYNTHETIC_LIVE');
    assert.equal(live.basic_info.id, 'SYNTHETIC_LIVE');
    assert.equal(live.basic_info.channel_id, 'UC_SYNTHETIC_STATUS');
    assert.equal(live.basic_info.is_live, true);
    assert.equal(live.basic_info.is_live_content, true);
    assert.ok(live.basic_info.start_timestamp instanceof Date);
    assert.equal(live.basic_info.start_timestamp.toISOString(), '2040-01-01T12:00:00.000Z');
    assert.equal(live.basic_info.end_timestamp, null);
    checks++;

    const ended = await getInfo('SYNTHETIC_ENDED');
    assert.equal(ended.basic_info.id, 'SYNTHETIC_ENDED');
    assert.equal(ended.basic_info.is_live, false);
    assert.equal(ended.basic_info.is_live_content, true);
    assert.equal(ended.basic_info.is_post_live_dvr, true);
    assert.equal(ended.playability_status?.status, 'OK');
    assert.ok(ended.basic_info.end_timestamp instanceof Date);
    assert.equal(ended.basic_info.end_timestamp.toISOString(), '2040-01-01T13:00:00.000Z');
    checks++;

    const missing = await getInfo('SYNTHETIC_MISSING_FLAG');
    assert.equal(missing.basic_info.is_live, false, 'missing raw isLive is coerced to false');
    assert.equal(missing.basic_info.is_live_content, true);
    assert.equal(missing.basic_info.end_timestamp, null);
    checks++;

    await assert.rejects(getInfo('SYNTHETIC_UNAVAILABLE'), (error: unknown) => {
        assert.ok(error instanceof sdk.Utils.InnertubeError);
        assert.equal(error.message, 'This video is unavailable');
        assert.equal((error.info as { status?: string }).status, 'ERROR');
        return true;
    });
    checks++;

    const invalid = await getInfo('SYNTHETIC_INVALID_END');
    assert.ok(invalid.basic_info.end_timestamp instanceof Date);
    assert.ok(Number.isNaN(invalid.basic_info.end_timestamp.getTime()), 'invalid Date is not valid end evidence');
    checks++;

    const contradictory = await getInfo('SYNTHETIC_CONTRADICTORY');
    assert.equal(contradictory.basic_info.is_live, true);
    assert.ok(contradictory.basic_info.end_timestamp instanceof Date);
    assert.equal(contradictory.basic_info.end_timestamp.toISOString(), '2040-01-01T13:00:00.000Z');
    checks++;

    const mismatch = await getInfo('SYNTHETIC_MISMATCH');
    assert.equal(mismatch.basic_info.id, 'SYNTHETIC_OTHER_VIDEO', 'SDK exposes response identity, not requested identity');
    assert.ok(mismatch.basic_info.end_timestamp instanceof Date);
    checks++;

    const upcoming = await getInfo('SYNTHETIC_UPCOMING');
    assert.equal(upcoming.basic_info.is_upcoming, true);
    assert.equal(upcoming.basic_info.is_live, false);
    assert.equal(upcoming.basic_info.is_live_content, true);
    assert.equal(upcoming.basic_info.end_timestamp, null);
    checks++;

    for (const videoId of fixtures.keys()) {
        assert.deepEqual(requests.filter(request => request.videoId === videoId).map(request => request.endpoint).sort(),
            ['/youtubei/v1/next', '/youtubei/v1/player']);
    }
    assert.equal(requests.length, fixtures.size * 2);
    assert.equal(service.stats.instancesCreated, 1);
    assert.equal(checks, 8);
} finally {
    await service.dispose();
}
console.log(`YOUTUBE_LIVE_STATUS_SDK_OK checks=${checks}`);
