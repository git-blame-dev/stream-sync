const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { AppRuntime } = require('../../src/main');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');
const { createConfigFixture } = require('../helpers/config-fixture');

describe('Platform Initialization Delegation', () => {
    let runtime;
    let mockConfig;
    let mockDependencies;
    let originalExit;

    beforeEach(() => {
        originalExit = process.exit;
        process.exit = createMockFn();

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
                channel: 'test_channel',
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret'
            },
            youtube: { enabled: false },
            tiktok: { enabled: false },
            obs: { enabled: false }
        };

        const platformLifecycleService = new PlatformLifecycleService({
            config: mockConfig,
            eventBus: null,
            streamDetector: null,
            dependencyFactory: null,
            logger: noOpLogger
        });

        mockDependencies = {
            logging: noOpLogger,
            displayQueue: { addItem: createMockFn() },
            eventBus: { subscribe: createMockFn(), emit: createMockFn(), unsubscribe: createMockFn() },
            configService: { get: createMockFn().mockReturnValue(mockConfig.general) },
            config: createConfigFixture(),
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
        process.exit = originalExit;
        restoreAllMocks();
    });

    describe('Service-Based Platform Management', () => {
        it('should delegate platform initialization to PlatformLifecycleService', async () => {
            runtime = new AppRuntime(mockConfig, mockDependencies);

            expect(runtime.platforms).toBeDefined();
            expect(runtime.platformLifecycleService).toBeDefined();
            expect(runtime.platformLifecycleService.getAllPlatforms).toBeDefined();
            expect(runtime.platforms).toEqual(runtime.platformLifecycleService.getAllPlatforms());
        });

        it('should wire StreamDetector into PlatformLifecycleService', () => {
            runtime = new AppRuntime(mockConfig, mockDependencies);

            expect(runtime.platformLifecycleService.streamDetector).toBeDefined();
            expect(runtime.platformLifecycleService.streamDetector).toBe(runtime.streamDetector);
        });

        it('should delegate platform access through service methods', async () => {
            runtime = new AppRuntime(mockConfig, mockDependencies);

            expect(runtime.platformLifecycleService.getPlatform).toBeDefined();
            expect(runtime.platformLifecycleService.isPlatformAvailable).toBeDefined();
            expect(typeof runtime.platformLifecycleService.getPlatform).toBe('function');
        });

        it('should track connection times in service, not AppRuntime', async () => {
            runtime = new AppRuntime(mockConfig, mockDependencies);

            expect(runtime.platformConnectionTimes).toBeUndefined();
            expect(runtime.platformLifecycleService.getPlatformConnectionTime).toBeDefined();
            expect(typeof runtime.platformLifecycleService.getPlatformConnectionTime).toBe('function');
        });
    });

    describe('Event Handler Integration', () => {
        it('should maintain AppRuntime handler methods for platform events', async () => {
            runtime = new AppRuntime(mockConfig, mockDependencies);

            expect(runtime.handleChatMessage).toBeDefined();
            expect(runtime.updateViewerCount).toBeDefined();
            expect(runtime.handleGiftNotification).toBeDefined();
            expect(runtime.handlePaypiggyNotification).toBeDefined();
            expect(runtime.handleFollowNotification).toBeDefined();
        });
    });

    describe('Platform Lifecycle Coordination', () => {
        it('should not contain duplicate platform initialization logic', async () => {
            runtime = new AppRuntime(mockConfig, mockDependencies);

            expect(runtime.initializePlatformWithStreamDetection).toBeUndefined();
            expect(runtime.shouldRunPlatformInBackground).toBeUndefined();
            expect(runtime.initializePlatformAsync).toBeUndefined();
        });

        it('should delegate platform disconnection to service', async () => {
            runtime = new AppRuntime(mockConfig, mockDependencies);
            await runtime.initializePlatforms();

            await runtime.shutdown();

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
