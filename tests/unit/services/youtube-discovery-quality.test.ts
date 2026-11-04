import { describe, expect, it } from 'bun:test';
import { InnertubeService } from '../../../src/services/innertube-service';
import { YouTubeStreamDetectionService } from '../../../src/services/youtube-stream-detection-service';
import { noOpLogger } from '../../helpers/mock-factories';
import { useFakeTimers, useRealTimers, advanceTimersByTime } from '../../helpers/bun-timers';

const channelId = `UC${'q'.repeat(22)}`;
const live = { id: 'synthetic_live', is_live: true, author: { id: channelId } };
function setup(channel: unknown, search?: () => Promise<unknown>) {
    const owner = new InnertubeService({
        createWithTimeout: async () => ({
            getInfo: async (id: string) => ({ basic_info: { id, is_live: true }, primary_info: { view_count: { is_live: true, original_view_count: 9 } } }),
            getChannel: async () => channel,
            resolveURL: async () => ({ payload: { browseId: channelId } }),
            ...(search ? { search } : {})
        })
    }, { logger: noOpLogger });
    const detection = new YouTubeStreamDetectionService(owner, { logger: noOpLogger });
    return { owner, detection };
}

describe('discovery observation quality through real metadata ownership and detection', () => {
    for (const tabIds of [[], ['synthetic_target']]) {
        it(`unions owned homepage candidates with a closed recent page: ${tabIds.length}`, async () => {
            const { owner, detection } = setup({
                videos: [{ ...live, id: 'synthetic_foreign', author: { id: `UC${'r'.repeat(22)}` } },
                    { ...live, id: 'synthetic_stale' }],
                getLiveStreams: async () => ({ videos: tabIds.map(id => ({ ...live, id })) })
            });
            try {
                expect(await detection.detectLiveStreams(channelId)).toMatchObject({ success: true, observationKind: 'complete', videoIds: ['synthetic_stale', ...tabIds] });
            } finally { await owner.dispose(); }
        });
    }
    for (const tabVideos of [[], [{ ...live, id: 'synthetic_tab' }]]) {
        it(`retains owned Live now candidates alongside a closed recent page: ${tabVideos.length}`, async () => {
            const { owner, detection } = setup({
                videos: [], current_tab: { content: { type: 'SectionList', contents: [{ type: 'ItemSection', contents: [
                    { type: 'Shelf', title: { text: 'Live now' }, content: { type: 'HorizontalList', items: [live] } }
                ] }] } },
                getLiveStreams: async () => ({ videos: tabVideos, has_continuation: false })
            });
            try {
                expect(await detection.detectLiveStreams(channelId)).toMatchObject({ success: true,
                    videoIds: ['synthetic_live', ...tabVideos.map(video => video.id)] });
            } finally { await owner.dispose(); }
        });
    }

    it('validates homepage ownership while retaining only owned positives on tab failure', async () => {
        const { owner, detection } = setup({ videos: [live, { ...live, id: 'synthetic_foreign', author: { id: `UC${'r'.repeat(22)}` } },
            { id: 'synthetic_unattributed', is_live: true }],
            getLiveStreams: async () => { throw new Error('synthetic tab failure'); } });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({ observationKind: 'partial', videoIds: ['synthetic_live'] });
        } finally { await owner.dispose(); }
    });
    for (const contradiction of [{ is_upcoming: true }, { is_post_live_dvr: true }, { end_timestamp: new Date('2020-01-01') }, { is_live: false, is_live_content: true }]) {
        it(`rejects contradictory live discovery signals: ${Object.keys(contradiction).join(',')}`, async () => {
            const video = { ...live, ...contradiction };
            const { owner, detection } = setup({ videos: [video], getLiveStreams: async () => ({ videos: [video] }) });
            try { expect((await detection.detectLiveStreams(channelId)).videoIds).toEqual([]); }
            finally { await owner.dispose(); }
        });
    }

    it('reports streams-tab pagination instead of unrelated malformed homepage cards', async () => {
        const { owner, detection } = setup({ videos: [null, live],
            getLiveStreams: async () => ({ videos: [live], has_continuation: true }) });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                success: true, observationKind: 'partial', qualityReason: 'pagination_incomplete', videoIds: ['synthetic_live']
            });
        } finally { await owner.dispose(); }
    });

    it('never follows an infinite archive even when later pages contain live broadcasts', async () => {
        let continuations = 0;
        const page = { videos: [{ ...live, is_live: false }], has_continuation: true,
            getContinuation: async () => { continuations++; return { ...page, videos: [live] }; } };
        const { owner, detection } = setup({ videos: [], getLiveStreams: async () => page });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                success: false, observationKind: 'partial', qualityReason: 'pagination_incomplete', videoIds: []
            });
            expect(continuations).toBe(0);
        } finally { await owner.dispose(); }
    });

    it('merges homepage and initial recent-page positives without following continuations', async () => {
        let continuations = 0;
        const { owner, detection } = setup({ videos: [{ ...live, id: 'synthetic_home' }], getLiveStreams: async () => ({
            videos: [live], has_continuation: true,
            getContinuation: async () => { continuations++; return { videos: [], has_continuation: false }; }
        }) });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                success: true, observationKind: 'partial', qualityReason: 'pagination_incomplete',
                videoIds: ['synthetic_home', 'synthetic_live']
            });
            expect(continuations).toBe(0);
        } finally { await owner.dispose(); }
    });

    for (const title of [{ text: 'Live now' }, { toString: () => 'Live now' }]) {
        it(`selects only the structured Live now shelf using ${'text' in title ? 'text' : 'toString'}`, async () => {
            const foreign = { ...live, id: 'synthetic_foreign', author: { id: `UC${'r'.repeat(22)}` } };
            const { owner, detection } = setup({
                videos: [null, { ...live, id: 'synthetic_unrelated' }],
                current_tab: { content: { type: 'SectionList', contents: [{ type: 'ItemSection', contents: [
                    { type: 'Shelf', title: { text: 'Shorts' }, content: { type: 'HorizontalList', items: [null] } },
                    { type: 'Shelf', title, content: { type: 'HorizontalList', items: [live, foreign] } }
                ] }] } },
                getLiveStreams: async () => ({ videos: [], has_continuation: true })
            });
            try {
                expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                    success: true, observationKind: 'partial', qualityReason: 'pagination_incomplete', videoIds: ['synthetic_live']
                });
            } finally { await owner.dispose(); }
        });
    }

    it('returns homepage positives within the budget when the initial recent-page request stalls', async () => {
        useFakeTimers();
        let entered!: () => void;
        let release!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        const { owner, detection } = setup({ videos: [live], getLiveStreams: async () => {
            entered(); await gate; return { videos: [] };
        } });
        try {
            const pending = detection.detectLiveStreams(channelId);
            await started;
            advanceTimersByTime(1000);
            expect(await pending).toMatchObject({ success: true, observationKind: 'partial',
                qualityReason: 'acquisition_failed', videoIds: ['synthetic_live'] });
        } finally { release(); await owner.dispose(); useRealTimers(); }
    });

    it('retains owned candidates from both sources despite malformed unrelated homepage entries', async () => {
        const { owner, detection } = setup({ videos: [null, { ...live, id: 'synthetic_home' }],
            getLiveStreams: async () => ({ videos: [live], has_continuation: false }) });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({ observationKind: 'complete', videoIds: ['synthetic_home', 'synthetic_live'] });
        } finally { await owner.dispose(); }
    });

    it('preserves an attributed homepage candidate when the closed recent page is empty', async () => {
        const { owner, detection } = setup({ videos: [null, live], getLiveStreams: async () => ({ videos: [], has_continuation: false }) });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({ success: true, observationKind: 'complete', videoIds: ['synthetic_live'] });
        } finally { await owner.dispose(); }
    });

    const metadataIdentity = (browseIds: unknown[]) => ({ metadata: { metadata: { metadata_rows: [{
        metadata_parts: browseIds.map(browseId => ({ text: { endpoint: { payload: { browseId } } } }))
    }] } } });
    const otherId = `UC${'r'.repeat(22)}`;
    const attributionCases = [
        { label: 'exact author ID', identity: { author: { id: channelId } }, owned: true },
        { label: 'normalized matching handle', identity: { author: { handle: '@SYNTHETIC' } }, owned: true },
        { label: 'metadata channel after playlist', identity: metadataIdentity(['VLsynthetic_playlist', channelId]), owned: true },
        { label: 'explicit other author ID', identity: { author: { id: otherId } }, owned: false },
        { label: 'explicit other handle', identity: { author: { handle: '@synthetic_other' } }, owned: false },
        { label: 'explicit other metadata channel', identity: metadataIdentity([otherId]), owned: false },
        { label: 'stable author ID with renamed handle', identity: { author: { id: channelId, handle: '@synthetic_previous' } }, owned: true },
        { label: 'other author ID with matching handle', identity: { author: { id: otherId, handle: '@synthetic' } }, owned: undefined },
        { label: 'contradictory channel IDs', identity: { author: { id: channelId }, ...metadataIdentity([otherId]) }, owned: undefined },
        { label: 'multiple other metadata IDs', identity: metadataIdentity([otherId, `UC${'s'.repeat(22)}`]), owned: undefined },
        { label: 'only playlist metadata', identity: metadataIdentity(['VLsynthetic_playlist']), owned: undefined },
        { label: 'empty author handle', identity: { author: { handle: '' } }, owned: undefined },
        { label: 'non-string author handle', identity: { author: { handle: 3 } }, owned: undefined },
        { label: 'stray author at-sign', identity: { author: { handle: '@@' } }, owned: undefined },
        { label: 'embedded author at-sign', identity: { author: { handle: '@synthetic@other' } }, owned: undefined },
        { label: 'embedded author whitespace', identity: { author: { handle: '@synthetic other' } }, owned: undefined },
        { label: 'international other handle', identity: { author: { handle: '@合成テスト' } }, owned: false },
        { label: 'non-string author ID', identity: { author: { id: 3 } }, owned: undefined },
        { label: 'malformed author ID', identity: { author: { id: 'synthetic_not_a_channel' } }, owned: undefined },
        { label: 'malformed metadata channel', identity: metadataIdentity([3]), owned: undefined }
    ];
    for (const { label, identity, owned } of attributionCases) {
        it(`classifies homepage and fallback attribution conservatively: ${label}`, async () => {
            const videos = [{ id: 'synthetic_search', is_live: true, ...identity }];
            const { owner, detection } = setup({ videos, getLiveStreams: async () => { throw new Error('synthetic tab failure'); } },
                async () => ({ videos }));
            try {
                const result = await detection.detectLiveStreams('@synthetic');
                expect(result).toMatchObject({
                    observationKind: owned === undefined ? 'unavailable' : 'partial',
                    success: owned === true, videoIds: owned === true ? ['synthetic_search'] : []
                });
                expect(result.qualityReason).toBe(owned === undefined ? 'malformed_collection' : 'acquisition_failed');
            } finally { await owner.dispose(); }
        });
    }

    for (const id of [42, null, undefined, '']) {
        it(`rejects a non-string or absent ID on non-live entries: ${String(id)}`, async () => {
            const { owner, detection } = setup({ videos: [{ id, is_live: false }], getLiveStreams: async () => ({ videos: [{ id, is_live: false }] }) },
                async () => ({ videos: [] }));
            try {
                expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                    success: false, observationKind: 'partial', qualityReason: 'malformed_collection', videoIds: []
                });
            } finally { await owner.dispose(); }
        });
    }

    for (const withOwnedNeighbor of [false, true]) {
        for (const handle of ['@@', '@synthetic other']) {
            it(`degrades malformed handle-only search attribution ${handle}; owned neighbor: ${withOwnedNeighbor}`, async () => {
                const unknown = { id: 'synthetic_unknown_owner', is_live: true, author: { handle } };
                const { owner, detection } = setup({ videos: [null], getLiveStreams: async () => ({ videos: [null] }) },
                    async () => ({ videos: withOwnedNeighbor ? [unknown, live] : [unknown] }));
                try {
                    expect(await detection.detectLiveStreams('@synthetic')).toMatchObject({
                        observationKind: withOwnedNeighbor ? 'partial' : 'unavailable', qualityReason: 'malformed_collection',
                        success: withOwnedNeighbor, videoIds: withOwnedNeighbor ? ['synthetic_live'] : []
                    });
                } finally { await owner.dispose(); }
            });
        }
        it(`degrades unattributed live search results without admitting them; owned neighbor: ${withOwnedNeighbor}`, async () => {
            const unknown = { id: 'synthetic_unknown_owner', is_live: true };
            const { owner, detection } = setup({ videos: [null], getLiveStreams: async () => ({ videos: [null] }) },
                async () => ({ videos: withOwnedNeighbor ? [unknown, live] : [unknown] }));
            try {
                expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                    observationKind: withOwnedNeighbor ? 'partial' : 'unavailable', qualityReason: 'malformed_collection',
                    success: withOwnedNeighbor, videoIds: withOwnedNeighbor ? ['synthetic_live'] : []
                });
            } finally { await owner.dispose(); }
        });

        it(`degrades invalid non-live IDs before treating the collection as observed; live neighbor: ${withOwnedNeighbor}`, async () => {
            const invalid = { id: 'synthetic invalid id', is_live: false };
            const { owner, detection } = setup({ videos: withOwnedNeighbor ? [invalid, live] : [invalid],
                getLiveStreams: async () => ({ videos: withOwnedNeighbor ? [invalid, live] : [invalid] }) }, async () => ({ videos: [] }));
            try {
                expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                    observationKind: 'partial', qualityReason: 'malformed_collection',
                    success: withOwnedNeighbor, videoIds: withOwnedNeighbor ? ['synthetic_live'] : []
                });
            } finally { await owner.dispose(); }
        });
    }

    it('skips search after authoritative empty target membership', async () => {
        let searches = 0;
        const { owner, detection } = setup({ videos: [], getLiveStreams: async () => ({ videos: [] }) },
            async () => { searches++; return { videos: [live] }; });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({ success: true, observationKind: 'complete', videoIds: [] });
            expect(searches).toBe(0);
        } finally { await owner.dispose(); }
    });

    it('preserves channel positives and usable-success metrics when live-tab acquisition fails', async () => {
        const { owner, detection } = setup({ videos: [live], getLiveStreams: async () => { throw new Error('synthetic provider failure'); } });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                success: true, observationKind: 'partial', qualityReason: 'acquisition_failed',
                videoIds: ['synthetic_live'], detectionMethod: 'channel_videos', hasContent: true
            });
            expect(detection.getUsageMetrics()).toMatchObject({ totalRequests: 1, successfulRequests: 1, failedRequests: 0 });
            await detection.cleanup();
            expect(detection.getUsageMetrics()).toMatchObject({ totalRequests: 0, successfulRequests: 0, failedRequests: 0 });
            expect(await owner.withMetadataOperation({}, client => client.getInfo('synthetic_live'))).toMatchObject({ primary_info: { view_count: { is_live: true, original_view_count: 9 } } });
        } finally { await owner.dispose(); }
    });

    for (const scenario of ['failed search', 'missing search', 'missing live tab', 'malformed live tab', 'malformed search'] as const) {
        it(`uses authoritative empty membership when available after ${scenario}`, async () => {
            const channel = {
                videos: [],
                ...(scenario === 'missing live tab' ? {} : { getLiveStreams: async () => ({ videos: scenario === 'malformed live tab' ? {} : [] }) })
            };
            const search = scenario === 'missing search' ? undefined : async () => {
                if (scenario === 'failed search') throw new Error('synthetic search failure');
                return { videos: scenario === 'malformed search' ? {} : [] };
            };
            const { owner, detection } = setup(channel, search);
            try {
                const incomplete = scenario === 'missing live tab' || scenario === 'malformed live tab';
                const result = await detection.detectLiveStreams(channelId);
                expect(result).toMatchObject({ success: !incomplete, observationKind: incomplete ? 'partial' : 'complete', videoIds: [] });
                expect(result.qualityReason).toBe(incomplete ? (scenario === 'missing live tab' ? 'missing_capability' : 'malformed_collection') : undefined);
                expect(detection.getUsageMetrics()).toMatchObject({ successfulRequests: incomplete ? 0 : 1, failedRequests: incomplete ? 1 : 0 });
            } finally { await owner.dispose(); }
        });
    }

    it('marks supported, well-parsed empty acquisition complete', async () => {
        const { owner, detection } = setup({ videos: [], getLiveStreams: async () => ({ videos: [] }) }, async () => ({ videos: [] }));
        try {
            const result = await detection.detectLiveStreams(channelId);
            expect(result).toMatchObject({ success: true, observationKind: 'complete', videoIds: [], hasContent: false });
            expect(result.qualityReason).toBeUndefined();
        } finally { await owner.dispose(); }
    });

    it('keeps first-seen unique IDs and method metadata for complete merged positives', async () => {
        const other = { ...live, id: 'synthetic_other' };
        const { owner, detection } = setup({ videos: [live, live], getLiveStreams: async () => ({ videos: [live, other, other] }) },
            async () => { throw new Error('search must not run after positives'); });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                success: true, observationKind: 'complete', videoIds: ['synthetic_live', 'synthetic_other'], detectionMethod: 'channel_api'
            });
        } finally { await owner.dispose(); }
    });

    it('retains feed and live-tab positives when another live-tab entry cannot be parsed', async () => {
        const { owner, detection } = setup({ videos: [live], getLiveStreams: async () => ({ videos: [
            { id: 'synthetic_bad', badges: {} }, { ...live, id: 'synthetic_other' }, live
        ] }) });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                success: true, observationKind: 'partial', qualityReason: 'malformed_collection',
                videoIds: ['synthetic_live', 'synthetic_other'], detectionMethod: 'channel_api'
            });
        } finally { await owner.dispose(); }
    });

    it('does not treat missing IDs in otherwise empty-looking collections as a complete negative', async () => {
        const { owner, detection } = setup({ videos: [{}], getLiveStreams: async () => ({ videos: [{}] }) }, async () => ({ videos: [] }));
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                success: false, observationKind: 'partial', qualityReason: 'malformed_collection', videoIds: []
            });
        } finally { await owner.dispose(); }
    });

    it('retains deduplicated search positives after malformed earlier collections', async () => {
        const { owner, detection } = setup({ videos: null, getLiveStreams: async () => ({ videos: {} }) }, async () => ({ videos: [live, live] }));
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                success: true, observationKind: 'partial', qualityReason: 'malformed_collection',
                videoIds: ['synthetic_live'], detectionMethod: 'search'
            });
        } finally { await owner.dispose(); }
    });

    it('reports unavailable when no route yields a usable collection', async () => {
        const { owner, detection } = setup({});
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({ success: false, observationKind: 'unavailable', videoIds: [] });
        } finally { await owner.dispose(); }
    });

    it('reports unavailable rather than complete empty when the primary channel request fails', async () => {
        const owner = new InnertubeService({ createWithTimeout: async () => ({
            getInfo: async () => ({}), getChannel: async () => { throw new Error('synthetic primary failure'); }
        }) }, { logger: noOpLogger });
        const detection = new YouTubeStreamDetectionService(owner, { logger: noOpLogger });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                success: false, observationKind: 'unavailable', qualityReason: 'acquisition_failed', videoIds: []
            });
        } finally { await owner.dispose(); }
    });

    it('keeps valid positives from a malformed collection but does not call it complete', async () => {
        const { owner, detection } = setup({ videos: [null, live], getLiveStreams: async () => ({ videos: [null, live] }) });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                success: true, observationKind: 'partial', qualityReason: 'malformed_collection', videoIds: ['synthetic_live']
            });
        } finally { await owner.dispose(); }
    });

    it('does not turn rejected live IDs into complete empty discovery', async () => {
        const invalid = { id: 'synthetic invalid id', is_live: true };
        const { owner, detection } = setup({ videos: [invalid], getLiveStreams: async () => ({ videos: [invalid] }) });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                success: false, observationKind: 'unavailable', qualityReason: 'malformed_collection', videoIds: []
            });
        } finally { await owner.dispose(); }
    });
});
