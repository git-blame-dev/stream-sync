// Test harness for building integration dependency bundles.
const EventEmitter = require('events');
const { createMockFn } = require('./bun-mock-utils');
const { mockModule } = require('./bun-module-mocks');

mockModule('../../src/core/logging', () => ({
    initializeLoggingConfig: createMockFn(),
    setConfigValidator: createMockFn(),
    setDebugMode: createMockFn(),
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
    })),
    createPlatformErrorHandler: createMockFn(() => ({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn(),
        logConfigError: createMockFn(),
        logError: createMockFn()
    })),
    setLoggerImplementation: createMockFn(),
    resetLoggingConfig: createMockFn()
}));
const {
    createMockDisplayQueue,
    createMockNotificationManager,
    createMockLogger
} = require('./mock-factories');
const testClock = require('./test-clock');
const { createRuntimeConstantsFixture } = require('./runtime-constants-fixture');

const createEventBusStub = () => {
    const emitter = new EventEmitter();

    return {
        subscribe: createMockFn((event, handler) => {
            emitter.on(event, handler);
            return () => emitter.removeListener(event, handler);
        }),
        emit: createMockFn((event, payload) => emitter.emit(event, payload)),
        reset: createMockFn(() => emitter.removeAllListeners())
    };
};

const createConfigServiceStub = (configSnapshot = {}) => {
    const snapshot = configSnapshot || {};

    return {
        get: createMockFn((path) => {
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
        getPlatformConfig: createMockFn((platform, key) => {
            const platformConfig = snapshot[platform];
            if (!platformConfig || platformConfig[key] === undefined) {
                throw new Error(`Missing platform config: ${platform}.${key}`);
            }
            return platformConfig[key];
        }),
        areNotificationsEnabled: createMockFn((settingKey, platform) => {
            const platformConfig = platform ? snapshot[platform] : null;
            if (platformConfig && platformConfig[settingKey] !== undefined) {
                return !!platformConfig[settingKey];
            }
            if (snapshot.general && snapshot.general[settingKey] !== undefined) {
                return !!snapshot.general[settingKey];
            }
            throw new Error(`Missing notification config: ${settingKey}`);
        }),
        getTTSConfig: createMockFn(() => {
            if (!snapshot.tts) {
                throw new Error('Missing tts config');
            }
            return snapshot.tts;
        }),
        isDebugEnabled: createMockFn(() => {
            if (!snapshot.general || snapshot.general.debugEnabled === undefined) {
                throw new Error('Missing general.debugEnabled config');
            }
            return !!snapshot.general.debugEnabled;
        }),
        getCLIOverrides: createMockFn().mockReturnValue({})
    };
};

const createPlatformLifecycleStub = (overrides = {}) => ({
    initializePlatforms: createMockFn().mockResolvedValue({}),
    initializeAllPlatforms: createMockFn().mockResolvedValue({}),
    initializePlatform: createMockFn().mockResolvedValue(true),
    waitForBackgroundInits: createMockFn().mockResolvedValue(true),
    shutdownPlatforms: createMockFn().mockResolvedValue(true),
    disconnectAll: createMockFn().mockResolvedValue(true),
    getAllPlatforms: createMockFn().mockReturnValue({}),
    getPlatforms: createMockFn().mockReturnValue({}),
    getPlatform: createMockFn().mockReturnValue(null),
    isPlatformAvailable: createMockFn().mockReturnValue(false),
    recordPlatformConnection: createMockFn(),
    startPlatform: createMockFn().mockResolvedValue(true),
    stopPlatform: createMockFn().mockResolvedValue(true),
    refreshPlatform: createMockFn().mockResolvedValue(true),
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
        executeCommand: createMockFn().mockResolvedValue({ success: true }),
        executeCommandForKey: createMockFn().mockResolvedValue({ success: true }),
        getVFXConfig: createMockFn().mockResolvedValue({})
    };
    const ttsService = options.ttsService || {
        speak: createMockFn().mockResolvedValue(true),
        stop: createMockFn().mockResolvedValue(true)
    };
    const userTrackingService = options.userTrackingService || {
        isFirstMessage: createMockFn().mockReturnValue(true)
    };
    const commandCooldownService = options.commandCooldownService || {
        loadCooldownConfig: createMockFn(),
        registerConfigListeners: createMockFn(),
        getStatus: createMockFn().mockReturnValue({ commands: {} }),
        checkCooldown: createMockFn().mockReturnValue({ allowed: true }),
        recordCommand: createMockFn()
    };
    const platformLifecycleService = options.platformLifecycleService ||
        createPlatformLifecycleStub();
    const dependencyFactory = options.dependencyFactory || {
        createYoutubeDependencies: createMockFn().mockReturnValue({
            streamDetectionService: { isLive: createMockFn() }
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
        timestampService: options.timestampService || { now: createMockFn(() => testClock.now()) },
        obsManager: options.obsManager || null,
        authManager: options.authManager || null,
        authFactory: options.authFactory || null,
        obs: options.obs || {},
        obsEventService: options.obsEventService || { start: createMockFn(), stop: createMockFn() },
        sceneManagementService: options.sceneManagementService || { start: createMockFn(), stop: createMockFn() },
        gracefulExitService: options.gracefulExitService || {
            isEnabled: createMockFn().mockReturnValue(false),
            getTargetMessageCount: createMockFn().mockReturnValue(0)
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
