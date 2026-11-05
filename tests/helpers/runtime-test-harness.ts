import { vi } from 'bun:test';
import { createEventBus } from '../../src/core/EventBus';
import { UserTrackingService } from '../../src/services/UserTrackingService';
import { AppRuntime } from '../../src/runtime/AppRuntime';


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
type PlatformLifecycleStub = RuntimeDependenciesForTest['platformLifecycleService'] & Record<string, unknown>;
type AppRuntimeDependencyOverrides = Partial<RuntimeDependenciesForTest> & Record<string, unknown>;

type AppRuntimeTestOptions = {
    [Key in keyof RuntimeDependenciesForTest]?: RuntimeDependenciesForTest[Key] | undefined;
} & {
    configOverrides?: ConfigFixtureOverrides;
    notificationManagerOverrides?: NotificationManagerOverrides;
    overrides?: AppRuntimeDependencyOverrides;
    logger?: RuntimeDependenciesForTest['logging'];
};

const asRuntimeConfig = (config: ConfigFixture): RuntimeConfigForTest => {
    return config as unknown as RuntimeConfigForTest;
};

const createPlatformLifecycleStub = (overrides: Partial<PlatformLifecycleStub> = {}): PlatformLifecycleStub => ({
    initializePlatforms: vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue({}),
    initializeAllPlatforms: vi.fn<(...args: [Record<string, unknown>]) => Promise<unknown>>().mockResolvedValue({}),
    initializePlatform: vi.fn<(...args: []) => Promise<boolean>>().mockResolvedValue(true),
    waitForBackgroundInits: vi.fn<(...args: []) => Promise<boolean>>().mockResolvedValue(true),
    shutdownPlatforms: vi.fn<(...args: []) => Promise<boolean>>().mockResolvedValue(true),
    disconnectAll: vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(true),
    getAllPlatforms: vi.fn<(...args: []) => Record<string, never>>().mockReturnValue({}),
    getPlatforms: vi.fn<(...args: []) => Record<string, never>>().mockReturnValue({}),
    getPlatform: vi.fn<(...args: []) => null>().mockReturnValue(null),
    getPlatformConnectionTime: vi.fn<(...args: [string]) => null>().mockReturnValue(null),
    isPlatformAvailable: vi.fn<(...args: []) => boolean>().mockReturnValue(false),
    recordPlatformConnection: vi.fn<(...args: [string]) => void>(),
    startPlatform: vi.fn<(...args: []) => Promise<boolean>>().mockResolvedValue(true),
    stopPlatform: vi.fn<(...args: []) => Promise<boolean>>().mockResolvedValue(true),
    refreshPlatform: vi.fn<(...args: []) => Promise<boolean>>().mockResolvedValue(true),
    ...overrides
});

function createAppRuntimeTestDependencies(options: AppRuntimeTestOptions = {}) {
    const {
        configOverrides = {},
        notificationManagerOverrides = {},
        overrides = {},
        logger: loggerOption,
        ...dependencyOptions
    } = options;

    const logger = loggerOption ?? noOpLogger;
    const displayQueue = options.displayQueue === undefined ? createMockDisplayQueue() : options.displayQueue;
    const notificationManager = options.notificationManager === undefined ?
        createMockNotificationManager(notificationManagerOverrides) : options.notificationManager;
    const eventBus = options.eventBus === undefined ? createEventBus() : options.eventBus;
    const config = createConfigFixture(configOverrides);
    const runtimeConfig = asRuntimeConfig(config);
    const vfxCommandService = options.vfxCommandService === undefined ? {
        executeCommand: vi.fn<(...args: [unknown, Record<string, unknown>]) => Promise<Record<string, boolean>>>().mockResolvedValue({ success: true }),
        executeCommandForKey: vi.fn<(...args: [unknown, Record<string, unknown>]) => Promise<Record<string, boolean>>>().mockResolvedValue({ success: true }),
        getVFXConfig: vi.fn<(...args: [string, string | null]) => Promise<Record<string, unknown>>>().mockResolvedValue({})
    } : options.vfxCommandService;
    const userTrackingService = options.userTrackingService === undefined ? new UserTrackingService() : options.userTrackingService;
    const commandCooldownService: RuntimeDependenciesForTest['commandCooldownService'] = options.commandCooldownService === undefined ? {
        getStatus: vi.fn<(...args: []) => Record<string, unknown>>().mockReturnValue({ commands: {} }),
        checkUserCooldown: vi.fn<(...args: [unknown, number, number]) => boolean>().mockReturnValue(true),
        updateUserCooldown: vi.fn<(...args: [unknown]) => void>(),
        dispose: vi.fn<(...args: []) => void>()
    } : options.commandCooldownService;
    const platformLifecycleService = options.platformLifecycleService === undefined ?
        createPlatformLifecycleStub() : options.platformLifecycleService;
    const commandParser = options.commandParser === undefined ? {
        getVFXConfig: vi.fn<(...args: [string?, string?]) => null>().mockReturnValue(null)
    } : options.commandParser;
    const dependencyFactory = options.dependencyFactory === undefined ? {
        createYoutubeDependencies: vi.fn<(...args: []) => { streamDetectionService: { isLive: () => unknown } }>().mockReturnValue({
            streamDetectionService: { isLive: vi.fn<(...args: unknown[]) => unknown>() }
        })
    } : options.dependencyFactory;

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
        timestampService: options.timestampService === undefined ? { now: vi.fn((): number => testClock.now()) } : options.timestampService,
        obsManager: options.obsManager === undefined ? null : options.obsManager,
        twitchAuth: options.twitchAuth === undefined ? null : options.twitchAuth,
        obs: options.obs === undefined ? {} : options.obs,
        obsEventService: options.obsEventService === undefined ? { start: vi.fn<(...args: unknown[]) => unknown>(), stop: vi.fn<(...args: unknown[]) => unknown>() } : options.obsEventService,
        sceneManagementService: options.sceneManagementService === undefined ? { start: vi.fn<(...args: unknown[]) => unknown>(), stop: vi.fn<(...args: unknown[]) => unknown>() } : options.sceneManagementService,
        gracefulExitService: options.gracefulExitService === undefined ? {
            isEnabled: vi.fn<(...args: []) => boolean>().mockReturnValue(false),
            getTargetMessageCount: vi.fn<(...args: []) => number>().mockReturnValue(0),
            incrementMessageCount: vi.fn<(...args: []) => boolean>().mockReturnValue(false),
            triggerExit: vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined)
        } : options.gracefulExitService,
        ...Object.fromEntries(Object.entries(dependencyOptions).filter(([, value]) => value !== undefined)),
        ...overrides
    } as RuntimeDependenciesForTest;

    return {
        dependencies,
        eventBus: dependencies.eventBus,
        notificationManager: dependencies.notificationManager,
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
