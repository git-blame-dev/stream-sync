import { describe, expect, test } from 'bun:test';
import { hasMatchingYouTubeVideoInfo } from '../../../src/utils/youtube-video-info';

describe('combined YouTube response identity', () => {
    const videoId = 'synthetic_A';
    const basic_info = { id: videoId };
    const next = { current_video_endpoint: { payload: { videoId } } };

    test('requires matching player and next responses', () => {
        expect(hasMatchingYouTubeVideoInfo(videoId, { basic_info, page: [{}, next] })).toBe(true);
    });

    for (const info of [
        undefined, null, [], {}, { basic_info },
        { basic_info, page: {} }, { basic_info, page: [] },
        { basic_info, page: [{}, null] },
        { basic_info, page: [{}, { current_video_endpoint: null }] },
        { basic_info, page: [{}, { current_video_endpoint: { payload: {} } }] },
        { basic_info, page: [{}, { current_video_endpoint: { payload: { videoId: 'synthetic_B' } } }] },
        { basic_info: { id: 'synthetic_B' }, page: [{}, next] },
    ]) {
        test(`rejects incomplete or conflicting identity: ${JSON.stringify(info)}`, () => {
            expect(hasMatchingYouTubeVideoInfo(videoId, info)).toBe(false);
        });
    }

    test('never accepts an empty requested identity', () => {
        expect(hasMatchingYouTubeVideoInfo('', { basic_info: { id: '' },
            page: [{}, { current_video_endpoint: { payload: { videoId: '' } } }] })).toBe(false);
    });
});
