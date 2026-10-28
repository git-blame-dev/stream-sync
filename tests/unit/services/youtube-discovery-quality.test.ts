import { describe, expect, it } from 'bun:test';
import { InnertubeService } from '../../../src/services/innertube-service';
import { YouTubeStreamDetectionService } from '../../../src/services/youtube-stream-detection-service';
import { noOpLogger } from '../../helpers/mock-factories';

const channelId = `UC${'q'.repeat(22)}`;
const live = { id: 'synthetic_live', is_live: true, author: { id: channelId } };
function setup(channel: unknown, search?: () => Promise<unknown>) {
    const owner = new InnertubeService({
        createWithTimeout: async () => ({
            getInfo: async (_id: string) => ({ basic_info: { is_live: true, view_count: 9 } }),
            getChannel: async () => channel,
            resolveURL: async () => ({ payload: { browseId: channelId } }),
            ...(search ? { search } : {})
        })
    }, { logger: noOpLogger });
    const detection = new YouTubeStreamDetectionService(owner, { logger: noOpLogger });
    return { owner, detection };
}

describe('discovery observation quality through real metadata ownership and detection', () => {
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
        it(`classifies search attribution conservatively: ${label}`, async () => {
            const { owner, detection } = setup({ videos: [], getLiveStreams: async () => ({ videos: [] }) },
                async () => ({ videos: [{ id: 'synthetic_search', is_live: true, ...identity }] }));
            try {
                const result = await detection.detectLiveStreams('@synthetic');
                expect(result).toMatchObject({
                    observationKind: owned === undefined ? 'partial' : 'complete',
                    success: owned !== undefined, videoIds: owned === true ? ['synthetic_search'] : []
                });
                expect(result.qualityReason).toBe(owned === undefined ? 'malformed_collection' : undefined);
            } finally { await owner.dispose(); }
        });
    }

    for (const id of [42, null, undefined, '']) {
        it(`rejects a non-string or absent ID on non-live entries: ${String(id)}`, async () => {
            const { owner, detection } = setup({ videos: [{ id, is_live: false }], getLiveStreams: async () => ({ videos: [] }) },
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
                const { owner, detection } = setup({ videos: [], getLiveStreams: async () => ({ videos: [] }) },
                    async () => ({ videos: withOwnedNeighbor ? [unknown, live] : [unknown] }));
                try {
                    expect(await detection.detectLiveStreams('@synthetic')).toMatchObject({
                        observationKind: 'partial', qualityReason: 'malformed_collection',
                        success: withOwnedNeighbor, videoIds: withOwnedNeighbor ? ['synthetic_live'] : []
                    });
                } finally { await owner.dispose(); }
            });
        }
        it(`degrades unattributed live search results without admitting them; owned neighbor: ${withOwnedNeighbor}`, async () => {
            const unknown = { id: 'synthetic_unknown_owner', is_live: true };
            const { owner, detection } = setup({ videos: [], getLiveStreams: async () => ({ videos: [] }) },
                async () => ({ videos: withOwnedNeighbor ? [unknown, live] : [unknown] }));
            try {
                expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                    observationKind: 'partial', qualityReason: 'malformed_collection',
                    success: withOwnedNeighbor, videoIds: withOwnedNeighbor ? ['synthetic_live'] : []
                });
            } finally { await owner.dispose(); }
        });

        it(`degrades invalid non-live IDs before treating the collection as observed; live neighbor: ${withOwnedNeighbor}`, async () => {
            const invalid = { id: 'synthetic invalid id', is_live: false };
            const { owner, detection } = setup({ videos: withOwnedNeighbor ? [invalid, live] : [invalid],
                getLiveStreams: async () => ({ videos: [] }) }, async () => ({ videos: [] }));
            try {
                expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                    observationKind: 'partial', qualityReason: 'malformed_collection',
                    success: withOwnedNeighbor, videoIds: withOwnedNeighbor ? ['synthetic_live'] : []
                });
            } finally { await owner.dispose(); }
        });
    }

    it('preserves complete negative search observations with explicit other-channel identity', async () => {
        const { owner, detection } = setup({ videos: [], getLiveStreams: async () => ({ videos: [] }) },
            async () => ({ videos: [{ ...live, author: { id: `UC${'r'.repeat(22)}` } }] }));
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({ success: true, observationKind: 'complete', videoIds: [] });
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
            expect(await owner.withMetadataOperation({}, client => client.getInfo('synthetic_live'))).toMatchObject({ basic_info: { view_count: 9 } });
        } finally { await owner.dispose(); }
    });

    for (const scenario of ['failed search', 'missing search', 'missing live tab', 'malformed channel', 'malformed live tab', 'malformed search'] as const) {
        it(`does not declare complete empty discovery after ${scenario}`, async () => {
            const channel = {
                videos: scenario === 'malformed channel' ? {} : [],
                ...(scenario === 'missing live tab' ? {} : { getLiveStreams: async () => ({ videos: scenario === 'malformed live tab' ? {} : [] }) })
            };
            const search = scenario === 'missing search' ? undefined : async () => {
                if (scenario === 'failed search') throw new Error('synthetic search failure');
                return { videos: scenario === 'malformed search' ? {} : [] };
            };
            const { owner, detection } = setup(channel, search);
            try {
                expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                    success: false, observationKind: 'partial', videoIds: [],
                    qualityReason: scenario.startsWith('malformed') ? 'malformed_collection'
                        : scenario.startsWith('missing') ? 'missing_capability' : 'acquisition_failed'
                });
                expect(detection.getUsageMetrics()).toMatchObject({ successfulRequests: 0, failedRequests: 1 });
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
        const { owner, detection } = setup({ videos: [{}], getLiveStreams: async () => ({ videos: [] }) }, async () => ({ videos: [] }));
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
        const { owner, detection } = setup({ videos: [null, live], getLiveStreams: async () => ({ videos: [live] }) });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                success: true, observationKind: 'partial', qualityReason: 'malformed_collection', videoIds: ['synthetic_live']
            });
        } finally { await owner.dispose(); }
    });

    it('does not turn rejected live IDs into complete empty discovery', async () => {
        const invalid = { id: 'synthetic invalid id', is_live: true };
        const { owner, detection } = setup({ videos: [invalid], getLiveStreams: async () => ({ videos: [] }) });
        try {
            expect(await detection.detectLiveStreams(channelId)).toMatchObject({
                success: false, observationKind: 'partial', qualityReason: 'malformed_collection', videoIds: []
            });
        } finally { await owner.dispose(); }
    });
});
