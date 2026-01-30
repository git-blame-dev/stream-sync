const EventEmitter = require('events');
const { createMockFn } = require('./bun-mock-utils');
const {
    createMockDisplayQueue,
    createMockNotificationManager,
    noOpLogger
} = require('./mock-factories');
const testClock = require('./test-clock');
const { createConfigFixture } = require('./config-fixture');

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
        configOverrides = {},
        notificationManagerOverrides = {},
        overrides = {}
    } = options;

    const logger = options.logger || noOpLogger;
    const displayQueue = options.displayQueue || createMockDisplayQueue();
    const notificationManager = options.notificationManager ||
        createMockNotificationManager(notificationManagerOverrides);
    const eventBus = options.eventBus || createEventBusStub();
    const config = createConfigFixture(configOverrides);
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

    const dependencies = {
        logging: logger,
        logger,
        displayQueue,
        notificationManager,
        eventBus,
        config,
        ttsService,
        vfxCommandService,
        userTrackingService,
        commandCooldownService,
        platformLifecycleService,
        dependencyFactory,
        timestampService: options.timestampService || { now: createMockFn(() => testClock.now()) },
        obsManager: options.obsManager || null,
        twitchAuth: options.twitchAuth || null,
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
    configFixture: config
  };
}

module.exports = {
    createAppRuntimeTestDependencies,
    createTestAppRuntime: (configOverrides = {}, options = {}) => {
        const { AppRuntime } = require('../../src/main');
        const harness = createAppRuntimeTestDependencies({
            configOverrides,
            ...options
        });

        const runtime = new AppRuntime(harness.configFixture, harness.dependencies);

        return {
            runtime,
            dependencies: harness.dependencies
        };
    }
};
