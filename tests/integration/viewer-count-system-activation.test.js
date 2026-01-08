
jest.mock('../../src/obs/connection', () => ({
    initializeOBSConnection: jest.fn().mockResolvedValue(),
    getOBSConnectionManager: jest.fn()
}));

jest.mock('../../src/obs/startup', () => ({
    clearStartupDisplays: jest.fn().mockResolvedValue()
}));

jest.mock('../../src/core/logging', () => {
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    };
    return {
        logger,
        getLogger: jest.fn(() => logger),
        getUnifiedLogger: jest.fn(() => logger),
        initializeLoggingConfig: jest.fn(),
        initializeConsoleOverride: jest.fn(),
        setConfigValidator: jest.fn(),
        setDebugMode: jest.fn()
    };
});

jest.mock('../../src/obs/goals', () => {
    const goalsManager = {
        initializeGoalDisplay: jest.fn().mockResolvedValue(),
        processDonationGoal: jest.fn()
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

const createMockPlatformLifecycleService = () => {
    const service = {
        platforms: {},
        initializeAllPlatforms: jest.fn().mockResolvedValue({}),
        getAllPlatforms: jest.fn(() => ({})),
        getPlatforms: jest.fn(() => ({})),
        getPlatform: jest.fn(() => null),
        isPlatformAvailable: jest.fn(() => false),
        getPlatformConnectionTime: jest.fn(() => Date.now()),
        recordPlatformConnection: jest.fn(),
        disconnectAll: jest.fn().mockResolvedValue(),
        waitForBackgroundInits: jest.fn().mockResolvedValue()
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
        // Reset modules to get fresh instances
        jest.resetModules();
        
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
        mockYouTubePlatform.getViewerCount = jest.fn().mockResolvedValue(150);
        
        mockTwitchPlatform = createMockTwitchPlatform();
        mockTwitchPlatform.getViewerCount = jest.fn().mockResolvedValue(75);
        
        mockTikTokPlatform = createMockTikTokPlatform();
        mockTikTokPlatform.getViewerCount = jest.fn().mockResolvedValue(200);
        
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
        it('should activate ViewerCount polling system', async () => {
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
        
        it('should poll viewer counts for all live platforms', async () => {
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
        
        it('should not poll platforms that are offline', async () => {
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
        it('should demonstrate the integration flow that should work', async () => {
            const app = new AppRuntime(mockConfig, buildAppRuntimeDependencies());
            
            app.viewerCountSystem = new ViewerCountSystem(app);

            // Skip heavy platform initialization for this integration-style test
            app.initializePlatforms = jest.fn().mockResolvedValue();
            
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
        it('should start polling when stream goes live', async () => {
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
        
        it('should stop polling when stream goes offline', async () => {
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
