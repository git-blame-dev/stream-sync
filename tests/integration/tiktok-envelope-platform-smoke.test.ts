import { describe, test, afterEach, expect } from "bun:test";

import EventEmitter from "events";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import NotificationManager from "../../src/notifications/NotificationManager";
import { createTestAppRuntime } from "../helpers/runtime-test-harness";
import { createMockDisplayQueue, noOpLogger } from "../helpers/mock-factories";
import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { createConfigFixture } from "../helpers/config-fixture";

type TestEventHandler = (event: Record<string, unknown>) => Promise<void> | void;
type TestEventBus = {
  emit: (event: string, payload: unknown) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => EventEmitter;
  subscribe: (event: string, handler: TestEventHandler) => () => void;
};
type UserFacingData = {
  displayMessage: string;
  ttsMessage: string;
  logMessage: string;
  username?: string;
  currency?: string;
};
type QueueItem = { type: string; platform: string; data: UserFacingData };
type LifecycleHandlers = { onEnvelope: (payload: Record<string, unknown>) => void };

const requireQueueItem = (value: unknown): QueueItem => {
  if (!value || typeof value !== "object") {
    throw new Error("Expected display queue item");
  }
  const record = value as Record<string, unknown>;
  if (!record.data || typeof record.data !== "object") {
    throw new Error("Expected queued item data");
  }
  return record as QueueItem;
};

describe("TikTok envelope platform flow (smoke)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const createEventBus = (): TestEventBus => {
    const emitter = new EventEmitter();
    return {
      emit: (event: string, payload: unknown) => {
        emitter.emit(event, payload);
      },
      on: emitter.on.bind(emitter),
      subscribe: (event: string, handler: TestEventHandler) => {
        const listener = (payload: unknown) => {
          if (payload && typeof payload === "object") {
            void handler(payload as Record<string, unknown>);
          }
        };
        emitter.on(event, listener);
        return () => emitter.off(event, listener);
      },
    };
  };

  const assertNonEmptyString = (value: string) => {
    expect(typeof value).toBe("string");
    expect(value.trim()).not.toBe("");
  };

  const assertUserFacingOutput = (
    data: UserFacingData,
    { username, keyword }: { username: string; keyword: string },
  ) => {
    assertNonEmptyString(data.displayMessage);
    assertNonEmptyString(data.ttsMessage);
    assertNonEmptyString(data.logMessage);

    expectNoTechnicalArtifacts(data.displayMessage);
    expectNoTechnicalArtifacts(data.ttsMessage);
    expectNoTechnicalArtifacts(data.logMessage);

    if (username) {
      expect(data.displayMessage).toContain(username);
      expect(data.ttsMessage).toContain(username);
      expect(data.logMessage).toContain(username);
    }
    if (keyword) {
      const normalizedKeyword = keyword.toLowerCase();
      expect(data.displayMessage.toLowerCase()).toContain(normalizedKeyword);
      expect(data.ttsMessage.toLowerCase()).toContain(normalizedKeyword);
      expect(data.logMessage.toLowerCase()).toContain(normalizedKeyword);
    }
  };

  test("routes envelope through lifecycle, router, and runtime", async () => {
    const eventBus = createEventBus();
    const logger = noOpLogger;
    const displayQueue = createMockDisplayQueue();
    const configOverrides = {
      general: {
        debugEnabled: false,
        giftsEnabled: true,
        paypiggiesEnabled: true,
      },
      tiktok: { enabled: true },
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
      config: { tiktok: { enabled: true } },
      eventBus,
      logger,
    });

    const { runtime } = createTestAppRuntime(configOverrides, {
      eventBus,
      notificationManager,
      displayQueue,
      logger,
    });

    class MockTikTokPlatform {
      async initialize(handlers: LifecycleHandlers) {
        handlers.onEnvelope({
          type: "platform:envelope",
          username: "ChestSender",
          userId: "tt-envelope-1",
          giftType: "Treasure Chest",
          giftCount: 1,
          amount: 50,
          currency: "coins",
          id: "tt-envelope-event-1",
          timestamp: "2024-01-01T00:00:00.000Z",
        });
      }

      on() {}

      cleanup() {
        return Promise.resolve();
      }
    }

    try {
      const platformModules: Parameters<PlatformLifecycleService["initializeAllPlatforms"]>[0] = {
        tiktok: MockTikTokPlatform,
      };
      await platformLifecycleService.initializeAllPlatforms(platformModules);
      await platformLifecycleService.waitForBackgroundInits();
      await new Promise(setImmediate);

      expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
      const queued = requireQueueItem(displayQueue.addItem.mock.calls[0]?.[0]);
      expect(queued.type).toBe("platform:envelope");
      expect(queued.platform).toBe("tiktok");
      expect(queued.data.username).toBe("ChestSender");
      expect(queued.data.currency).toBe("coins");
      assertUserFacingOutput(queued.data, {
        username: "ChestSender",
        keyword: "treasure chest",
      });
    } finally {
      runtime.platformEventRouter?.dispose();
      platformLifecycleService.dispose();
    }
  });
});
