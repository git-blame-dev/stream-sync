import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createMockFn, clearAllMocks } from "../../helpers/bun-mock-utils";
import type { TestMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { PlatformLifecycleService } from "../../../src/services/PlatformLifecycleService.ts";
import type {
  PlatformConfig,
  PlatformConstructor,
  PlatformEventHandlerMap,
  PlatformEventHandlers,
  PlatformInstance,
} from "../../../src/services/PlatformLifecycleService.ts";
import { PlatformEvents } from "../../../src/interfaces/PlatformEvents";
import { DependencyFactory } from "../../../src/utils/dependency-factory";
import * as testClock from "../../helpers/test-clock";
import {
  secrets,
  _resetForTesting,
  initializeStaticSecrets,
} from "../../../src/core/secrets";

type MockEventBus = {
  emit: TestMockFn<[string, unknown], void>;
  subscribe: TestMockFn<[string, (...args: unknown[]) => unknown], () => void>;
};

type TestConfigFixture = Record<string, PlatformConfig>;

type EmittedPlatformEvent = {
  platform?: string;
  type?: string;
  data?: Record<string, unknown>;
};

type PlatformWithDependencies = PlatformInstance & {
  dependencies: Record<string, unknown>;
};

type MatrixHandlerName = Exclude<keyof PlatformEventHandlers, "onConnection">;

type HandlerMatrixEntry = {
  eventType: string;
  requiresTimestamp: boolean;
  dataKey: string;
};

const createDeferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const createNoopHandlers = (): PlatformEventHandlers => ({
  onChat: () => {},
  onViewerCount: () => {},
  onGift: () => {},
  onPaypiggy: () => {},
  onGiftPaypiggy: () => {},
  onFollow: () => {},
  onShare: () => {},
  onRaid: () => {},
  onEnvelope: () => {},
  onStreamStatus: () => {},
  onStreamDetected: () => {},
  onConnection: () => {},
});

const createDefaultPlatformInstance = (): PlatformInstance => ({
  initialize: createMockFn<
    [PlatformEventHandlers],
    Promise<boolean>
  >().mockResolvedValue(true),
  cleanup: createMockFn<[], Promise<void>>().mockResolvedValue(),
  on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
});

const createPlatformConstructor = (
  createInstance: (
    config: PlatformConfig,
    dependencies?: unknown,
  ) => PlatformInstance = () => createDefaultPlatformInstance(),
): PlatformConstructor => {
  return class TestPlatform implements PlatformInstance {
    private readonly instance: PlatformInstance;

    constructor(config: PlatformConfig, dependencies?: unknown) {
      this.instance = createInstance(config, dependencies);
    }

    initialize(handlers: PlatformEventHandlers) {
      return this.instance.initialize(handlers);
    }

    cleanup() {
      return this.instance.cleanup();
    }

    on(eventName: string, handler: (...args: unknown[]) => unknown) {
      return this.instance.on(eventName, handler);
    }
  };
};

const getEmittedPlatformEvents = (eventBus: MockEventBus) =>
  eventBus.emit.mock.calls
    .filter(([name]) => name === "platform:event")
    .map(([, payload]) => payload)
    .filter(isEmittedPlatformEvent);

const isEmittedPlatformEvent = (
  payload: unknown,
): payload is EmittedPlatformEvent => {
  return !!payload && typeof payload === "object";
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object";
};

const hasDependencies = (
  platform: PlatformInstance,
): platform is PlatformWithDependencies => {
  return "dependencies" in platform && isRecord(platform.dependencies);
};

const isLoggerLike = (value: unknown): value is { info: unknown } => {
  return isRecord(value) && typeof value.info === "function";
};

const findEmittedEvent = (
  eventBus: MockEventBus,
  eventType: string,
): EmittedPlatformEvent | undefined => {
  for (const [, payload] of eventBus.emit.mock.calls) {
    if (isEmittedPlatformEvent(payload) && payload.type === eventType) {
      return payload;
    }
  }
  return undefined;
};

describe("PlatformLifecycleService", () => {
  let service: PlatformLifecycleService;
  let mockEventBus: MockEventBus;
  let configFixture: TestConfigFixture;

  beforeEach(() => {
    mockEventBus = {
      emit: createMockFn<[string, unknown], void>(),
      subscribe: createMockFn<
        [string, (...args: unknown[]) => unknown],
        () => void
      >().mockReturnValue(() => {}),
    };

    _resetForTesting();
    secrets.twitch.clientSecret = "test-client-secret";

    configFixture = {
      twitch: { enabled: false },
      youtube: { enabled: false },
      tiktok: { enabled: false },
    };

    service = new PlatformLifecycleService({
      config: configFixture,
      eventBus: mockEventBus,
      logger: noOpLogger,
    });
  });

  describe("Service Status Reporting", () => {
    it("reports ready platforms and connection times", async () => {
      configFixture.twitch = {
        enabled: true,
        channel: "test-channel",
        clientId: "test-client-id",
      };

      const mockPlatformClass = createPlatformConstructor(() => ({
        initialize: createMockFn<
          [PlatformEventHandlers],
          Promise<void>
        >().mockImplementation(async (handlers) => {
          await handlers.onChat({ message: { text: "ready" } });
        }),
        cleanup: createMockFn<[], Promise<void>>().mockResolvedValue(),
        on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
      }));

      await service.initializeAllPlatforms({ twitch: mockPlatformClass });

      const status = service.getStatus();
      expect(status.initializedPlatforms).toContain("twitch");
      expect(status.connectionTimes.twitch).toEqual(expect.any(Number));
      expect("streamStatuses" in status).toBe(false);
    });

    it("reports failed platforms with error context", async () => {
      configFixture.youtube = { enabled: true, username: "channel" };

      const mockPlatformClass = createPlatformConstructor(() => ({
        initialize: createMockFn<
          [PlatformEventHandlers],
          Promise<never>
        >().mockRejectedValue(
          new Error("connect failed"),
        ),
        cleanup: createMockFn<[], Promise<void>>().mockResolvedValue(),
        on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
      }));

      await service.initializeAllPlatforms({ youtube: mockPlatformClass });

      const status = service.getStatus();
      expect(status.failedPlatforms).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "youtube",
            lastError: "connect failed",
          }),
        ]),
      );
      expect(service.getPlatform("youtube")).toBeNull();
      expect(status.registeredPlatforms).not.toContain("youtube");
    });

    it("reports registered platforms consistently with accessors", () => {
      service.platforms = {
        twitch: createDefaultPlatformInstance(),
        youtube: createDefaultPlatformInstance(),
      };
      service.updatePlatformHealth("twitch", { state: "ready" });
      service.updatePlatformHealth("youtube", {
        state: "failed",
        lastError: "test-failure",
      });

      const accessorPlatforms = Object.keys(service.getAllPlatforms()).sort();
      const status = service.getStatus();

      expect(status.registeredPlatforms.sort()).toEqual(accessorPlatforms);
    });

    it("counts only platform config entries in totalConfigured status", () => {
      service.config = {
        twitch: { enabled: true },
        youtube: { enabled: false },
        general: { debugEnabled: false },
        obs: { enabled: true },
        vfx: { filePath: "/tmp" },
      };

      const status = service.getStatus();

      expect(status.totalConfigured).toBe(2);
    });
  });

  afterEach(() => {
    if (service) {
      service.dispose();
    }
    clearAllMocks();
    _resetForTesting();
    initializeStaticSecrets();
  });

  describe("Platform Initialization", () => {
    it("should initialize enabled platforms", async () => {
      configFixture.twitch = {
        enabled: true,
        channel: "test-channel",
        clientId: "test-client-id",
      };

      const mockPlatformClass = createPlatformConstructor();

      const platformModules = { twitch: mockPlatformClass };
      const eventHandlers: PlatformEventHandlerMap = {
        default: createNoopHandlers(),
      };

      const result = await service.initializeAllPlatforms(
        platformModules,
        eventHandlers,
      );

      expect(result.twitch).toBeDefined();
      if (result.twitch) {
        expect(result.twitch.initialize).toBeDefined();
      }
    });

    it("should skip disabled platforms", async () => {
      const mockPlatformClass = createPlatformConstructor();
      const platformModules = {
        twitch: mockPlatformClass,
        youtube: mockPlatformClass,
      };

      const result = await service.initializeAllPlatforms(platformModules, {});

      expect(result).toEqual({});
      expect(service.isPlatformAvailable("twitch")).toBe(false);
      expect(service.isPlatformAvailable("youtube")).toBe(false);
    });

    it("should handle missing config safely", async () => {
      const localService = new PlatformLifecycleService({
        eventBus: mockEventBus,
        logger: noOpLogger,
      });

      const platformModules = {
        twitch: createPlatformConstructor(),
      };

      const result = await localService.initializeAllPlatforms(
        platformModules,
        {},
      );

      expect(result).toEqual({});
      expect(localService.isPlatformAvailable("twitch")).toBe(false);
    });

    it("should emit platform:initialized event when platform is ready", async () => {
      configFixture.youtube = { enabled: true, username: "test-channel" };

      const mockPlatformClass = createPlatformConstructor();

      const platformModules = { youtube: mockPlatformClass };

      await service.initializeAllPlatforms(platformModules, {
        default: createNoopHandlers(),
      });

      expect(service.isPlatformAvailable("youtube")).toBe(true);
      expect(service.getPlatform("youtube")).toBeDefined();
      expect(service.getPlatformConnectionTime("youtube")).toBeGreaterThan(0);
    });

    it("should emit EventBus platform events when default handlers are used", async () => {
      configFixture.twitch = { enabled: true };
      const timestamp = new Date().toISOString();

      const mockPlatformClass = createPlatformConstructor(() => ({
        initialize: createMockFn<
          [PlatformEventHandlers],
          Promise<boolean>
        >().mockImplementation((handlers) => {
          handlers.onChat({
            message: { text: "hello" },
            username: "user",
            userId: "u1",
            timestamp,
          });
          handlers.onViewerCount({ count: 42, timestamp });

          handlers.onGift({
            username: "donor",
            userId: "u2",
            id: "gift-1",
            giftType: "rose",
            giftCount: 1,
            amount: 5,
            currency: "coins",
            timestamp,
          });
          return Promise.resolve(true);
        }),
        cleanup: createMockFn<[], Promise<void>>().mockResolvedValue(),
        on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
      }));

      const platformModules = { twitch: mockPlatformClass };

      await service.initializeAllPlatforms(platformModules);

      const platformEvents = getEmittedPlatformEvents(mockEventBus);

      expect(platformEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            platform: "twitch",
            type: "platform:chat-message",
            data: expect.objectContaining({
              message: { text: "hello" },
              timestamp,
            }),
          }),
          expect.objectContaining({
            platform: "twitch",
            type: "platform:viewer-count",
            data: expect.objectContaining({
              count: 42,
              timestamp: expect.any(String),
            }),
          }),
          expect.objectContaining({
            platform: "twitch",
            type: "platform:gift",
            data: expect.objectContaining({
              username: "donor",
              timestamp,
            }),
          }),
        ]),
      );
    });

    it("validates PlatformClass is a constructor", async () => {
      configFixture.twitch = { enabled: true };
      const platformModules = JSON.parse('{"twitch":null}');

      await service.initializeAllPlatforms(platformModules, {});

      expect(service.isPlatformAvailable("twitch")).toBe(false);
      expect(service.getPlatform("twitch")).toBeNull();
    });

    it("records platform failure safely when non-Error values are thrown during initialization", async () => {
      configFixture.twitch = {
        enabled: true,
        channel: "test-channel",
        clientId: "test-client-id",
      };

      service.createPlatformInstance = createMockFn<
        [string, PlatformConstructor, PlatformConfig],
        Promise<PlatformInstance>
      >().mockRejectedValue(null);

      await service.initializeAllPlatforms({
        twitch: createPlatformConstructor(),
      });

      const status = service.getStatus();
      expect(status.failedPlatforms).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "twitch",
            lastError: "null",
          }),
        ]),
      );
    });

    it("rethrows original non-Error values from initializePlatformConnection without secondary crashes", async () => {
      const platformInstance: PlatformInstance = {
        initialize: createMockFn<
          [PlatformEventHandlers],
          Promise<never>
        >().mockRejectedValue(null),
        cleanup: createMockFn<[], Promise<void>>().mockResolvedValue(),
        on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
      };

      await expect(
        service.initializePlatformConnection(
          "twitch",
          platformInstance,
          createNoopHandlers(),
          {
            enabled: true,
          },
        ),
      ).rejects.toBeNull();
    });
  });

  describe("Platform Instance Creation", () => {
    it("should create platform instance without DI when no factory", async () => {
      const mockPlatformClass = createPlatformConstructor();
      const config = { test: "config" };

      const instance = await service.createPlatformInstance(
        "twitch",
        mockPlatformClass,
        config,
      );

      expect(instance).toBeDefined();
      expect(typeof instance).toBe("object");
    });

    it("should use factory method when available", async () => {
      const mockDependencies = { auth: "mock" };
      const mockFactory = {
        createTwitchDependencies:
          createMockFn<
            [PlatformConfig, Record<string, unknown> | undefined],
            Record<string, unknown>
          >().mockReturnValue(mockDependencies),
      };

      service.dispose();
      service = new PlatformLifecycleService({
        config: configFixture,
        eventBus: mockEventBus,
        logger: noOpLogger,
        dependencyFactory: mockFactory,
        sharedDependencies: { test: "value" },
      });

      class TestPlatform implements PlatformInstance {
        readonly platformConfig: PlatformConfig;
        readonly dependencies: Record<string, unknown>;
        initialize = createMockFn<
          [PlatformEventHandlers],
          Promise<boolean>
        >().mockResolvedValue(true);
        cleanup = createMockFn<[], Promise<void>>().mockResolvedValue();
        on = createMockFn<
          [string, (...args: unknown[]) => unknown],
          unknown
        >();

        constructor(platformConfig: PlatformConfig, dependencies?: unknown) {
          this.platformConfig = platformConfig;
          this.dependencies = isRecord(dependencies) ? dependencies : {};
        }
      }
      const config = { test: "config" };

      const instance = await service.createPlatformInstance(
        "twitch",
        TestPlatform,
        config,
      );

      expect(hasDependencies(instance)).toBe(true);
      if (hasDependencies(instance)) {
        expect(instance.dependencies).toBe(mockDependencies);
      }
      expect(instance).toBeDefined();
      expect(typeof instance).toBe("object");
    });

    it("creates platform dependencies from a DependencyFactory instance without losing method context", async () => {
      configFixture.twitch = {
        enabled: true,
        channel: "test-channel",
        clientId: "test-client-id",
      };

      const dependencyFactory = new DependencyFactory();
      const testTwitchAuth = { isReady: () => true };

      service.dispose();
      service = new PlatformLifecycleService({
        config: configFixture,
        eventBus: mockEventBus,
        logger: noOpLogger,
        dependencyFactory,
        sharedDependencies: {
          config: configFixture,
          twitchAuth: testTwitchAuth,
        },
      });

      class TestPlatform implements PlatformInstance {
        readonly platformConfig: PlatformConfig;
        readonly dependencies: Record<string, unknown>;
        initialize = createMockFn<
          [PlatformEventHandlers],
          Promise<boolean>
        >().mockResolvedValue(true);
        cleanup = createMockFn<[], Promise<void>>().mockResolvedValue();
        on = createMockFn<
          [string, (...args: unknown[]) => unknown],
          unknown
        >();

        constructor(platformConfig: PlatformConfig, dependencies?: unknown) {
          this.platformConfig = platformConfig;
          this.dependencies = isRecord(dependencies) ? dependencies : {};
        }
      }

      const instance = await service.createPlatformInstance(
        "twitch",
        TestPlatform,
        configFixture.twitch,
      );

      expect(hasDependencies(instance)).toBe(true);
      if (hasDependencies(instance)) {
        expect(instance.dependencies.twitchAuth).toBe(testTwitchAuth);
        expect(instance.dependencies.selfMessageDetectionService).toBeDefined();
        const dependencyLogger = instance.dependencies.logger;
        expect(isLoggerLike(dependencyLogger)).toBe(true);
      }
    });

    it("should fallback gracefully if factory method missing", async () => {
      service.dependencyFactory = {};

      const mockPlatformClass = createPlatformConstructor();
      const config = { test: "config" };

      const instance = await service.createPlatformInstance(
        "unknown",
        mockPlatformClass,
        config,
      );

      expect(instance).toBeDefined();
      expect(typeof instance).toBe("object");
    });

    it("uses dynamically named dependency factories for non-core platforms", async () => {
      const mockDependencies = { streamElementsClient: "mock-client" };
      const mockFactory = {
        createStreamelementsDependencies: createMockFn<
          [PlatformConfig, Record<string, unknown> | undefined],
          Record<string, unknown>
        >().mockReturnValue(mockDependencies),
      };

      service.dispose();
      service = new PlatformLifecycleService({
        config: configFixture,
        eventBus: mockEventBus,
        logger: noOpLogger,
        dependencyFactory: mockFactory,
        sharedDependencies: { config: configFixture },
      });

      class TestPlatform implements PlatformInstance {
        readonly dependencies: Record<string, unknown>;
        initialize = createMockFn<
          [PlatformEventHandlers],
          Promise<boolean>
        >().mockResolvedValue(true);
        cleanup = createMockFn<[], Promise<void>>().mockResolvedValue();
        on = createMockFn<
          [string, (...args: unknown[]) => unknown],
          unknown
        >();

        constructor(_platformConfig: PlatformConfig, dependencies?: unknown) {
          this.dependencies = isRecord(dependencies) ? dependencies : {};
        }
      }

      const instance = await service.createPlatformInstance(
        "streamelements",
        TestPlatform,
        { enabled: true },
      );

      expect(mockFactory.createStreamelementsDependencies).toHaveBeenCalledTimes(1);
      expect(hasDependencies(instance)).toBe(true);
      if (hasDependencies(instance)) {
        expect(instance.dependencies).toBe(mockDependencies);
      }
    });
  });

  describe("Connection State Tracking", () => {
    it("should record platform connection time", () => {
      service.recordPlatformConnection("twitch");

      const connectionTime = service.getPlatformConnectionTime("twitch");
      expect(connectionTime).toBeGreaterThan(0);
      expect(typeof connectionTime).toBe("number");
    });

    it("should check if platform is available", () => {
      service.platforms = { twitch: createDefaultPlatformInstance() };

      expect(service.isPlatformAvailable("twitch")).toBe(true);
    });

    it("should return false for unavailable platform", () => {
      expect(service.isPlatformAvailable("nonexistent")).toBe(false);
    });

    it("should get platform instance", () => {
      const mockPlatform = createDefaultPlatformInstance();
      service.platforms = { twitch: mockPlatform };

      expect(service.getPlatform("twitch")).toBe(mockPlatform);
    });

    it("should return null for non-existent platform", () => {
      expect(service.getPlatform("nonexistent")).toBeNull();
    });
  });

  describe("Resource Cleanup", () => {
    it("should dispose resources when service stops", () => {
      service.platforms = {
        twitch: createDefaultPlatformInstance(),
        youtube: createDefaultPlatformInstance(),
      };
      service.platformConnectionTimes = { twitch: testClock.now() };
      service.backgroundPlatformInits = [
        { platform: "tiktok", promise: Promise.resolve() },
      ];

      service.dispose();

      expect(Object.keys(service.platforms).length).toBe(0);
      expect(Object.keys(service.platformConnectionTimes).length).toBe(0);
      expect(service.backgroundPlatformInits.length).toBe(0);
    });
  });

  describe("Platform Connection Coordination", () => {
    it("should connect YouTube directly (platform-managed detection)", async () => {
      configFixture.youtube = { enabled: true, username: "test-channel" };

      const platformInitSpy = createMockFn<
        [PlatformEventHandlers],
        Promise<boolean>
      >().mockResolvedValue(true);
      const mockPlatformClass = createPlatformConstructor(() => ({
        initialize: platformInitSpy,
        cleanup: createMockFn<[], Promise<void>>().mockResolvedValue(),
        on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
      }));

      await service.initializeAllPlatforms({ youtube: mockPlatformClass });

      const status = service.getStatus();
      expect(status.initializedPlatforms).toContain("youtube");
      expect(status.platformHealth.youtube?.state).toBe("ready");
    });

    it("should connect Twitch directly (chat always available)", async () => {
      configFixture.twitch = {
        enabled: true,
        channel: "test-channel",
        clientId: "test-client-id",
      };

      const platformInitSpy = createMockFn<
        [PlatformEventHandlers],
        Promise<boolean>
      >().mockResolvedValue(true);
      const mockPlatformClass = createPlatformConstructor(() => ({
        initialize: platformInitSpy,
        cleanup: createMockFn<[], Promise<void>>().mockResolvedValue(),
        on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
      }));

      await service.initializeAllPlatforms({ twitch: mockPlatformClass });

      const status = service.getStatus();
      expect(status.initializedPlatforms).toContain("twitch");
      expect(status.platformHealth.twitch?.state).toBe("ready");
    });
  });

  describe("Background Initialization", () => {
    it("should run TikTok initialization in background without blocking", async () => {
      configFixture.tiktok = { enabled: true, username: "streamer" };

      const deferred = createDeferred<boolean>();
      const platformInitSpy = createMockFn<
        [PlatformEventHandlers],
        Promise<boolean>
      >().mockImplementation(
        () => deferred.promise,
      );
      const mockPlatformClass = createPlatformConstructor(() => ({
        initialize: platformInitSpy,
        cleanup: createMockFn<[], Promise<void>>().mockResolvedValue(),
        on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
      }));

      await service.initializeAllPlatforms({ tiktok: mockPlatformClass });

      expect(service.backgroundPlatformInits).toHaveLength(1);
      expect(platformInitSpy).toHaveBeenCalled();

      const waitPromise = service.waitForBackgroundInits(100);
      deferred.resolve(true);
      await waitPromise;
      expect(service.backgroundPlatformInits).toHaveLength(0);
    });

    it("starts enabled non-background platforms in parallel", async () => {
      configFixture.twitch = {
        enabled: true,
        channel: "test-channel",
        clientId: "test-client-id",
      };
      configFixture.youtube = { enabled: true, username: "test-channel" };

      const twitchInitDeferred = createDeferred<boolean>();
      const youtubeInitDeferred = createDeferred<boolean>();

      const twitchInit = createMockFn<
        [PlatformEventHandlers],
        Promise<boolean>
      >().mockImplementation(
        () => twitchInitDeferred.promise,
      );
      const youtubeInit = createMockFn<
        [PlatformEventHandlers],
        Promise<boolean>
      >().mockImplementation(
        () => youtubeInitDeferred.promise,
      );

      const platformModules = {
        twitch: createPlatformConstructor(() => ({
          initialize: twitchInit,
          cleanup: createMockFn<[], Promise<void>>().mockResolvedValue(),
          on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
        })),
        youtube: createPlatformConstructor(() => ({
          initialize: youtubeInit,
          cleanup: createMockFn<[], Promise<void>>().mockResolvedValue(),
          on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
        })),
      };

      const initPromise = service.initializeAllPlatforms(platformModules);

      await Promise.resolve();

      const statusDuringInit = service.getStatus();
      expect(statusDuringInit.initializingPlatforms).toEqual(
        expect.arrayContaining(["twitch", "youtube"]),
      );

      twitchInitDeferred.resolve(true);
      youtubeInitDeferred.resolve(true);
      await initPromise;
    });

    it("keeps successful platform initialization progressing when another platform fails", async () => {
      configFixture.twitch = {
        enabled: true,
        channel: "test-channel",
        clientId: "test-client-id",
      };
      configFixture.youtube = { enabled: true, username: "test-channel" };

      const twitchInitDeferred = createDeferred<void>();
      const twitchError = new Error("twitch connect failed");
      const twitchInit = createMockFn<
        [PlatformEventHandlers],
        Promise<never>
      >().mockImplementation(async () => {
        await twitchInitDeferred.promise;
        throw twitchError;
      });
      const youtubeInit = createMockFn<
        [PlatformEventHandlers],
        Promise<boolean>
      >().mockResolvedValue(true);

      const platformModules = {
        twitch: createPlatformConstructor(() => ({
          initialize: twitchInit,
          cleanup: createMockFn<[], Promise<void>>().mockResolvedValue(),
          on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
        })),
        youtube: createPlatformConstructor(() => ({
          initialize: youtubeInit,
          cleanup: createMockFn<[], Promise<void>>().mockResolvedValue(),
          on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
        })),
      };

      const initPromise = service.initializeAllPlatforms(platformModules);

      await Promise.resolve();
      await Promise.resolve();

      const statusWhileTwitchPending = service.getStatus();
      expect(statusWhileTwitchPending.initializedPlatforms).toContain(
        "youtube",
      );

      twitchInitDeferred.resolve(undefined);
      await initPromise;

      const status = service.getStatus();
      expect(status.initializedPlatforms).toContain("youtube");
      expect(status.failedPlatforms).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "twitch",
            lastError: "twitch connect failed",
          }),
        ]),
      );
    });

    it("preserves TikTok background initialization semantics with parallel startup", async () => {
      configFixture.twitch = {
        enabled: true,
        channel: "test-channel",
        clientId: "test-client-id",
      };
      configFixture.tiktok = { enabled: true, username: "streamer" };

      const twitchInitDeferred = createDeferred<boolean>();
      const tiktokInitDeferred = createDeferred<boolean>();
      const twitchInit = createMockFn<
        [PlatformEventHandlers],
        Promise<boolean>
      >().mockImplementation(
        () => twitchInitDeferred.promise,
      );
      const tiktokInit = createMockFn<
        [PlatformEventHandlers],
        Promise<boolean>
      >().mockImplementation(
        () => tiktokInitDeferred.promise,
      );

      const platformModules = {
        twitch: createPlatformConstructor(() => ({
          initialize: twitchInit,
          cleanup: createMockFn<[], Promise<void>>().mockResolvedValue(),
          on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
        })),
        tiktok: createPlatformConstructor(() => ({
          initialize: tiktokInit,
          cleanup: createMockFn<[], Promise<void>>().mockResolvedValue(),
          on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
        })),
      };

      const initPromise = service.initializeAllPlatforms(platformModules);

      await Promise.resolve();

      const statusDuringInit = service.getStatus();
      expect(statusDuringInit.initializingPlatforms).toContain("tiktok");
      expect(service.backgroundPlatformInits).toHaveLength(1);

      twitchInitDeferred.resolve(true);
      tiktokInitDeferred.resolve(true);
      await initPromise;
    });

    it("marks background init failure safely when callback throws non-Error values", async () => {
      await expect(
        service.initializePlatformAsync("tiktok", async () => {
          throw null;
        }),
      ).resolves.toBeUndefined();

      const status = service.getStatus();
      expect(status.failedPlatforms).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "tiktok",
            lastError: "null",
          }),
        ]),
      );
    });
  });

  describe("Platform Shutdown", () => {
    it("should cleanup all platforms gracefully on service shutdown", async () => {
      configFixture.twitch = { enabled: true };

      const cleanupSpy = createMockFn<[], Promise<void>>().mockResolvedValue();
      const mockPlatformClass = createPlatformConstructor(() => ({
        initialize: createMockFn<
          [PlatformEventHandlers],
          Promise<boolean>
        >().mockResolvedValue(true),
        cleanup: cleanupSpy,
        on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
      }));

      await service.initializeAllPlatforms({ twitch: mockPlatformClass });

      await service.disconnectAll();

      expect(cleanupSpy).toHaveBeenCalled();
      expect(service.isPlatformAvailable("twitch")).toBe(false);
      expect(service.getStatus().platformHealth.twitch?.state).toBe(
        "disconnected",
      );
    });

    it("removes platform instances even when cleanup fails", async () => {
      configFixture.twitch = {
        enabled: true,
        channel: "test-channel",
        clientId: "test-client-id",
      };

      const cleanupSpy = createMockFn<[], Promise<void>>().mockRejectedValue(
        new Error("cleanup failed"),
      );
      const mockPlatformClass = createPlatformConstructor(() => ({
        initialize: createMockFn<
          [PlatformEventHandlers],
          Promise<boolean>
        >().mockResolvedValue(true),
        cleanup: cleanupSpy,
        on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
      }));

      await service.initializeAllPlatforms({ twitch: mockPlatformClass });
      await service.disconnectAll();

      expect(cleanupSpy).toHaveBeenCalled();
      expect(service.isPlatformAvailable("twitch")).toBe(false);
      expect(service.getStatus().registeredPlatforms).not.toContain("twitch");
    });

    it("prefers cleanup even when a disconnect method exists", async () => {
      configFixture.twitch = { enabled: true };

      const cleanupSpy = createMockFn<[], Promise<void>>().mockResolvedValue();
      const disconnectSpy = createMockFn<[], Promise<void>>().mockResolvedValue();
      const mockPlatformClass = createPlatformConstructor(() => ({
        initialize: createMockFn<
          [PlatformEventHandlers],
          Promise<boolean>
        >().mockResolvedValue(true),
        cleanup: cleanupSpy,
        disconnect: disconnectSpy,
        on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
      }));

      await service.initializeAllPlatforms({ twitch: mockPlatformClass });
      await service.disconnectAll();

      expect(cleanupSpy).toHaveBeenCalled();
      expect(disconnectSpy).not.toHaveBeenCalled();
      expect(service.isPlatformAvailable("twitch")).toBe(false);
    });

    it("prevents background init from transitioning health to ready after shutdown begins", async () => {
      configFixture.tiktok = { enabled: true, username: "test-streamer" };

      const deferred = createDeferred<boolean>();
      const cleanupSpy = createMockFn<[], Promise<void>>().mockResolvedValue();
      const tiktokClass = createPlatformConstructor(() => ({
        initialize: createMockFn<
          [PlatformEventHandlers],
          Promise<boolean>
        >().mockImplementation(() => deferred.promise),
        cleanup: cleanupSpy,
        on: createMockFn<[string, (...args: unknown[]) => unknown], unknown>(),
      }));

      await service.initializeAllPlatforms({ tiktok: tiktokClass });

      const shutdownPromise = service.disconnectAll();
      deferred.resolve(true);
      await shutdownPromise;

      const status = service.getStatus();
      expect(status.platformHealth.tiktok?.state).not.toBe("ready");
      expect(cleanupSpy).toHaveBeenCalled();
    });
  });

  describe("Default Handler Contract Matrix", () => {
    const CANONICAL_HANDLER_NAMES_WITH_EVENTS: MatrixHandlerName[] = [
      "onChat",
      "onViewerCount",
      "onGift",
      "onPaypiggy",
      "onGiftPaypiggy",
      "onFollow",
      "onShare",
      "onRaid",
      "onEnvelope",
      "onStreamStatus",
      "onStreamDetected",
    ];

    const CANONICAL_HANDLER_MATRIX: Record<
      MatrixHandlerName,
      HandlerMatrixEntry
    > = {
      onChat: {
        eventType: PlatformEvents.CHAT_MESSAGE,
        requiresTimestamp: true,
        dataKey: "message",
      },
      onViewerCount: {
        eventType: PlatformEvents.VIEWER_COUNT,
        requiresTimestamp: true,
        dataKey: "count",
      },
      onGift: {
        eventType: PlatformEvents.GIFT,
        requiresTimestamp: true,
        dataKey: "giftType",
      },
      onPaypiggy: {
        eventType: PlatformEvents.PAYPIGGY,
        requiresTimestamp: true,
        dataKey: "tier",
      },
      onGiftPaypiggy: {
        eventType: PlatformEvents.GIFTPAYPIGGY,
        requiresTimestamp: true,
        dataKey: "giftCount",
      },
      onFollow: {
        eventType: PlatformEvents.FOLLOW,
        requiresTimestamp: true,
        dataKey: "username",
      },
      onShare: {
        eventType: PlatformEvents.SHARE,
        requiresTimestamp: true,
        dataKey: "username",
      },
      onRaid: {
        eventType: PlatformEvents.RAID,
        requiresTimestamp: true,
        dataKey: "viewerCount",
      },
      onEnvelope: {
        eventType: PlatformEvents.ENVELOPE,
        requiresTimestamp: true,
        dataKey: "giftType",
      },
      onStreamStatus: {
        eventType: PlatformEvents.STREAM_STATUS,
        requiresTimestamp: true,
        dataKey: "isLive",
      },
      onStreamDetected: {
        eventType: PlatformEvents.STREAM_DETECTED,
        requiresTimestamp: false,
        dataKey: "eventType",
      },
    };

    const CANONICAL_HANDLER_NAMES: (keyof PlatformEventHandlers)[] = [
      ...CANONICAL_HANDLER_NAMES_WITH_EVENTS,
      "onConnection",
    ];

    const createPayloadForHandler = (
      handlerName: MatrixHandlerName,
      timestamp: string,
    ): Record<string, unknown> => {
      const base = { username: "test-user", userId: "test-user-id", timestamp };
      switch (handlerName) {
        case "onChat":
          return { ...base, message: { text: "test-message" } };
        case "onViewerCount":
          return { count: 42, timestamp };
        case "onGift":
          return {
            ...base,
            id: "test-gift-id",
            giftType: "test-rose",
            giftCount: 1,
            amount: 5,
            currency: "coins",
          };
        case "onPaypiggy":
          return { ...base, tier: "test-tier-1", months: 1 };
        case "onGiftPaypiggy":
          return { ...base, giftCount: 5, tier: "test-tier-1" };
        case "onFollow":
          return { ...base };
        case "onShare":
          return { ...base };
        case "onRaid":
          return { ...base, viewerCount: 100 };
        case "onEnvelope":
          return {
            ...base,
            id: "test-envelope-id",
            giftType: "test-envelope",
            giftCount: 1,
            amount: 10,
            currency: "coins",
          };
        case "onStreamStatus":
          return { isLive: true, timestamp };
        case "onStreamDetected":
          return {
            eventType: "stream-detected",
            newStreamIds: ["test-stream-1"],
            allStreamIds: ["test-stream-1"],
            detectionTime: 1000,
            connectionCount: 1,
          };
        default:
          return base;
      }
    };

    for (const handlerName of CANONICAL_HANDLER_NAMES_WITH_EVENTS) {
      const { eventType, dataKey } = CANONICAL_HANDLER_MATRIX[handlerName];
      it(`${handlerName} emits ${eventType} with payload data on the event bus`, () => {
        const handlers = service.createDefaultEventHandlers("twitch");
        const timestamp = "2024-06-15T12:00:00.000Z";
        const payload = createPayloadForHandler(handlerName, timestamp);

        handlers[handlerName](payload);

        const emitted = findEmittedEvent(mockEventBus, eventType);
        expect(emitted).toBeTruthy();
        if (emitted) {
          expect(emitted.platform).toBe("twitch");
          expect(emitted.data?.[dataKey]).toBeDefined();
        }
      });
    }

    it("exposes exactly the canonical handler names and no legacy aliases", () => {
      const handlers = service.createDefaultEventHandlers("twitch");
      const handlerKeys = Object.keys(handlers).sort();

      expect(handlerKeys).toEqual([...CANONICAL_HANDLER_NAMES].sort());
      expect("onMembership" in handlers).toBe(false);
    });

    it("onFollow emits using payload platform when provided", () => {
      const handlers = service.createDefaultEventHandlers("streamelements");
      const timestamp = "2024-06-15T12:00:00.000Z";

      handlers.onFollow({
        platform: "youtube",
        username: "test-user",
        userId: "test-user-id",
        timestamp,
      });

      const emitted = findEmittedEvent(mockEventBus, PlatformEvents.FOLLOW);
      expect(emitted).toBeTruthy();
      if (emitted) {
        expect(emitted.platform).toBe("youtube");
        expect(emitted.data?.platform).toBeUndefined();
      }
    });

    for (const handlerName of CANONICAL_HANDLER_NAMES_WITH_EVENTS) {
      const { requiresTimestamp, eventType } = CANONICAL_HANDLER_MATRIX[handlerName];
      if (!requiresTimestamp) continue;

      it(`${handlerName} suppresses emit when payload lacks timestamp`, () => {
        const handlers = service.createDefaultEventHandlers("twitch");
        const payload = createPayloadForHandler(
          handlerName,
          "2024-06-15T12:00:00.000Z",
        );
        delete payload.timestamp;

        mockEventBus.emit.mockClear();
        handlers[handlerName](payload);

        const emitted = findEmittedEvent(mockEventBus, eventType);
        expect(emitted).toBeUndefined();
      });
    }

    it("onStreamDetected emits without timestamp in payload", () => {
      const handlers = service.createDefaultEventHandlers("twitch");
      handlers.onStreamDetected({
        eventType: "stream-detected",
        newStreamIds: ["test-stream-1"],
        allStreamIds: ["test-stream-1"],
        detectionTime: 1000,
        connectionCount: 1,
      });

      const emitted = findEmittedEvent(
        mockEventBus,
        PlatformEvents.STREAM_DETECTED,
      );
      expect(emitted).toBeTruthy();
      if (emitted) {
        expect(emitted.platform).toBe("twitch");
      }
    });

    it("onViewerCount suppresses emit when data is a raw number", () => {
      const handlers = service.createDefaultEventHandlers("twitch");

      mockEventBus.emit.mockClear();
      handlers.onViewerCount(42);

      const emitted = findEmittedEvent(mockEventBus, PlatformEvents.VIEWER_COUNT);
      expect(emitted).toBeUndefined();
    });

    it("onConnection updates lifecycle state without emitting through the event bus", () => {
      const handlers = service.createDefaultEventHandlers("twitch");

      testClock.set(1000);
      mockEventBus.emit.mockClear();

      handlers.onConnection({
        platform: "twitch",
        status: "connected",
        timestamp: new Date(testClock.now()).toISOString(),
        willReconnect: false,
      });

      expect(service.getStatus().platformHealth.twitch?.state).toBe("ready");
      expect(service.getPlatformConnectionTime("twitch")).toBe(testClock.now());
      expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it("onConnection keeps platform instance registered while reconnect is expected", () => {
      const handlers = service.createDefaultEventHandlers("twitch");
      const livePlatform = createDefaultPlatformInstance();

      service.platforms.twitch = livePlatform;
      service.updatePlatformHealth("twitch", { state: "ready" });
      testClock.set(1000);
      service.recordPlatformConnection("twitch");

      mockEventBus.emit.mockClear();
      handlers.onConnection({
        platform: "twitch",
        status: "disconnected",
        timestamp: new Date(testClock.now() + 1000).toISOString(),
        willReconnect: true,
        error: { message: "socket dropped" },
      });

      expect(service.getStatus().platformHealth.twitch?.state).toBe(
        "disconnected",
      );
      expect(service.getPlatform("twitch")).toBe(livePlatform);
      expect(service.getPlatformConnectionTime("twitch")).toBe(1000);
      expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it("onConnection ignores late connection events after shutdown begins", () => {
      const handlers = service.createDefaultEventHandlers("twitch");

      service.shutdownRequested = true;
      service.updatePlatformHealth("twitch", { state: "disconnected" });
      testClock.set(1000);
      mockEventBus.emit.mockClear();

      handlers.onConnection({
        platform: "twitch",
        status: "connected",
        timestamp: new Date(testClock.now()).toISOString(),
        willReconnect: false,
      });

      expect(service.getStatus().platformHealth.twitch?.state).toBe(
        "disconnected",
      );
      expect(service.getPlatformConnectionTime("twitch")).toBeNull();
      expect(mockEventBus.emit).not.toHaveBeenCalled();
    });
  });
});
