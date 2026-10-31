import { vi } from 'bun:test';
import { EventEmitter } from 'node:events';
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
        subscribe: vi.fn((event: string, handler: RuntimeEventHandler) => {
            emitter.on(event, handler);
            return () => emitter.removeListener(event, handler);
        }),
        emit: vi.fn((event: string, payload: unknown) => emitter.emit(event, payload)),
        reset: vi.fn(() => emitter.removeAllListeners())
    };
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
        executeCommand: vi.fn<(...args: [unknown, Record<string, unknown>]) => Promise<Record<string, boolean>>>().mockResolvedValue({ success: true }),
        executeCommandForKey: vi.fn<(...args: [unknown, Record<string, unknown>]) => Promise<Record<string, boolean>>>().mockResolvedValue({ success: true }),
        getVFXConfig: vi.fn<(...args: [string, string | null]) => Promise<Record<string, unknown>>>().mockResolvedValue({})
    };
    const userTrackingService = options.userTrackingService || {
        isFirstMessage: vi.fn<(...args: [unknown, Record<string, unknown>?]) => boolean>().mockReturnValue(true)
    };
    const commandCooldownService = options.commandCooldownService || {
        loadCooldownConfig: vi.fn<(...args: []) => void>(),
        registerConfigListeners: vi.fn<(...args: []) => void>(),
        getStatus: vi.fn<(...args: []) => Record<string, unknown>>().mockReturnValue({ commands: {} }),
        checkUserCooldown: vi.fn<(...args: [unknown, number, number]) => boolean>().mockReturnValue(true),
        updateUserCooldown: vi.fn<(...args: [unknown]) => void>()
    };
    const platformLifecycleService = options.platformLifecycleService ||
        createPlatformLifecycleStub();
    const commandParser = options.commandParser || {
        getVFXConfig: vi.fn<(...args: [string?, string?]) => null>().mockReturnValue(null)
    };
    const dependencyFactory = options.dependencyFactory || {
        createYoutubeDependencies: vi.fn<(...args: []) => { streamDetectionService: { isLive: () => unknown } }>().mockReturnValue({
            streamDetectionService: { isLive: vi.fn<(...args: unknown[]) => unknown>() }
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
        timestampService: options.timestampService || { now: vi.fn((): number => testClock.now()) },
        obsManager: options.obsManager || null,
        twitchAuth: options.twitchAuth || null,
        obs: options.obs || {},
        obsEventService: options.obsEventService || { start: vi.fn<(...args: unknown[]) => unknown>(), stop: vi.fn<(...args: unknown[]) => unknown>() },
        sceneManagementService: options.sceneManagementService || { start: vi.fn<(...args: unknown[]) => unknown>(), stop: vi.fn<(...args: unknown[]) => unknown>() },
        gracefulExitService: options.gracefulExitService || {
            isEnabled: vi.fn<(...args: []) => boolean>().mockReturnValue(false),
            getTargetMessageCount: vi.fn<(...args: []) => number>().mockReturnValue(0),
            incrementMessageCount: vi.fn<(...args: []) => boolean>().mockReturnValue(false),
            triggerExit: vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined)
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
