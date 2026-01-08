
const { initializeTestLogging } = require('../helpers/test-setup');
const { createMockLogger } = require('../helpers/mock-factories');

// Initialize logging for tests
initializeTestLogging();

// Mock YouTube.js v16 and dependencies
jest.mock('youtubei.js', () => ({
    Innertube: {
        create: jest.fn()
    }
}));

// Mock InnertubeInstanceManager to avoid complex prototype mocking
jest.mock('../../src/services/innertube-instance-manager', () => ({
    getInstance: jest.fn()
}));

// Bypass the global jest mock to test actual implementation
jest.unmock('../../src/platforms/youtube');

describe('YouTube Multi-Stream Aggregation', () => {
    let mockYouTubePlatform;
    let mockLogger;
    let mockInnertube;

    // Behavior-focused factory for creating stream scenarios
    const createStreamScenario = (streamData) => ({
        name: `${streamData.length} streams with ${streamData.reduce((sum, s) => sum + s.viewers, 0)} total viewers`,
        streams: streamData,
        expectedTotal: streamData.reduce((sum, s) => sum + s.viewers, 0)
    });

    // Factory for creating mock stream response
    const createStreamResponse = (videoId, viewers, isLive = true) => ({
        basic_info: { is_live: isLive },
        primary_info: {
            view_count: {
                view_count: {
                    text: `${viewers.toLocaleString()} watching now`
                }
            }
        }
    });

    // Factory for creating YouTube platform with multi-stream mocks
    const createYouTubePlatformWithStreams = async (streamConfigs) => {
        const { YouTubePlatform } = require('../../src/platforms/youtube');
        const InnertubeInstanceManager = require('../../src/services/innertube-instance-manager');
        
        // Mock the active video IDs to return our test streams
        const activeVideoIds = streamConfigs.map(stream => stream.videoId);
        
        // Create mock responses for each stream
        const streamResponses = {};
        streamConfigs.forEach(stream => {
            streamResponses[stream.videoId] = createStreamResponse(stream.videoId, stream.viewers, stream.isLive);
        });
        
        // Mock Innertube to return appropriate responses
        mockInnertube = {
            getInfo: jest.fn().mockImplementation((videoId) => {
                const response = streamResponses[videoId];
                if (!response) {
                    throw new Error(`No mock response for video ${videoId}`);
                }
                return Promise.resolve(response);
            })
        };
        
        // Mock InnertubeInstanceManager.getInstance to return a mock manager
        const mockManager = {
            getInstance: jest.fn().mockResolvedValue(mockInnertube)
        };
        InnertubeInstanceManager.getInstance.mockReturnValue(mockManager);
        
        // Create mock notification manager (required dependency)
        const mockNotificationManager = {
            emit: jest.fn(),
            on: jest.fn(),
            removeListener: jest.fn()
        };

        // Create mock viewer extraction service (required for provider)
        const mockViewerExtractionService = {
            getAggregatedViewerCount: jest.fn().mockImplementation(async (videoIds) => {
                let totalCount = 0;
                let successfulStreams = 0;
                
                for (const videoId of videoIds) {
                    try {
                        const response = await mockInnertube.getInfo(videoId);
                        if (response.basic_info.is_live) {
                            const viewerText = response.primary_info.view_count.view_count.text;
                            const viewers = parseInt(viewerText.replace(/[^\d]/g, ''));
                            totalCount += viewers;
                            successfulStreams++;
                        }
                    } catch (error) {
                        // Skip failed streams
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
            logger: mockLogger,
            notificationManager: mockNotificationManager,
            viewerExtractionService: mockViewerExtractionService,
            streamDetectionService: {
                detectLiveStreams: jest.fn().mockResolvedValue({ success: true, videoIds: [] })
            }
        });

        // Mock the getDetectedStreamIds method (used by viewer count provider)
        platform.getDetectedStreamIds = jest.fn().mockReturnValue(activeVideoIds);
        platform.Innertube = { create: jest.fn() };
        
        return platform;
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockLogger = createMockLogger();
    });

    describe('Multi-Stream Aggregation Success Scenarios', () => {
        test('should aggregate viewer counts from 3 active streams correctly', async () => {
            // Given: 3 active streams with different viewer counts
            const scenario = createStreamScenario([
                { videoId: 'stream-1', viewers: 140 },
                { videoId: 'stream-2', viewers: 920 },
                { videoId: 'stream-3', viewers: 26 }
            ]);
            
            const platform = await createYouTubePlatformWithStreams(scenario.streams);
            
            // When: Getting aggregated viewer count
            const totalViewers = await platform.getViewerCountByYoutubei();
            
            // Then: Should return sum of all stream viewers
            expect(totalViewers).toBe(1086); // 140 + 920 + 26
            expect(totalViewers).toBe(scenario.expectedTotal);
        });

        test('should handle single stream scenario', async () => {
            // Given: Single active stream
            const scenario = createStreamScenario([
                { videoId: 'solo-stream', viewers: 1234 }
            ]);
            
            const platform = await createYouTubePlatformWithStreams(scenario.streams);
            
            // When: Getting viewer count
            const totalViewers = await platform.getViewerCountByYoutubei();
            
            // Then: Should return the single stream's viewer count
            expect(totalViewers).toBe(1234);
        });

        test('should aggregate large viewer counts across multiple streams', async () => {
            // Given: Multiple streams with large viewer counts
            const scenario = createStreamScenario([
                { videoId: 'big-stream-1', viewers: 45000 },
                { videoId: 'big-stream-2', viewers: 32000 },
                { videoId: 'big-stream-3', viewers: 18000 },
                { videoId: 'big-stream-4', viewers: 5000 }
            ]);
            
            const platform = await createYouTubePlatformWithStreams(scenario.streams);
            
            // When: Getting aggregated viewer count
            const totalViewers = await platform.getViewerCountByYoutubei();
            
            // Then: Should handle large number aggregation
            expect(totalViewers).toBe(100000); // 45k + 32k + 18k + 5k
        });

        test('should handle streams with zero viewers correctly', async () => {
            // Given: Mix of streams including some with zero viewers
            const scenario = createStreamScenario([
                { videoId: 'active-stream', viewers: 500 },
                { videoId: 'empty-stream', viewers: 0 },
                { videoId: 'another-active', viewers: 250 }
            ]);
            
            const platform = await createYouTubePlatformWithStreams(scenario.streams);
            
            // When: Getting aggregated viewer count
            const totalViewers = await platform.getViewerCountByYoutubei();
            
            // Then: Should include zero-viewer streams in calculation
            expect(totalViewers).toBe(750); // 500 + 0 + 250
        });
    });

    describe('Error Resilience and Partial Failures', () => {
        test('should continue aggregation when one stream fails to load', async () => {
            // Given: Mix of successful and failing streams
            const platform = await createYouTubePlatformWithStreams([
                { videoId: 'working-stream-1', viewers: 300 },
                { videoId: 'working-stream-2', viewers: 700 }
            ]);
            
            // Mock one additional stream that will fail
            platform.getDetectedStreamIds = jest.fn().mockReturnValue([
                'working-stream-1', 'failing-stream', 'working-stream-2'
            ]);
            
            // Configure mock to fail for specific stream
            mockInnertube.getInfo.mockImplementation((videoId) => {
                if (videoId === 'failing-stream') {
                    throw new Error('Video unavailable');
                }
                if (videoId === 'working-stream-1') {
                    return Promise.resolve(createStreamResponse(videoId, 300));
                }
                if (videoId === 'working-stream-2') {
                    return Promise.resolve(createStreamResponse(videoId, 700));
                }
            });
            
            // When: Getting aggregated viewer count
            const totalViewers = await platform.getViewerCountByYoutubei();
            
            // Then: Should return sum of successful streams only
            expect(totalViewers).toBe(1000); // 300 + 700 (failing stream ignored)
        });

        test('should return 0 when no active streams are found', async () => {
            // Given: Platform with no active streams
            const platform = await createYouTubePlatformWithStreams([]);
            
            // When: Getting viewer count with no streams
            const totalViewers = await platform.getViewerCountByYoutubei();
            
            // Then: Should return 0 gracefully
            expect(totalViewers).toBe(0);
        });

        test('should handle scenario where all streams fail to load', async () => {
            // Given: Platform with streams that all fail
            const platform = await createYouTubePlatformWithStreams([]);
            platform.getDetectedStreamIds = jest.fn().mockReturnValue(['failing-1', 'failing-2']);
            
            mockInnertube.getInfo.mockRejectedValue(new Error('All streams unavailable'));
            
            // When: Getting aggregated viewer count
            const totalViewers = await platform.getViewerCountByYoutubei();
            
            // Then: Should return 0 when all streams fail
            expect(totalViewers).toBe(0);
        });
    });

    describe('Real-World Stream Scenarios', () => {
        test('should handle typical gaming stream configuration', async () => {
            // Given: Typical gaming stream setup with main + restream
            const scenario = createStreamScenario([
                { videoId: 'main-gaming-stream', viewers: 2500 },
                { videoId: 'restream-backup', viewers: 150 }
            ]);
            
            const platform = await createYouTubePlatformWithStreams(scenario.streams);
            
            // When: Getting total viewer count
            const totalViewers = await platform.getViewerCountByYoutubei();
            
            // Then: Should aggregate both streams
            expect(totalViewers).toBe(2650);
        });

        test('should handle corporate multi-language stream setup', async () => {
            // Given: Corporate event with multiple language streams
            const scenario = createStreamScenario([
                { videoId: 'english-stream', viewers: 5000 },
                { videoId: 'spanish-stream', viewers: 2000 },
                { videoId: 'french-stream', viewers: 1500 },
                { videoId: 'german-stream', viewers: 800 }
            ]);
            
            const platform = await createYouTubePlatformWithStreams(scenario.streams);
            
            // When: Getting total viewer count
            const totalViewers = await platform.getViewerCountByYoutubei();
            
            // Then: Should sum all language streams
            expect(totalViewers).toBe(9300);
        });

        test('should handle educational stream with breakout sessions', async () => {
            // Given: Educational event with main session plus breakouts
            const scenario = createStreamScenario([
                { videoId: 'main-lecture', viewers: 1200 },
                { videoId: 'breakout-session-1', viewers: 45 },
                { videoId: 'breakout-session-2', viewers: 38 },
                { videoId: 'breakout-session-3', viewers: 52 }
            ]);
            
            const platform = await createYouTubePlatformWithStreams(scenario.streams);
            
            // When: Getting total viewer count
            const totalViewers = await platform.getViewerCountByYoutubei();
            
            // Then: Should aggregate main + all breakout sessions
            expect(totalViewers).toBe(1335);
        });
    });

    describe('Performance and Efficiency', () => {
        test('should make individual calls for each stream', async () => {
            // Given: Multiple streams
            const streamConfigs = [
                { videoId: 'stream-a', viewers: 100 },
                { videoId: 'stream-b', viewers: 200 },
                { videoId: 'stream-c', viewers: 300 }
            ];
            
            const platform = await createYouTubePlatformWithStreams(streamConfigs);
            
            // When: Getting aggregated viewer count
            await platform.getViewerCountByYoutubei();
            
            // Then: Should call getInfo once per stream
            expect(mockInnertube.getInfo).toHaveBeenCalledTimes(3);
            expect(mockInnertube.getInfo).toHaveBeenCalledWith('stream-a');
            expect(mockInnertube.getInfo).toHaveBeenCalledWith('stream-b');
            expect(mockInnertube.getInfo).toHaveBeenCalledWith('stream-c');
        });

        test('should provide debug logging during aggregation process', async () => {
            // Given: Multiple streams
            const platform = await createYouTubePlatformWithStreams([
                { videoId: 'stream-1', viewers: 400 },
                { videoId: 'stream-2', viewers: 600 }
            ]);
            
            // When: Getting aggregated viewer count
            const result = await platform.getViewerCountByYoutubei();
            
            // Then: Should provide expected aggregated result and some debug logging
            expect(result).toBe(1000); // 400 + 600
            expect(mockLogger.debug).toHaveBeenCalled(); // Some debug logging should occur
            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThan(0);
        });
    });
});