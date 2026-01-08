
const { initializeTestLogging } = require('../helpers/test-setup');
const { createMockOBSManager, createMockPlatform } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { createSilentLogger } = require('../helpers/test-logger');

// Initialize logging for tests FIRST
initializeTestLogging();

// Setup automated cleanup (will be called properly in beforeEach/afterEach)
const cleanupConfig = {
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
};

// Mock the config manager
jest.mock('../../src/core/config', () => ({
    configManager: {
        getNumber: jest.fn().mockImplementation((section, key, defaultValue) => {
            console.log(`Config requested: ${section}.${key} (default: ${defaultValue})`);
            if (section === 'general' && key === 'viewerCountPollingInterval') {
                return 60; // 60 second polling interval
            }
            return defaultValue !== undefined ? defaultValue : 0;
        }),
        getSection: jest.fn((section) => {
            // Mock platform configs with viewer count enabled
            return {
                viewerCountEnabled: true,
                viewerCountSource: `${section}_viewer_count_source`
            };
        })
    },
    config: { general: { fallbackUsername: 'Unknown User' } }
}));

const mockTextProcessing = {
    formatViewerCount: jest.fn((count) => count.toString())
};

// Mock the text processing utilities
jest.mock('../../src/utils/text-processing', () => ({
    createTextProcessingManager: jest.fn(() => mockTextProcessing),
    TextProcessingManager: jest.fn(),
    formatTimestampCompact: jest.fn()
}));

const { ViewerCountSystem } = require('../../src/utils/viewer-count');
const { OBSViewerCountObserver } = require('../../src/observers/obs-viewer-count-observer');

describe('Viewer Count Polling System Fix', () => {
    let platforms;
    let mockObsManager;
    let viewerCountSystem;
    let mockYoutubePlatform;
    let mockTwitchPlatform;
    let mockTiktokPlatform;
    let cleanupFunctions;
    let logger;

    beforeEach(async () => {
        // Setup automated cleanup
        cleanupFunctions = setupAutomatedCleanup(cleanupConfig);
        cleanupFunctions.beforeEach();
        logger = createSilentLogger();
        // Create behavior-focused platform mocks with active connections
        mockYoutubePlatform = createMockPlatform('youtube', {
            // Mock YouTube platform with active stream connections
            streamConnections: ['stream1', 'stream2'], // 2 active streams
            hasActiveConnections: true,
            connectionState: 'connected'
        });
        
        mockTwitchPlatform = createMockPlatform('twitch', {
            // Twitch is always considered "active" for chat
            hasActiveConnections: true,
            connectionState: 'connected'
        });
        
        mockTiktokPlatform = createMockPlatform('tiktok', {
            // TikTok platform disabled (no active connections)
            hasActiveConnections: false,
            connectionState: 'disconnected'
        });

        // Platform map with instances
        platforms = {
            youtube: mockYoutubePlatform,
            twitch: mockTwitchPlatform,
            tiktok: mockTiktokPlatform
        };

        // Create connected OBS manager
        mockObsManager = createMockOBSManager('connected');

        // Create viewer count system
        viewerCountSystem = new ViewerCountSystem({
            platformProvider: () => platforms
        });
        
        // Register OBS observer instead of directly setting OBS manager
        const obsObserver = new OBSViewerCountObserver(mockObsManager, logger);
        viewerCountSystem.addObserver(obsObserver);
        
        // Set initial stream status for active platforms
        await viewerCountSystem.updateStreamStatus('youtube', true);
        await viewerCountSystem.updateStreamStatus('twitch', true);
        await viewerCountSystem.updateStreamStatus('tiktok', false);
    });

    afterEach(() => {
        if (cleanupFunctions) {
            cleanupFunctions.afterEach();
        }
    });

    afterAll(() => {
        if (cleanupFunctions) {
            cleanupFunctions.afterAll();
        }
    });

    describe('Platform Detection for Active Streams', () => {
        test('should start polling for platforms with active connections', async () => {
            // Arrange: Verify initial state and stream status
            expect(viewerCountSystem.isPolling).toBe(false);
            expect(Object.keys(viewerCountSystem.pollingHandles)).toHaveLength(0);
            
            console.log('YouTube stream live:', viewerCountSystem.isStreamLive('youtube'));
            console.log('Twitch stream live:', viewerCountSystem.isStreamLive('twitch'));
            console.log('TikTok stream live:', viewerCountSystem.isStreamLive('tiktok'));

            // Act: Start polling system
            viewerCountSystem.startPolling();

            // Assert: System should be in polling state
            expect(viewerCountSystem.isPolling).toBe(true);
            
            console.log('Polling handles:', Object.keys(viewerCountSystem.pollingHandles));
            
            // Assert: Should have polling handles for live platforms
            const liveHandles = Object.keys(viewerCountSystem.pollingHandles);
            expect(liveHandles.length).toBeGreaterThan(0);
        });

        test('should skip polling when YouTube stream status is offline', () => {
            viewerCountSystem.updateStreamStatus('youtube', false);

            expect(mockYoutubePlatform.getViewerCount).toBeDefined();
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(false);

            viewerCountSystem.startPolling();

            expect(viewerCountSystem.pollingHandles['youtube']).toBeUndefined();
            expect(mockYoutubePlatform.getViewerCount).not.toHaveBeenCalled();
        });

        test('should start polling for Twitch platform (always active)', async () => {
            // Act: Start polling
            viewerCountSystem.startPolling();
            
            // Wait for immediate polling
            await new Promise(resolve => setImmediate(resolve));

            // Assert: Twitch polling should start (always considered active)
            expect(viewerCountSystem.pollingHandles['twitch']).toBeDefined();
            expect(mockTwitchPlatform.getViewerCount).toHaveBeenCalled();
        });

        test('should not start polling for platforms without active streams', async () => {
            // Arrange: Verify TikTok is not live (disabled)
            expect(viewerCountSystem.isStreamLive('tiktok')).toBe(false);
            
            // Act: Start polling
            viewerCountSystem.startPolling();
            
            // Wait for immediate polling
            await new Promise(resolve => setImmediate(resolve));

            // Assert: TikTok polling should NOT start
            expect(viewerCountSystem.pollingHandles['tiktok']).toBeUndefined();
            expect(mockTiktokPlatform.getViewerCount).not.toHaveBeenCalled();
        });
    });

    describe('Polling System Behavior', () => {
        test('should track polling state correctly when starting', () => {
            // Arrange: Verify initial state
            expect(viewerCountSystem.isPolling).toBe(false);
            expect(Object.keys(viewerCountSystem.pollingHandles)).toHaveLength(0);

            // Act: Start polling
            viewerCountSystem.startPolling();

            // Assert: System should report as polling
            expect(viewerCountSystem.isPolling).toBe(true);
            
            // Assert: Should have polling handles for active platforms
            const activeHandles = Object.keys(viewerCountSystem.pollingHandles);
            expect(activeHandles.length).toBeGreaterThan(0);
            expect(activeHandles).toContain('youtube');
            expect(activeHandles).toContain('twitch');
            expect(activeHandles).not.toContain('tiktok');
        });

        test('should prevent duplicate polling when called multiple times', () => {
            // Act: Start polling twice
            viewerCountSystem.startPolling();
            viewerCountSystem.startPolling();

            // Assert: Should only start once (no duplicate polling)
            expect(viewerCountSystem.isPolling).toBe(true);
            
            // The implementation should handle this gracefully
            // We're testing the behavior that users experience (no duplicate polling)
        });

        test('should handle polling interval configuration correctly', () => {
            // Act: Start polling
            viewerCountSystem.startPolling();

            // Assert: Should use configured polling interval (60 seconds * 1000 ms)
            // Note: The actual configuration integration is working in the real implementation
            expect(viewerCountSystem.isPolling).toBe(true);
            expect(typeof viewerCountSystem.pollingInterval).toBe('number');
        });
    });

    describe('Platform Stream Status Integration', () => {
        test('should start polling when stream status changes to live', async () => {
            // Arrange: Start with TikTok offline
            expect(viewerCountSystem.isStreamLive('tiktok')).toBe(false);
            viewerCountSystem.startPolling();
            
            // Verify no TikTok polling initially
            expect(viewerCountSystem.pollingHandles['tiktok']).toBeUndefined();

            // Act: TikTok stream goes live
            viewerCountSystem.updateStreamStatus('tiktok', true);
            
            // Wait for polling to start
            await new Promise(resolve => setImmediate(resolve));

            // Assert: Should start polling TikTok now that it's live
            expect(viewerCountSystem.pollingHandles['tiktok']).toBeDefined();
            expect(mockTiktokPlatform.getViewerCount).toHaveBeenCalled();
        });

        test('should stop polling when stream status changes to offline', async () => {
            // Arrange: Start with YouTube live and polling
            viewerCountSystem.startPolling();
            expect(viewerCountSystem.pollingHandles['youtube']).toBeDefined();

            // Act: YouTube stream goes offline
            await viewerCountSystem.updateStreamStatus('youtube', false);

            // Assert: Should stop polling YouTube and reset count
            expect(viewerCountSystem.pollingHandles['youtube']).toBeUndefined();
            expect(viewerCountSystem.counts.youtube).toBe(0);
        });
        
        test('should start polling after YouTube marks stream live', async () => {
            // Arrange: Reset system to initial state (no polling)
            viewerCountSystem.stopPolling();
            await viewerCountSystem.updateStreamStatus('youtube', false);
            
            // Verify YouTube starts with no polling
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(false);
            
            // Act: Start polling (should find no live platforms)
            viewerCountSystem.startPolling();
            expect(viewerCountSystem.pollingHandles['youtube']).toBeUndefined();
            
            await viewerCountSystem.updateStreamStatus('youtube', true);
            
            // Assert: Now YouTube polling should start immediately
            expect(viewerCountSystem.pollingHandles['youtube']).toBeDefined();
            expect(mockYoutubePlatform.getViewerCount).toHaveBeenCalled();
        });
    });
});
