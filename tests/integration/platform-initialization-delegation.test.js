
const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

mockModule('../../src/core/logging', () => ({
    setConfigValidator: createMockFn(),
    setDebugMode: createMockFn(),
    initializeLoggingConfig: createMockFn(),
    initializeConsoleOverride: createMockFn(),
    logger: {
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn(),
        debug: createMockFn()
    },
    getLogger: createMockFn(() => ({
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn(),
        debug: createMockFn()
    }))
}));

const { AppRuntime } = require('../../src/main');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');
const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');

describe('Platform Initialization Delegation', () => {
    let runtime;
    let mockConfig;
    let mockDependencies;
    let originalExit;

    beforeEach(() => {
        // Mock process.exit to prevent tests from terminating
        originalExit = process.exit;
        process.exit = createMockFn();

        // Create minimal config for testing
        mockConfig = {
            general: {
                debugEnabled: false,
                commandPrefix: '!',
                ttsEnabled: false,
                streamDetectionEnabled: false,
                streamRetryInterval: 15,
                streamMaxRetries: 3,
                continuousMonitoringInterval: 60000
            },
            twitch: {
                enabled: true,
                username: 'test_channel',
                apiKey: 'test_oauth_token'
            },
            youtube: { enabled: false },
            tiktok: { enabled: false },
            obs: { enabled: false }
        };

        // Create a real PlatformLifecycleService for testing delegation
        const mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

        const platformLifecycleService = new PlatformLifecycleService({
            config: mockConfig,
            eventBus: null,
            streamDetector: null,
            dependencyFactory: null,
            logger: mockLogger
        });

        // Create mock dependencies to avoid initialization errors
        mockDependencies = {
            logging: mockLogger,
            displayQueue: { addItem: createMockFn() },
            eventBus: { subscribe: createMockFn(), emit: createMockFn(), unsubscribe: createMockFn() },
            configService: { get: createMockFn().mockReturnValue(mockConfig.general) },
            runtimeConstants: createRuntimeConstantsFixture(),
            vfxCommandService: { executeCommandForKey: createMockFn().mockResolvedValue({ success: true }) },
            ttsService: { speak: createMockFn().mockResolvedValue({ success: true }) },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) },
            obsEventService: {},
            sceneManagementService: {},
            commandCooldownService: {
                checkCooldown: createMockFn(() => ({ allowed: true })),
                recordCommand: createMockFn()
            },
            notificationManager: {
                handleNotification: createMockFn()
            },
            platformLifecycleService: platformLifecycleService
        };
    });

    afterEach(async () => {
        if (runtime && runtime.shutdown) {
            await runtime.shutdown();
        }

        // Restore process.exit AFTER shutdown
        process.exit = originalExit;
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    describe('Service-Based Platform Management', () => {
        it('should delegate platform initialization to PlatformLifecycleService', async () => {
            // Given: AppRuntime with platform lifecycle service
            runtime = new AppRuntime(mockConfig, mockDependencies);

            // Then: AppRuntime should delegate platform access to service
            expect(runtime.platforms).toBeDefined(); // Getter provides backwards compatibility
            expect(runtime.platformLifecycleService).toBeDefined();
            expect(runtime.platformLifecycleService.getAllPlatforms).toBeDefined();

            // Platforms should come from the service
            expect(runtime.platforms).toEqual(runtime.platformLifecycleService.getAllPlatforms());
        });

        it('should wire StreamDetector into PlatformLifecycleService', () => {
            runtime = new AppRuntime(mockConfig, mockDependencies);

            expect(runtime.platformLifecycleService.streamDetector).toBeDefined();
            expect(runtime.platformLifecycleService.streamDetector).toBe(runtime.streamDetector);
        });

        it('should delegate platform access through service methods', async () => {
            // Given: AppRuntime with platform lifecycle service
            runtime = new AppRuntime(mockConfig, mockDependencies);

            // Then: Platform access should go through service
            expect(runtime.platformLifecycleService.getPlatform).toBeDefined();
            expect(runtime.platformLifecycleService.isPlatformAvailable).toBeDefined();
            expect(typeof runtime.platformLifecycleService.getPlatform).toBe('function');
        });

        it('should track connection times in service, not AppRuntime', async () => {
            // Given: AppRuntime instance
            runtime = new AppRuntime(mockConfig, mockDependencies);

            // Then: Connection time tracking should be in service
            expect(runtime.platformConnectionTimes).toBeUndefined();
            expect(runtime.platformLifecycleService.getPlatformConnectionTime).toBeDefined();
            expect(typeof runtime.platformLifecycleService.getPlatformConnectionTime).toBe('function');
        });
    });

    describe('Event Handler Integration', () => {
        it('should maintain AppRuntime handler methods for platform events', async () => {
            // Given: AppRuntime instance
            runtime = new AppRuntime(mockConfig, mockDependencies);

            // Then: AppRuntime should still have all handler methods that platforms need
            expect(runtime.handleChatMessage).toBeDefined();
            expect(runtime.updateViewerCount).toBeDefined();
            expect(runtime.handleGiftNotification).toBeDefined();
            expect(runtime.handlePaypiggyNotification).toBeDefined();
            expect(runtime.handleFollowNotification).toBeDefined();
        });
    });

    describe('Platform Lifecycle Coordination', () => {
        it('should not contain duplicate platform initialization logic', async () => {
            // Given: AppRuntime instance
            runtime = new AppRuntime(mockConfig, mockDependencies);

            // Then: AppRuntime should NOT have methods that duplicate service functionality
            expect(runtime.initializePlatformWithStreamDetection).toBeUndefined();
            expect(runtime.shouldRunPlatformInBackground).toBeUndefined();
            expect(runtime.initializePlatformAsync).toBeUndefined();
        });

        it('should delegate platform disconnection to service', async () => {
            // Given: AppRuntime with initialized platforms
            runtime = new AppRuntime(mockConfig, mockDependencies);
            await runtime.initializePlatforms();

            // When: AppRuntime shuts down
            await runtime.shutdown();

            // Then: Service should have handled disconnection
            expect(runtime.platformLifecycleService.isPlatformAvailable('twitch')).toBe(false);
        });
    });

    describe('Background Initialization Coordination', () => {
        it('should delegate background platform initialization to service', async () => {
            mockConfig.tiktok = {
                enabled: true,
                username: '@test_user'
            };
            mockConfig.twitch.enabled = false;
            runtime = new AppRuntime(mockConfig, mockDependencies);
            await runtime.initializePlatforms();
            expect(runtime.backgroundPlatformInits).toBeUndefined();
            expect(runtime.platformLifecycleService.backgroundPlatformInits).toBeDefined();
        });

        it('tracks platform health during background initialization', async () => {
            mockConfig.tiktok = {
                enabled: true,
                username: '@test_user'
            };
            mockConfig.twitch.enabled = false;

            const platformLifecycleService = new PlatformLifecycleService({
                config: mockConfig,
                eventBus: null,
                streamDetector: null,
                dependencyFactory: null,
                logger: mockDependencies.logging
            });

            const deps = {
                ...mockDependencies,
                platformLifecycleService
            };

            runtime = new AppRuntime(mockConfig, deps);
            await runtime.initializePlatforms();

            const status = platformLifecycleService.getStatus();
            expect(status.platformHealth.tiktok).toBeDefined();
            expect(status.platformHealth.tiktok.state).toBeDefined();
        });
    });
});
