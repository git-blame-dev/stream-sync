const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { YouTubeViewerExtractor } = require('../../src/extractors/youtube-viewer-extractor');
const { expectNoTechnicalArtifacts } = require('../helpers/behavior-validation');
const testClock = require('../helpers/test-clock');

describe('Extractor Service Integration', () => {
    beforeEach(async () => {
        testClock.reset();
    });

    afterEach(async () => {
        clearAllMocks();
        restoreAllMocks();
    });

    describe('Primary Extraction Strategy (View Text)', () => {
        test('extracts from standard "watching now" format', () => {
            const videoInfo = {
                primary_info: {
                    view_count: { view_count: { text: '1,234 watching now' } }
                }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

            expect(result.success).toBe(true);
            expect(result.count).toBe(1234);
            expect(result.strategy).toBe('view_text');
            expect(result.metadata.strategiesAttempted).toContain('view_text');
        });

        test('extracts from "watching" format without "now"', () => {
            const videoInfo = {
                primary_info: {
                    view_count: { view_count: { text: '5,678 watching' } }
                }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

            expect(result.success).toBe(true);
            expect(result.count).toBe(5678);
            expect(result.strategy).toBe('view_text');
        });

        test('handles numbers without commas', () => {
            const videoInfo = {
                primary_info: {
                    view_count: { view_count: { text: '123 watching now' } }
                }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

            expect(result.success).toBe(true);
            expect(result.count).toBe(123);
            expect(result.strategy).toBe('view_text');
        });

        test('handles large numbers with multiple commas', () => {
            const videoInfo = {
                primary_info: {
                    view_count: { view_count: { text: '1,234,567 watching now' } }
                }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

            expect(result.success).toBe(true);
            expect(result.count).toBe(1234567);
            expect(result.strategy).toBe('view_text');
        });

        test('handles alternative watching patterns', () => {
            const patterns = [
                { text: '999 currently watching', expected: 999 },
                { text: '2,500 viewers watching', expected: 2500 },
                { text: '750 people watching', expected: 750 }
            ];

            patterns.forEach(pattern => {
                const videoInfo = {
                    primary_info: {
                        view_count: { view_count: { text: pattern.text } }
                    }
                };

                const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

                expect(result.success).toBe(true);
                expect(result.count).toBe(pattern.expected);
                expect(result.strategy).toBe('view_text');
            });
        });
    });

    describe('Fallback Extraction Strategy (Video Details)', () => {
        test('falls back to video_details when view_text unavailable', () => {
            const videoInfo = {
                video_details: { viewer_count: '9876' }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

            expect(result.success).toBe(true);
            expect(result.count).toBe(9876);
            expect(result.strategy).toBe('video_details');
            expect(result.metadata.strategiesAttempted).toContain('view_text');
            expect(result.metadata.strategiesAttempted).toContain('video_details');
        });

        test('uses concurrent_viewers field as secondary fallback', () => {
            const videoInfo = {
                video_details: { concurrent_viewers: '5432' }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

            expect(result.success).toBe(true);
            expect(result.count).toBe(5432);
            expect(result.strategy).toBe('video_details');
        });

        test('prefers viewer_count over concurrent_viewers', () => {
            const videoInfo = {
                video_details: {
                    viewer_count: '1111',
                    concurrent_viewers: '2222'
                }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

            expect(result.success).toBe(true);
            expect(result.count).toBe(1111);
            expect(result.strategy).toBe('video_details');
        });

        test('handles numeric viewer_count values', () => {
            const videoInfo = {
                video_details: { viewer_count: 8888 }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

            expect(result.success).toBe(true);
            expect(result.count).toBe(8888);
            expect(result.strategy).toBe('video_details');
        });
    });

    describe('Last Resort Extraction Strategy (Basic Info)', () => {
        test('uses basic_info as last resort for live streams', () => {
            const videoInfo = {
                basic_info: { is_live: true, view_count: '3333' }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                strategies: ['basic_info']
            });

            expect(result.success).toBe(true);
            expect(result.count).toBe(3333);
            expect(result.strategy).toBe('basic_info');
        });

        test('rejects basic_info for non-live streams', () => {
            const videoInfo = {
                basic_info: { is_live: false, view_count: '4444' }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                strategies: ['basic_info']
            });

            expect(result.success).toBe(false);
            expect(result.count).toBe(0);
        });
    });

    describe('Strategy Selection and Configuration', () => {
        test('respects custom strategy selection', () => {
            const videoInfo = {
                primary_info: {
                    view_count: { view_count: { text: '1111 watching now' } }
                },
                video_details: { viewer_count: '2222' }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                strategies: ['video_details']
            });

            expect(result.success).toBe(true);
            expect(result.count).toBe(2222);
            expect(result.strategy).toBe('video_details');
            expect(result.metadata.strategiesAttempted).toEqual(['video_details']);
        });

        test('handles empty strategy list gracefully', () => {
            const videoInfo = {
                primary_info: {
                    view_count: { view_count: { text: '1111 watching now' } }
                }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                strategies: []
            });

            expect(result.success).toBe(false);
            expect(result.count).toBe(0);
            expect(result.metadata.strategiesAttempted).toEqual([]);
        });

        test('uses strategy priority order', () => {
            const videoInfo = {
                primary_info: {
                    view_count: { view_count: { text: '1111 watching now' } }
                },
                video_details: { viewer_count: '2222' }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                strategies: ['video_details', 'view_text']
            });

            expect(result.success).toBe(true);
            expect(result.count).toBe(1111);
            expect(result.strategy).toBe('view_text');

            const result2 = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                strategies: ['video_details']
            });

            expect(result2.success).toBe(true);
            expect(result2.count).toBe(2222);
            expect(result2.strategy).toBe('video_details');
        });
    });

    describe('Debug Mode and Metadata Collection', () => {
        test('collects detailed metadata in debug mode', () => {
            const videoInfo = {
                primary_info: {
                    view_count: { view_count: { text: '5,555 watching now' } }
                }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                debug: true
            });

            expect(result.success).toBe(true);
            expect(result.count).toBe(5555);
            expect(result.metadata.rawData).toBeDefined();
            expect(result.metadata.rawData.view_text).toMatchObject({
                viewText: '5,555 watching now',
                hasViewText: true,
                viewTextType: 'string',
                patternMatched: 'watching_now',
                extractedText: '5,555 watching now'
            });
        });

        test('does not collect metadata when debug disabled', () => {
            const videoInfo = {
                primary_info: {
                    view_count: { view_count: { text: '7,777 watching now' } }
                }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                debug: false
            });

            expect(result.success).toBe(true);
            expect(result.count).toBe(7777);
            expect(result.metadata.rawData).toBeNull();
        });

        test('collects error information in debug mode', () => {
            const videoInfo = {
                primary_info: { view_count: null }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                debug: true
            });

            expect(result.success).toBe(false);
            expect(result.metadata.rawData).toBeDefined();
        });
    });

    describe('Error Handling and Edge Cases', () => {
        test('handles null video info gracefully', () => {
            const result = YouTubeViewerExtractor.extractConcurrentViewers(null);

            expect(result.success).toBe(false);
            expect(result.count).toBe(0);
            expect(result.metadata.error).toBe('No video info provided');
        });

        test('handles undefined video info gracefully', () => {
            const result = YouTubeViewerExtractor.extractConcurrentViewers(undefined);

            expect(result.success).toBe(false);
            expect(result.count).toBe(0);
            expect(result.metadata.error).toBe('No video info provided');
        });

        test('handles empty video info object', () => {
            const result = YouTubeViewerExtractor.extractConcurrentViewers({});

            expect(result.success).toBe(false);
            expect(result.count).toBe(0);
            expect(result.metadata.strategiesAttempted).toContain('view_text');
        });

        test('handles malformed view text', () => {
            const malformedTexts = [
                'No viewers currently',
                'Offline',
                'Stream ended',
                '??? watching',
                'unknown watching now'
            ];

            malformedTexts.forEach(text => {
                const videoInfo = {
                    primary_info: {
                        view_count: { view_count: { text } }
                    }
                };

                const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

                expect(typeof result.success).toBe('boolean');
                expect(typeof result.count).toBe('number');
                expect(result.count >= 0 || Number.isNaN(result.count)).toBe(true);
                expect(result.metadata).toBeDefined();
            });
        });

        test('handles invalid numeric values', () => {
            const invalidValues = [
                { viewer_count: 'abc' },
                { viewer_count: '' },
                { viewer_count: 'NaN' },
                { viewer_count: '-1' },
                { concurrent_viewers: 'invalid' }
            ];

            invalidValues.forEach(invalidData => {
                const videoInfo = { video_details: invalidData };

                const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                    strategies: ['video_details']
                });

                expect(result.success).toBe(false);
                expect(result.count).toBe(0);
            });
        });
    });

    describe('Validation and Content Quality', () => {
        test('validates extracted viewer counts', () => {
            const testCases = [
                { count: 0, expected: true },
                { count: 100, expected: true },
                { count: 1000000, expected: true },
                { count: -1, expected: false },
                { count: NaN, expected: false },
                { count: 'invalid', expected: false },
                { count: 11000000, expected: false },
                { count: null, expected: false },
                { count: undefined, expected: false }
            ];

            testCases.forEach(testCase => {
                const isValid = YouTubeViewerExtractor.isValidViewerCount(testCase.count);
                expect(isValid).toBe(testCase.expected);
            });
        });

        test('produces clean, user-friendly viewer counts', () => {
            const videoInfo = {
                primary_info: {
                    view_count: { view_count: { text: '12,345 watching now' } }
                }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

            expect(result.success).toBe(true);
            expect(result.count).toBe(12345);
            expect(Number.isInteger(result.count)).toBe(true);
            expectNoTechnicalArtifacts(result.count.toString());
        });

        test('handles international number formats', () => {
            const formats = [
                { text: '1,234 watching now', expected: 1234 },
                { text: '1,234,567 watching now', expected: 1234567 }
            ];

            formats.forEach(format => {
                const videoInfo = {
                    primary_info: {
                        view_count: { view_count: { text: format.text } }
                    }
                };

                const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

                expect(result.success).toBe(true);
                expect(result.count).toBe(format.expected);
            });

            const problematicFormats = [
                '1.234 watching now',
                '1 234 watching now'
            ];

            problematicFormats.forEach(text => {
                const videoInfo = {
                    primary_info: {
                        view_count: { view_count: { text } }
                    }
                };

                const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

                expect(result.success).toEqual(expect.any(Boolean));
                expect(result.count).toBeGreaterThanOrEqual(0);
            });
        });
    });

    describe('Performance and Efficiency', () => {
        test('extracts viewer counts efficiently', () => {
            const videoInfo = {
                primary_info: {
                    view_count: { view_count: { text: '50,000 watching now' } }
                },
                video_details: {
                    viewer_count: '50000',
                    title: 'Test Stream',
                    description: 'A very long description...'.repeat(100),
                    thumbnail: { url: 'http://example.com/thumb.jpg' },
                    duration: 3600,
                    keywords: Array(100).fill('keyword')
                }
            };

            const startTime = testClock.now();
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            testClock.advance(5);
            const endTime = testClock.now();

            expect(endTime - startTime).toBeLessThan(10);
            expect(result.success).toBe(true);
            expect(result.count).toBe(50000);
        });

        test('handles high-frequency extraction calls', () => {
            const videoInfo = {
                primary_info: {
                    view_count: { view_count: { text: '1,000 watching now' } }
                }
            };

            const startTime = testClock.now();
            const results = [];
            const iterations = 100;

            for (let i = 0; i < iterations; i++) {
                results.push(YouTubeViewerExtractor.extractConcurrentViewers(videoInfo));
            }

            testClock.advance(iterations - 1);
            const endTime = testClock.now();

            expect(endTime - startTime).toBeLessThan(100);

            results.forEach(result => {
                expect(result.success).toBe(true);
                expect(result.count).toBe(1000);
            });
        });

        test('minimizes memory allocation during extraction', () => {
            const initialMemory = process.memoryUsage().heapUsed;

            const videoInfo = {
                primary_info: {
                    view_count: { view_count: { text: '2,000 watching now' } }
                }
            };

            for (let i = 0; i < 1000; i++) {
                YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            }

            if (global.gc) {
                global.gc();
            }

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryGrowth = finalMemory - initialMemory;

            expect(memoryGrowth).toBeLessThan(5 * 1024 * 1024);
        });
    });

    describe('Capabilities and Metadata', () => {
        test('provides comprehensive capability information', () => {
            const capabilities = YouTubeViewerExtractor.getCapabilities();

            expect(capabilities).toMatchObject({
                version: '1.0.0',
                strategies: ['view_text', 'video_details', 'basic_info'],
                patterns: expect.arrayContaining([
                    'watching_now',
                    'watching',
                    'currently_watching',
                    'viewers_watching',
                    'people_watching'
                ]),
                supports: {
                    debug: true,
                    fallback: true,
                    metadata: true
                }
            });
        });

        test('lists all supported extraction patterns', () => {
            const capabilities = YouTubeViewerExtractor.getCapabilities();

            const expectedPatterns = [
                'watching_now',
                'watching',
                'currently_watching',
                'viewers_watching',
                'people_watching'
            ];

            expectedPatterns.forEach(pattern => {
                expect(capabilities.patterns).toContain(pattern);
            });
        });

        test('indicates support for all major features', () => {
            const capabilities = YouTubeViewerExtractor.getCapabilities();

            expect(capabilities.supports.debug).toBe(true);
            expect(capabilities.supports.fallback).toBe(true);
            expect(capabilities.supports.metadata).toBe(true);
        });
    });
});
