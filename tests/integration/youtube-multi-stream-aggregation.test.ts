const { describe, test, afterEach, expect } = require('bun:test');

const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { YouTubePlatform } = require('../../src/platforms/youtube');

describe('YouTube Multi-Stream Aggregation', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const createStreamScenario = (streamData) => ({
        name: `${streamData.length} streams with ${streamData.reduce((sum, s) => sum + s.viewers, 0)} total viewers`,
        streams: streamData,
        expectedTotal: streamData.reduce((sum, s) => sum + s.viewers, 0)
    });

    const createYouTubePlatformWithStreams = async (streamConfigs, options = {}) => {
        const activeVideoIds = streamConfigs.map(stream => stream.videoId);
        const failingVideoIds = options.failingVideoIds || [];

        const mockNotificationManager = {
            emit: createMockFn(),
            on: createMockFn(),
            removeListener: createMockFn()
        };

        const mockViewerExtractionService = {
            getAggregatedViewerCount: createMockFn().mockImplementation(async (videoIds) => {
                let totalCount = 0;
                let successfulStreams = 0;
                for (const videoId of videoIds) {
                    if (failingVideoIds.includes(videoId)) {
                        continue;
                    }
                    const stream = streamConfigs.find(s => s.videoId === videoId);
                    if (stream && stream.isLive !== false) {
                        totalCount += stream.viewers;
                        successfulStreams++;
                    }
                }
                return {
                    success: true,
                    totalCount,
                    successfulStreams
                };
            })
        };

        const platform = new YouTubePlatform({
            youtube: {
                viewerCountMethod: 'youtubei',
                enabled: true
            }
        }, {
            logger: noOpLogger,
            notificationManager: mockNotificationManager,
            viewerExtractionService: mockViewerExtractionService,
            streamDetectionService: {
                detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
            }
        });

        platform.getDetectedStreamIds = createMockFn().mockReturnValue(
            options.detectedIds || activeVideoIds
        );
        platform.Innertube = { create: createMockFn() };
        return platform;
    };

    describe('Multi-Stream Aggregation Success Scenarios', () => {
        test('should aggregate viewer counts from 3 active streams correctly', async () => {
            const scenario = createStreamScenario([
                { videoId: 'stream-1', viewers: 140 },
                { videoId: 'stream-2', viewers: 920 },
                { videoId: 'stream-3', viewers: 26 }
            ]);
            const platform = await createYouTubePlatformWithStreams(scenario.streams);

            const totalViewers = await platform.getViewerCountByYoutubei();

            expect(totalViewers).toBe(1086);
            expect(totalViewers).toBe(scenario.expectedTotal);
        });

        test('should handle single stream scenario', async () => {
            const scenario = createStreamScenario([
                { videoId: 'solo-stream', viewers: 1234 }
            ]);
            const platform = await createYouTubePlatformWithStreams(scenario.streams);

            const totalViewers = await platform.getViewerCountByYoutubei();

            expect(totalViewers).toBe(1234);
        });

        test('should aggregate large viewer counts across multiple streams', async () => {
            const scenario = createStreamScenario([
                { videoId: 'big-stream-1', viewers: 45000 },
                { videoId: 'big-stream-2', viewers: 32000 },
                { videoId: 'big-stream-3', viewers: 18000 },
                { videoId: 'big-stream-4', viewers: 5000 }
            ]);
            const platform = await createYouTubePlatformWithStreams(scenario.streams);

            const totalViewers = await platform.getViewerCountByYoutubei();

            expect(totalViewers).toBe(100000);
        });

        test('should handle streams with zero viewers correctly', async () => {
            const scenario = createStreamScenario([
                { videoId: 'active-stream', viewers: 500 },
                { videoId: 'empty-stream', viewers: 0 },
                { videoId: 'another-active', viewers: 250 }
            ]);
            const platform = await createYouTubePlatformWithStreams(scenario.streams);

            const totalViewers = await platform.getViewerCountByYoutubei();

            expect(totalViewers).toBe(750);
        });
    });

    describe('Error Resilience and Partial Failures', () => {
        test('should continue aggregation when one stream fails to load', async () => {
            const streams = [
                { videoId: 'working-stream-1', viewers: 300 },
                { videoId: 'working-stream-2', viewers: 700 }
            ];
            const platform = await createYouTubePlatformWithStreams(streams, {
                detectedIds: ['working-stream-1', 'failing-stream', 'working-stream-2'],
                failingVideoIds: ['failing-stream']
            });

            const totalViewers = await platform.getViewerCountByYoutubei();

            expect(totalViewers).toBe(1000);
        });

        test('should return 0 when no active streams are found', async () => {
            const platform = await createYouTubePlatformWithStreams([]);

            const totalViewers = await platform.getViewerCountByYoutubei();

            expect(totalViewers).toBe(0);
        });

        test('should handle scenario where all streams fail to load', async () => {
            const platform = await createYouTubePlatformWithStreams([], {
                detectedIds: ['failing-1', 'failing-2'],
                failingVideoIds: ['failing-1', 'failing-2']
            });

            const totalViewers = await platform.getViewerCountByYoutubei();

            expect(totalViewers).toBe(0);
        });
    });

    describe('Real-World Stream Scenarios', () => {
        test('should handle typical gaming stream configuration', async () => {
            const scenario = createStreamScenario([
                { videoId: 'main-gaming-stream', viewers: 2500 },
                { videoId: 'restream-backup', viewers: 150 }
            ]);
            const platform = await createYouTubePlatformWithStreams(scenario.streams);

            const totalViewers = await platform.getViewerCountByYoutubei();

            expect(totalViewers).toBe(2650);
        });

        test('should handle corporate multi-language stream setup', async () => {
            const scenario = createStreamScenario([
                { videoId: 'english-stream', viewers: 5000 },
                { videoId: 'spanish-stream', viewers: 2000 },
                { videoId: 'french-stream', viewers: 1500 },
                { videoId: 'german-stream', viewers: 800 }
            ]);
            const platform = await createYouTubePlatformWithStreams(scenario.streams);

            const totalViewers = await platform.getViewerCountByYoutubei();

            expect(totalViewers).toBe(9300);
        });

        test('should handle educational stream with breakout sessions', async () => {
            const scenario = createStreamScenario([
                { videoId: 'main-lecture', viewers: 1200 },
                { videoId: 'breakout-session-1', viewers: 45 },
                { videoId: 'breakout-session-2', viewers: 38 },
                { videoId: 'breakout-session-3', viewers: 52 }
            ]);
            const platform = await createYouTubePlatformWithStreams(scenario.streams);

            const totalViewers = await platform.getViewerCountByYoutubei();

            expect(totalViewers).toBe(1335);
        });
    });

    describe('Aggregation Behavior', () => {
        test('should return correct aggregate across multiple streams', async () => {
            const platform = await createYouTubePlatformWithStreams([
                { videoId: 'stream-1', viewers: 400 },
                { videoId: 'stream-2', viewers: 600 }
            ]);

            const result = await platform.getViewerCountByYoutubei();

            expect(result).toBe(1000);
            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThan(0);
        });

        test('should return numeric type for all scenarios', async () => {
            const platform = await createYouTubePlatformWithStreams([
                { videoId: 'test-stream', viewers: 123 }
            ]);

            const result = await platform.getViewerCountByYoutubei();

            expect(typeof result).toBe('number');
            expect(Number.isInteger(result)).toBe(true);
        });
    });
});
