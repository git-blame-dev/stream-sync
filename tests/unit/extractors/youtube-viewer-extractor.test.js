const { describe, test, expect } = require('bun:test');
const { YouTubeViewerExtractor } = require('../../../src/extractors/youtube-viewer-extractor');

describe('YouTubeViewerExtractor', () => {
    describe('extractConcurrentViewers', () => {
        test('uses view_text by default and records attempts', () => {
            const videoInfo = {
                primary_info: {
                    view_count: { view_count: { text: '1,234 watching now' } }
                },
                video_details: {
                    viewer_count: '9999'
                }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

            expect(result).toMatchObject({
                success: true,
                count: 1234,
                strategy: 'view_text',
                metadata: {
                    strategiesAttempted: ['view_text'],
                    rawData: null
                }
            });
        });

        test('falls back to video_details when view_text is unavailable', () => {
            const videoInfo = {
                video_details: { viewer_count: '456' }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

            expect(result.success).toBe(true);
            expect(result.count).toBe(456);
            expect(result.strategy).toBe('video_details');
            expect(result.metadata.strategiesAttempted).toEqual(['view_text', 'video_details']);
            expect(result.metadata.rawData).toBeNull();
        });

        test('extracts zero viewer counts from live basic_info', () => {
            const videoInfo = {
                basic_info: { is_live: true, view_count: 0 }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                strategies: ['basic_info']
            });

            expect(result).toMatchObject({
                success: true,
                count: 0,
                strategy: 'basic_info'
            });
            expect(result.metadata.strategiesAttempted).toEqual(['basic_info']);
        });
    });

    describe('isValidViewerCount', () => {
        test('validates viewer count bounds', () => {
            const cases = [
                { count: 0, expected: true },
                { count: 100, expected: true },
                { count: 10000000, expected: true },
                { count: 10000001, expected: false },
                { count: -1, expected: false },
                { count: NaN, expected: false },
                { count: '1', expected: false }
            ];

            cases.forEach(({ count, expected }) => {
                expect(YouTubeViewerExtractor.isValidViewerCount(count)).toBe(expected);
            });
        });
    });
});
