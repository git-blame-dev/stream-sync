import { describe, test, beforeEach, afterEach, expect } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
  type TestMockFn,
} from "../helpers/bun-mock-utils";
import { TEST_TIMEOUTS } from "../helpers/test-setup";
import { createConfigFixture } from "../helpers/config-fixture";
import {
  noOpLogger,
  createMockOBSConnection,
  createMockTwitchPlatform,
  createMockYouTubePlatform,
  createMockTikTokPlatform,
  createMockDisplayQueue,
} from "../helpers/mock-factories";
import { setupAutomatedCleanup } from "../helpers/mock-lifecycle";
import { createAppRuntimeTestDependencies } from "../helpers/runtime-test-harness";
import testClock from "../helpers/test-clock";
import { safeDelay } from "../../src/utils/timeout-validator";
import { AppRuntime } from "../../src/main";
import { ViewerCountSystem } from "../../src/utils/viewer-count";

type PlatformName = "youtube" | "twitch" | "tiktok";
type AppRuntimeConfig = ConstructorParameters<typeof AppRuntime>[0];
type AppRuntimeDependencies = ConstructorParameters<typeof AppRuntime>[1];
type ViewerCountPlatform = {
  getViewerCount: TestMockFn<[], Promise<number>>;
};
type PlatformRegistry = Record<PlatformName, ViewerCountPlatform>;
type MockPlatformLifecycleService = ReturnType<
  typeof createMockPlatformLifecycleService
>;
type ConfigOverrides = Parameters<typeof createConfigFixture>[0];

const createMockPlatformLifecycleService = () => ({
  platforms: {} as Partial<PlatformRegistry>,
  initializeAllPlatforms: createMockFn().mockResolvedValue({}),
  getAllPlatforms: createMockFn<[], Partial<PlatformRegistry>>(() => ({})),
  getPlatforms: createMockFn<[], Partial<PlatformRegistry>>(() => ({})),
  getPlatform: createMockFn<[PlatformName], ViewerCountPlatform | null>(() => null),
  isPlatformAvailable: createMockFn<[PlatformName], boolean>(() => false),
  getPlatformConnectionTime: createMockFn(() => testClock.now()),
  recordPlatformConnection: createMockFn(),
  disconnectAll: createMockFn().mockResolvedValue(),
  waitForBackgroundInits: createMockFn().mockResolvedValue(),
});

const createMockGoalsManager = () => ({
  initializeGoalDisplay: createMockFn().mockResolvedValue(),
  processDonationGoal: createMockFn(),
});

setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  logPerformanceMetrics: true,
});

describe("ViewerCount System Activation Integration", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let configOverrides: ConfigOverrides;
  let configFixture: AppRuntimeConfig;
  let mockOBSManager: ReturnType<typeof createMockOBSConnection>;
  let mockYouTubePlatform: ReturnType<typeof createMockYouTubePlatform> &
    ViewerCountPlatform;
  let mockTwitchPlatform: ReturnType<typeof createMockTwitchPlatform> &
    ViewerCountPlatform;
  let mockTikTokPlatform: ReturnType<typeof createMockTikTokPlatform> &
    ViewerCountPlatform;
  let mockDisplayQueue: ReturnType<typeof createMockDisplayQueue>;
  let mockPlatformLifecycleService: MockPlatformLifecycleService;
  let mockGoalsManager: ReturnType<typeof createMockGoalsManager>;
  let buildAppRuntimeDependencies: (
    overrides?: Record<string, unknown>,
  ) => AppRuntimeDependencies;

  const registerMockPlatforms = () => {
    const platforms: PlatformRegistry = {
      youtube: mockYouTubePlatform,
      twitch: mockTwitchPlatform,
      tiktok: mockTikTokPlatform,
    };

    mockPlatformLifecycleService.platforms = platforms;
    mockPlatformLifecycleService.getAllPlatforms.mockImplementation(() => ({
      ...platforms,
    }));
    mockPlatformLifecycleService.getPlatforms.mockImplementation(() => ({
      ...platforms,
    }));
    mockPlatformLifecycleService.getPlatform.mockImplementation(
      (platform: PlatformName) => platforms[platform] || null,
    );
    mockPlatformLifecycleService.isPlatformAvailable.mockImplementation(
      (platform: PlatformName) => !!platforms[platform],
    );

    return platforms;
  };

  beforeEach(() => {
    testClock.reset();

    configOverrides = {
      general: {
        debug: true,
        viewerCountPollingInterval: 60,
      },
      youtube: {
        enabled: true,
        viewerCountEnabled: true,
        viewerCountSource: "youtube-viewer-count",
      },
      twitch: {
        enabled: true,
        viewerCountEnabled: true,
        viewerCountSource: "twitch-viewer-count",
      },
      tiktok: {
        enabled: true,
        viewerCountEnabled: true,
        viewerCountSource: "tiktok-viewer-count",
      },
      obs: { enabled: true },
    };
    configFixture = createConfigFixture(configOverrides) as unknown as AppRuntimeConfig;

    mockOBSManager = createMockOBSConnection();
    mockOBSManager.isConnected.mockReturnValue(true);

    mockGoalsManager = createMockGoalsManager();

    mockYouTubePlatform = createMockYouTubePlatform() as ReturnType<
      typeof createMockYouTubePlatform
    > & ViewerCountPlatform;
    mockYouTubePlatform.getViewerCount = createMockFn<[], Promise<number>>().mockResolvedValue(150);

    mockTwitchPlatform = createMockTwitchPlatform() as ReturnType<
      typeof createMockTwitchPlatform
    > & ViewerCountPlatform;
    mockTwitchPlatform.getViewerCount = createMockFn<[], Promise<number>>().mockResolvedValue(75);

    mockTikTokPlatform = createMockTikTokPlatform() as ReturnType<
      typeof createMockTikTokPlatform
    > & ViewerCountPlatform;
    mockTikTokPlatform.getViewerCount = createMockFn<[], Promise<number>>().mockResolvedValue(200);

    mockDisplayQueue = createMockDisplayQueue();

    mockPlatformLifecycleService = createMockPlatformLifecycleService();
    registerMockPlatforms();

    buildAppRuntimeDependencies = (overrides = {}) => {
      const logger = noOpLogger;
      return createAppRuntimeTestDependencies({
        configOverrides,
        displayQueue: mockDisplayQueue,
        logger,
        overrides: {
          obs: {
            connectionManager: mockOBSManager,
            goalsManager: mockGoalsManager,
          },
          platformLifecycleService: mockPlatformLifecycleService,
          logging: logger,
          ...overrides,
        } as Record<string, unknown>,
      }).dependencies as AppRuntimeDependencies;
    };

  });

  describe("when system starts with YouTube enabled and live", () => {
    test(
      "should activate ViewerCount polling system",
      async () => {
        const app = new AppRuntime(
          configFixture,
          buildAppRuntimeDependencies(),
        );

        app.viewerCountSystem = new ViewerCountSystem({
          platformProvider: () => app.getPlatforms(),
          logger: noOpLogger,
          config: configFixture,
        });

        app.viewerCountSystem.updateStreamStatus("youtube", true);

        await app.viewerCountSystem.initialize();
        await app.viewerCountSystem.startPolling();

        await safeDelay(100);

        expect(app.viewerCountSystem.isPolling).toBe(true);
        expect(app.viewerCountSystem.isStreamLive("youtube")).toBe(true);

        expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();

        expect(app.viewerCountSystem.counts.youtube).toBe(150);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should poll viewer counts for all live platforms",
      async () => {
        const app = new AppRuntime(
          configFixture,
          buildAppRuntimeDependencies(),
        );

        app.viewerCountSystem = new ViewerCountSystem({
          platformProvider: () => app.getPlatforms(),
          logger: noOpLogger,
          config: configFixture,
        });

        app.viewerCountSystem.updateStreamStatus("youtube", true);
        app.viewerCountSystem.updateStreamStatus("twitch", true);
        app.viewerCountSystem.updateStreamStatus("tiktok", true);

        await app.viewerCountSystem.initialize();
        await app.viewerCountSystem.startPolling();

        await safeDelay(100);

        expect(app.viewerCountSystem.isPolling).toBe(true);
        expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();
        expect(mockTwitchPlatform.getViewerCount).toHaveBeenCalled();
        expect(mockTikTokPlatform.getViewerCount).toHaveBeenCalled();

        expect(app.viewerCountSystem.counts.youtube).toBe(150);
        expect(app.viewerCountSystem.counts.twitch).toBe(75);
        expect(app.viewerCountSystem.counts.tiktok).toBe(200);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should not poll platforms that are offline",
      async () => {
        const app = new AppRuntime(
          configFixture,
          buildAppRuntimeDependencies(),
        );

        app.viewerCountSystem = new ViewerCountSystem({
          platformProvider: () => app.getPlatforms(),
          logger: noOpLogger,
          config: configFixture,
        });

        app.viewerCountSystem.updateStreamStatus("youtube", true);
        app.viewerCountSystem.updateStreamStatus("twitch", false);
        app.viewerCountSystem.updateStreamStatus("tiktok", false);

        await app.viewerCountSystem.initialize();
        await app.viewerCountSystem.startPolling();

        await safeDelay(100);

        expect(app.viewerCountSystem.isPolling).toBe(true);
        expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();
        expect(mockTwitchPlatform.getViewerCount).not.toHaveBeenCalled();
        expect(mockTikTokPlatform.getViewerCount).not.toHaveBeenCalled();

        expect(app.viewerCountSystem.counts.youtube).toBe(150);
        expect(app.viewerCountSystem.counts.twitch).toBe(0);
        expect(app.viewerCountSystem.counts.tiktok).toBe(0);
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("when ViewerCount system activation is driven by app.start()", () => {
    test(
      "should demonstrate the integration flow that should work",
      async () => {
        const app = new AppRuntime(
          configFixture,
          buildAppRuntimeDependencies(),
        );

        app.viewerCountSystem = new ViewerCountSystem({
          platformProvider: () => app.getPlatforms(),
          logger: noOpLogger,
          config: configFixture,
        });

        app.initializePlatforms = createMockFn().mockResolvedValue();

        app.viewerCountSystem.updateStreamStatus("youtube", true);

        await app.viewerCountSystem.initialize();

        await app.start();

        await safeDelay(100);

        expect(app.viewerCountSystem.isPolling).toBe(true);
        expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();
      },
      TEST_TIMEOUTS.SLOW,
    );
  });

  describe("when stream status changes after startup", () => {
    test(
      "should start polling when stream goes live",
      async () => {
        const app = new AppRuntime(
          configFixture,
          buildAppRuntimeDependencies(),
        );

        app.viewerCountSystem = new ViewerCountSystem({
          platformProvider: () => app.getPlatforms(),
          logger: noOpLogger,
          config: configFixture,
        });

        app.viewerCountSystem.updateStreamStatus("youtube", false);
        app.viewerCountSystem.updateStreamStatus("twitch", false);
        app.viewerCountSystem.updateStreamStatus("tiktok", false);

        await app.viewerCountSystem.initialize();
        await app.viewerCountSystem.startPolling();

        app.viewerCountSystem.updateStreamStatus("youtube", true);

        await safeDelay(100);

        expect(app.viewerCountSystem.isPolling).toBe(true);
        expect(app.viewerCountSystem.isStreamLive("youtube")).toBe(true);
        expect(mockYouTubePlatform.getViewerCount).toHaveBeenCalled();
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should stop polling when stream goes offline",
      async () => {
        const app = new AppRuntime(
          configFixture,
          buildAppRuntimeDependencies(),
        );

        app.viewerCountSystem = new ViewerCountSystem({
          platformProvider: () => app.getPlatforms(),
          logger: noOpLogger,
          config: configFixture,
        });

        app.viewerCountSystem.updateStreamStatus("youtube", true);
        await app.viewerCountSystem.initialize();
        await app.viewerCountSystem.startPolling();

        mockYouTubePlatform.getViewerCount.mockClear();

        app.viewerCountSystem.updateStreamStatus("youtube", false);

        await safeDelay(100);

        expect(app.viewerCountSystem.isStreamLive("youtube")).toBe(false);
        expect(app.viewerCountSystem.counts.youtube).toBe(0);
      },
      TEST_TIMEOUTS.FAST,
    );
  });
});
