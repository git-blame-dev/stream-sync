const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { AppRuntime } = require('../../src/main');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');
const { createConfigFixture } = require('../helpers/config-fixture');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../src/core/secrets');

describe('Platform Initialization Delegation', () => {
    let runtime;
    let configFixture;
    let mockDependencies;
    let originalExit;

    beforeEach(() => {
        originalExit = process.exit;
        process.exit = createMockFn();

        _resetForTesting();
        secrets.twitch.clientSecret = 'test-client-secret';

        configFixture = {
            general: {
                debugEnabled: false,
                commandPrefix: '!',
                ttsEnabled: false
            },
            twitch: {
                enabled: true,
                username: 'test_channel',
                channel: 'test_channel',
                clientId: 'test-client-id'
            },
            youtube: { enabled: false },
            tiktok: { enabled: false },
            obs: { enabled: false }
        };

        const platformLifecycleService = new PlatformLifecycleService({
            config: configFixture,
            eventBus: null,
            dependencyFactory: null,
            logger: noOpLogger
        });

        mockDependencies = {
            logging: noOpLogger,
            displayQueue: { addItem: createMockFn() },
            eventBus: { subscribe: createMockFn(), emit: createMockFn(), unsubscribe: createMockFn() },
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
        _resetForTesting();
        initializeStaticSecrets();
    });

    describe('Service-Based Platform Management', () => {
        it('should delegate platform initialization to PlatformLifecycleService', async () => {
            runtime = new AppRuntime(configFixture, mockDependencies);

            expect(runtime.platforms).toBeDefined();
            expect(runtime.platformLifecycleService).toBeDefined();
            expect(runtime.platformLifecycleService.getAllPlatforms).toBeDefined();
            expect(runtime.platforms).toEqual(runtime.platformLifecycleService.getAllPlatforms());
        });

        it('does not require StreamDetector wiring for PlatformLifecycleService', () => {
            runtime = new AppRuntime(configFixture, mockDependencies);

            expect(runtime.streamDetector).toBeUndefined();
            expect(runtime.platformLifecycleService.streamDetector).toBeUndefined();
        });

        it('should delegate platform access through service methods', async () => {
            runtime = new AppRuntime(configFixture, mockDependencies);

            expect(runtime.platformLifecycleService.getPlatform).toBeDefined();
            expect(runtime.platformLifecycleService.isPlatformAvailable).toBeDefined();
            expect(typeof runtime.platformLifecycleService.getPlatform).toBe('function');
        });

        it('should track connection times in service, not AppRuntime', async () => {
            runtime = new AppRuntime(configFixture, mockDependencies);

            expect(runtime.platformConnectionTimes).toBeUndefined();
            expect(runtime.platformLifecycleService.getPlatformConnectionTime).toBeDefined();
            expect(typeof runtime.platformLifecycleService.getPlatformConnectionTime).toBe('function');
        });
    });

    describe('Event Handler Integration', () => {
        it('should maintain AppRuntime handler methods for platform events', async () => {
            runtime = new AppRuntime(configFixture, mockDependencies);

            expect(runtime.handleChatMessage).toBeDefined();
            expect(runtime.updateViewerCount).toBeDefined();
            expect(runtime.handleGiftNotification).toBeDefined();
            expect(runtime.handlePaypiggyNotification).toBeDefined();
            expect(runtime.handleFollowNotification).toBeDefined();
        });
    });

    describe('Platform Lifecycle Coordination', () => {
        it('should not contain duplicate platform initialization logic', async () => {
            runtime = new AppRuntime(configFixture, mockDependencies);

            expect(runtime.initializePlatformWithStreamDetection).toBeUndefined();
            expect(runtime.shouldRunPlatformInBackground).toBeUndefined();
            expect(runtime.initializePlatformAsync).toBeUndefined();
        });

        it('should delegate platform disconnection to service', async () => {
            runtime = new AppRuntime(configFixture, mockDependencies);
            await runtime.initializePlatforms();

            await runtime.shutdown();

            expect(runtime.platformLifecycleService.isPlatformAvailable('twitch')).toBe(false);
        });
    });

    describe('Background Initialization Coordination', () => {
        it('should delegate background platform initialization to service', async () => {
            configFixture.tiktok = {
                enabled: true,
                username: '@test_user'
            };
            configFixture.twitch.enabled = false;
            runtime = new AppRuntime(configFixture, mockDependencies);
            await runtime.initializePlatforms();
            expect(runtime.backgroundPlatformInits).toBeUndefined();
            expect(runtime.platformLifecycleService.backgroundPlatformInits).toBeDefined();
        });

        it('tracks platform health during background initialization', async () => {
            configFixture.tiktok = {
                enabled: true,
                username: '@test_user'
            };
            configFixture.twitch.enabled = false;

            const platformLifecycleService = new PlatformLifecycleService({
                config: configFixture,
                eventBus: null,
                dependencyFactory: null,
                logger: mockDependencies.logging
            });

            const deps = {
                ...mockDependencies,
                platformLifecycleService
            };

            runtime = new AppRuntime(configFixture, deps);
            await runtime.initializePlatforms();

            const status = platformLifecycleService.getStatus();
            expect(status.platformHealth.tiktok).toBeDefined();
            expect(status.platformHealth.tiktok.state).toBeDefined();
        });
    });
});
