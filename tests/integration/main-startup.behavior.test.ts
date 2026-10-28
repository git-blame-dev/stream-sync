import { describe, it, beforeEach, afterEach, expect } from "bun:test";

import { main } from "../../src/main.ts";
import { AppRuntime } from "../../src/runtime/AppRuntime";
import { DependencyFactory } from "../../src/utils/dependency-factory";
import { createGracefulExitService } from "../../src/services/GracefulExitService";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService";
import { YouTubeStreamDetectionService } from "../../src/services/youtube-stream-detection-service";
import { YouTubePlatform } from "../../src/platforms/youtube";
import { InnertubeFactory } from "../../src/factories/innertube-factory";
import { createEventBus } from "../../src/core/EventBus";
import type { UsdRateService } from "../../src/services/usd-rate-service";
import type { SingleInstanceMetadata } from "../../src/services/SingleInstanceGuard.ts";
import { createDonationSpamDetection } from "../../src/utils/spam-detection";
import { createConfigFixture } from "../helpers/config-fixture";
import {
  useFakeTimers,
  useRealTimers,
  clearAllTimers,
  getTimerCount,
} from "../helpers/bun-timers";
import { createFundingGoalService } from "../../src/services/funding-goal-service";
import { noOpLogger, createMockDisplayQueue } from "../helpers/mock-factories";
import { captureStdout, captureStderr } from "../helpers/output-capture";

type OutputCapture = ReturnType<typeof captureStdout>;
type StartupOnlyEnv = NodeJS.ProcessEnv["CHAT_BOT_STARTUP_ONLY"];
type ConfigFixtureOverrides = Parameters<typeof createConfigFixture>[0];
type MainOverridesArg = NonNullable<Parameters<typeof main>[0]>;
type DonationSpamFactory = NonNullable<MainOverridesArg["createDonationSpamDetection"]>;
type CreateDisplayQueue = NonNullable<MainOverridesArg["createDisplayQueue"]>;

const TEST_USD_RATE_SERVICE: UsdRateService = Object.freeze({
  rates: Object.freeze({ USD: 1 }),
  convertToUsd: (amount: number, currency: string) =>
    currency.trim().toUpperCase() === "USD" ? amount : null,
});

const createSuccessfulSecretSetupResult = () => ({
  applied: {},
  persisted: [],
  missingRequired: [],
});

const buildMainConfig = (overrides: ConfigFixtureOverrides = {}) =>
  createConfigFixture({
    general: {
      debugEnabled: false,
      envFilePath: "/tmp/test-env",
      envFileReadEnabled: false,
      envFileWriteEnabled: false,
      viewerCountPollingIntervalMs: 0,
      ...overrides.general,
    },
    obs: {
      chatMsgTxt: "test-chat-text",
      chatMsgScene: "test-chat-scene",
      chatMsgGroup: "test-chat-group",
      ttsChatEnabled: false,
      ttsNotificationsEnabled: true,
      notificationTxt: "test-notification-text",
      notificationScene: "test-notification-scene",
      notificationMsgGroup: "test-notification-group",
      chatPlatformLogos: {},
      notificationPlatformLogos: {},
      ...overrides.obs,
    },
    displayQueue: {
      autoProcess: false,
      maxQueueSize: 5,
      rowIntervalMs: 1000,
      ...overrides.displayQueue,
    },
    http: {
      userAgents: ["test-agent"],
      ...overrides.http,
    },
    twitch: {
      enabled: false,
      ...overrides.twitch,
    },
    youtube: {
      enabled: false,
      ...overrides.youtube,
    },
    tiktok: {
      enabled: false,
      ...overrides.tiktok,
    },
    ...overrides,
  });

type BuildOverridesOptions = {
  ensureSecretsError?: Error;
  singleInstanceAcquireError?: Error;
  twitchAuthInitError?: Error;
  twitchAuthReady?: boolean;
  cliArgs?: MainOverridesArg["cliArgs"];
};

const TEST_SINGLE_INSTANCE_METADATA: SingleInstanceMetadata = {
  instanceId: "test-instance",
  pid: 1,
  ppid: 0,
  hostname: "test-host",
  platform: process.platform,
  cwd: "/tmp/test-stream-sync",
  command: "test stream-sync",
  startedAt: "2025-01-15T12:00:00.000Z",
};

const buildOverrides = (options: BuildOverridesOptions = {}) => {
  const ensureSecretsCalls: boolean[] = [];
  const singleInstanceReleaseCalls: boolean[] = [];
  const obsManager = {
    isConnected: () => false,
    isReady: () => false,
    ensureConnected: async () => undefined,
    call: async () => ({}),
    connect: async () => true,
    disconnect: async () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  let capturedDisplayQueueConfig: unknown = null;
  let capturedDisplayQueueDependencies: unknown = null;

  const ensureSecrets: NonNullable<MainOverridesArg["ensureSecrets"]> = async () => {
    ensureSecretsCalls.push(true);
    if (options.ensureSecretsError) {
      throw options.ensureSecretsError;
    }
    return createSuccessfulSecretSetupResult();
  };

  const createSingleInstanceGuard = async () => {
    if (options.singleInstanceAcquireError) {
      throw options.singleInstanceAcquireError;
    }
    return {
      lockPath: "/tmp/test-stream-sync.lock",
      metadata: TEST_SINGLE_INSTANCE_METADATA,
      release: async () => {
        singleInstanceReleaseCalls.push(true);
      },
    };
  };

  class TwitchAuthStub {
    private initialized = false;

    async initialize() {
      if (options.twitchAuthInitError) {
        throw options.twitchAuthInitError;
      }
      this.initialized = true;
    }

    isReady() {
      return this.initialized && options.twitchAuthReady !== false;
    }

    startValidationMonitoring() {}

    async stopValidationMonitoring() {}
  }

  const createDonationSpamDetectionNoCleanup: DonationSpamFactory = (spamConfig, deps) =>
    createDonationSpamDetection(spamConfig, { ...deps, autoCleanup: false });

  const initializeDisplayQueueForTest = (
    _obsManager: unknown,
    displayQueueConfig: unknown,
    _constants: unknown,
    _eventBus: unknown,
    dependencies: unknown,
  ) => {
    capturedDisplayQueueConfig = displayQueueConfig;
    capturedDisplayQueueDependencies = dependencies;
    return createMockDisplayQueue();
  };

  const overrides: Record<string, unknown> = {
    cliArgs: options.cliArgs || {},
    ensureSecrets,
    createSingleInstanceGuard,
    TwitchAuth: TwitchAuthStub,
    initializeDisplayQueue: initializeDisplayQueueForTest,
    getOBSConnectionManager: () => obsManager,
    createOBSEventService: () => ({ disconnect: async () => {} }),
    createDonationSpamDetection: createDonationSpamDetectionNoCleanup,
    createUsdRateService: async () => TEST_USD_RATE_SERVICE,
    createFundingGoalService: (options: Parameters<typeof createFundingGoalService>[0]) =>
      createFundingGoalService({
        ...options,
        fs: {
          readFile: async () => { throw Object.assign(new Error("test missing funding state"), { code: "ENOENT" }); },
          mkdir: async () => {},
          writeFile: async () => {},
          rename: async () => {},
          unlink: async () => {},
        },
      }),
  };

  return {
    overrides,
    getCapturedDisplayQueueConfig: () => capturedDisplayQueueConfig,
    getCapturedDisplayQueueDependencies: () => capturedDisplayQueueDependencies,
    getEnsureSecretsCalls: () => ensureSecretsCalls,
    getSingleInstanceReleaseCalls: () => singleInstanceReleaseCalls,
  };
};

describe("main startup behavior", () => {
  let stdoutCapture: OutputCapture;
  let stderrCapture: OutputCapture;
  let originalStartupOnly: StartupOnlyEnv;

  beforeEach(() => {
    stdoutCapture = captureStdout();
    stderrCapture = captureStderr();
    useFakeTimers();
    originalStartupOnly = process.env.CHAT_BOT_STARTUP_ONLY;
    delete process.env.CHAT_BOT_STARTUP_ONLY;
  });

  afterEach(() => {
    if (originalStartupOnly === undefined) {
      delete process.env.CHAT_BOT_STARTUP_ONLY;
    } else {
      process.env.CHAT_BOT_STARTUP_ONLY = originalStartupOnly;
    }
    clearAllTimers();
    InnertubeFactory.configure();
    useRealTimers();
    stdoutCapture.restore();
    stderrCapture.restore();
  });

  for (const enabled of [true, false]) {
    it(`composes the default production YouTube owner only when enabled=${enabled}`, async () => {
      process.env.CHAT_BOT_STARTUP_ONLY = "true";
      const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });
      let app: AppRuntime | undefined;
      const platformAttempts: Promise<void>[] = [];
      let sdkCreations = 0;
      const result = await main({
        ...overrides,
        config: buildMainConfig({ youtube: { enabled, username: "" } }),
        innertubeImporter: async () => ({ Innertube: { create: async () => {
          sdkCreations += 1;
          return { getInfo: async () => ({}) };
        } } }) as never,
        createGracefulExitService: (runtime, ...args) => {
          app = runtime as AppRuntime;
          expect(sdkCreations).toBe(0);
          if (enabled) {
            const owner = app.innertubeService;
            if (!owner) throw new Error("Expected the production root owner");
            const factory = new DependencyFactory();
            for (let attempt = 0; attempt < 2; attempt += 1) {
              const deps = factory.createYoutubeDependencies(
                { username: "synthetic-channel", streamDetectionMethod: "youtubei" },
                { logger: noOpLogger, config: buildMainConfig(), innertubeService: owner },
              );
              expect(deps.innertubeService).toBe(owner);
              expect(deps.viewerExtractionService.innertubeService).toBe(owner);
              expect((deps.streamDetectionService as YouTubeStreamDetectionService).client).toBe(owner);
            }
            expect((app.platformLifecycleService as PlatformLifecycleService).sharedDependencies.innertubeService).toBe(owner);
            const lifecycle = app.platformLifecycleService as PlatformLifecycleService;
            for (let attempt = 0; attempt < 2; attempt += 1) {
              platformAttempts.push(lifecycle.createPlatformInstance("youtube",
                YouTubePlatform as unknown as Parameters<PlatformLifecycleService["createPlatformInstance"]>[1],
                { ...buildMainConfig().youtube, username: "synthetic-channel", streamDetectionMethod: "youtubei" },
              ).then(async instance => {
                const platform = instance as unknown as YouTubePlatform;
                expect(platform.viewerExtractionService).toBeDefined();
                expect((platform.streamDetectionService as YouTubeStreamDetectionService).client).toBe(owner);
                await owner.withMetadataOperation({}, client => client.getInfo("synthetic-video"));
                await platform.cleanup();
              }));
            }
          }
          return createGracefulExitService(runtime, ...args);
        },
      });
      await Promise.all(platformAttempts);
      expect(result.success).toBe(true);
      expect(sdkCreations).toBe(enabled ? 1 : 0);
      expect(!!app?.innertubeService).toBe(enabled);
      if (app?.innertubeService) {
        expect(() => app!.innertubeService!.withMetadataOperation({}, async () => true)).toThrow("disposed");
      }
    });
  }

  for (const failure of ["validation", "constructor"] as const) {
    it(`retires the acquired root YouTube owner on pre-adoption ${failure} failure`, async () => {
      const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });
      const factory = new DependencyFactory();
      let owner: ReturnType<DependencyFactory["createYoutubeInnertubeService"]> | undefined;
      let disposals = 0;
      const dependencyFactory = {
        createYoutubeInnertubeService: (...args: Parameters<DependencyFactory["createYoutubeInnertubeService"]>) => {
          owner = factory.createYoutubeInnertubeService(...args);
          const dispose = owner.dispose.bind(owner);
          owner.dispose = () => { disposals += 1; return dispose(); };
          return owner;
        },
      };
      await expect(main({
        ...overrides,
        config: buildMainConfig({ youtube: { enabled: true } }),
        createProductionDependencies: (() => ({ dependencyFactory, ...(failure === "constructor" ? { logging: {} } : {}) })) as never,
      })).rejects.toThrow(failure === "constructor" ? "AppRuntime requires logger" : "Runtime dependencies missing required keys: logging");
      expect(disposals).toBe(1);
      expect(owner).toBeDefined();
      expect(() => owner!.withMetadataOperation({}, async () => true)).toThrow("disposed");
    });
  }

  it("rejects enabled YouTube composition without the root acquisition capability", async () => {
    const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });
    await expect(main({
      ...overrides,
      config: buildMainConfig({ youtube: { enabled: true } }),
      dependencyFactory: {},
    })).rejects.toThrow("Enabled YouTube requires dependencyFactory.createYoutubeInnertubeService");
  });

  for (const failure of ["validation", "constructor", "cleanup"] as const) {
  it(`retires provisional resources on ${failure} failure before runtime adoption`, async () => {
    const { overrides, getSingleInstanceReleaseCalls } = buildOverrides({ cliArgs: { chat: 1 } });
    const bus = createEventBus();
    const unrelated = bus.subscribe("config:changed", () => undefined);
    const cleaned: string[] = [];
    const initialTimers = getTimerCount();
    try {
      await expect(main({
        ...overrides,
        config: buildMainConfig(),
        createEventBus: () => bus,
        createProductionDependencies: (() => ({ dependencyFactory: {}, ...(failure === "constructor" ? { logging: {} } : {}) })) as never,
        initializeDisplayQueue: (() => ({ stop: async () => {
          cleaned.push("display");
          if (failure === "cleanup") throw new Error("synthetic display cleanup failure");
        } })) as never,
        createOBSEventService: (() => ({
          disconnect: async () => { cleaned.push("obs-disconnect"); },
          destroy: () => { cleaned.push("obs-destroy"); },
        })) as never,
        createDonationSpamDetection: ((...args: Parameters<DonationSpamFactory>) => {
          const detector = createDonationSpamDetection(args[0], args[1]);
          const destroy = detector.destroy.bind(detector);
          detector.destroy = () => { cleaned.push("spam"); destroy(); };
          return detector;
        }) as DonationSpamFactory,
      })).rejects.toThrow(failure === "constructor" ? "AppRuntime requires logger" : "Runtime dependencies missing required keys: logging");
      expect(cleaned).toEqual(["spam", "display", "obs-disconnect", "obs-destroy"]);
      expect(bus.listenerCount("config:changed")).toBe(1);
      expect(bus.listenerCount("config:reloaded")).toBe(0);
      expect(getTimerCount()).toBe(initialTimers);
      expect(getSingleInstanceReleaseCalls()).toHaveLength(1);
    } finally {
      unrelated();
    }
  });
  }

  it("unwinds runtime construction when its final diagnostic throws through real main", async () => {
    const { overrides, getSingleInstanceReleaseCalls } = buildOverrides({ cliArgs: { chat: 1 } });
    const bus = createEventBus();
    const unrelated = bus.subscribe("platform:event", () => undefined);
    const listenerBaseline = bus.getListenerSummary();
    const timerBaseline = getTimerCount();
    const failure = new Error("test final runtime constructor diagnostic");
    const logging = {
      ...noOpLogger,
      debug: (message: string) => {
        if (message === "Constructor completed") throw failure;
      },
    };
    try {
      const result = await main({
        ...overrides,
        config: buildMainConfig(),
        createEventBus: () => bus,
        createProductionDependencies: (() => ({ logging, dependencyFactory: {} })) as never,
        createDonationSpamDetection,
      }).catch(error => error);
      expect(result).toBe(failure);
      expect(bus.getListenerSummary()).toEqual(listenerBaseline);
      expect(getTimerCount()).toBe(timerBaseline);
      expect(getSingleInstanceReleaseCalls()).toHaveLength(1);
    } finally {
      unrelated();
    }
  });

  for (const stage of ["Periodic cleanup scheduled every 30 seconds", "System initialized"] as const) {
    it(`unwinds real constructor acquisition when ${stage} throws`, async () => {
      const { overrides, getSingleInstanceReleaseCalls } = buildOverrides({ cliArgs: { chat: 1 } });
      const bus = createEventBus();
      const unrelated = bus.subscribe("config:changed", () => undefined);
      const baseline = bus.getListenerSummary();
      const timers = getTimerCount();
      const failure = new Error("test resource constructor diagnostic failure");
      const failDiagnostic = (message: string) => {
        if (message === stage) throw failure;
      };
      const logging = { ...noOpLogger, debug: failDiagnostic, info: failDiagnostic };
      try {
        const result = await main({
          ...overrides,
          config: buildMainConfig(),
          createEventBus: () => bus,
          createProductionDependencies: (() => ({ logging, dependencyFactory: {} })) as never,
          createDonationSpamDetection: (config, dependencies) => createDonationSpamDetection(config, { ...dependencies, logger: logging }),
        }).catch(error => error);
        expect(result).toBe(failure);
        expect(bus.getListenerSummary()).toEqual(baseline);
        expect(getTimerCount()).toBe(timers);
        expect(getSingleInstanceReleaseCalls()).toHaveLength(1);
      } finally {
        unrelated();
      }
    });
  }

  it("starts runtime and returns startup status", async () => {
    const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });

    const result = await main({
      ...overrides,
      config: buildMainConfig(),
    });

    expect(result).toEqual({
      success: true,
      appStarted: true,
      viewerCountActive: false,
      authValid: true,
    });
  });

  it("shuts down in startup-only mode", async () => {
    process.env.CHAT_BOT_STARTUP_ONLY = "true";
    const { overrides, getSingleInstanceReleaseCalls } = buildOverrides({
      cliArgs: { chat: 1 },
    });

    const result = await main({
      ...overrides,
      config: buildMainConfig(),
    });

    expect(result.success).toBe(true);
    expect(getSingleInstanceReleaseCalls()).toHaveLength(1);
  });

  it("stores keep-alive interval when chat limit is not set", async () => {
    const { overrides } = buildOverrides({
      cliArgs: { chat: null },
    });

    const result = await main({
      ...overrides,
      config: buildMainConfig(),
    });

    expect(result.success).toBe(true);
  });

  it("surfaces secret setup failures", async () => {
    const error = new Error("test-secret-failure");
    const { overrides, getSingleInstanceReleaseCalls } = buildOverrides({
      ensureSecretsError: error,
      cliArgs: { chat: 1 },
    });

    await expect(
      main({
        ...overrides,
        config: buildMainConfig(),
      }),
    ).rejects.toThrow("test-secret-failure");
    expect(getSingleInstanceReleaseCalls()).toHaveLength(1);
  });

  it("aborts before secrets when another instance is already running", async () => {
    const error = new Error("another instance is running");
    const { overrides, getEnsureSecretsCalls } = buildOverrides({
      singleInstanceAcquireError: error,
      cliArgs: { chat: 1 },
    });

    await expect(
      main({
        ...overrides,
        config: buildMainConfig(),
      }),
    ).rejects.toThrow("another instance is running");
    expect(getEnsureSecretsCalls()).toHaveLength(0);
  });

  it("continues when Twitch auth initialization fails", async () => {
    const error = new Error("test-auth-failure");
    const { overrides } = buildOverrides({
      twitchAuthInitError: error,
      cliArgs: { chat: 1 },
    });

    const result = await main({
      ...overrides,
      config: buildMainConfig({ twitch: { enabled: true } }),
    });

    expect(result.authValid).toBe(false);
    expect(result.success).toBe(true);
  });

  it("passes gui settings to display queue configuration", async () => {
    process.env.CHAT_BOT_STARTUP_ONLY = "true";
    const { overrides, getCapturedDisplayQueueConfig } = buildOverrides({
      cliArgs: { chat: 1 },
    });
    const config = buildMainConfig({
      gui: {
        enableDock: false,
        enableOverlay: false,
        showGifts: true,
      },
    });

    const result = await main({
      ...overrides,
      config,
    });

    expect(result.success).toBe(true);
    const capturedDisplayQueueConfig = getCapturedDisplayQueueConfig();
    expect(capturedDisplayQueueConfig).toMatchObject({
      gui: config.gui,
      ttsChatEnabled: config.obs.ttsChatEnabled,
      ttsNotificationsEnabled: config.obs.ttsNotificationsEnabled,
    });
  });

  it("wires global operator defaults while keeping notification preparation active", async () => {
    process.env.CHAT_BOT_STARTUP_ONLY = "true";
    const { overrides, getCapturedDisplayQueueDependencies } = buildOverrides({ cliArgs: { chat: 1 } });
    const config = buildMainConfig({
      general: { giftsEnabled: false },
      gui: {
        enableDock: false,
        enableOverlay: false,
        enableOperator: true,
        host: "127.0.0.1",
        port: 0,
      },
    });
    const capturedDefaults: Array<Record<string, boolean>> = [];
    const notificationConfigs: Array<Record<string, Record<string, unknown>>> = [];
    const listeners = new Set<(snapshot: { controls: Record<string, boolean> }) => void>();
    const operatorControls = {
      controls: {} as Record<string, boolean>,
      overriddenKeys: [] as string[],
      revision: 0,
      isEnabled(key: string) { return this.controls[key] !== false; },
      subscribe(listener: (snapshot: { controls: Record<string, boolean> }) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async setEnabled() {},
      async reset() {},
    };
    const dependencyFactory = {
      createYoutubeDependencies: () => ({}),
      createTiktokDependencies: () => ({}),
      createTwitchDependencies: () => ({}),
    };
    const testLogger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
    class CapturingNotificationManager {
      donationSpamDetector?: unknown;
      constructor(options: unknown) {
        const candidate = options as { config: Record<string, Record<string, unknown>> };
        notificationConfigs.push(candidate.config);
      }
      async handleNotification() { return { success: true }; }
      async prepareNotification() { return { success: false }; }
      handleAggregatedDonation() {}
    }

    const result = await main({
      ...overrides,
      config,
      createOperatorControlService: async (options: unknown) => {
        const defaults = (options as { defaults: Record<string, boolean> }).defaults;
        capturedDefaults.push(defaults);
        operatorControls.controls = { ...defaults };
        return operatorControls as never;
      },
      createProductionDependencies: (() => ({
        obs: {},
        dependencyFactory,
        lazyInnertube: {},
        logging: testLogger,
        logger: testLogger,
        guiTransportService: {
          start: async () => undefined,
          stop: async () => undefined,
          publishChatMessage: () => undefined,
        },
      })) as never,
      NotificationManager: CapturingNotificationManager,
    });

    expect(result.success).toBe(true);
    expect(capturedDefaults[0]?.giftsEnabled).toBe(false);
    expect(notificationConfigs[0]?.tiktok?.giftsEnabled).toBe(true);
    expect(getCapturedDisplayQueueDependencies()).toMatchObject({ operatorControls });
  });

  it("rejects non-function startup override dependencies", async () => {
    const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });

    const invalidOverrides: Record<string, unknown> = {
        ...overrides,
        createEventBus: "not-a-function",
        config: buildMainConfig(),
      };

    await expect(main(invalidOverrides)).rejects.toThrow(
      "main override createEventBus must be a function when provided",
    );
  });

  it("rejects invalid cliArgs chat override values", async () => {
    const { overrides } = buildOverrides({});

    const invalidOverrides: Record<string, unknown> = {
      ...overrides,
      cliArgs: { chat: "invalid-chat-count" },
      config: buildMainConfig(),
    };

    await expect(main(invalidOverrides)).rejects.toThrow(
      "main override cliArgs.chat must be null or a positive integer",
    );
  });

  it("uses one OBS subsystem instance for display queue, event services, and VFX wiring", async () => {
    process.env.CHAT_BOT_STARTUP_ONLY = "true";
    const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });
    const displayQueueManagers: unknown[] = [];
    const eventServiceManagers: unknown[] = [];
    const createVfxCallArgs: Parameters<NonNullable<MainOverridesArg["createVFXCommandService"]>>[] = [];
    const createProductionDependenciesArgs: Parameters<NonNullable<MainOverridesArg["createProductionDependencies"]>>[] = [];
    let managerSeq = 0;

    const makeObsManager = () => {
      managerSeq += 1;
      return {
        id: `obs-manager-${managerSeq}`,
        isConnected: () => false,
        isReady: () => false,
        connect: async () => true,
        disconnect: async () => undefined,
        ensureConnected: async () => undefined,
        call: async () => ({}),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
    };

    const subsystemOverrides: Record<string, unknown> = {
      ...overrides,
      getOBSConnectionManager: () => makeObsManager(),
      initializeDisplayQueue: (obsManager: unknown) => {
        displayQueueManagers.push(obsManager);
        return createMockDisplayQueue();
      },
      createOBSEventService: ({ obsConnection }: { obsConnection: unknown }) => {
        eventServiceManagers.push(obsConnection);
        return {
          connect: async () => true,
          disconnect: async () => undefined,
          destroy: () => undefined,
        };
      },
      createVFXCommandService: (...args: Parameters<NonNullable<MainOverridesArg["createVFXCommandService"]>>) => {
        createVfxCallArgs.push(args);
        return {
          executeCommand: async () => ({ success: true }),
          executeCommandForKey: async () => ({ success: true }),
          getVFXConfig: async () => null,
        };
      },
      createProductionDependencies: (...args: Parameters<NonNullable<MainOverridesArg["createProductionDependencies"]>>) => {
        createProductionDependenciesArgs.push(args);
        const loggerDouble = {
          debug: () => undefined,
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
          console: () => undefined,
        };
        return {
          obs: {},
          sourcesFactory: {},
          effectsFactory: {},
          logger: loggerDouble,
          logging: loggerDouble,
          platforms: {},
          displayQueue: null,
          notificationManager: null,
          dependencyFactory: {},
          lazyInnertube: {},
          axios: undefined,
          WebSocketCtor: undefined,
          tiktokConnector: undefined,
          eventBus: null,
          vfxCommandService: null,
          userTrackingService: null,
        };
      },
      config: buildMainConfig(),
    };

    const result = await main(subsystemOverrides);

    expect(result.success).toBe(true);
    expect(displayQueueManagers.length).toBe(1);
    expect(eventServiceManagers.length).toBe(1);
    expect(displayQueueManagers[0]).toBe(eventServiceManagers[0]);
    const firstVfxCall = createVfxCallArgs[0];
    const firstProductionDependenciesCall = createProductionDependenciesArgs[0];
    expect(firstVfxCall).toBeDefined();
    expect(firstProductionDependenciesCall).toBeDefined();
    if (!firstVfxCall || !firstProductionDependenciesCall) {
      throw new Error("Expected VFX and production dependency calls");
    }
    expect(firstVfxCall[2]?.effectsManager).toBeDefined();
    expect(firstProductionDependenciesCall[1]?.effectsManager).toBe(
      firstVfxCall[2]?.effectsManager,
    );
  });

  it("uses non-singleton createDisplayQueue runtime path when provided", async () => {
    process.env.CHAT_BOT_STARTUP_ONLY = "true";
    const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });
    const createdQueues: Array<{
      obsManager: Parameters<CreateDisplayQueue>[0];
      displayQueueConfig: Parameters<CreateDisplayQueue>[1];
      displayQueueConstants: Parameters<CreateDisplayQueue>[2];
      eventBus: Parameters<CreateDisplayQueue>[3];
      dependencies: Parameters<CreateDisplayQueue>[4];
    }> = [];

    const createDisplayQueueOverrides: Record<string, unknown> = {
      ...overrides,
      createDisplayQueue: (
        obsManager: Parameters<CreateDisplayQueue>[0],
        displayQueueConfig: Parameters<CreateDisplayQueue>[1],
        displayQueueConstants: Parameters<CreateDisplayQueue>[2],
        eventBus: Parameters<CreateDisplayQueue>[3],
        dependencies: Parameters<CreateDisplayQueue>[4],
      ) => {
        createdQueues.push({
          obsManager,
          displayQueueConfig,
          displayQueueConstants,
          eventBus,
          dependencies,
        });
        return createMockDisplayQueue();
      },
      config: buildMainConfig(),
    };
    delete createDisplayQueueOverrides.initializeDisplayQueue;

    const result = await main(createDisplayQueueOverrides);

    expect(result.success).toBe(true);
    expect(createdQueues.length).toBe(1);
  });
});
