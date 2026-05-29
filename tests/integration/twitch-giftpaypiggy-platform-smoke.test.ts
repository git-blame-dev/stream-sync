import { describe, test, afterEach, expect } from "bun:test";

import EventEmitter from "events";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import NotificationManager from "../../src/notifications/NotificationManager";
import { createTestAppRuntime } from "../helpers/runtime-test-harness";
import { createMockDisplayQueue, noOpLogger } from "../helpers/mock-factories";
import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { createConfigFixture } from "../helpers/config-fixture";
import { waitFor } from "../helpers/event-driven-testing";

type EventBusHandler = (payload: unknown) => void | Promise<void>;
type EventBus = {
  emit: (eventName: string, payload: unknown) => boolean;
  on: (eventName: string, handler: EventBusHandler) => EventEmitter;
  subscribe: (eventName: string, handler: EventBusHandler) => () => void;
};
type RuntimeOptions = NonNullable<Parameters<typeof createTestAppRuntime>[1]>;
type RuntimeEventBus = NonNullable<RuntimeOptions["eventBus"]>;
type GiftPaypiggyPayload = {
  username: string;
  userId: string;
  giftCount: number;
  tier: string;
  timestamp: string;
};
type PlatformHandlers = {
  onGiftPaypiggy: (payload: GiftPaypiggyPayload) => void;
};
type QueueItem = {
  type: string;
  platform: string;
  data: Record<string, unknown>;
};
type CopyExpectations = {
  username?: string;
  keyword?: string;
  count?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const requireQueueItem = (value: unknown): QueueItem => {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) {
    throw new Error("Expected queued display item");
  }
  expect(typeof value.type).toBe("string");
  expect(typeof value.platform).toBe("string");
  expect(isRecord(value.data)).toBe(true);
  if (
    typeof value.type !== "string" ||
    typeof value.platform !== "string" ||
    !isRecord(value.data)
  ) {
    throw new Error("Queued display item has invalid shape");
  }
  return { type: value.type, platform: value.platform, data: value.data };
};

const createRuntimeEventBus = (eventBus: EventBus): RuntimeEventBus => ({
  emit: (eventName: string, payload: unknown) => {
    eventBus.emit(eventName, payload);
  },
  subscribe: (
    eventName: string,
    handler: (event: Record<string, unknown>) => void | Promise<void>,
  ) =>
    eventBus.subscribe(eventName, (payload) => {
      if (isRecord(payload)) {
        return handler(payload);
      }
      return handler({});
    }),
});

describe("Twitch giftpaypiggy platform flow (smoke)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const createEventBus = (): EventBus => {
    const emitter = new EventEmitter();
    return {
      emit: emitter.emit.bind(emitter),
      on: emitter.on.bind(emitter),
      subscribe: (event: string, handler: EventBusHandler) => {
        emitter.on(event, handler);
        return () => {
          emitter.off(event, handler);
        };
      },
    };
  };

  const assertNonEmptyString = (value: unknown) => {
    expect(typeof value).toBe("string");
    if (typeof value !== "string") {
      throw new Error("Expected non-empty string");
    }
    expect(value.trim()).not.toBe("");
  };

  const assertUserFacingOutput = (
    data: Record<string, unknown>,
    { username, keyword, count }: CopyExpectations,
  ) => {
    expect(typeof data.displayMessage).toBe("string");
    expect(typeof data.ttsMessage).toBe("string");
    expect(typeof data.logMessage).toBe("string");
    if (
      typeof data.displayMessage !== "string" ||
      typeof data.ttsMessage !== "string" ||
      typeof data.logMessage !== "string"
    ) {
      throw new Error("Expected user-facing notification copy");
    }
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
      twitch: { enabled: true },
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
      config: { twitch: { enabled: true } },
      eventBus,
      logger,
    });

    const { runtime } = createTestAppRuntime(configOverrides, {
      overrides: {
        eventBus: createRuntimeEventBus(eventBus),
        notificationManager,
        displayQueue,
        logger,
      },
    });

    class MockTwitchPlatform {
      async initialize(handlers: PlatformHandlers) {
        handlers.onGiftPaypiggy({
          username: "TestGifter",
          userId: "tw-test-gifter-1",
          giftCount: 5,
          tier: "1000",
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
        twitch: MockTwitchPlatform,
      });
      await waitFor(() => displayQueue.addItem.mock.calls.length === 1, {
        timeout: 100,
        interval: 1,
      });

      expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
      const queued = requireQueueItem(displayQueue.addItem.mock.calls[0]?.[0]);
      expect(queued.type).toBe("platform:giftpaypiggy");
      expect(queued.platform).toBe("twitch");
      expect(queued.data.username).toBe("TestGifter");
      expect(queued.data.giftCount).toBe(5);
      expect(queued.data.tier).toBe("1000");
      assertUserFacingOutput(queued.data, {
        username: "TestGifter",
        keyword: "subscription",
        count: 5,
      });
    } finally {
      runtime.platformEventRouter?.dispose();
      platformLifecycleService.dispose();
    }
  });
});
