import { EventEmitter } from 'node:events';
import { AppRuntime } from '../../src/runtime/AppRuntime';

import { createMockFn } from './bun-mock-utils';
import { createConfigFixture } from './config-fixture';
import {
    createMockDisplayQueue,
    createMockNotificationManager,
    noOpLogger
} from './mock-factories';
import testClock from './test-clock';

type RuntimeConfigForTest = ConstructorParameters<typeof AppRuntime>[0];
type RuntimeDependenciesForTest = ConstructorParameters<typeof AppRuntime>[1];
type ConfigFixtureOverrides = Parameters<typeof createConfigFixture>[0];
type ConfigFixture = ReturnType<typeof createConfigFixture>;
type NotificationManagerOverrides = Parameters<typeof createMockNotificationManager>[0];
type RuntimeEventHandler = (event: Record<string, unknown>) => Promise<void> | void;
type EventBusStub = RuntimeDependenciesForTest['eventBus'] & {
    reset: () => void;
};
type PlatformLifecycleStub = RuntimeDependenciesForTest['platformLifecycleService'] & Record<string, unknown>;
type AppRuntimeDependencyOverrides = Partial<RuntimeDependenciesForTest> & Record<string, unknown>;

type AppRuntimeTestOptions = Partial<RuntimeDependenciesForTest> & {
    configOverrides?: ConfigFixtureOverrides;
    notificationManagerOverrides?: NotificationManagerOverrides;
    overrides?: AppRuntimeDependencyOverrides;
    logger?: RuntimeDependenciesForTest['logging'];
    displayQueue?: RuntimeDependenciesForTest['displayQueue'];
    notificationManager?: RuntimeDependenciesForTest['notificationManager'];
    eventBus?: RuntimeDependenciesForTest['eventBus'];
    platformLifecycleService?: RuntimeDependenciesForTest['platformLifecycleService'];
};

const asRuntimeConfig = (config: ConfigFixture): RuntimeConfigForTest => {
    return config as unknown as RuntimeConfigForTest;
};

const createEventBusStub = (): EventBusStub => {
    const emitter = new EventEmitter();

    return {
        subscribe: createMockFn((event: string, handler: RuntimeEventHandler) => {
            emitter.on(event, handler);
            return () => emitter.removeListener(event, handler);
        }),
        emit: createMockFn((event: string, payload: unknown) => emitter.emit(event, payload)),
        reset: createMockFn(() => emitter.removeAllListeners())
    };
};

const createPlatformLifecycleStub = (overrides: Partial<PlatformLifecycleStub> = {}): PlatformLifecycleStub => ({
    initializePlatforms: createMockFn<[], Promise<unknown>>().mockResolvedValue({}),
    initializeAllPlatforms: createMockFn<[Record<string, unknown>], Promise<unknown>>().mockResolvedValue({}),
    initializePlatform: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
    waitForBackgroundInits: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
    shutdownPlatforms: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
    disconnectAll: createMockFn<[], Promise<unknown>>().mockResolvedValue(true),
    getAllPlatforms: createMockFn<[], Record<string, never>>().mockReturnValue({}),
    getPlatforms: createMockFn<[], Record<string, never>>().mockReturnValue({}),
    getPlatform: createMockFn<[], null>().mockReturnValue(null),
    getPlatformConnectionTime: createMockFn<[string], null>().mockReturnValue(null),
    isPlatformAvailable: createMockFn<[], boolean>().mockReturnValue(false),
    recordPlatformConnection: createMockFn<[string], void>(),
    startPlatform: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
    stopPlatform: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
    refreshPlatform: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
    ...overrides
});

function createAppRuntimeTestDependencies(options: AppRuntimeTestOptions = {}) {
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
    const runtimeConfig = asRuntimeConfig(config);
    const vfxCommandService = options.vfxCommandService || {
        executeCommand: createMockFn<[unknown, Record<string, unknown>], Promise<Record<string, boolean>>>().mockResolvedValue({ success: true }),
        executeCommandForKey: createMockFn<[unknown, Record<string, unknown>], Promise<Record<string, boolean>>>().mockResolvedValue({ success: true }),
        getVFXConfig: createMockFn<[string, string | null], Promise<Record<string, unknown>>>().mockResolvedValue({})
    };
    const userTrackingService = options.userTrackingService || {
        isFirstMessage: createMockFn<[unknown, Record<string, unknown>?], boolean>().mockReturnValue(true)
    };
    const commandCooldownService = options.commandCooldownService || {
        loadCooldownConfig: createMockFn<[], void>(),
        registerConfigListeners: createMockFn<[], void>(),
        getStatus: createMockFn<[], Record<string, unknown>>().mockReturnValue({ commands: {} }),
        checkUserCooldown: createMockFn<[unknown, number, number], boolean>().mockReturnValue(true),
        updateUserCooldown: createMockFn<[unknown], void>()
    };
    const platformLifecycleService = options.platformLifecycleService ||
        createPlatformLifecycleStub();
    const commandParser = options.commandParser || {
        getVFXConfig: createMockFn<[string?, string?], null>().mockReturnValue(null)
    };
    const dependencyFactory = options.dependencyFactory || {
        createYoutubeDependencies: createMockFn<[], { streamDetectionService: { isLive: () => unknown } }>().mockReturnValue({
            streamDetectionService: { isLive: createMockFn() }
        })
    };

    const dependencies = {
        logging: logger,
        logger,
        displayQueue,
        notificationManager,
        eventBus,
        config: runtimeConfig,
        vfxCommandService,
        userTrackingService,
        commandCooldownService,
        platformLifecycleService,
        commandParser,
        dependencyFactory,
        timestampService: options.timestampService || { now: createMockFn((): number => testClock.now()) },
        obsManager: options.obsManager || null,
        twitchAuth: options.twitchAuth || null,
        obs: options.obs || {},
        obsEventService: options.obsEventService || { start: createMockFn(), stop: createMockFn() },
        sceneManagementService: options.sceneManagementService || { start: createMockFn(), stop: createMockFn() },
        gracefulExitService: options.gracefulExitService || {
            isEnabled: createMockFn<[], boolean>().mockReturnValue(false),
            getTargetMessageCount: createMockFn<[], number>().mockReturnValue(0),
            incrementMessageCount: createMockFn<[], boolean>().mockReturnValue(false),
            triggerExit: createMockFn<[], Promise<unknown>>().mockResolvedValue(undefined)
        },
        ...overrides
    } as RuntimeDependenciesForTest;

    return {
        dependencies,
        eventBus,
        notificationManager,
        configFixture: config,
        runtimeConfig
    };
}

const createTestAppRuntime = (configOverrides: ConfigFixtureOverrides = {}, options: AppRuntimeTestOptions = {}) => {
    const harness = createAppRuntimeTestDependencies({
        configOverrides,
        ...options
    });

    const runtime = new AppRuntime(harness.runtimeConfig, harness.dependencies);

    return {
        runtime,
        dependencies: harness.dependencies
    };
};

export {
    createAppRuntimeTestDependencies,
    createTestAppRuntime
};
