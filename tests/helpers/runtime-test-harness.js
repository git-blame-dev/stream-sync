// Test harness for building integration dependency bundles.
const EventEmitter = require('events');
jest.mock('../../src/core/logging', () => ({
    initializeLoggingConfig: jest.fn(),
    setConfigValidator: jest.fn(),
    setDebugMode: jest.fn(),
    initializeConsoleOverride: jest.fn(),
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    },
    getLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    })),
    createPlatformErrorHandler: jest.fn(() => ({
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn(),
        logConfigError: jest.fn(),
        logError: jest.fn()
    })),
    setConfigValidator: jest.fn(),
    setLoggerImplementation: jest.fn(),
    resetLoggingConfig: jest.fn()
}));
const {
    createMockDisplayQueue,
    createMockNotificationManager,
    createMockLogger
} = require('./mock-factories');
const { createRuntimeConstantsFixture } = require('./runtime-constants-fixture');

const createEventBusStub = () => {
    const emitter = new EventEmitter();

    return {
        subscribe: jest.fn((event, handler) => {
            emitter.on(event, handler);
            return () => emitter.removeListener(event, handler);
        }),
        emit: jest.fn((event, payload) => emitter.emit(event, payload)),
        reset: jest.fn(() => emitter.removeAllListeners())
    };
};

const createConfigServiceStub = (configSnapshot = {}) => {
    const snapshot = configSnapshot || {};

    return {
        get: jest.fn((path) => {
            if (!path) {
                if (!snapshot) {
                    throw new Error('Config snapshot required');
                }
                return snapshot;
            }

            const resolved = path.split('.').reduce((value, key) => {
                if (value && Object.prototype.hasOwnProperty.call(value, key)) {
                    return value[key];
                }
                return undefined;
            }, snapshot);
            if (resolved === undefined) {
                throw new Error(`Missing config path: ${path}`);
            }
            return resolved;
        }),
        getPlatformConfig: jest.fn((platform, key) => {
            const platformConfig = snapshot[platform];
            if (!platformConfig || platformConfig[key] === undefined) {
                throw new Error(`Missing platform config: ${platform}.${key}`);
            }
            return platformConfig[key];
        }),
        areNotificationsEnabled: jest.fn((settingKey, platform) => {
            const platformConfig = platform ? snapshot[platform] : null;
            if (platformConfig && platformConfig[settingKey] !== undefined) {
                return !!platformConfig[settingKey];
            }
            if (snapshot.general && snapshot.general[settingKey] !== undefined) {
                return !!snapshot.general[settingKey];
            }
            throw new Error(`Missing notification config: ${settingKey}`);
        }),
        getTTSConfig: jest.fn(() => {
            if (!snapshot.tts) {
                throw new Error('Missing tts config');
            }
            return snapshot.tts;
        }),
        isDebugEnabled: jest.fn(() => {
            if (!snapshot.general || snapshot.general.debugEnabled === undefined) {
                throw new Error('Missing general.debugEnabled config');
            }
            return !!snapshot.general.debugEnabled;
        }),
        getCLIOverrides: jest.fn().mockReturnValue({})
    };
};

const createPlatformLifecycleStub = (overrides = {}) => ({
    initializePlatforms: jest.fn().mockResolvedValue({}),
    initializeAllPlatforms: jest.fn().mockResolvedValue({}),
    initializePlatform: jest.fn().mockResolvedValue(true),
    waitForBackgroundInits: jest.fn().mockResolvedValue(true),
    shutdownPlatforms: jest.fn().mockResolvedValue(true),
    disconnectAll: jest.fn().mockResolvedValue(true),
    getAllPlatforms: jest.fn().mockReturnValue({}),
    getPlatforms: jest.fn().mockReturnValue({}),
    getPlatform: jest.fn().mockReturnValue(null),
    isPlatformAvailable: jest.fn().mockReturnValue(false),
    recordPlatformConnection: jest.fn(),
    startPlatform: jest.fn().mockResolvedValue(true),
    stopPlatform: jest.fn().mockResolvedValue(true),
    refreshPlatform: jest.fn().mockResolvedValue(true),
    ...overrides
});

function createAppRuntimeTestDependencies(options = {}) {
    const {
        configSnapshot = {},
        notificationManagerOverrides = {},
        overrides = {}
    } = options;

    const baseConfigSnapshot = {
        general: {
            debugEnabled: false,
            messagesEnabled: true,
            greetingsEnabled: true,
            farewellsEnabled: true,
            followsEnabled: true,
            giftsEnabled: true,
            paypiggiesEnabled: true,
            raidsEnabled: true,
            userSuppressionEnabled: false,
            maxNotificationsPerUser: 5,
            suppressionWindowMs: 60000,
            suppressionDurationMs: 300000,
            suppressionCleanupIntervalMs: 300000,
            streamDetectionEnabled: false,
            streamRetryInterval: 15,
            streamMaxRetries: 3,
            continuousMonitoringInterval: 60
        },
        obs: {
            notificationTxt: 'obs-notification-text',
            notificationScene: 'obs-notification-scene',
            notificationMsgGroup: 'obs-notification-group'
        },
        tts: {
            enabled: false,
            deduplicationEnabled: true,
            debugDeduplication: false,
            onlyForGifts: false,
            voice: 'default',
            rate: 1,
            volume: 1
        },
        timing: {
            greetingDuration: 3000,
            commandDuration: 3000,
            chatDuration: 3000,
            notificationDuration: 3000
        },
        monitoring: {}
    };
    const mergedConfigSnapshot = {
        ...baseConfigSnapshot,
        ...configSnapshot,
        general: { ...baseConfigSnapshot.general, ...(configSnapshot.general || {}) },
        obs: { ...baseConfigSnapshot.obs, ...(configSnapshot.obs || {}) },
        tts: { ...baseConfigSnapshot.tts, ...(configSnapshot.tts || {}) },
        timing: { ...baseConfigSnapshot.timing, ...(configSnapshot.timing || {}) },
        monitoring: { ...baseConfigSnapshot.monitoring, ...(configSnapshot.monitoring || {}) }
    };

    const logger = options.logger || createMockLogger('debug', { captureConsole: true });
    const displayQueue = options.displayQueue || createMockDisplayQueue();
    const notificationManager = options.notificationManager ||
        createMockNotificationManager(notificationManagerOverrides);
    const eventBus = options.eventBus || createEventBusStub();
    const configService = options.configService || createConfigServiceStub(mergedConfigSnapshot);
    const vfxCommandService = options.vfxCommandService || {
        executeCommand: jest.fn().mockResolvedValue({ success: true }),
        executeCommandForKey: jest.fn().mockResolvedValue({ success: true }),
        getVFXConfig: jest.fn().mockResolvedValue({})
    };
    const ttsService = options.ttsService || {
        speak: jest.fn().mockResolvedValue(true),
        stop: jest.fn().mockResolvedValue(true)
    };
    const userTrackingService = options.userTrackingService || {
        isFirstMessage: jest.fn().mockReturnValue(true)
    };
    const commandCooldownService = options.commandCooldownService || {
        loadCooldownConfig: jest.fn(),
        registerConfigListeners: jest.fn(),
        getStatus: jest.fn().mockReturnValue({ commands: {} }),
        checkCooldown: jest.fn().mockReturnValue({ allowed: true }),
        recordCommand: jest.fn()
    };
    const platformLifecycleService = options.platformLifecycleService ||
        createPlatformLifecycleStub();
    const dependencyFactory = options.dependencyFactory || {
        createYoutubeDependencies: jest.fn().mockReturnValue({
            streamDetectionService: { isLive: jest.fn() }
        })
    };

    const runtimeConstants = options.runtimeConstants || createRuntimeConstantsFixture();
    const dependencies = {
        logging: logger,
        logger,
        displayQueue,
        notificationManager,
        eventBus,
        configService,
        runtimeConstants,
        ttsService,
        vfxCommandService,
        userTrackingService,
        commandCooldownService,
        platformLifecycleService,
        dependencyFactory,
        timestampService: options.timestampService || { now: jest.fn(() => Date.now()) },
        obsManager: options.obsManager || null,
        authManager: options.authManager || null,
        authFactory: options.authFactory || null,
        obs: options.obs || {},
        obsEventService: options.obsEventService || { start: jest.fn(), stop: jest.fn() },
        sceneManagementService: options.sceneManagementService || { start: jest.fn(), stop: jest.fn() },
        gracefulExitService: options.gracefulExitService || {
            isEnabled: jest.fn().mockReturnValue(false),
            getTargetMessageCount: jest.fn().mockReturnValue(0)
        },
        ...overrides
    };

  return {
    dependencies,
    eventBus,
    notificationManager,
    configService
  };
}

module.exports = {
    createAppRuntimeTestDependencies,
    createTestAppRuntime: (configSnapshot = {}, options = {}) => {
        const { AppRuntime } = require('../../src/main');
        const harness = createAppRuntimeTestDependencies({
            configSnapshot,
            ...options
        });

        const runtimeConfig = harness.configService.get();
        const runtime = new AppRuntime(runtimeConfig, harness.dependencies);

        return {
            runtime,
            dependencies: harness.dependencies
        };
    }
};
