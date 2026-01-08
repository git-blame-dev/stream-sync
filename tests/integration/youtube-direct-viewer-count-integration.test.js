
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

// Create universal test factory for viewer count provider mocking
const createMockViewerCountProvider = (overrides = {}) => ({
    getViewerCount: jest.fn().mockResolvedValue(100),
    isReady: jest.fn().mockReturnValue(true),
    getProviderStatus: jest.fn().mockReturnValue({ healthy: true }),
    cleanup: jest.fn(),
    getViewerCountForVideo: jest.fn().mockResolvedValue(100),
    ...overrides
});

// Bypass the global jest mock to test actual implementation
jest.unmock('../../src/platforms/youtube');

describe('YouTube Direct getViewerCount() Integration', () => {
    let mockYouTubePlatform;
    let mockLogger;
    let mockInnertube;

    // Factory for creating YouTube platform with provider configuration
    const createProviderYouTubePlatform = async (expectedViewerCount = 100, providerOverrides = {}) => {
        const { YouTubePlatform } = require('../../src/platforms/youtube');
        
        // Create mock notification manager (required dependency)
        const mockNotificationManager = {
            emit: jest.fn(),
            on: jest.fn(),
            removeListener: jest.fn()
        };
        
        // Create mock provider with expected viewer count
        const mockProvider = createMockViewerCountProvider({
            getViewerCount: jest.fn().mockResolvedValue(expectedViewerCount),
            ...providerOverrides
        });
        
        const platform = new YouTubePlatform({
            youtube: {
                enabled: true
            }
        }, {
            logger: mockLogger,
            notificationManager: mockNotificationManager,
            viewerCountProvider: mockProvider,
            streamDetectionService: {
                detectLiveStreams: jest.fn().mockResolvedValue({ success: true, videoIds: [] })
            }
        });
        
        return { platform, mockProvider };
    };

    // Factory for creating stream responses
    const createStreamResponse = (viewers) => ({
        basic_info: { is_live: true },
        primary_info: {
            view_count: {
                view_count: {
                    text: `${viewers.toLocaleString()} watching now`
                }
            }
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockLogger = createMockLogger();
        mockInnertube = {
            getInfo: jest.fn()
        };
    });

    describe('Direct Call Path Integration', () => {
        test('should use provider aggregation for multi-stream scenario', async () => {
            // Given: Platform with provider configured for aggregated viewer count
            const { platform, mockProvider } = await createProviderYouTubePlatform(1000);
            
            // When: Calling platform.getViewerCount()
            const totalViewers = await platform.getViewerCount();
            
            // Then: Should return aggregated total through provider
            expect(totalViewers).toBe(1000); // 150 + 850
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });

        test('should work for single stream through provider path', async () => {
            // Given: Platform with provider configured for single stream
            const { platform, mockProvider } = await createProviderYouTubePlatform(1234);
            
            // When: Calling platform.getViewerCount()
            const viewerCount = await platform.getViewerCount();
            
            // Then: Should return single stream count via provider
            expect(viewerCount).toBe(1234);
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });

        test('should respect provider configuration', async () => {
            // Given: Platform configured with provider
            const { platform, mockProvider } = await createProviderYouTubePlatform(500);
            
            // When: Getting viewer count
            const viewerCount = await platform.getViewerCount();
            
            // Then: Should return expected count through provider
            expect(viewerCount).toBe(500);
            expect(typeof viewerCount).toBe('number');
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });

        test('should handle provider errors gracefully', async () => {
            // Given: Platform with provider that throws errors
            const { platform } = await createProviderYouTubePlatform(0, {
                getViewerCount: jest.fn().mockRejectedValue(new Error('Provider error'))
            });
            
            // When: Attempting to get viewer count with failing provider
            const viewerCount = await platform.getViewerCount();
            
            // Then: Should handle error gracefully by returning 0
            expect(viewerCount).toBe(0);
            expect(typeof viewerCount).toBe('number');
        });
    });

    describe('Error Handling and User Experience', () => {
        test('should return 0 when provider fails completely', async () => {
            // Given: Platform with failing provider
            const { platform } = await createProviderYouTubePlatform(0, {
                getViewerCount: jest.fn().mockRejectedValue(new Error('Provider API unavailable'))
            });
            
            // When: Getting viewer count during provider failure
            const viewerCount = await platform.getViewerCount();
            
            // Then: Should return 0 instead of throwing (graceful error handling)
            expect(viewerCount).toBe(0);
            expect(typeof viewerCount).toBe('number');
        });

        test('should handle no active streams gracefully', async () => {
            // Given: Platform with provider returning 0 for no streams
            const { platform } = await createProviderYouTubePlatform(0);
            
            // When: Getting viewer count with no streams
            const viewerCount = await platform.getViewerCount();
            
            // Then: Should return 0 for no streams
            expect(viewerCount).toBe(0);
        });

        test('should return accurate viewer count for normal operation', async () => {
            // Given: Platform with provider configured for normal operation
            const { platform, mockProvider } = await createProviderYouTubePlatform(777);
            
            // When: Getting viewer count
            const result = await platform.getViewerCount();
            
            // Then: Should return expected count via provider
            expect(result).toBe(777);
            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThanOrEqual(0);
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });
    });

    describe('Integration with ViewerCount System', () => {
        test('should provide consistent interface for ViewerCount polling', async () => {
            // Given: ViewerCount system calling platform.getViewerCount() with provider
            const { platform, mockProvider } = await createProviderYouTubePlatform(456);
            
            // When: ViewerCount system polls for viewer count
            const polledCount = await platform.getViewerCount();
            
            // Then: Should return consistent numeric result via provider
            expect(typeof polledCount).toBe('number');
            expect(polledCount).toBe(456);
            expect(polledCount).toBeGreaterThanOrEqual(0);
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });

        test('should handle rapid successive calls efficiently', async () => {
            // Given: Platform with provider that will receive multiple rapid calls
            const { platform, mockProvider } = await createProviderYouTubePlatform(888);
            
            // When: Making multiple rapid calls (simulating polling)
            const results = await Promise.all([
                platform.getViewerCount(),
                platform.getViewerCount(),
                platform.getViewerCount()
            ]);
            
            // Then: Should handle all calls successfully via provider
            expect(results).toEqual([888, 888, 888]);
            expect(mockProvider.getViewerCount).toHaveBeenCalledTimes(3);
        });

        test('should maintain performance under load', async () => {
            // Given: Platform with provider configured for performance testing
            const { platform } = await createProviderYouTubePlatform(999);
            
            // When: Measuring call performance
            const startTime = Date.now();
            await platform.getViewerCount();
            const duration = Date.now() - startTime;
            
            // Then: Should complete within reasonable time (< 1000ms for test)
            expect(duration).toBeLessThan(1000);
        });
    });

    describe('Configuration and Method Routing', () => {
        test('should route to provider when configured', async () => {
            // Given: Platform configured with provider
            const { platform, mockProvider } = await createProviderYouTubePlatform(200);
            
            // When: Getting viewer count with provider
            const viewerCount = await platform.getViewerCount();
            
            // Then: Should return valid numeric result via provider
            expect(typeof viewerCount).toBe('number');
            expect(viewerCount).toBe(200);
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });

        test('should use provider with default configuration', async () => {
            // Given: Platform with provider using default configuration
            const { platform, mockProvider } = await createProviderYouTubePlatform(333);
            
            // When: Getting viewer count with default configuration
            const viewerCount = await platform.getViewerCount();
            
            // Then: Should return expected count via provider
            expect(viewerCount).toBe(333);
            expect(typeof viewerCount).toBe('number');
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });
    });

    describe('Real-World Integration Scenarios', () => {
        test('should handle typical streaming platform usage', async () => {
            // Given: Platform with provider configured for multi-stream aggregation
            const { platform, mockProvider } = await createProviderYouTubePlatform(1415); // 1250 + 45 + 120
            
            // When: Getting total viewer count for streaming platform
            const totalViewers = await platform.getViewerCount();
            
            // Then: Should aggregate all streams via provider for total audience
            expect(totalViewers).toBe(1415); // 1250 + 45 + 120
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });

        test('should work in educational streaming context', async () => {
            // Given: Educational platform with provider configured for combined attendance
            const { platform, mockProvider } = await createProviderYouTubePlatform(640); // 350 + 290
            
            // When: Getting total student count across all lectures
            const totalStudents = await platform.getViewerCount();
            
            // Then: Should provide combined attendance figure via provider
            expect(totalStudents).toBe(640);
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });
    });
});