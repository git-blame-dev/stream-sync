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
type TestEventBus = {
  emit: (event: string, payload: unknown) => void;
  on: (event: string, handler: EventHandler) => EventEmitter;
  subscribe: (event: string, handler: EventHandler) => () => void;
};
type GiftPaypiggyHandlers = {
  onGiftPaypiggy: (payload: GiftPaypiggyPayload) => void;
};
type GiftPaypiggyPayload = {
  username: string;
  userId: string;
  giftCount: number;
  timestamp: string;
};
type UserFacingGiftPaypiggyData = GiftPaypiggyPayload & {
  displayMessage: string;
  ttsMessage: string;
  logMessage: string;
};
type QueuedGiftPaypiggy = {
  type: "platform:giftpaypiggy";
  platform: "youtube";
  data: UserFacingGiftPaypiggyData;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

function assertQueuedGiftPaypiggy(
  value: unknown,
): asserts value is QueuedGiftPaypiggy {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) throw new Error("Queued item must be an object");
  expect(value.type).toBe("platform:giftpaypiggy");
  expect(value.platform).toBe("youtube");
  expect(isRecord(value.data)).toBe(true);
  if (!isRecord(value.data)) throw new Error("Queued data must be an object");
  expect(value.data.username).toBe("GiftMember");
  expect(value.data.userId).toBe("yt-gifter-1");
  expect(value.data.giftCount).toBe(5);
  expect(typeof value.data.timestamp).toBe("string");
  expect(typeof value.data.displayMessage).toBe("string");
  expect(typeof value.data.ttsMessage).toBe("string");
  expect(typeof value.data.logMessage).toBe("string");
}

describe("YouTube giftpaypiggy platform flow (smoke)", () => {
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
      subscribe: (event: string, handler: EventHandler) => {
        emitter.on(event, handler);
        return () => emitter.off(event, handler);
      },
    };
  };

  const assertNonEmptyString = (value: string) => {
    expect(typeof value).toBe("string");
    expect(value.trim()).not.toBe("");
  };

  const assertUserFacingOutput = (
    data: UserFacingGiftPaypiggyData,
    {
      username,
      keyword,
      count,
    }: { username?: string; keyword?: string; count?: number },
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
    if (count !== undefined) {
      const countText = String(count);
      expect(data.displayMessage).toContain(countText);
      expect(data.ttsMessage).toContain(countText);
      expect(data.logMessage).toContain(countText);
    }
  };

  test("routes giftpaypiggy through lifecycle, router, and runtime", async () => {
    const eventBus = createEventBus();
    const logger = noOpLogger;
    const displayQueue = createMockDisplayQueue();
    const configOverrides = {
      general: {
        debugEnabled: false,
        giftsEnabled: true,
        paypiggiesEnabled: true,
      },
      youtube: { enabled: true, username: "test-channel" },
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
    const { runtime } = createTestAppRuntime(configOverrides, {
      eventBus,
      notificationManager,
      displayQueue,
      logger,
    });

    class MockYouTubePlatform {
      initialize(handlers: GiftPaypiggyHandlers): void {
        handlers.onGiftPaypiggy({
          username: "GiftMember",
          userId: "yt-gifter-1",
          giftCount: 5,
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
      await Promise.resolve();
      await Promise.resolve();

      expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
      const firstAddItemCall = displayQueue.addItem.mock.calls[0];
      expect(firstAddItemCall).toBeDefined();
      if (!firstAddItemCall) throw new Error("Expected display queue item");
      const [queued] = firstAddItemCall;
      assertQueuedGiftPaypiggy(queued);
      assertUserFacingOutput(queued.data, {
        username: "GiftMember",
        keyword: "membership",
        count: 5,
      });
    } finally {
      runtime.platformEventRouter?.dispose();
      platformLifecycleService.dispose();
    }
  });
});
