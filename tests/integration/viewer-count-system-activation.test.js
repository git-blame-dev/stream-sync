const { describe, test, beforeEach, afterEach, expect } = require('bun:test');

const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks, resetModules } = require('../helpers/bun-module-mocks');

mockModule('../../src/obs/connection', () => ({
    initializeOBSConnection: createMockFn().mockResolvedValue(),
    getOBSConnectionManager: createMockFn()
}));

mockModule('../../src/obs/startup', () => ({
    clearStartupDisplays: createMockFn().mockResolvedValue()
}));

mockModule('../../src/core/logging', () => {
    const logger = {
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn()
    };
    return {
        logger,
        getLogger: createMockFn(() => logger),
        getUnifiedLogger: createMockFn(() => logger),
        initializeLoggingConfig: createMockFn(),
        initializeConsoleOverride: createMockFn(),
        setConfigValidator: createMockFn(),
        setDebugMode: createMockFn()
    };
});

mockModule('../../src/obs/goals', () => {
    const goalsManager = {
        initializeGoalDisplay: createMockFn().mockResolvedValue(),
        processDonationGoal: createMockFn()
    };
    return {
        OBSGoalsManager: class {},
        createOBSGoalsManager: () => goalsManager,
        getDefaultGoalsManager: () => goalsManager
    };
});

// MANDATORY imports
const { 
    initializeTestLogging,
    createTestUser, 
    TEST_TIMEOUTS 
} = require('../helpers/test-setup');

const { 
    createMockNotificationDispatcher,
    createMockLogger,
    createMockConfig,
    createMockOBSConnection,
    createMockTwitchPlatform,
    createMockYouTubePlatform,
    createMockTikTokPlatform,
    createMockDisplayQueue
} = require('../helpers/mock-factories');

const { 
    setupAutomatedCleanup
} = require('../helpers/mock-lifecycle');
const { createAppRuntimeTestDependencies } = require('../helpers/runtime-test-harness');
const testClock = require('../helpers/test-clock');

const createMockPlatformLifecycleService = () => {
    const service = {
        platforms: {},
        initializeAllPlatforms: createMockFn().mockResolvedValue({}),
        getAllPlatforms: createMockFn(() => ({})),
        getPlatforms: createMockFn(() => ({})),
        getPlatform: createMockFn(() => null),
        isPlatformAvailable: createMockFn(() => false),
        getPlatformConnectionTime: createMockFn(() => testClock.now()),
        recordPlatformConnection: createMockFn(),
        disconnectAll: createMockFn().mockResolvedValue(),
        waitForBackgroundInits: createMockFn().mockResolvedValue()
    };
    return service;
};

// Initialize FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

describe('ViewerCount System Activation Integration', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let AppRuntime;
    let ViewerCountSystem;
    let mockConfig;
    let mockOBSManager;
    let mockYouTubePlatform;
    let mockTwitchPlatform;
    let mockTikTokPlatform;
    let mockDisplayQueue;
    let mockPlatformLifecycleService;
    let buildAppRuntimeDependencies;
    const registerMockPlatforms = () => {
        const platforms = {
            youtube: mockYouTubePlatform,
            twitch: mockTwitchPlatform,
            tiktok: mockTikTokPlatform
        };

        mockPlatformLifecycleService.platforms = platforms;
        mockPlatformLifecycleService.getAllPlatforms.mockImplementation(() => ({ ...platforms }));
        mockPlatformLifecycleService.getPlatforms.mockImplementation(() => ({ ...platforms }));
        mockPlatformLifecycleService.getPlatform.mockImplementation((platform) => platforms[platform] || null);
        mockPlatformLifecycleService.isPlatformAvailable.mockImplementation((platform) => Boolean(platforms[platform]));

        return platforms;
    };
    
    beforeEach(() => {
        testClock.reset();
        // Reset modules to get fresh instances
        resetModules();
        
        // Create mock config with YouTube enabled
        mockConfig = createMockConfig({
            general: { 
                debug: true, 
                viewerCountPollingInterval: 60, // 60 seconds
                streamDetectionEnabled: false,
                streamRetryInterval: 15,
                streamMaxRetries: 3,
                continuousMonitoringInterval: 60000
            },
            youtube: { 
                enabled: true, 
                apiKey: 'test-youtube-key',
                viewerCountEnabled: true,
                viewerCountSource: 'youtube-viewer-count'
            },
            twitch: { 
                enabled: true, 
                apiKey: 'test-twitch-key',
                viewerCountEnabled: true,
                viewerCountSource: 'twitch-viewer-count'
            },
            tiktok: { 
                enabled: true, 
                apiKey: 'test-tiktok-key',
                viewerCountEnabled: true,
                viewerCountSource: 'tiktok-viewer-count'
            },
            obs: { enabled: true }
        });
        
        // Create mock OBS manager
        mockOBSManager = createMockOBSConnection();
        mockOBSManager.isConnected.mockReturnValue(true);
        
        // Create mock platforms with getViewerCount functionality
        mockYouTubePlatform = createMockYouTubePlatform();
        mockYouTubePlatform.getViewerCount = createMockFn().mockResolvedValue(150);

        mockTwitchPlatform = createMockTwitchPlatform();
        mockTwitchPlatform.getViewerCount = createMockFn().mockResolvedValue(75);

        mockTikTokPlatform = createMockTikTokPlatform();
        mockTikTokPlatform.getViewerCount = createMockFn().mockResolvedValue(200);
        
        // Create mock DisplayQueue
        mockDisplayQueue = createMockDisplayQueue();

        // Platform lifecycle service mock
        mockPlatformLifecycleService = createMockPlatformLifecycleService();
        registerMockPlatforms();

        buildAppRuntimeDependencies = (overrides = {}) => {
            const logger = createMockLogger();
            return createAppRuntimeTestDependencies({
                configSnapshot: mockConfig,
                displayQueue: mockDisplayQueue,
                logger,
                overrides: {
                    obs: { connectionManager: mockOBSManager },
                    platformLifecycleService: mockPlatformLifecycleService,
                    logging: logger,
                    ...overrides
                }
            }).dependencies;
        };
        
        // Configure OBS connection mocks to use our mock manager
        const obsConnectionModule = require('../../src/obs/connection');
        obsConnectionModule.initializeOBSConnection.mockReset();
        obsConnectionModule.getOBSConnectionManager.mockReset();
        obsConnectionModule.initializeOBSConnection.mockResolvedValue();
        obsConnectionModule.getOBSConnectionManager.mockReturnValue(mockOBSManager);
        
        // Mock the ViewerCountSystem
        ViewerCountSystem = require('../../src/utils/viewer-count').ViewerCountSystem;
        AppRuntime = require('../../src/main').AppRuntime;
    });

    describe('when system starts with YouTube enabled and live', () => {
        test('should activate ViewerCount polling system', async () => {
            // Arrange
            const app = new AppRuntime(mockConfig, buildAppRuntimeDependencies());
            
            // Setup viewer count system with mocked dependencies
            app.viewerCountSystem = new ViewerCountSystem(app);
            
            // Simulate YouTube stream being live (this is what should trigger polling)
            app.viewerCountSystem.updateStreamStatus('youtube', true);
            
            // Act
            await app.viewerCountSystem.initialize();
            await app.viewerCountSystem.startPolling();
            
            // Allow polling to execute at least once
            await waitForDelay(100);
            
            // Assert - ViewerCount system should be actively polling
            expect(app.viewerCountSystem.isPolling).toBe(true);
            expect(app.viewerCountSystem.isStreamLive('youtube')).toBe(true);
            
            // Should have started polling for live platforms
            expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();
            
            // Viewer count should be updated in the system
            expect(app.viewerCountSystem.counts.youtube).toBe(150);
        }, TEST_TIMEOUTS.FAST);
        
        test('should poll viewer counts for all live platforms', async () => {
            // Arrange
            const app = new AppRuntime(mockConfig, buildAppRuntimeDependencies());
            
            app.viewerCountSystem = new ViewerCountSystem(app);
            
            // Simulate multiple platforms being live
            app.viewerCountSystem.updateStreamStatus('youtube', true);
            app.viewerCountSystem.updateStreamStatus('twitch', true);
            app.viewerCountSystem.updateStreamStatus('tiktok', true);
            
            // Act
            await app.viewerCountSystem.initialize();
            await app.viewerCountSystem.startPolling();
            
            // Allow polling to execute
            await waitForDelay(100);
            
            // Assert - All live platforms should be polled
            expect(app.viewerCountSystem.isPolling).toBe(true);
            expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();
            expect(mockTwitchPlatform.getViewerCount).toHaveBeenCalled();
            expect(mockTikTokPlatform.getViewerCount).toHaveBeenCalled();
            
            // All platforms should have updated viewer counts
            expect(app.viewerCountSystem.counts.youtube).toBe(150);
            expect(app.viewerCountSystem.counts.twitch).toBe(75);
            expect(app.viewerCountSystem.counts.tiktok).toBe(200);
        }, TEST_TIMEOUTS.FAST);
        
        test('should not poll platforms that are offline', async () => {
            // Arrange
            const app = new AppRuntime(mockConfig, buildAppRuntimeDependencies());
            
            app.viewerCountSystem = new ViewerCountSystem(app);
            
            // Only YouTube is live, others are offline
            app.viewerCountSystem.updateStreamStatus('youtube', true);
            app.viewerCountSystem.updateStreamStatus('twitch', false);
            app.viewerCountSystem.updateStreamStatus('tiktok', false);
            
            // Act
            await app.viewerCountSystem.initialize();
            await app.viewerCountSystem.startPolling();
            
            // Allow polling to execute
            await waitForDelay(100);
            
            // Assert - Only live platforms should be polled
            expect(app.viewerCountSystem.isPolling).toBe(true);
            expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();
            expect(mockTwitchPlatform.getViewerCount).not.toHaveBeenCalled();
            expect(mockTikTokPlatform.getViewerCount).not.toHaveBeenCalled();
            
            // Only YouTube should have updated viewer count
            expect(app.viewerCountSystem.counts.youtube).toBe(150);
            expect(app.viewerCountSystem.counts.twitch).toBe(0);
            expect(app.viewerCountSystem.counts.tiktok).toBe(0);
        }, TEST_TIMEOUTS.FAST);
    });
    
    describe('when ViewerCount system activation is driven by app.start()', () => {
        test('should demonstrate the integration flow that should work', async () => {
            const app = new AppRuntime(mockConfig, buildAppRuntimeDependencies());

            app.viewerCountSystem = new ViewerCountSystem(app);

            // Skip heavy platform initialization for this integration-style test
            app.initializePlatforms = createMockFn().mockResolvedValue();
            
            app.viewerCountSystem.updateStreamStatus('youtube', true);
            
            await app.viewerCountSystem.initialize();
            
            await app.start();
            
            // Allow polling to execute
            await waitForDelay(100);
            
            expect(app.viewerCountSystem.isPolling).toBe(true);
            expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();
        }, TEST_TIMEOUTS.SLOW);
    });
    
    describe('when stream status changes after startup', () => {
        test('should start polling when stream goes live', async () => {
            // Arrange
            const app = new AppRuntime(mockConfig, buildAppRuntimeDependencies());
            
            app.viewerCountSystem = new ViewerCountSystem(app);
            
            // Start with all streams offline
            app.viewerCountSystem.updateStreamStatus('youtube', false);
            app.viewerCountSystem.updateStreamStatus('twitch', false);
            app.viewerCountSystem.updateStreamStatus('tiktok', false);
            
            await app.viewerCountSystem.initialize();
            await app.viewerCountSystem.startPolling();
            
            // Act - YouTube stream goes live
            app.viewerCountSystem.updateStreamStatus('youtube', true);
            
            // Allow polling to execute
            await waitForDelay(100);
            
            // Assert - Should start polling the newly live platform
            expect(app.viewerCountSystem.isPolling).toBe(true);
            expect(app.viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);
        
        test('should stop polling when stream goes offline', async () => {
            // Arrange
            const app = new AppRuntime(mockConfig, buildAppRuntimeDependencies());
            
            app.viewerCountSystem = new ViewerCountSystem(app);
            
            // Start with YouTube live
            app.viewerCountSystem.updateStreamStatus('youtube', true);
            await app.viewerCountSystem.initialize();
            await app.viewerCountSystem.startPolling();
            
            // Clear previous calls
            mockYouTubePlatform.getViewerCount.mockClear();
            
            // Act - YouTube stream goes offline
            app.viewerCountSystem.updateStreamStatus('youtube', false);
            
            // Allow time for status update
            await waitForDelay(100);
            
            // Assert - Should reset count to 0 and stop polling for that platform
            expect(app.viewerCountSystem.isStreamLive('youtube')).toBe(false);
            expect(app.viewerCountSystem.counts.youtube).toBe(0);
        }, TEST_TIMEOUTS.FAST);
    });
});
