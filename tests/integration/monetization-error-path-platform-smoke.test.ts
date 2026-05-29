import { describe, it, expect, afterEach } from "bun:test";
import {
  createMockFn,
  clearAllMocks,
  restoreAllMocks,
} from "../helpers/bun-mock-utils";
import EventEmitter from "events";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import NotificationManager from "../../src/notifications/NotificationManager";
import { createMonetizationErrorPayload } from "../../src/utils/monetization-error-utils";
import { createMockDisplayQueue, noOpLogger } from "../helpers/mock-factories";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";
import { createConfigFixture } from "../helpers/config-fixture";
import { waitFor } from "../helpers/event-driven-testing";

type PlatformKey = "twitch" | "youtube" | "tiktok";
type NotificationType =
  | "platform:gift"
  | "platform:giftpaypiggy"
  | "platform:paypiggy"
  | "platform:envelope";
type PlatformConfigOverride = { enabled: boolean; username?: string };
type EventBusHandler = (payload: unknown) => void | Promise<void>;
type EventBus = {
  emit: (eventName: string, payload: unknown) => boolean;
  on: (eventName: string, handler: EventBusHandler) => EventEmitter;
  subscribe: (eventName: string, handler: EventBusHandler) => () => void;
};
type PlatformEvent = {
  platform: PlatformKey;
  type: NotificationType;
  data: Record<string, unknown>;
};
type PlatformHandlers = {
  onGift: (payload: Record<string, unknown>) => void;
  onGiftPaypiggy: (payload: Record<string, unknown>) => void;
  onPaypiggy: (payload: Record<string, unknown>) => void;
  onEnvelope: (payload: Record<string, unknown>) => void;
};
type QueueItem = {
  type: NotificationType;
  platform: PlatformKey;
  data: Record<string, unknown>;
};
type ErrorNotificationExpectations = {
  platform: PlatformKey;
  type: NotificationType;
  expectMissingUsername?: boolean;
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
  return {
    type: value.type as NotificationType,
    platform: value.platform as PlatformKey,
    data: value.data,
  };
};

const requirePlatformEvent = (value: unknown): PlatformEvent => {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Expected platform event payload");
  }
  expect(typeof value.platform).toBe("string");
  expect(typeof value.type).toBe("string");
  if (typeof value.platform !== "string" || typeof value.type !== "string") {
    throw new Error("Platform event has invalid shape");
  }
  return {
    platform: value.platform as PlatformKey,
    type: value.type as NotificationType,
    data: value.data,
  };
};

const requireFoundItem = (
  item: QueueItem | undefined,
  type: NotificationType,
): QueueItem => {
  expect(item).toBeDefined();
  if (!item) {
    throw new Error(`Expected queued ${type} item`);
  }
  return item;
};

describe("Monetization error-path platform flows (smoke)", () => {
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

  afterEach(() => {
    clearAllMocks();
    restoreAllMocks();
  });

  const createHarness = (platformKey: PlatformKey) => {
    const eventBus = createEventBus();
    const logger = noOpLogger;
    const displayQueue = createMockDisplayQueue();
    const platformConfigOverride: PlatformConfigOverride = { enabled: true };
    if (platformKey === "youtube") {
      platformConfigOverride.username = "test-channel";
    }
    const config = createConfigFixture({
      general: {
        debugEnabled: false,
        giftsEnabled: true,
        paypiggiesEnabled: true,
      },
      [platformKey]: platformConfigOverride,
      obs: { enabled: false },
    });
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

    const platformConfig: PlatformConfigOverride = { enabled: true };
    if (platformKey === "youtube") {
      platformConfig.username = "test-channel";
    }

    const platformLifecycleService = new PlatformLifecycleService({
      config: { [platformKey]: platformConfig },
      eventBus,
      logger,
    });

    const monetizationEvents = new Set([
      PlatformEvents.GIFT,
      PlatformEvents.PAYPIGGY,
      PlatformEvents.GIFTPAYPIGGY,
      PlatformEvents.ENVELOPE,
    ]);
    eventBus.on("platform:event", (payload: unknown) => {
      const platformEvent = requirePlatformEvent(payload);
      if (monetizationEvents.has(platformEvent.type)) {
        notificationManager.handleNotificationInternal(
          platformEvent.type,
          platformEvent.platform,
          platformEvent.data,
          true,
        );
      }
    });

    return {
      eventBus,
      logger,
      displayQueue,
      config,
      notificationManager,
      platformLifecycleService,
    };
  };

  const expectNonEmptyString = (value: unknown) => {
    expect(typeof value).toBe("string");
    if (typeof value !== "string") {
      throw new Error("Expected non-empty string");
    }
    expect(value.trim()).not.toBe("");
  };

  const assertErrorNotification = (
    item: QueueItem,
    { platform, type, expectMissingUsername = false }: ErrorNotificationExpectations,
  ) => {
    expect(item.type).toBe(type);
    expect(item.platform).toBe(platform);
    expect(item.data.isError).toBe(true);
    expectNonEmptyString(item.data.displayMessage);
    expectNonEmptyString(item.data.ttsMessage);
    expectNonEmptyString(item.data.logMessage);
    if (expectMissingUsername) {
      expect(item.data.username).toBeUndefined();
      expect(typeof item.data.displayMessage).toBe("string");
      if (typeof item.data.displayMessage !== "string") {
        throw new Error("Expected display message copy");
      }
      expect(item.data.displayMessage.toLowerCase()).not.toContain("from ");
    }
  };

  it("routes Twitch monetization parse errors through notifications", async () => {
    const harness = createHarness("twitch");

    class MockTwitchPlatform {
      async initialize(handlers: PlatformHandlers) {
        const giftError = createMonetizationErrorPayload({
          notificationType: "platform:gift",
          platform: "twitch",
          timestamp: "2024-01-01T00:00:00.000Z",
        });
        const giftpaypiggyError = createMonetizationErrorPayload({
          notificationType: "platform:giftpaypiggy",
          platform: "twitch",
          timestamp: "2024-01-01T00:00:00.000Z",
        });
        const paypiggyError = createMonetizationErrorPayload({
          notificationType: "platform:paypiggy",
          platform: "twitch",
          timestamp: "2024-01-01T00:00:00.000Z",
        });

        handlers.onGift(giftError);
        handlers.onGiftPaypiggy(giftpaypiggyError);
        handlers.onPaypiggy(paypiggyError);
      }

      on() {}

      cleanup() {
        return Promise.resolve();
      }
    }

    try {
      await harness.platformLifecycleService.initializeAllPlatforms({
        twitch: MockTwitchPlatform,
      });
      await harness.platformLifecycleService.waitForBackgroundInits();
      await waitFor(
        () => harness.displayQueue.addItem.mock.calls.length === 3,
        { timeout: 100, interval: 1 },
      );

      const items = harness.displayQueue.addItem.mock.calls.map(
        (call) => requireQueueItem(call[0]),
      );
      expect(items).toHaveLength(3);

      const giftItem = items.find((item) => item.type === "platform:gift");
      const giftpaypiggyItem = items.find(
        (item) => item.type === "platform:giftpaypiggy",
      );
      const paypiggyItem = items.find(
        (item) => item.type === "platform:paypiggy",
      );

      expect(giftItem).toBeTruthy();
      expect(giftpaypiggyItem).toBeTruthy();
      expect(paypiggyItem).toBeTruthy();

      assertErrorNotification(requireFoundItem(giftItem, "platform:gift"), {
        platform: "twitch",
        type: "platform:gift",
        expectMissingUsername: true,
      });
      assertErrorNotification(requireFoundItem(giftpaypiggyItem, "platform:giftpaypiggy"), {
        platform: "twitch",
        type: "platform:giftpaypiggy",
        expectMissingUsername: true,
      });
      assertErrorNotification(requireFoundItem(paypiggyItem, "platform:paypiggy"), {
        platform: "twitch",
        type: "platform:paypiggy",
        expectMissingUsername: true,
      });
    } finally {
      harness.platformLifecycleService.dispose();
    }
  });

  it("routes YouTube monetization parse errors through notifications", async () => {
    const harness = createHarness("youtube");

    class MockYouTubePlatform {
      async initialize(handlers: PlatformHandlers) {
        const superChatItem = {
          item: {
            author: { id: "yt-error-user", name: "TestViewer" },
            timestamp: 1700000000000,
          },
        };
        const giftMembershipItem = {
          item: {
            author: { id: "yt-error-gifter", name: "GiftBuyer" },
            timestamp: 1700000000000,
          },
        };
        const membershipItem = {
          item: {
            author: { id: "yt-error-member", name: "MemberUser" },
            memberMilestoneDurationInMonths: 3,
          },
        };

        this.dispatchWithHandler(handlers, "platform:gift", superChatItem);
        this.dispatchWithHandler(
          handlers,
          "platform:giftpaypiggy",
          giftMembershipItem,
        );
        this.dispatchWithHandler(handlers, "platform:paypiggy", membershipItem);
      }

      dispatchWithHandler(
        handlers: PlatformHandlers,
        type: NotificationType,
        _chatItem: Record<string, unknown>,
      ) {
        const errorPayload = createMonetizationErrorPayload({
          notificationType: type,
          platform: "youtube",
          isError: true,
          timestamp: "2024-01-01T00:00:00.000Z",
        });

        if (type === "platform:gift") {
          handlers.onGift(errorPayload);
          return;
        }
        if (type === "platform:giftpaypiggy") {
          handlers.onGiftPaypiggy(errorPayload);
          return;
        }
        if (type === "platform:paypiggy") {
          handlers.onPaypiggy(errorPayload);
        }
      }

      on() {}

      cleanup() {
        return Promise.resolve();
      }
    }

    try {
      await harness.platformLifecycleService.initializeAllPlatforms({
        youtube: MockYouTubePlatform,
      });
      await harness.platformLifecycleService.waitForBackgroundInits();
      await waitFor(
        () => harness.displayQueue.addItem.mock.calls.length === 3,
        { timeout: 100, interval: 1 },
      );

      const items = harness.displayQueue.addItem.mock.calls.map(
        (call) => requireQueueItem(call[0]),
      );
      expect(items).toHaveLength(3);

      const giftItem = items.find((item) => item.type === "platform:gift");
      const giftpaypiggyItem = items.find(
        (item) => item.type === "platform:giftpaypiggy",
      );
      const paypiggyItem = items.find(
        (item) => item.type === "platform:paypiggy",
      );

      expect(giftItem).toBeTruthy();
      expect(giftpaypiggyItem).toBeTruthy();
      expect(paypiggyItem).toBeTruthy();

      assertErrorNotification(requireFoundItem(giftItem, "platform:gift"), {
        platform: "youtube",
        type: "platform:gift",
        expectMissingUsername: true,
      });
      assertErrorNotification(requireFoundItem(giftpaypiggyItem, "platform:giftpaypiggy"), {
        platform: "youtube",
        type: "platform:giftpaypiggy",
        expectMissingUsername: true,
      });
      assertErrorNotification(requireFoundItem(paypiggyItem, "platform:paypiggy"), {
        platform: "youtube",
        type: "platform:paypiggy",
        expectMissingUsername: true,
      });
    } finally {
      harness.platformLifecycleService.dispose();
    }
  });

  it("routes TikTok monetization parse errors through notifications", async () => {
    const harness = createHarness("tiktok");

    class MockTikTokPlatform {
      async initialize(handlers: PlatformHandlers) {
        const giftError = createMonetizationErrorPayload({
          notificationType: "platform:gift",
          platform: "tiktok",
          timestamp: "2024-01-01T00:00:00.000Z",
        });
        const paypiggyError = createMonetizationErrorPayload({
          notificationType: "platform:paypiggy",
          platform: "tiktok",
          timestamp: "2024-01-01T00:00:00.000Z",
        });
        const envelopeError = createMonetizationErrorPayload({
          notificationType: "platform:envelope",
          platform: "tiktok",
          timestamp: "2024-01-01T00:00:00.000Z",
        });

        handlers.onGift(giftError);
        handlers.onPaypiggy(paypiggyError);
        handlers.onEnvelope(envelopeError);
      }

      on() {}

      cleanup() {
        return Promise.resolve();
      }
    }

    try {
      await harness.platformLifecycleService.initializeAllPlatforms({
        tiktok: MockTikTokPlatform,
      });
      await harness.platformLifecycleService.waitForBackgroundInits();
      await waitFor(
        () => harness.displayQueue.addItem.mock.calls.length === 3,
        { timeout: 100, interval: 1 },
      );

      const items = harness.displayQueue.addItem.mock.calls.map(
        (call) => requireQueueItem(call[0]),
      );
      expect(items).toHaveLength(3);

      const giftItem = items.find((item) => item.type === "platform:gift");
      const paypiggyItem = items.find(
        (item) => item.type === "platform:paypiggy",
      );
      const envelopeItem = items.find(
        (item) => item.type === "platform:envelope",
      );

      expect(giftItem).toBeTruthy();
      expect(paypiggyItem).toBeTruthy();
      expect(envelopeItem).toBeTruthy();

      assertErrorNotification(requireFoundItem(giftItem, "platform:gift"), {
        platform: "tiktok",
        type: "platform:gift",
        expectMissingUsername: true,
      });
      assertErrorNotification(requireFoundItem(paypiggyItem, "platform:paypiggy"), {
        platform: "tiktok",
        type: "platform:paypiggy",
        expectMissingUsername: true,
      });
      assertErrorNotification(requireFoundItem(envelopeItem, "platform:envelope"), {
        platform: "tiktok",
        type: "platform:envelope",
        expectMissingUsername: true,
      });
    } finally {
      harness.platformLifecycleService.dispose();
    }
  });
});
