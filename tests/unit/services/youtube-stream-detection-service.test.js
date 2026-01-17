const { describe, it, beforeEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { YouTubeStreamDetectionService } = require('../../../src/services/youtube-stream-detection-service');
const testClock = require('../../helpers/test-clock');

function createMockInnertubeClient(streamData = []) {
    const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
            videos: streamData.map(stream => ({
                id: stream.videoId,
                video_id: stream.videoId,
                title: { text: stream.title },
                is_live: stream.isLive,
                author: { name: stream.channelName }
            }))
        })
    };

    return {
        search: createMockFn().mockImplementation((query, options) => {
            if (options && options.type === 'channel') {
                return Promise.resolve({
                    channels: [{
                        author: {
                            id: 'UCmockChannelId123',
                            name: 'testchannel',
                            handle: '@testchannel'
                        }
                    }]
                });
            }
            return Promise.resolve({
                videos: streamData.map(stream => ({
                    id: stream.videoId,
                    title: stream.title,
                    is_live: stream.isLive,
                    author: { name: stream.channelName }
                })),
                results: streamData.map(stream => ({
                    id: stream.videoId,
                    title: stream.title,
                    is_live: stream.isLive,
                    author: { name: stream.channelName }
                }))
            });
        }),
        resolveURL: createMockFn().mockResolvedValue({
            payload: { browseId: 'UCmockChannelId123' }
        }),
        getChannel: createMockFn().mockResolvedValue(mockChannel)
    };
}

function createStreamDetectionService(mockClient = null) {
    const client = mockClient || createMockInnertubeClient();
    return new YouTubeStreamDetectionService(client, { logger: noOpLogger });
}

function createLiveStreamData() {
    return [
        { videoId: 'live123', title: 'Test Live Stream', isLive: true, channelName: 'TestChannel' },
        { videoId: 'live456', title: 'Another Live Stream', isLive: true, channelName: 'TestChannel' }
    ];
}

function createNonLiveStreamData() {
    return [{ videoId: 'video123', title: 'Recorded Video', isLive: false, channelName: 'TestChannel' }];
}

function expectNoTechnicalArtifacts(message) {
    expect(message).not.toMatch(/innertube|api|client|error|exception/i);
    expect(message).not.toContain('undefined');
    expect(message).not.toContain('null');
    expect(message).not.toContain('[object Object]');
}

function expectValidVideoId(videoId) {
    expect(videoId).toBeDefined();
    expect(typeof videoId).toBe('string');
    expect(videoId.length).toBeGreaterThan(0);
    expect(videoId).toMatch(/^[a-zA-Z0-9_-]+$/);
}

describe('YouTubeStreamDetectionService', () => {
    let service;
    let mockClient;

    beforeEach(() => {
        clearAllMocks();
    });

    describe('Core Stream Detection Behavior', () => {
        it('should detect multiple live streams for a channel', async () => {
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            const result = await service.detectLiveStreams('@testchannel');

            expect(result.videoIds).toHaveLength(2);
            expect(result.videoIds).toContain('live123');
            expect(result.videoIds).toContain('live456');
            expect(result.success).toBe(true);
            result.videoIds.forEach(expectValidVideoId);
        });

        it('should return empty array when no streams are live', async () => {
            const nonLiveStreams = createNonLiveStreamData();
            mockClient = createMockInnertubeClient(nonLiveStreams);
            service = createStreamDetectionService(mockClient);

            const result = await service.detectLiveStreams('@testchannel');

            expect(result.videoIds).toEqual([]);
            expect(result.success).toBe(true);
            expect(result.message).toContain('No live streams');
            expectNoTechnicalArtifacts(result.message);
        });

        it('should handle channel with no content gracefully', async () => {
            mockClient = createMockInnertubeClient([]);
            service = createStreamDetectionService(mockClient);

            const result = await service.detectLiveStreams('@emptychannel');

            expect(result.videoIds).toEqual([]);
            expect(result.success).toBe(true);
            expect(result.message).toContain('No content found');
            expectNoTechnicalArtifacts(result.message);
        });

        it('should include detection method metadata for transparency', async () => {
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            const result = await service.detectLiveStreams('@testchannel');

            expect(result.success).toBe(true);
            expect(result.detectionMethod).toBe('channel_api');
            expect(result.hasContent).toBe(true);
        });
    });

    describe('Performance Requirements', () => {
        it('should complete detection within 2 seconds', async () => {
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            const startTime = testClock.now();
            const result = await service.detectLiveStreams('@testchannel');
            const simulatedDurationMs = 25;
            testClock.advance(simulatedDurationMs);
            const endTime = testClock.now();

            const duration = endTime - startTime;
            expect(duration).toBeLessThan(2000);
            expect(result.success).toBe(true);
            expect(result.responseTime).toBeDefined();
            expect(result.responseTime).toBeLessThan(2000);
        });

        it('should timeout gracefully for slow responses', async () => {
            mockClient = {
                resolveURL: createMockFn().mockImplementation(() => waitForDelay(5000)),
                getChannel: createMockFn().mockResolvedValue({})
            };
            service = createStreamDetectionService(mockClient);

            const result = await service.detectLiveStreams('@slowchannel');

            expect(result.success).toBe(false);
            expect(result.videoIds).toEqual([]);
            expect(result.message).toContain('timeout');
            expectNoTechnicalArtifacts(result.message);
        });
    });

    describe('Error Recovery Behavior', () => {
        it('should handle network errors gracefully', async () => {
            mockClient = {
                resolveURL: createMockFn().mockRejectedValue(new Error('Network error')),
                getChannel: createMockFn().mockRejectedValue(new Error('Network error'))
            };
            service = createStreamDetectionService(mockClient);

            const result = await service.detectLiveStreams('@testchannel');

            expect(result.success).toBe(false);
            expect(result.videoIds).toEqual([]);
            expect(result.message).toContain('connection issue');
            expectNoTechnicalArtifacts(result.message);
            expect(result.retryable).toBe(true);
        });

        it('should handle API rate limiting gracefully', async () => {
            const rateLimitError = new Error('Quota exceeded');
            rateLimitError.status = 429;
            mockClient = {
                resolveURL: createMockFn().mockRejectedValue(rateLimitError),
                getChannel: createMockFn().mockRejectedValue(rateLimitError)
            };
            service = createStreamDetectionService(mockClient);

            const result = await service.detectLiveStreams('@testchannel');

            expect(result.success).toBe(false);
            expect(result.videoIds).toEqual([]);
            expect(result.message).toContain('rate limit');
            expectNoTechnicalArtifacts(result.message);
            expect(result.retryAfter).toBeDefined();
        });

        it('should handle invalid channel gracefully', async () => {
            const notFoundError = new Error('Channel not found');
            notFoundError.status = 404;
            mockClient = {
                resolveURL: createMockFn().mockResolvedValue({ payload: {} }),
                getChannel: createMockFn().mockRejectedValue(notFoundError)
            };
            service = createStreamDetectionService(mockClient);

            const result = await service.detectLiveStreams('@nonexistentchannel');

            expect(result.success).toBe(false);
            expect(result.videoIds).toEqual([]);
            expect(result.message).toContain('channel not found');
            expectNoTechnicalArtifacts(result.message);
            expect(result.retryable).toBe(false);
        });
    });

    describe('Channel Handle Format Support', () => {
        it('should work with @ handle format', async () => {
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            const result = await service.detectLiveStreams('@testchannel');

            expect(result.success).toBe(true);
            expect(result.videoIds).toHaveLength(2);
        });

        it('should work with plain channel name', async () => {
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            const result = await service.detectLiveStreams('testchannel');

            expect(result.success).toBe(true);
            expect(result.videoIds).toHaveLength(2);
        });

        it('should work with channel ID format', async () => {
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            const result = await service.detectLiveStreams('UCTestChannelId123');

            expect(result.success).toBe(true);
            expect(result.videoIds).toHaveLength(2);
        });
    });

    describe('Data Quality and Validation', () => {
        it('should filter out invalid video IDs', async () => {
            const mixedData = [
                { videoId: 'valid123', title: 'Valid Stream', isLive: true, channelName: 'Test' },
                { videoId: '', title: 'Invalid Stream', isLive: true, channelName: 'Test' },
                { videoId: null, title: 'Null Stream', isLive: true, channelName: 'Test' },
                { videoId: 'valid456', title: 'Another Valid', isLive: true, channelName: 'Test' }
            ];
            mockClient = createMockInnertubeClient(mixedData);
            service = createStreamDetectionService(mockClient);

            const result = await service.detectLiveStreams('@testchannel');

            expect(result.videoIds).toEqual(['valid123', 'valid456']);
            expect(result.success).toBe(true);
            result.videoIds.forEach(expectValidVideoId);
        });

        it('should handle malformed API responses gracefully', async () => {
            const malformedChannel = {
                getLiveStreams: createMockFn().mockRejectedValue(new Error('Type mismatch in YouTube.js parser'))
            };
            mockClient = {
                resolveURL: createMockFn().mockResolvedValue({
                    payload: { browseId: 'UC' + 'p'.repeat(22) }
                }),
                search: createMockFn().mockResolvedValue({
                    channels: [{
                        author: {
                            id: 'UC' + 'p'.repeat(22),
                            name: 'testchannel',
                            handle: '@testchannel'
                        }
                    }]
                }),
                getChannel: createMockFn().mockResolvedValue(malformedChannel)
            };
            service = createStreamDetectionService(mockClient);

            const result = await service.detectLiveStreams('@testchannel');

            expect(result.success).toBe(true);
            expect(result.videoIds).toEqual([]);
            expect(result.message).toContain('No content found');
            expectNoTechnicalArtifacts(result.message);
        });
    });

    describe('Metrics and Debug Support', () => {
        it('should provide debug information for troubleshooting', async () => {
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            const result = await service.detectLiveStreams('@testchannel', { debug: true });

            expect(result.debug).toBeDefined();
            expect(result.debug.requestTime).toBeDefined();
            expect(result.debug.channelHandle).toBe('@testchannel');
            expect(result.debug.totalVideosFound).toBe(2);
            expectNoTechnicalArtifacts(result.message);
        });

        it('should track API usage metrics', async () => {
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            await service.detectLiveStreams('@channel1');
            await service.detectLiveStreams('@channel2');
            const metrics = service.getUsageMetrics();

            expect(metrics.totalRequests).toBe(2);
            expect(metrics.successfulRequests).toBe(2);
            expect(metrics.averageResponseTime).toBeDefined();
            expect(metrics.errorRate).toBe(0);
        });
    });
});
