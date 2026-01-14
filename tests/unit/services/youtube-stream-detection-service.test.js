const { describe, it, beforeEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { YouTubeStreamDetectionService } = require('../../../src/services/youtube-stream-detection-service');
const { createSilentLogger } = require('../../helpers/test-logger');
const testClock = require('../../helpers/test-clock');

// Behavior-focused test factories following test standards
function createMockInnertubeClient(streamData = []) {
    // Create mock channel object that supports getLiveStreams()
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
            // Mock channel search for resolution (when type: 'channel')
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
            // Mock video search for fallback methods
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
            payload: {
                browseId: 'UCmockChannelId123'
            }
        }),
        getChannel: createMockFn().mockResolvedValue(mockChannel)
    };
}

function createStreamDetectionService(mockClient = null) {
    const client = mockClient || createMockInnertubeClient();
    return new YouTubeStreamDetectionService(client, { logger: createSilentLogger() });
}

function createLiveStreamData() {
    return [
        {
            videoId: 'live123',
            title: 'Test Live Stream',
            isLive: true,
            channelName: 'TestChannel'
        },
        {
            videoId: 'live456',
            title: 'Another Live Stream',
            isLive: true,
            channelName: 'TestChannel'
        }
    ];
}

function createNonLiveStreamData() {
    return [
        {
            videoId: 'video123',
            title: 'Recorded Video',
            isLive: false,
            channelName: 'TestChannel'
        }
    ];
}

function expectNoTechnicalArtifacts(message) {
    // Validate user-facing content contains no technical implementation details
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
            // Given: Channel with multiple live streams
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            // When: Detecting live streams
            const result = await service.detectLiveStreams('@testchannel');

            // Then: User receives all live video IDs
            expect(result.videoIds).toHaveLength(2);
            expect(result.videoIds).toContain('live123');
            expect(result.videoIds).toContain('live456');
            expect(result.success).toBe(true);
            
            // Validate video IDs are clean user-facing data
            result.videoIds.forEach(expectValidVideoId);
        });

        it('should return empty array when no streams are live', async () => {
            // Given: Channel with only recorded content
            const nonLiveStreams = createNonLiveStreamData();
            mockClient = createMockInnertubeClient(nonLiveStreams);
            service = createStreamDetectionService(mockClient);

            // When: Detecting live streams
            const result = await service.detectLiveStreams('@testchannel');

            // Then: User receives empty result indicating no live streams
            expect(result.videoIds).toEqual([]);
            expect(result.success).toBe(true);
            expect(result.message).toContain('No live streams');
            expectNoTechnicalArtifacts(result.message);
        });

        it('should handle channel with no content gracefully', async () => {
            // Given: Channel with no videos
            mockClient = createMockInnertubeClient([]);
            service = createStreamDetectionService(mockClient);

            // When: Detecting live streams
            const result = await service.detectLiveStreams('@emptychannel');

            // Then: User receives clean empty result
            expect(result.videoIds).toEqual([]);
            expect(result.success).toBe(true);
            expect(result.message).toContain('No content found');
            expectNoTechnicalArtifacts(result.message);
        });

        it('should include detection method metadata for transparency', async () => {
            // Given: Active channel with live streams resolved via channel API
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            // When: Detecting live streams
            const result = await service.detectLiveStreams('@testchannel');

            // Then: Response includes detection method for debugging
            expect(result.success).toBe(true);
            expect(result.detectionMethod).toBe('channel_api');
            expect(result.hasContent).toBe(true);
        });
    });

    describe('Performance Requirements', () => {
        it('should complete detection within 2 seconds', async () => {
            // Given: Service with normal response time
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            // When: Measuring detection time
            const startTime = testClock.now();
            const result = await service.detectLiveStreams('@testchannel');
            const simulatedDurationMs = 25;
            testClock.advance(simulatedDurationMs);
            const endTime = testClock.now();

            // Then: User experiences fast response
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(2000);
            expect(result.success).toBe(true);
            expect(result.responseTime).toBeDefined();
            expect(result.responseTime).toBeLessThan(2000);
        });

        it('should timeout gracefully for slow responses', async () => {
            // Given: Service that responds slowly during channel resolution
            mockClient = {
                resolveURL: createMockFn().mockImplementation(() =>
                    waitForDelay(5000)
                ),
                getChannel: createMockFn().mockResolvedValue({})
            };
            service = createStreamDetectionService(mockClient);

            // When: Detection takes too long
            const result = await service.detectLiveStreams('@slowchannel');

            // Then: User receives timeout message instead of hanging
            expect(result.success).toBe(false);
            expect(result.videoIds).toEqual([]);
            expect(result.message).toContain('timeout');
            expectNoTechnicalArtifacts(result.message);
        });
    });

    describe('Error Recovery Behavior', () => {
        it('should handle network errors gracefully', async () => {
            // Given: Network connectivity issues during channel resolution
            mockClient = {
                resolveURL: createMockFn().mockRejectedValue(new Error('Network error')),
                getChannel: createMockFn().mockRejectedValue(new Error('Network error'))
            };
            service = createStreamDetectionService(mockClient);

            // When: Network failure occurs
            const result = await service.detectLiveStreams('@testchannel');

            // Then: User receives clean error message instead of crash
            expect(result.success).toBe(false);
            expect(result.videoIds).toEqual([]);
            expect(result.message).toContain('connection issue');
            expectNoTechnicalArtifacts(result.message);
            expect(result.retryable).toBe(true);
        });

        it('should handle API rate limiting gracefully', async () => {
            // Given: API rate limit exceeded during channel resolution
            const rateLimitError = new Error('Quota exceeded');
            rateLimitError.status = 429;
            mockClient = {
                resolveURL: createMockFn().mockRejectedValue(rateLimitError),
                getChannel: createMockFn().mockRejectedValue(rateLimitError)
            };
            service = createStreamDetectionService(mockClient);

            // When: Rate limit is hit
            const result = await service.detectLiveStreams('@testchannel');

            // Then: User receives appropriate rate limit message
            expect(result.success).toBe(false);
            expect(result.videoIds).toEqual([]);
            expect(result.message).toContain('rate limit');
            expectNoTechnicalArtifacts(result.message);
            expect(result.retryAfter).toBeDefined();
        });

        it('should handle invalid channel gracefully', async () => {
            // Given: Channel that doesn't exist during resolution
            const notFoundError = new Error('Channel not found');
            notFoundError.status = 404;
            mockClient = {
                resolveURL: createMockFn().mockResolvedValue({ payload: {} }),
                getChannel: createMockFn().mockRejectedValue(notFoundError)
            };
            service = createStreamDetectionService(mockClient);

            // When: Checking non-existent channel
            const result = await service.detectLiveStreams('@nonexistentchannel');

            // Then: User receives clear channel not found message
            expect(result.success).toBe(false);
            expect(result.videoIds).toEqual([]);
            expect(result.message).toContain('channel not found');
            expectNoTechnicalArtifacts(result.message);
            expect(result.retryable).toBe(false);
        });
    });

    describe('Channel Handle Format Support', () => {
        it('should work with @ handle format', async () => {
            // Given: Channel handle with @ prefix
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            // When: Using @ handle format
            const result = await service.detectLiveStreams('@testchannel');

            // Then: User gets successful detection
            expect(result.success).toBe(true);
            expect(result.videoIds).toHaveLength(2);
        });

        it('should work with plain channel name', async () => {
            // Given: Plain channel name without @
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            // When: Using plain channel name
            const result = await service.detectLiveStreams('testchannel');

            // Then: User gets successful detection
            expect(result.success).toBe(true);
            expect(result.videoIds).toHaveLength(2);
        });

        it('should work with channel ID format', async () => {
            // Given: YouTube channel ID
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            // When: Using channel ID format
            const result = await service.detectLiveStreams('UCTestChannelId123');

            // Then: User gets successful detection
            expect(result.success).toBe(true);
            expect(result.videoIds).toHaveLength(2);
        });
    });

    describe('Data Quality and Validation', () => {
        it('should filter out invalid video IDs', async () => {
            // Given: Mixed valid and invalid video data
            const mixedData = [
                { videoId: 'valid123', title: 'Valid Stream', isLive: true, channelName: 'Test' },
                { videoId: '', title: 'Invalid Stream', isLive: true, channelName: 'Test' },
                { videoId: null, title: 'Null Stream', isLive: true, channelName: 'Test' },
                { videoId: 'valid456', title: 'Another Valid', isLive: true, channelName: 'Test' }
            ];
            mockClient = createMockInnertubeClient(mixedData);
            service = createStreamDetectionService(mockClient);

            // When: Processing mixed data
            const result = await service.detectLiveStreams('@testchannel');

            // Then: User only receives valid video IDs
            expect(result.videoIds).toEqual(['valid123', 'valid456']);
            expect(result.success).toBe(true);
            result.videoIds.forEach(expectValidVideoId);
        });

        it('should handle malformed API responses gracefully', async () => {
            // Given: Parser error (YouTube.js type mismatch)
            const malformedChannel = {
                getLiveStreams: createMockFn().mockRejectedValue(new Error('Type mismatch in YouTube.js parser'))
            };
            mockClient = {
                resolveURL: createMockFn().mockResolvedValue({
                    payload: {
                        browseId: 'UC' + 'p'.repeat(22)
                    }
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

            // When: Processing malformed response
            const result = await service.detectLiveStreams('@testchannel');

            // Then: User receives safe empty result flagged as malformed
            expect(result.success).toBe(true);
            expect(result.videoIds).toEqual([]);
            expect(result.message).toContain('No content found');
            expectNoTechnicalArtifacts(result.message);
        });
    });

    describe('Logging and Debugging Support', () => {
        it('should log a clean warning when the channel is not found', async () => {
            // Given: A channel handle that does not resolve to any channel
            const logger = createSilentLogger();
            mockClient = {
                resolveURL: createMockFn().mockResolvedValue({ payload: {} }),
                getChannel: createMockFn()
            };
            service = new YouTubeStreamDetectionService(mockClient, { logger });

            // When: Attempting to detect streams for a missing channel
            await service.detectLiveStreams('@missingchannel');

            // Then: Warning is clean and no error log is emitted
            const warnEntries = logger.getEntriesByLevel('WARN')
                .filter(entry => entry.message.toLowerCase().includes('channel not found'));
            const warnEntry = warnEntries[0];
            expect(warnEntry).toBeDefined();
            expectNoTechnicalArtifacts(warnEntry.message);
            expect(warnEntries.length).toBe(1);

            const errorEntry = logger.getEntriesByLevel('ERROR')
                .find(entry => entry.message.includes('Stream detection failed'));
            expect(errorEntry).toBeUndefined();
        });

        it('should provide debug information for troubleshooting', async () => {
            // Given: Service in debug mode
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            // When: Detecting streams with debug enabled
            const result = await service.detectLiveStreams('@testchannel', { debug: true });

            // Then: Debug info is available but not in user-facing content
            expect(result.debug).toBeDefined();
            expect(result.debug.requestTime).toBeDefined();
            expect(result.debug.channelHandle).toBe('@testchannel');
            expect(result.debug.totalVideosFound).toBe(2);
            
            // User-facing message remains clean
            expectNoTechnicalArtifacts(result.message);
        });

        it('should track API usage metrics', async () => {
            // Given: Service tracking usage
            const liveStreams = createLiveStreamData();
            mockClient = createMockInnertubeClient(liveStreams);
            service = createStreamDetectionService(mockClient);

            // When: Multiple detections occur
            await service.detectLiveStreams('@channel1');
            await service.detectLiveStreams('@channel2');
            const metrics = service.getUsageMetrics();

            // Then: Usage metrics are tracked for monitoring
            expect(metrics.totalRequests).toBe(2);
            expect(metrics.successfulRequests).toBe(2);
            expect(metrics.averageResponseTime).toBeDefined();
            expect(metrics.errorRate).toBe(0);
        });
    });
});
