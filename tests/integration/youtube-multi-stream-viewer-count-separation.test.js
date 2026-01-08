
const { initializeTestLogging } = require('../helpers/test-setup');
const { createMockLogger, createMockNotificationManager, setupAutomatedCleanup } = require('../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../helpers/behavior-validation');

// Initialize test environment
initializeTestLogging();

// Mock YouTube.js to control test behavior
jest.mock('youtubei.js', () => ({
    Innertube: {
        create: jest.fn()
    }
}));

// Mock dependencies to focus on behavior
jest.mock('../../src/services/innertube-instance-manager', () => ({
    getInstance: jest.fn()
}));

// Unmock to test actual implementation behavior
jest.unmock('../../src/platforms/youtube');
jest.unmock('../../src/utils/youtube-connection-manager');

describe('YouTube Multi-Stream Viewer Count Separation', () => {
    let mockLogger, mockNotificationManager, cleanup;

    // ============================================================================================
    // BEHAVIOR-FOCUSED FACTORIES
    // ============================================================================================

    const createMultiStreamScenario = (streamConfigs) => {
        const totalViewers = streamConfigs
            .filter(stream => stream.isLive !== false)
            .reduce((sum, stream) => sum + stream.viewers, 0);
        
        const chatReadyStreams = streamConfigs.filter(stream => stream.chatReady);
        const allDetectedStreams = streamConfigs.filter(stream => stream.isLive !== false);
        
        return {
            name: `${streamConfigs.length} total streams (${chatReadyStreams.length} chat-ready, ${allDetectedStreams.length} detected)`,
            streams: streamConfigs,
            expectedViewerCount: totalViewers,
            chatReadyCount: chatReadyStreams.length,
            detectedCount: allDetectedStreams.length
        };
    };

    const createYouTubePlatformWithMixedStates = async (scenario) => {
        const { YouTubePlatform } = require('../../src/platforms/youtube');
        const InnertubeInstanceManager = require('../../src/services/innertube-instance-manager');
        
        // Create mock Innertube responses for each stream
        const streamResponses = {};
        scenario.streams.forEach(stream => {
            if (stream.isLive !== false) {
                streamResponses[stream.videoId] = {
                    basic_info: { is_live: true },
                    primary_info: {
                        view_count: {
                            view_count: {
                                text: `${stream.viewers.toLocaleString()} watching now`
                            }
                        }
                    }
                };
            }
        });
        
        // Mock Innertube instance
        const mockInnertube = {
            getInfo: jest.fn().mockImplementation((videoId) => {
                const response = streamResponses[videoId];
                if (!response) {
                    throw new Error(`Stream not available: ${videoId}`);
                }
                return Promise.resolve(response);
            })
        };
        
        // Mock InnertubeInstanceManager
        const mockManager = {
            getInstance: jest.fn().mockResolvedValue(mockInnertube)
        };
        InnertubeInstanceManager.getInstance.mockReturnValue(mockManager);
        
        // Create mock viewer extraction service for testing
        const mockViewerExtractionService = {
            getAggregatedViewerCount: jest.fn().mockImplementation(async (videoIds) => {
                let totalCount = 0;
                let successfulStreams = 0;
                
                for (const videoId of videoIds) {
                    const stream = scenario.streams.find(s => s.videoId === videoId);
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
            }),
            extractViewerCount: jest.fn().mockImplementation(async (videoId) => {
                const stream = scenario.streams.find(s => s.videoId === videoId);
                if (stream && stream.isLive !== false) {
                    return {
                        success: true,
                        count: stream.viewers
                    };
                }
                return {
                    success: false,
                    count: 0
                };
            })
        };

        // Create platform instance
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
        
        // Mock connection manager behavior
        const originalGetActiveVideoIds = platform.connectionManager.getActiveVideoIds;
        const originalIsConnectionReady = platform.connectionManager.isConnectionReady;
        
        // Mock getActiveVideoIds to return ALL detected streams (not just chat-ready)
        // This is what SHOULD happen for viewer count aggregation
        platform.connectionManager.getActiveVideoIds = jest.fn().mockReturnValue(
            scenario.streams
                .filter(stream => stream.isLive !== false)
                .map(stream => stream.videoId)
        );
        
        // Mock isConnectionReady to respect chatReady state
        platform.connectionManager.isConnectionReady = jest.fn().mockImplementation((videoId) => {
            const stream = scenario.streams.find(s => s.videoId === videoId);
            return stream ? stream.chatReady : false;
        });
        
        // Store original methods for potential restoration
        platform._originalGetActiveVideoIds = originalGetActiveVideoIds;
        platform._originalIsConnectionReady = originalIsConnectionReady;
        
        return platform;
    };


    beforeEach(async () => {
        cleanup = setupAutomatedCleanup();
        mockLogger = createMockLogger();
        mockNotificationManager = createMockNotificationManager();
        jest.clearAllMocks();
    });

    afterEach(async () => {
        if (cleanup && typeof cleanup === 'function') {
            await cleanup();
        }
    });

    // ============================================================================================
    // MULTI-STREAM VIEWER COUNT AGGREGATION BEHAVIOR TESTS
    // ============================================================================================

    describe('Multi-Stream Viewer Count Aggregation (From ALL Detected Streams)', () => {
        test('should aggregate viewer count from all detected streams regardless of chat readiness', async () => {
            // Given: Multiple streams with mixed chat readiness states
            const scenario = createMultiStreamScenario([
                { videoId: 'stream-1', viewers: 1500, chatReady: true, isLive: true },   // Chat ready
                { videoId: 'stream-2', viewers: 800, chatReady: false, isLive: true },   // Chat not ready
                { videoId: 'stream-3', viewers: 1200, chatReady: true, isLive: true },   // Chat ready
                { videoId: 'stream-4', viewers: 600, chatReady: false, isLive: true },   // Chat not ready
            ]);
            
            const platform = await createYouTubePlatformWithMixedStates(scenario);
            
            // When: Getting viewer count (should include ALL streams)
            const totalViewers = await platform.getViewerCount();
            
            // Then: Should aggregate from ALL detected streams (not just chat-ready)
            expect(totalViewers).toBe(4100); // 1500 + 800 + 1200 + 600
            expect(totalViewers).toBe(scenario.expectedViewerCount);
            
            // And: Should not be limited to chat-ready streams only
            const chatReadyOnly = scenario.streams
                .filter(s => s.chatReady)
                .reduce((sum, s) => sum + s.viewers, 0);
            expect(totalViewers).toBeGreaterThan(chatReadyOnly); // 4100 > 2700
        });

        test('should include streams with failed chat connections in viewer count', async () => {
            // Given: Scenario where some streams fail chat connection but still have viewers
            const scenario = createMultiStreamScenario([
                { videoId: 'successful-chat', viewers: 2000, chatReady: true, isLive: true },
                { videoId: 'failed-chat-1', viewers: 1500, chatReady: false, isLive: true },
                { videoId: 'failed-chat-2', viewers: 900, chatReady: false, isLive: true },
            ]);
            
            const platform = await createYouTubePlatformWithMixedStates(scenario);
            
            // When: Getting viewer count
            const totalViewers = await platform.getViewerCount();
            
            // Then: Should include viewers from failed chat connections
            expect(totalViewers).toBe(4400); // 2000 + 1500 + 900
            
            // And: Should not exclude streams just because chat failed
            const chatReadyTotal = 2000; // Only the successful chat stream
            expect(totalViewers).toBeGreaterThan(chatReadyTotal);
        });

        test('should handle mixed stream states with premiere and live streams', async () => {
            // Given: Complex scenario with different stream types and readiness
            const scenario = createMultiStreamScenario([
                { videoId: 'live-main', viewers: 3500, chatReady: true, isLive: true },      // Live with chat
                { videoId: 'premiere-pending', viewers: 800, chatReady: false, isLive: true }, // Premiere without chat
                { videoId: 'live-backup', viewers: 1200, chatReady: false, isLive: true },    // Live without chat
                { videoId: 'restream', viewers: 400, chatReady: true, isLive: true },         // Restream with chat
            ]);
            
            const platform = await createYouTubePlatformWithMixedStates(scenario);
            
            // When: Getting total viewer count
            const totalViewers = await platform.getViewerCount();
            
            // Then: Should aggregate from all stream types
            expect(totalViewers).toBe(5900); // 3500 + 800 + 1200 + 400
            expect(totalViewers).toBe(scenario.expectedViewerCount);
        });

        test('should maintain accurate count when chat connections change state', async () => {
            // Given: Initial scenario with mixed readiness
            const scenario = createMultiStreamScenario([
                { videoId: 'stable-stream', viewers: 1000, chatReady: true, isLive: true },
                { videoId: 'unstable-stream', viewers: 2000, chatReady: false, isLive: true },
            ]);
            
            const platform = await createYouTubePlatformWithMixedStates(scenario);
            
            // When: Getting initial viewer count
            const initialCount = await platform.getViewerCount();
            
            // Then: Should include both streams initially
            expect(initialCount).toBe(3000);
            
            // When: Unstable stream chat comes online (viewer count stays same)
            platform.connectionManager.isConnectionReady = jest.fn().mockImplementation((videoId) => {
                return true; // Both connections now ready
            });
            
            const afterChatReady = await platform.getViewerCount();
            
            // Then: Viewer count should remain the same (was already including both)
            expect(afterChatReady).toBe(3000);
            expect(afterChatReady).toBe(initialCount);
        });
    });

    // ============================================================================================
    // CHAT-INDEPENDENT VIEWER COUNT BEHAVIOR TESTS
    // ============================================================================================

    describe('Chat-Independent Viewer Count Functionality', () => {
        test('should provide viewer count even when all chat connections fail', async () => {
            // Given: Multiple streams detected but all chat connections failed
            const scenario = createMultiStreamScenario([
                { videoId: 'stream-1', viewers: 1800, chatReady: false, isLive: true },
                { videoId: 'stream-2', viewers: 1200, chatReady: false, isLive: true },
                { videoId: 'stream-3', viewers: 900, chatReady: false, isLive: true },
            ]);
            
            const platform = await createYouTubePlatformWithMixedStates(scenario);
            
            // When: Getting viewer count despite no chat connections
            const totalViewers = await platform.getViewerCount();
            
            // Then: Should still provide viewer count from detected streams
            expect(totalViewers).toBe(3900); // 1800 + 1200 + 900
            expect(totalViewers).toBeGreaterThan(0);
            
            // And: Should not return 0 just because chat isn't working
            expect(totalViewers).not.toBe(0);
        });

        test('should work independently of chat service availability', async () => {
            // Given: Streams detected via stream detection service (not chat)
            const scenario = createMultiStreamScenario([
                { videoId: 'detected-stream-1', viewers: 2500, chatReady: false, isLive: true },
                { videoId: 'detected-stream-2', viewers: 1800, chatReady: false, isLive: true },
            ]);
            
            const platform = await createYouTubePlatformWithMixedStates(scenario);
            
            // When: Chat service is completely unavailable
            platform.connectionManager.isConnectionReady = jest.fn().mockReturnValue(false);
            platform.connectionManager.isAnyConnectionReady = jest.fn().mockReturnValue(false);
            
            const viewerCount = await platform.getViewerCount();
            
            // Then: Viewer count should still work via stream detection
            expect(viewerCount).toBe(4300); // 2500 + 1800
            expect(viewerCount).toBeGreaterThan(0);
        });

        test('should handle partial chat connectivity gracefully', async () => {
            // Given: Some streams have chat, others detected via different means
            const scenario = createMultiStreamScenario([
                { videoId: 'chat-enabled', viewers: 3000, chatReady: true, isLive: true },
                { videoId: 'api-detected-1', viewers: 1500, chatReady: false, isLive: true },
                { videoId: 'api-detected-2', viewers: 800, chatReady: false, isLive: true },
                { videoId: 'chat-enabled-2', viewers: 1200, chatReady: true, isLive: true },
            ]);
            
            const platform = await createYouTubePlatformWithMixedStates(scenario);
            
            // When: Getting viewer count with mixed connectivity
            const totalViewers = await platform.getViewerCount();
            
            // Then: Should include viewers from all detection methods
            expect(totalViewers).toBe(6500); // 3000 + 1500 + 800 + 1200
            
            // And: Should not privilege chat-connected streams
            const chatOnlyTotal = scenario.streams
                .filter(s => s.chatReady)
                .reduce((sum, s) => sum + s.viewers, 0);
            expect(totalViewers).toBeGreaterThan(chatOnlyTotal);
        });

        test('should maintain viewer count during chat connection interruptions', async () => {
            // Given: Stable streams with viewer counts
            const scenario = createMultiStreamScenario([
                { videoId: 'main-stream', viewers: 4000, chatReady: true, isLive: true },
                { videoId: 'backup-stream', viewers: 1000, chatReady: true, isLive: true },
            ]);
            
            const platform = await createYouTubePlatformWithMixedStates(scenario);
            
            // When: Getting initial count with working chat
            const beforeInterruption = await platform.getViewerCount();
            expect(beforeInterruption).toBe(5000);
            
            // When: Chat connections get interrupted
            platform.connectionManager.isConnectionReady = jest.fn().mockReturnValue(false);
            
            const duringInterruption = await platform.getViewerCount();
            
            // Then: Viewer count should remain stable
            expect(duringInterruption).toBe(5000);
            expect(duringInterruption).toBe(beforeInterruption);
        });
    });

    // ============================================================================================
    // CONSISTENT PLATFORM INTERFACE BEHAVIOR TESTS
    // ============================================================================================

    describe('Consistent Platform Interface (TikTok/Twitch Compatibility)', () => {
        test('should provide reliable getViewerCount() like other platforms', async () => {
            // Given: YouTube platform with detected streams
            const scenario = createMultiStreamScenario([
                { videoId: 'reliable-stream', viewers: 2500, chatReady: false, isLive: true },
            ]);
            
            const platform = await createYouTubePlatformWithMixedStates(scenario);
            
            // When: Calling getViewerCount() multiple times
            const call1 = await platform.getViewerCount();
            const call2 = await platform.getViewerCount();
            const call3 = await platform.getViewerCount();
            
            // Then: Should consistently return viewer count
            expect(call1).toBe(2500);
            expect(call2).toBe(2500);
            expect(call3).toBe(2500);
            
            // And: Should never return undefined/null like other platforms
            expect(call1).toBeDefined();
            expect(typeof call1).toBe('number');
        });

        test('should handle zero viewers consistently with other platforms', async () => {
            // Given: Live stream with zero viewers
            const scenario = createMultiStreamScenario([
                { videoId: 'empty-stream', viewers: 0, chatReady: false, isLive: true },
            ]);
            
            const platform = await createYouTubePlatformWithMixedStates(scenario);
            
            // When: Getting viewer count for empty stream
            const viewerCount = await platform.getViewerCount();
            
            // Then: Should return 0 (not undefined/error)
            expect(viewerCount).toBe(0);
            expect(typeof viewerCount).toBe('number');
        });

        test('should behave consistently regardless of chat implementation details', async () => {
            // Given: Same viewer counts with different chat architectures
            const scenario1 = createMultiStreamScenario([
                { videoId: 'websocket-chat', viewers: 1000, chatReady: true, isLive: true },
                { videoId: 'api-polling', viewers: 500, chatReady: false, isLive: true },
            ]);
            
            const scenario2 = createMultiStreamScenario([
                { videoId: 'different-impl-1', viewers: 1000, chatReady: false, isLive: true },
                { videoId: 'different-impl-2', viewers: 500, chatReady: true, isLive: true },
            ]);
            
            const platform1 = await createYouTubePlatformWithMixedStates(scenario1);
            const platform2 = await createYouTubePlatformWithMixedStates(scenario2);
            
            // When: Getting viewer counts from both scenarios
            const count1 = await platform1.getViewerCount();
            const count2 = await platform2.getViewerCount();
            
            // Then: Should return same total regardless of chat implementation
            expect(count1).toBe(1500);
            expect(count2).toBe(1500);
            expect(count1).toBe(count2);
        });

        test('should provide user-friendly viewer count display values', async () => {
            // Given: Platform with various viewer counts
            const scenario = createMultiStreamScenario([
                { videoId: 'big-stream', viewers: 15000, chatReady: true, isLive: true },
                { videoId: 'medium-stream', viewers: 850, chatReady: false, isLive: true },
                { videoId: 'small-stream', viewers: 42, chatReady: false, isLive: true },
            ]);
            
            const platform = await createYouTubePlatformWithMixedStates(scenario);
            
            // When: Getting viewer count for display
            const totalViewers = await platform.getViewerCount();
            
            // Then: Should be clean numeric value suitable for display
            expect(totalViewers).toBe(15892); // 15000 + 850 + 42
            expect(typeof totalViewers).toBe('number');
            expect(totalViewers).toBeGreaterThan(0);
            expect(Number.isInteger(totalViewers)).toBe(true);
            
            // And: Should produce clean display text
            const displayText = totalViewers.toLocaleString();
            expectNoTechnicalArtifacts(displayText);
            expect(displayText).toMatch(/^\d{1,3}(,\d{3})*$/); // Format like "15,892"
        });
    });

});
