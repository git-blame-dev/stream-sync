import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { noOpLogger } from "../helpers/mock-factories";
import { AppRuntime } from "../../src/main";
import {
  secrets,
  _resetForTesting,
  initializeStaticSecrets,
} from "../../src/core/secrets";

type RuntimeConfig = ConstructorParameters<typeof AppRuntime>[0];
type RuntimeDependencies = ConstructorParameters<typeof AppRuntime>[1];
type PlatformDelegationConfig = RuntimeConfig & {
  twitch: Record<string, unknown> & {
    enabled: boolean;
    username?: string;
    channel?: string;
    clientId?: string;
  };
  youtube: Record<string, unknown> & { enabled: boolean };
  tiktok: Record<string, unknown> & { enabled: boolean; username?: string };
  obs: RuntimeConfig["obs"] & { enabled: boolean };
};
type RuntimePlatformLifecycleDependency =
  RuntimeDependencies["platformLifecycleService"];
type RuntimePlatformMap = ReturnType<
  RuntimePlatformLifecycleDependency["getAllPlatforms"]
>;
type PlatformHealthStatus = { state?: unknown };
type PlatformDelegationLifecycleService = RuntimePlatformLifecycleDependency & {
  getPlatform: (platformName: string) => unknown;
  isPlatformAvailable: (platformName: string) => boolean;
  readonly backgroundPlatformInits: unknown[];
  getStatus: () => {
    platformHealth: Record<string, PlatformHealthStatus | undefined> & {
      tiktok?: PlatformHealthStatus;
    };
  };
};

function createPlatformDelegationConfig(): PlatformDelegationConfig {
  return {
    general: {
      debugEnabled: false,
      commandPrefix: "!",
      ttsEnabled: false,
      maxMessageLength: 500,
    },
    twitch: {
      enabled: true,
      username: "test_channel",
      channel: "test_channel",
      clientId: "test-client-id",
    },
    youtube: { enabled: false },
    tiktok: { enabled: false },
    obs: {
      enabled: false,
      chatMsgScene: "test-chat-scene",
      notificationScene: "test-notification-scene",
      chatPlatformLogos: {},
      notificationPlatformLogos: {},
      ttsTxt: "test-tts-source",
      notificationTxt: "test-notification-source",
    },
    handcam: {
      enabled: false,
      maxSize: 50,
      rampUpDuration: 0.5,
      holdDuration: 8,
      rampDownDuration: 0.5,
      totalSteps: 10,
      easingEnabled: false,
      sourceName: "test-handcam",
      glowFilterName: "Glow",
    },
    cooldowns: {
      cmdCooldownMs: 1000,
      heavyCommandCooldownMs: 5000,
      globalCmdCooldownMs: 250,
    },
    farewell: { timeout: 60 },
  };
}

function createPlatformLifecycleService(
  config: PlatformDelegationConfig,
): PlatformDelegationLifecycleService {
  const platforms: RuntimePlatformMap = {};
  const platformHealth: Record<string, PlatformHealthStatus | undefined> = {};
  const backgroundPlatformInits: unknown[] = [];

  return {
    getAllPlatforms: () => platforms,
    initializeAllPlatforms: async () => {
      if (config.tiktok.enabled) {
        platformHealth.tiktok = { state: "initializing" };
        backgroundPlatformInits.push(Promise.resolve());
      }
    },
    disconnectAll: async () => {
      for (const platformName of Object.keys(platforms)) {
        delete platforms[platformName];
      }
    },
    getPlatformConnectionTime: () => null,
    getStatus: () => ({ platformHealth }),
    getPlatform: (platformName: string) => platforms[platformName] ?? null,
    isPlatformAvailable: (platformName: string) => !!platforms[platformName],
    get backgroundPlatformInits() {
      return backgroundPlatformInits;
    },
  };
}

describe("Platform Initialization Delegation", () => {
  let runtime: AppRuntime | null;
  let configFixture: PlatformDelegationConfig;
  let mockDependencies: RuntimeDependencies;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    runtime = null;
    originalExit = process.exit;
    process.exit = createMockFn<Parameters<typeof process.exit>, never>(() => {
      throw new Error("process.exit called during test");
    });

    _resetForTesting();
    secrets.twitch.clientSecret = "test-client-secret";

    configFixture = createPlatformDelegationConfig();

    const platformLifecycleService = createPlatformLifecycleService(configFixture);

    mockDependencies = {
      logging: noOpLogger,
      displayQueue: { addItem: createMockFn() },
      eventBus: {
        subscribe: createMockFn(),
        emit: createMockFn(),
      },
      vfxCommandService: {
        executeCommandForKey: createMockFn().mockResolvedValue({
          success: true,
        }),
      },
      userTrackingService: {
        isFirstMessage: createMockFn(() => false),
      },
      commandParser: { getVFXConfig: createMockFn() },
      obsEventService: {},
      sceneManagementService: {},
      commandCooldownService: {
        checkUserCooldown: createMockFn(() => true),
        updateUserCooldown: createMockFn(),
      },
      notificationManager: {
        handleNotification: createMockFn().mockResolvedValue(undefined),
      },
      platformLifecycleService: platformLifecycleService,
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

  describe("Service-Based Platform Management", () => {
    it("should delegate platform initialization to PlatformLifecycleService", async () => {
      runtime = new AppRuntime(configFixture, mockDependencies);

      expect(runtime.platforms).toBeDefined();
      expect(runtime.platformLifecycleService).toBeDefined();
      expect(runtime.platformLifecycleService.getAllPlatforms).toBeDefined();
      expect(runtime.platforms).toEqual(
        runtime.platformLifecycleService.getAllPlatforms(),
      );
    });

    it("does not require StreamDetector wiring for PlatformLifecycleService", () => {
      runtime = new AppRuntime(configFixture, mockDependencies);

      expect("streamDetector" in runtime).toBe(false);
      expect("streamDetector" in runtime.platformLifecycleService).toBe(false);
    });

    it("should delegate platform access through service methods", async () => {
      runtime = new AppRuntime(configFixture, mockDependencies);

      expect("getPlatform" in runtime.platformLifecycleService).toBe(true);
      expect(
        "isPlatformAvailable" in runtime.platformLifecycleService,
      ).toBe(true);
      expect(
        "getPlatform" in runtime.platformLifecycleService &&
          typeof runtime.platformLifecycleService.getPlatform,
      ).toBe("function");
      expect(
        "isPlatformAvailable" in runtime.platformLifecycleService &&
          typeof runtime.platformLifecycleService.isPlatformAvailable,
      ).toBe(
        "function",
      );
    });

    it("should track connection times in service, not AppRuntime", async () => {
      runtime = new AppRuntime(configFixture, mockDependencies);

      expect("platformConnectionTimes" in runtime).toBe(false);
      expect(
        runtime.platformLifecycleService.getPlatformConnectionTime,
      ).toBeDefined();
      expect(
        typeof runtime.platformLifecycleService.getPlatformConnectionTime,
      ).toBe("function");
    });

    it("delegates StreamElements module to lifecycle initialization", async () => {
      const initializeAllPlatforms = createMockFn().mockResolvedValue({});
      mockDependencies.platformLifecycleService.initializeAllPlatforms =
        initializeAllPlatforms;
      runtime = new AppRuntime(configFixture, mockDependencies);

      await runtime.initializePlatforms();

      expect(initializeAllPlatforms.mock.calls).toHaveLength(1);
      const firstInitializeCall = initializeAllPlatforms.mock.calls[0];
      expect(firstInitializeCall).toBeDefined();
      if (!firstInitializeCall) {
        throw new Error("initializeAllPlatforms was not called");
      }
      const [platformModules] = firstInitializeCall;
      expect(platformModules).toBeDefined();
      expect(typeof platformModules).toBe("object");
      if (!platformModules || typeof platformModules !== "object") {
        throw new Error("initializeAllPlatforms received invalid modules");
      }
      expect("streamelements" in platformModules).toBe(true);
    });
  });

  describe("Event Handler Integration", () => {
    it("should maintain AppRuntime handler methods for platform events", async () => {
      runtime = new AppRuntime(configFixture, mockDependencies);

      expect(runtime.handleChatMessage).toBeDefined();
      expect(runtime.updateViewerCount).toBeDefined();
      expect(runtime.handleGiftNotification).toBeDefined();
      expect(runtime.handlePaypiggyNotification).toBeDefined();
      expect(runtime.handleFollowNotification).toBeDefined();
    });
  });

  describe("Platform Lifecycle Coordination", () => {
    it("should not contain duplicate platform initialization logic", async () => {
      runtime = new AppRuntime(configFixture, mockDependencies);

      expect("initializePlatformWithStreamDetection" in runtime).toBe(false);
      expect("shouldRunPlatformInBackground" in runtime).toBe(false);
      expect("initializePlatformAsync" in runtime).toBe(false);
    });

    it("should delegate platform disconnection to service", async () => {
      runtime = new AppRuntime(configFixture, mockDependencies);
      await runtime.initializePlatforms();

      await runtime.shutdown();

      expect(
        "isPlatformAvailable" in runtime.platformLifecycleService,
      ).toBe(true);
      if (
        "isPlatformAvailable" in runtime.platformLifecycleService &&
        typeof runtime.platformLifecycleService.isPlatformAvailable === "function"
      ) {
        expect(
          runtime.platformLifecycleService.isPlatformAvailable("twitch"),
        ).toBe(false);
      }
    });
  });

  describe("Background Initialization Coordination", () => {
    it("should delegate background platform initialization to service", async () => {
      configFixture.tiktok = {
        enabled: true,
        username: "@test_user",
      };
      configFixture.twitch.enabled = false;
      runtime = new AppRuntime(configFixture, mockDependencies);
      await runtime.initializePlatforms();
      expect("backgroundPlatformInits" in runtime).toBe(false);
      expect(
        "backgroundPlatformInits" in runtime.platformLifecycleService,
      ).toBe(true);
    });

    it("tracks platform health during background initialization", async () => {
      configFixture.tiktok = {
        enabled: true,
        username: "@test_user",
      };
      configFixture.twitch.enabled = false;

      const platformLifecycleService = createPlatformLifecycleService(configFixture);

      const deps = {
        ...mockDependencies,
        platformLifecycleService,
      };

      runtime = new AppRuntime(configFixture, deps);
      await runtime.initializePlatforms();

      const status = platformLifecycleService.getStatus();
      const platformHealth = status.platformHealth;
      expect(platformHealth).toBeDefined();
      expect(typeof platformHealth).toBe("object");
      if (!platformHealth || typeof platformHealth !== "object") {
        throw new Error("Platform health status was not tracked");
      }
      const tiktokHealth = "tiktok" in platformHealth
        ? platformHealth.tiktok
        : undefined;
      expect(tiktokHealth).toBeDefined();
      expect(typeof tiktokHealth).toBe("object");
      if (!tiktokHealth || typeof tiktokHealth !== "object") {
        throw new Error("TikTok health status was not tracked");
      }
      expect("state" in tiktokHealth).toBe(true);
    });
  });
});
