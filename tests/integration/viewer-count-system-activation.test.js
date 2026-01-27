const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { TEST_TIMEOUTS } = require('../helpers/test-setup');
const {
    noOpLogger,
    createConfigFixture,
    createMockOBSConnection,
    createMockTwitchPlatform,
    createMockYouTubePlatform,
    createMockTikTokPlatform,
    createMockDisplayQueue
} = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { createAppRuntimeTestDependencies } = require('../helpers/runtime-test-harness');
const testClock = require('../helpers/test-clock');
const { safeDelay } = require('../../src/utils/timeout-validator');

const createMockPlatformLifecycleService = () => ({
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
});

const createMockGoalsManager = () => ({
    initializeGoalDisplay: createMockFn().mockResolvedValue(),
    processDonationGoal: createMockFn()
});

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

describe('ViewerCount System Activation Integration', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let AppRuntime;
    let ViewerCountSystem;
    let configFixture;
    let mockOBSManager;
    let mockYouTubePlatform;
    let mockTwitchPlatform;
    let mockTikTokPlatform;
    let mockDisplayQueue;
    let mockPlatformLifecycleService;
    let mockGoalsManager;
    let buildAppRuntimeDependencies;
    let testConfig;

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

        configFixture = createConfigFixture({
            general: {
                debug: true,
                viewerCountPollingInterval: 60,
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

        mockOBSManager = createMockOBSConnection();
        mockOBSManager.isConnected.mockReturnValue(true);

        mockGoalsManager = createMockGoalsManager();
        testConfig = createConfigFixture();

        mockYouTubePlatform = createMockYouTubePlatform();
        mockYouTubePlatform.getViewerCount = createMockFn().mockResolvedValue(150);

        mockTwitchPlatform = createMockTwitchPlatform();
        mockTwitchPlatform.getViewerCount = createMockFn().mockResolvedValue(75);

        mockTikTokPlatform = createMockTikTokPlatform();
        mockTikTokPlatform.getViewerCount = createMockFn().mockResolvedValue(200);

        mockDisplayQueue = createMockDisplayQueue();

        mockPlatformLifecycleService = createMockPlatformLifecycleService();
        registerMockPlatforms();

        buildAppRuntimeDependencies = (overrides = {}) => {
            const logger = noOpLogger;
            return createAppRuntimeTestDependencies({
                configSnapshot: configFixture,
                displayQueue: mockDisplayQueue,
                logger,
                config: testConfig,
                overrides: {
                    obs: {
                        connectionManager: mockOBSManager,
                        goalsManager: mockGoalsManager
                    },
                    platformLifecycleService: mockPlatformLifecycleService,
                    logging: logger,
                    ...overrides
                }
            }).dependencies;
        };

        ViewerCountSystem = require('../../src/utils/viewer-count').ViewerCountSystem;
        AppRuntime = require('../../src/main').AppRuntime;
    });

    describe('when system starts with YouTube enabled and live', () => {
        test('should activate ViewerCount polling system', async () => {
            const app = new AppRuntime(configFixture, buildAppRuntimeDependencies());

            app.viewerCountSystem = new ViewerCountSystem({
                platformProvider: () => app.getPlatforms(),
                logger: noOpLogger,
                config: testConfig
            });

            app.viewerCountSystem.updateStreamStatus('youtube', true);

            await app.viewerCountSystem.initialize();
            await app.viewerCountSystem.startPolling();

            await safeDelay(100);

            expect(app.viewerCountSystem.isPolling).toBe(true);
            expect(app.viewerCountSystem.isStreamLive('youtube')).toBe(true);

            expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();

            expect(app.viewerCountSystem.counts.youtube).toBe(150);
        }, TEST_TIMEOUTS.FAST);

        test('should poll viewer counts for all live platforms', async () => {
            const app = new AppRuntime(configFixture, buildAppRuntimeDependencies());

            app.viewerCountSystem = new ViewerCountSystem({
                platformProvider: () => app.getPlatforms(),
                logger: noOpLogger,
                config: testConfig
            });

            app.viewerCountSystem.updateStreamStatus('youtube', true);
            app.viewerCountSystem.updateStreamStatus('twitch', true);
            app.viewerCountSystem.updateStreamStatus('tiktok', true);

            await app.viewerCountSystem.initialize();
            await app.viewerCountSystem.startPolling();

            await safeDelay(100);

            expect(app.viewerCountSystem.isPolling).toBe(true);
            expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();
            expect(mockTwitchPlatform.getViewerCount).toHaveBeenCalled();
            expect(mockTikTokPlatform.getViewerCount).toHaveBeenCalled();

            expect(app.viewerCountSystem.counts.youtube).toBe(150);
            expect(app.viewerCountSystem.counts.twitch).toBe(75);
            expect(app.viewerCountSystem.counts.tiktok).toBe(200);
        }, TEST_TIMEOUTS.FAST);

        test('should not poll platforms that are offline', async () => {
            const app = new AppRuntime(configFixture, buildAppRuntimeDependencies());

            app.viewerCountSystem = new ViewerCountSystem({
                platformProvider: () => app.getPlatforms(),
                logger: noOpLogger,
                config: testConfig
            });

            app.viewerCountSystem.updateStreamStatus('youtube', true);
            app.viewerCountSystem.updateStreamStatus('twitch', false);
            app.viewerCountSystem.updateStreamStatus('tiktok', false);

            await app.viewerCountSystem.initialize();
            await app.viewerCountSystem.startPolling();

            await safeDelay(100);

            expect(app.viewerCountSystem.isPolling).toBe(true);
            expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();
            expect(mockTwitchPlatform.getViewerCount).not.toHaveBeenCalled();
            expect(mockTikTokPlatform.getViewerCount).not.toHaveBeenCalled();

            expect(app.viewerCountSystem.counts.youtube).toBe(150);
            expect(app.viewerCountSystem.counts.twitch).toBe(0);
            expect(app.viewerCountSystem.counts.tiktok).toBe(0);
        }, TEST_TIMEOUTS.FAST);
    });

    describe('when ViewerCount system activation is driven by app.start()', () => {
        test('should demonstrate the integration flow that should work', async () => {
            const app = new AppRuntime(configFixture, buildAppRuntimeDependencies());

            app.viewerCountSystem = new ViewerCountSystem({
                platformProvider: () => app.getPlatforms(),
                logger: noOpLogger,
                config: testConfig
            });

            app.initializePlatforms = createMockFn().mockResolvedValue();

            app.viewerCountSystem.updateStreamStatus('youtube', true);

            await app.viewerCountSystem.initialize();

            await app.start();

            await safeDelay(100);

            expect(app.viewerCountSystem.isPolling).toBe(true);
            expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();
        }, TEST_TIMEOUTS.SLOW);
    });

    describe('when stream status changes after startup', () => {
        test('should start polling when stream goes live', async () => {
            const app = new AppRuntime(configFixture, buildAppRuntimeDependencies());

            app.viewerCountSystem = new ViewerCountSystem({
                platformProvider: () => app.getPlatforms(),
                logger: noOpLogger,
                config: testConfig
            });

            app.viewerCountSystem.updateStreamStatus('youtube', false);
            app.viewerCountSystem.updateStreamStatus('twitch', false);
            app.viewerCountSystem.updateStreamStatus('tiktok', false);

            await app.viewerCountSystem.initialize();
            await app.viewerCountSystem.startPolling();

            app.viewerCountSystem.updateStreamStatus('youtube', true);

            await safeDelay(100);

            expect(app.viewerCountSystem.isPolling).toBe(true);
            expect(app.viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('should stop polling when stream goes offline', async () => {
            const app = new AppRuntime(configFixture, buildAppRuntimeDependencies());

            app.viewerCountSystem = new ViewerCountSystem({
                platformProvider: () => app.getPlatforms(),
                logger: noOpLogger,
                config: testConfig
            });

            app.viewerCountSystem.updateStreamStatus('youtube', true);
            await app.viewerCountSystem.initialize();
            await app.viewerCountSystem.startPolling();

            mockYouTubePlatform.getViewerCount.mockClear();

            app.viewerCountSystem.updateStreamStatus('youtube', false);

            await safeDelay(100);

            expect(app.viewerCountSystem.isStreamLive('youtube')).toBe(false);
            expect(app.viewerCountSystem.counts.youtube).toBe(0);
        }, TEST_TIMEOUTS.FAST);
    });
});
