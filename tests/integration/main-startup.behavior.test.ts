import { describe, it, beforeEach, afterEach, expect } from "bun:test";

import { main } from "../../src/main.ts";
import type { SingleInstanceMetadata } from "../../src/services/SingleInstanceGuard.ts";
import { createDonationSpamDetection } from "../../src/utils/spam-detection";
import { createConfigFixture } from "../helpers/config-fixture";
import {
  useFakeTimers,
  useRealTimers,
  clearAllTimers,
} from "../helpers/bun-timers";
import { createMockDisplayQueue } from "../helpers/mock-factories";
import { captureStdout, captureStderr } from "../helpers/output-capture";

type OutputCapture = ReturnType<typeof captureStdout>;
type StartupOnlyEnv = NodeJS.ProcessEnv["CHAT_BOT_STARTUP_ONLY"];
type ConfigFixtureOverrides = Parameters<typeof createConfigFixture>[0];
type MainOverridesArg = NonNullable<Parameters<typeof main>[0]>;
type DonationSpamFactory = NonNullable<MainOverridesArg["createDonationSpamDetection"]>;
type CreateDisplayQueue = NonNullable<MainOverridesArg["createDisplayQueue"]>;

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
      ttsEnabled: false,
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
      ...overrides.displayQueue,
    },
    timing: {
      transitionDelay: 1000,
      notificationClearDelay: 500,
      chatMessageDuration: 1000,
      ...overrides.timing,
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
    async initialize() {
      if (options.twitchAuthInitError) {
        throw options.twitchAuthInitError;
      }
    }

    isReady() {
      return options.twitchAuthReady !== false;
    }
  }

  const createDonationSpamDetectionNoCleanup: DonationSpamFactory = (spamConfig, deps) =>
    createDonationSpamDetection(spamConfig, { ...deps, autoCleanup: false });

  const initializeDisplayQueueForTest = (
    _obsManager: unknown,
    displayQueueConfig: unknown,
  ) => {
    capturedDisplayQueueConfig = displayQueueConfig;
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
  };

  return {
    overrides,
    getCapturedDisplayQueueConfig: () => capturedDisplayQueueConfig,
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
    useRealTimers();
    stdoutCapture.restore();
    stderrCapture.restore();
  });

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
    expect(capturedDisplayQueueConfig).toMatchObject({ gui: config.gui });
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
