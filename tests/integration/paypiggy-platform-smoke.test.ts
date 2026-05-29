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

type PlatformKey = "twitch" | "youtube" | "tiktok";
type HandlerName = "onPaypiggy";
type PlatformHandlers = Record<HandlerName, (payload: PaypiggyPayload) => void>;
type PlatformConfigOverride = { enabled: boolean; username?: string };
type EventBusHandler = (payload: unknown) => void | Promise<void>;
type EventBus = {
  emit: (eventName: string, payload: unknown) => boolean;
  on: (eventName: string, handler: EventBusHandler) => EventEmitter;
  subscribe: (eventName: string, handler: EventBusHandler) => () => void;
};
type RuntimeOptions = NonNullable<Parameters<typeof createTestAppRuntime>[1]>;
type RuntimeEventBus = NonNullable<RuntimeOptions["eventBus"]>;
type PaypiggyPayload = {
  username: string;
  userId: string;
  tier?: string;
  membershipLevel?: string;
  months?: number;
  message?: string;
  timestamp: string;
};
type QueueItem = {
  type: string;
  platform: PlatformKey;
  data: Record<string, unknown>;
};
type CopyExpectations = {
  username?: string;
  keyword?: string;
  logKeyword?: string;
  count?: number;
};
type PaypiggySmokeCase = {
  platformKey: PlatformKey;
  handlerName: HandlerName;
  payload: PaypiggyPayload;
  assertFn: (queued: QueueItem) => void;
  copyExpectations: CopyExpectations;
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
  return { type: value.type, platform: value.platform as PlatformKey, data: value.data };
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

describe("Paypiggy platform flows (smoke)", () => {
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
    { username, keyword, logKeyword, count }: CopyExpectations,
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
      const normalizedLogKeyword = (logKeyword || keyword).toLowerCase();
      expect(data.logMessage.toLowerCase()).toContain(normalizedLogKeyword);
    }
    if (count !== undefined) {
      const countText = String(count);
      expect(data.displayMessage).toContain(countText);
      expect(data.ttsMessage).toContain(countText);
      expect(data.logMessage).toContain(countText);
    }
  };

  const createHarness = (platformKey: PlatformKey) => {
    const eventBus = createEventBus();
    const logger = noOpLogger;
    const displayQueue = createMockDisplayQueue();
    const platformConfigOverride: PlatformConfigOverride = { enabled: true };
    if (platformKey === "youtube") {
      platformConfigOverride.username = "test-channel";
    }
    const configOverrides = {
      general: {
        debugEnabled: false,
        giftsEnabled: true,
        paypiggiesEnabled: true,
      },
      [platformKey]: platformConfigOverride,
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

    const lifecyclePlatformConfig: PlatformConfigOverride = { enabled: true };
    if (platformKey === "youtube") {
      lifecyclePlatformConfig.username = "test-channel";
    }

    const platformLifecycleService = new PlatformLifecycleService({
      config: { [platformKey]: lifecyclePlatformConfig },
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

    return {
      eventBus,
      logger,
      displayQueue,
      config,
      notificationManager,
      platformLifecycleService,
      runtime,
    };
  };

  const runPaypiggySmoke = async ({
    platformKey,
    handlerName,
    payload,
    assertFn,
    copyExpectations,
  }: PaypiggySmokeCase) => {
    const harness = createHarness(platformKey);

    class MockPlatform {
      async initialize(handlers: PlatformHandlers) {
        handlers[handlerName](payload);
      }

      on() {}

      cleanup() {
        return Promise.resolve();
      }
    }

    try {
      await harness.platformLifecycleService.initializeAllPlatforms({
        [platformKey]: MockPlatform,
      });
      await harness.platformLifecycleService.waitForBackgroundInits();
      await waitFor(
        () => harness.displayQueue.addItem.mock.calls.length === 1,
        { timeout: 100, interval: 1 },
      );

      expect(harness.displayQueue.addItem).toHaveBeenCalledTimes(1);
      const queued = requireQueueItem(harness.displayQueue.addItem.mock.calls[0]?.[0]);
      expect(queued.type).toBe("platform:paypiggy");
      expect(queued.platform).toBe(platformKey);
      assertUserFacingOutput(queued.data, copyExpectations);
      assertFn(queued);
    } finally {
      harness.runtime.platformEventRouter?.dispose();
      harness.platformLifecycleService.dispose();
    }
  };

  test("routes Twitch paypiggy through lifecycle, router, and runtime", async () => {
    await runPaypiggySmoke({
      platformKey: "twitch",
      handlerName: "onPaypiggy",
      payload: {
        username: "SubUser",
        userId: "tw-sub-1",
        tier: "1000",
        months: 1,
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      copyExpectations: {
        username: "SubUser",
        keyword: "subscribed",
        logKeyword: "subscriber",
      },
      assertFn: (queued) => {
        expect(queued.data.username).toBe("SubUser");
        expect(queued.data.tier).toBe("1000");
        expect(queued.data.months).toBe(1);
      },
    });
  });

  test("routes YouTube memberships through lifecycle, router, and runtime", async () => {
    await runPaypiggySmoke({
      platformKey: "youtube",
      handlerName: "onPaypiggy",
      payload: {
        username: "MemberUser",
        userId: "yt-member-1",
        membershipLevel: "Member",
        months: 2,
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      copyExpectations: {
        username: "MemberUser",
        keyword: "member",
      },
      assertFn: (queued) => {
        expect(queued.data.username).toBe("MemberUser");
        expect(queued.data.membershipLevel).toBe("Member");
        expect(queued.data.months).toBe(2);
      },
    });
  });

  test("routes YouTube membership renewals with renewal copy", async () => {
    await runPaypiggySmoke({
      platformKey: "youtube",
      handlerName: "onPaypiggy",
      payload: {
        username: "MilestoneUser",
        userId: "yt-member-10",
        membershipLevel: "Member",
        months: 10,
        message: "Thanks for the membership!",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      copyExpectations: {
        username: "MilestoneUser",
        keyword: "renewed membership",
        logKeyword: "member renewal",
        count: 10,
      },
      assertFn: (queued) => {
        expect(queued.data.displayMessage).toContain("renewed membership");
        expect(queued.data.ttsMessage).toContain("renewed membership");
        expect(queued.data.months).toBe(10);
        expect(queued.data.message).toBe("Thanks for the membership!");
      },
    });
  });

  test("routes TikTok subscriptions through lifecycle, router, and runtime", async () => {
    await runPaypiggySmoke({
      platformKey: "tiktok",
      handlerName: "onPaypiggy",
      payload: {
        username: "TikFan",
        userId: "tt-sub-1",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      copyExpectations: {
        username: "TikFan",
        keyword: "subscribed",
        logKeyword: "subscriber",
      },
      assertFn: (queued) => {
        expect(queued.data.username).toBe("TikFan");
        expect(queued.data.tier).toBeUndefined();
      },
    });
  });
});
