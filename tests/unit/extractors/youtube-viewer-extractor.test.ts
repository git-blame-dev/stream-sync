import { describe, test, expect } from 'bun:test';
import { YouTubeViewerExtractor as Extractor } from '../../../src/extractors/youtube-viewer-extractor';

function live(fields: Record<string, unknown> = {}, basic: Record<string, unknown> = {}) {
    return { basic_info: { is_live: true, ...basic }, primary_info: { view_count: { is_live: true, ...fields } } };
}

describe('authoritative YouTube concurrent viewer extraction', () => {
    test('uses the exact SDK live count before rounded/localized display text', () => {
        expect(Extractor.extractConcurrentViewers(live({ original_view_count: 1234, view_count: { text: '1.2K watching now' } }))).toMatchObject({ success: true, count: 1234, strategy: 'original_view_count' });
        expect(Extractor.extractConcurrentViewers(live({ unlabeled_view_count_value: { text: '1,234' } }))).toMatchObject({ success: true, count: 1234, strategy: 'unlabeled_view_count_value' });
    });
    test('does not mistake cumulative views or fictional video details for concurrent viewers', () => {
        expect(Extractor.extractConcurrentViewers({ basic_info: { is_live: true, view_count: 9000 }, video_details: { viewer_count: 30 } }).success).toBe(false);
    });
    test('requires the primary count to identify a live measurement', () => {
        for (const is_live of [false, undefined, 'true', 1]) {
            expect(Extractor.extractConcurrentViewers({ primary_info: { view_count: { is_live, original_view_count: 12, view_count: { text: '12 watching now' } } } }).success).toBe(false);
        }
    });
    test('rejects ended, upcoming and contradictory metadata', () => {
        for (const basic of [{ is_live: false }, { is_upcoming: true }, { is_post_live_dvr: true }, { is_live_content: false }, { end_timestamp: new Date('2020-01-01T00:00:00Z') }, { start_timestamp: new Date('2999-01-01T00:00:00Z') }]) {
            expect(Extractor.extractConcurrentViewers(live({ original_view_count: 12 }, basic)).success).toBe(false);
        }
        expect(Extractor.extractConcurrentViewers(live({ original_view_count: 12, unlabeled_view_count_value: { text: '13' } })).success).toBe(false);
        expect(Extractor.extractConcurrentViewers(live({ original_view_count: 12, view_count: { text: '13 watching now' } })).success).toBe(false);
    });
    test('preserves exact zero and safe integer boundary', () => {
        for (const count of [0, Number.MAX_SAFE_INTEGER]) {
            expect(Extractor.extractConcurrentViewers(live({ original_view_count: count }))).toMatchObject({ success: true, count });
        }
    });
    test('rejects unsafe or coerced exact values without falling through to display text', () => {
        let coerced = false;
        const object = { toString() { coerced = true; return '12'; } };
        for (const count of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '12', true, null, object]) {
            expect(Extractor.extractConcurrentViewers(live({ original_view_count: count, view_count: { text: '12 watching now' } })).success).toBe(false);
        }
        expect(coerced).toBe(false);
        for (const text of ['', '12\n', ' 12', '12junk', '1.2K', '1 234', '12.0', '-1', '9007199254740992', object]) {
            expect(Extractor.extractConcurrentViewers(live({ unlabeled_view_count_value: { text } })).success).toBe(false);
        }
    });
    test('only accepts exact English watching text as source-aware fallback', () => {
        for (const text of ['1,234 watching now', '1,234 watching', '1,234 currently watching', '1,234 viewers watching', '1,234 people watching']) {
            expect(Extractor.extractConcurrentViewers(live({ view_count: { text } }))).toMatchObject({ success: true, count: 1234, strategy: 'view_text' });
        }
        for (const text of ['1,234 views', '1.2K watching now', '1.234 watching now', '1,23 watching now', '12 watching now yesterday', '9007199254740992 watching now']) {
            expect(Extractor.extractConcurrentViewers(live({ view_count: { text } })).success).toBe(false);
        }
    });
    test('retains safe source metadata without raw payloads', () => {
        const result = Extractor.extractConcurrentViewers(live({ original_view_count: 1234, view_count: { text: 'synthetic-private' } }));
        expect(result.metadata).toEqual({ source: 'original_view_count' });
        expect(JSON.stringify(result.metadata)).not.toContain('synthetic-private');
    });
    test('handles absent and malformed input', () => {
        for (const info of [null, undefined, [], {}, { primary_info: { view_count: null } }]) {
            expect(Reflect.apply(Extractor.extractConcurrentViewers, Extractor, [info])).toMatchObject({ success: false, count: 0 });
        }
    });
    test('validates output without coercion', () => {
        for (const value of [-1, 0.5, Infinity, NaN, '1', {}, null, Number.MAX_SAFE_INTEGER + 1]) expect(Extractor.isValidViewerCount(value)).toBe(false);
        expect(Extractor.isValidViewerCount(0)).toBe(true);
    });
});
