import { describe, test, afterEach, expect } from "bun:test";

import EventEmitter from "events";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import NotificationManager from "../../src/notifications/NotificationManager";
import { createTestAppRuntime } from "../helpers/runtime-test-harness";
import { createMockDisplayQueue, noOpLogger } from "../helpers/mock-factories";
import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { createConfigFixture } from "../helpers/config-fixture";

type RuntimeEvent = Record<string, unknown>;
type EventHandler = (event: RuntimeEvent) => Promise<void> | void;
type PlatformHandlers = Parameters<PlatformLifecycleService["initializeAllPlatforms"]>[0] extends Record<string, infer Constructor>
  ? Constructor extends new (...args: never[]) => { initialize: (handlers: infer Handlers) => unknown }
    ? Handlers
    : { onGift: (payload: unknown) => void }
  : { onGift: (payload: unknown) => void };
type GiftQueueData = {
  giftType: string;
  currency: string;
  displayMessage: string;
  ttsMessage: string;
  logMessage: string;
  message?: string;
  parts?: unknown;
  userId?: string;
};
type QueuedGiftItem = {
  type: "platform:gift";
  platform: "youtube";
  data: GiftQueueData;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const isGiftQueueData = (value: unknown): value is GiftQueueData =>
  isRecord(value) &&
  typeof value.giftType === "string" &&
  typeof value.currency === "string" &&
  typeof value.displayMessage === "string" &&
  typeof value.ttsMessage === "string" &&
  typeof value.logMessage === "string";

const isQueuedGiftItem = (value: unknown): value is QueuedGiftItem =>
  isRecord(value) &&
  value.type === "platform:gift" &&
  value.platform === "youtube" &&
  isGiftQueueData(value.data);

describe("YouTube gift platform flow (smoke)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const createEventBus = () => {
    const emitter = new EventEmitter();
    return {
      emit: (event: string, payload: unknown) => {
        emitter.emit(event, payload);
      },
      on: (event: string, handler: EventHandler) => {
        emitter.on(event, handler);
      },
      subscribe: (event: string, handler: EventHandler) => {
        emitter.on(event, handler);
        return () => {
          emitter.off(event, handler);
        };
      },
    };
  };

  const assertNonEmptyString = (value: string) => {
    expect(typeof value).toBe("string");
    expect(value.trim()).not.toBe("");
  };

  const assertUserFacingOutput = (
    data: GiftQueueData,
    { username, keyword }: { username?: string; keyword?: string },
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

  const configOverrides = {
    general: {
      debugEnabled: false,
      giftsEnabled: true,
      paypiggiesEnabled: true,
    },
    youtube: { enabled: true, username: "test-channel" },
    obs: { enabled: false },
  };

  const createRuntimeDeps = () => {
    const eventBus = createEventBus();
    const logger = noOpLogger;
    const displayQueue = createMockDisplayQueue();
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

    const runtimeBundle = createTestAppRuntime(configOverrides, {
      eventBus,
      notificationManager,
      displayQueue,
      logger,
    });

    return {
      eventBus,
      logger,
      displayQueue,
      config,
      notificationManager,
      platformLifecycleService,
      runtimeBundle,
    };
  };

  test("routes Super Chat gifts through lifecycle, router, and runtime", async () => {
    const { displayQueue, platformLifecycleService, runtimeBundle } =
      createRuntimeDeps();

    class MockYouTubePlatform {
      async initialize(handlers: PlatformHandlers) {
        handlers.onGift({
          username: "ChatHero",
          userId: "yt-chat-1",
          giftType: "Super Chat",
          giftCount: 1,
          amount: 5,
          currency: "USD",
          id: "yt-superchat-1",
          timestamp: "2024-01-01T00:00:00.000Z",
        });
      }

      on() {}

      cleanup() {
        return Promise.resolve();
      }
    }

    try {
      await platformLifecycleService.initializeAllPlatforms({
        youtube: MockYouTubePlatform,
      });
      await new Promise(setImmediate);

      expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
      const [queued] = displayQueue.addItem.mock.calls[0] ?? [];
      expect(isQueuedGiftItem(queued)).toBe(true);
      if (!isQueuedGiftItem(queued)) {
        throw new Error("Expected a YouTube gift queue item");
      }
      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("youtube");
      expect(queued.data.giftType).toBe("Super Chat");
      expect(queued.data.currency).toBe("USD");
      expect(queued.data.displayMessage).toContain("Super Chat");
      assertUserFacingOutput(queued.data, {
        username: "ChatHero",
        keyword: "Super Chat",
      });
    } finally {
      runtimeBundle.runtime.platformEventRouter?.dispose();
      platformLifecycleService.dispose();
    }
  });

  test("routes Super Sticker gifts through lifecycle, router, and runtime", async () => {
    const { displayQueue, platformLifecycleService, runtimeBundle } =
      createRuntimeDeps();

    class MockYouTubePlatform {
      async initialize(handlers: PlatformHandlers) {
        handlers.onGift({
          username: "test-sticker-hero",
          userId: "yt-sticker-1",
          giftType: "Super Sticker",
          giftCount: 1,
          amount: 3,
          currency: "USD",
          message: "Nice sticker",
          giftImageUrl:
            "https://lh3.googleusercontent.com/test-supersticker=s176-rwa",
          id: "yt-supersticker-1",
          timestamp: "2024-01-01T00:00:00.000Z",
        });
      }

      on() {}

      cleanup() {
        return Promise.resolve();
      }
    }

    try {
      await platformLifecycleService.initializeAllPlatforms({
        youtube: MockYouTubePlatform,
      });
      await new Promise(setImmediate);

      expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
      const [queued] = displayQueue.addItem.mock.calls[0] ?? [];
      expect(isQueuedGiftItem(queued)).toBe(true);
      if (!isQueuedGiftItem(queued)) {
        throw new Error("Expected a YouTube gift queue item");
      }
      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("youtube");
      expect(queued.data.giftType).toBe("Super Sticker");
      expect(queued.data.message).toBe("Nice sticker");
      expect(queued.data.displayMessage).toContain("Super Sticker");
      expect(queued.data.parts).toEqual([
        {
          type: "emote",
          platform: "youtube",
          emoteId: "supersticker",
          imageUrl:
            "https://lh3.googleusercontent.com/test-supersticker=s176-rwa",
        },
        { type: "text", text: " Nice sticker" },
      ]);
      assertUserFacingOutput(queued.data, {
        username: "test-sticker-hero",
        keyword: "Super Sticker",
      });
    } finally {
      runtimeBundle.runtime.platformEventRouter?.dispose();
      platformLifecycleService.dispose();
    }
  });

  test("routes YouTube jewels gifts without userId through lifecycle, router, and runtime", async () => {
    const { displayQueue, platformLifecycleService, runtimeBundle } =
      createRuntimeDeps();

    class MockYouTubePlatform {
      async initialize(handlers: PlatformHandlers) {
        handlers.onGift({
          username: "test-jewels-user",
          giftType: "Girl power",
          giftCount: 1,
          amount: 300,
          currency: "jewels",
          id: "yt-jewels-1",
          timestamp: "2024-01-01T00:00:00.000Z",
          metadata: {
            missingFields: ["userId"],
          },
        });
      }

      on() {}

      cleanup() {
        return Promise.resolve();
      }
    }

    try {
      await platformLifecycleService.initializeAllPlatforms({
        youtube: MockYouTubePlatform,
      });
      await new Promise(setImmediate);

      expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
      const [queued] = displayQueue.addItem.mock.calls[0] ?? [];
      expect(isQueuedGiftItem(queued)).toBe(true);
      if (!isQueuedGiftItem(queued)) {
        throw new Error("Expected a YouTube gift queue item");
      }
      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("youtube");
      expect(queued.data.giftType).toBe("Girl power");
      expect(queued.data.currency).toBe("jewels");
      expect(queued.data.userId).toBeUndefined();
      expect(queued.data.displayMessage.toLowerCase()).toContain("jewels");
      assertUserFacingOutput(queued.data, {
        username: "test-jewels-user",
        keyword: "jewels",
      });
    } finally {
      runtimeBundle.runtime.platformEventRouter?.dispose();
      platformLifecycleService.dispose();
    }
  });
});
