import { describe, test, afterEach, expect } from "bun:test";
import EventEmitter from "events";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import NotificationManager from "../../src/notifications/NotificationManager";
import { YouTubePlatform } from "../../src/platforms/youtube";
import { createTestAppRuntime } from "../helpers/runtime-test-harness";
import { createMockDisplayQueue, noOpLogger } from "../helpers/mock-factories";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import {
  createConfigFixture,
  createYouTubeConfigFixture,
} from "../helpers/config-fixture";

type EventPayload = Record<string, unknown>;
type EventHandler = (event: EventPayload) => void | Promise<void>;
type ViewerCountUpdate = {
  platform: string;
  count: number;
  previousCount: number;
};

const createEventBus = () => {
  const emitter = new EventEmitter();
  return {
    emit: (event: string, payload: unknown) => emitter.emit(event, payload),
    on: (event: string, handler: EventHandler) => {
      emitter.on(event, handler);
      return undefined;
    },
    subscribe: (event: string, handler: EventHandler) => {
      emitter.on(event, handler);
      return () => {
        emitter.off(event, handler);
      };
    },
  };
};

describe("YouTube viewer count platform flow (smoke)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("routes viewer count updates from platform to runtime", async () => {
    const eventBus = createEventBus();
    const logger = noOpLogger;
    const displayQueue = createMockDisplayQueue();
    const configOverrides = {
      general: {},
      youtube: {
        enabled: true,
        viewerCountEnabled: true,
        username: "test-channel",
      },
      obs: { enabled: false },
    };
    const config = createConfigFixture(configOverrides);
    const notificationManager = new NotificationManager({
      displayQueue,
      logger,
      eventBus,
      config,
      constants: require("../../src/core/constants"),
      obsGoals: { processDonationGoal: createMockFn() },
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue(null),
      },
      userTrackingService: {
        isFirstMessage: createMockFn().mockResolvedValue(false),
      },
    });

    const platformLifecycleService = new PlatformLifecycleService({
      config: { youtube: { enabled: true, username: "test-channel" } },
      eventBus,
      logger,
    });

    const runtimePlatformLifecycleService = {
      getAllPlatforms: () => platformLifecycleService.getAllPlatforms(),
      initializeAllPlatforms: async (_platformModules: Record<string, unknown>) => ({}),
      disconnectAll: () => platformLifecycleService.disconnectAll(),
      getPlatformConnectionTime: (platformName: string) =>
        platformLifecycleService.getPlatformConnectionTime(platformName),
      getStatus: () => platformLifecycleService.getStatus(),
    };

    const { runtime } = createTestAppRuntime(configOverrides, {
      eventBus,
      notificationManager,
      displayQueue,
      logger,
      platformLifecycleService: runtimePlatformLifecycleService,
    });

    const platform = new YouTubePlatform(
      createYouTubeConfigFixture({ enabled: true, username: "test-channel" }),
      {
        logger,
        USER_AGENTS: ["test-agent"],
        streamDetectionService: {
          detectLiveStreams: createMockFn().mockResolvedValue({
            success: true,
            videoIds: [],
          }),
        },
      },
    );
    platform.handlers =
      platformLifecycleService.createDefaultEventHandlers("youtube");

    const updates: ViewerCountUpdate[] = [];
    runtime.viewerCountSystem.addObserver({
      getObserverId: () => "test-viewer-count-observer",
      onViewerCountUpdate: (update) => {
        updates.push(update);
      },
    });

    try {
      platform.updateViewerCountForStream("test-stream-1", 321);

      await Promise.resolve();

      expect(updates).toHaveLength(1);
      const [update] = updates;
      if (!update) {
        throw new Error("expected viewer count update");
      }
      expect(update.platform).toBe("youtube");
      expect(update.count).toBe(321);
      expect(update.previousCount).toBe(0);
    } finally {
      runtime.platformEventRouter?.dispose();
      platformLifecycleService.dispose();
    }
  });
});
