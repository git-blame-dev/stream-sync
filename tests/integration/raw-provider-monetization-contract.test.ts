import { describe, test, expect, afterEach } from "bun:test";

import EventEmitter from "events";
import NotificationManager from "../../src/notifications/NotificationManager";
import { TikTokPlatform } from "../../src/platforms/tiktok";
import { YouTubePlatform } from "../../src/platforms/youtube";
import { createTwitchEventSubEventRouter } from "../../src/platforms/twitch/events/event-router.ts";
import { getSyntheticFixture } from "../helpers/platform-test-data";
import { createConfigFixture } from "../helpers/config-fixture";
import { createMockDisplayQueue, noOpLogger } from "../helpers/mock-factories";
import {
  createMockFn,
  restoreAllMocks,
} from "../helpers/bun-mock-utils";

type MonetizationType =
  | "platform:gift"
  | "platform:giftpaypiggy"
  | "platform:paypiggy";
type PlatformKey = "tiktok" | "twitch" | "youtube";
type QueueItem = {
  type: MonetizationType;
  platform: PlatformKey;
  data: Record<string, unknown>;
};
type EmittedPlatformPayload = Record<string, unknown>;
type TwitchRouterEvent = { type: string; payload: Record<string, unknown> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const requireQueueItem = (value: unknown): QueueItem => {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Expected queued display item");
  }
  return value as QueueItem;
};

const createNotificationHarness = () => {
  const eventBus = new EventEmitter();
  const displayQueue = createMockDisplayQueue();
  const config = createConfigFixture({
    general: {
      debugEnabled: false,
      giftsEnabled: true,
      paypiggiesEnabled: true,
    },
    tiktok: { enabled: true },
    twitch: { enabled: true },
    youtube: { enabled: true, username: "test-channel" },
    obs: { enabled: false },
  });
  const notificationManager = new NotificationManager({
    displayQueue,
    logger: noOpLogger,
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

  const enqueue = async (
    notificationType: MonetizationType,
    platform: PlatformKey,
    payload: Record<string, unknown>,
  ) => {
    await notificationManager.handleNotification(notificationType, platform, payload);
    const lastCall = displayQueue.addItem.mock.calls.at(-1);
    return requireQueueItem(lastCall?.[0]);
  };

  return { displayQueue, enqueue };
};

const createYouTubePlatform = () =>
  new YouTubePlatform(
    { enabled: true, username: "test-channel" },
    {
      logger: noOpLogger,
      streamDetectionService: {
        detectLiveStreams: createMockFn().mockResolvedValue({
          success: true,
          videoIds: [],
          detectionMethod: "test",
        }),
      },
      notificationManager: {
        emit: createMockFn(),
        on: createMockFn(),
        removeListener: createMockFn(),
      },
      USER_AGENTS: ["test-agent"],
      Innertube: null,
    },
  );

const createTikTokPlatform = () =>
  new TikTokPlatform(
    { enabled: true, giftAggregationEnabled: false },
    {
      logger: noOpLogger,
      TikTokWebSocketClient: class {},
      WebcastEvent: {
        CHAT: "chat",
        GIFT: "gift",
        FOLLOW: "follow",
        SHARE: "share",
        SOCIAL: "social",
        ROOM_USER: "roomUser",
        ENVELOPE: "envelope",
        SUBSCRIBE: "subscribe",
        SUPER_FAN: "superfan",
        ERROR: "error",
        DISCONNECT: "disconnect",
        STREAM_END: "streamEnd",
      },
      ControlEvent: {
        CONNECTED: "connected",
        DISCONNECTED: "disconnected",
        ERROR: "control-error",
      },
    },
  );

const requireFirstPayload = (payloads: EmittedPlatformPayload[]) => {
  const payload = payloads[0];
  expect(payload).toBeDefined();
  if (!payload) {
    throw new Error("Expected platform payload");
  }
  return payload;
};

describe("Raw provider monetization contract smokes", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("routes raw YouTube Super Chat to final display queue data", async () => {
    const { enqueue } = createNotificationHarness();
    const platform = createYouTubePlatform();
    const emitted: EmittedPlatformPayload[] = [];
    platform.handlers.onGift = (payload: unknown) => {
      if (isRecord(payload)) emitted.push(payload);
    };

    await platform.handleSuperChat(getSyntheticFixture("youtube", "superchat"));
    const queued = await enqueue("platform:gift", "youtube", requireFirstPayload(emitted));

    expect(queued.type).toBe("platform:gift");
    expect(queued.platform).toBe("youtube");
    expect(queued.data.username).toBe("SuperChatDonor");
    expect(queued.data.giftType).toBe("Super Chat");
    expect(queued.data.amount).toBe(25);
    expect(queued.data.currency).toBe("USD");
    expect(queued.data.displayMessage).toEqual(expect.stringContaining("Super Chat"));
  });

  test("routes raw YouTube gift purchase count aliases to final display queue data", async () => {
    const { enqueue } = createNotificationHarness();
    const platform = createYouTubePlatform();
    const emitted: EmittedPlatformPayload[] = [];
    platform.handlers.onGiftPaypiggy = (payload: unknown) => {
      if (isRecord(payload)) emitted.push(payload);
    };
    const fixture = getSyntheticFixture("youtube", "gift-purchase-header") as Record<string, unknown>;
    const item = { ...(fixture.item as Record<string, unknown>) };
    delete item.giftMembershipsCount;
    item.membershipGiftCount = "9";

    await platform.handleGiftMembershipPurchase({ ...fixture, item });
    const queued = await enqueue(
      "platform:giftpaypiggy",
      "youtube",
      requireFirstPayload(emitted),
    );

    expect(queued.type).toBe("platform:giftpaypiggy");
    expect(queued.platform).toBe("youtube");
    expect(queued.data.username).toBe("GiftGiver");
    expect(queued.data.giftCount).toBe(9);
    expect(queued.data.displayMessage).toEqual(expect.stringContaining("9"));
  });

  test("routes raw YouTube Jewels gifts without user IDs to final display queue data", async () => {
    const { enqueue } = createNotificationHarness();
    const platform = createYouTubePlatform();
    const emitted: EmittedPlatformPayload[] = [];
    platform.handlers.onGift = (payload: unknown) => {
      if (isRecord(payload)) emitted.push(payload);
    };

    await platform.handleGiftMessageView({
      item: {
        type: "GiftMessageView",
        id: "LCC.raw-jewels-no-user-id",
        timestamp_usec: "1704067200000000",
        text: { content: "sent Girl power for 300 Jewels" },
        authorName: { content: "@JewelsFan " },
      },
    });
    const queued = await enqueue("platform:gift", "youtube", requireFirstPayload(emitted));

    expect(queued.type).toBe("platform:gift");
    expect(queued.platform).toBe("youtube");
    expect(queued.data.username).toBe("JewelsFan");
    expect(queued.data.userId).toBeUndefined();
    expect(queued.data.giftType).toBe("Girl power");
    expect(queued.data.amount).toBe(300);
    expect(queued.data.currency).toBe("jewels");
    expect(queued.data.displayMessage).toEqual(expect.stringContaining("Girl power"));
  });

  test("routes raw Twitch bits EventSub payload to final display queue data", async () => {
    const { enqueue } = createNotificationHarness();
    const emitted: TwitchRouterEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: (type, payload) => {
        if (isRecord(payload)) emitted.push({ type, payload });
      },
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent(
      "channel.bits.use",
      getSyntheticFixture("twitch", "eventsub-bits") as Record<string, unknown>,
      {
        message_id: "eventsub-bits-raw-smoke",
        message_timestamp: "2024-01-01T00:00:00.123456789Z",
      },
    );
    const gift = emitted.find((event) => event.type === "gift");
    expect(gift).toBeDefined();
    const queued = await enqueue("platform:gift", "twitch", gift?.payload ?? {});

    expect(queued.type).toBe("platform:gift");
    expect(queued.platform).toBe("twitch");
    expect(queued.data.username).toBe("TwitchCheerer");
    expect(queued.data.amount).toBe(100);
    expect(queued.data.currency).toBe("bits");
    expect(queued.data.displayMessage).toBe(
      "TwitchCheerer sent 100 bits: Great stream!",
    );
  });

  test("routes raw Twitch Power-up EventSub payload to final display queue data", async () => {
    const { enqueue } = createNotificationHarness();
    const emitted: TwitchRouterEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: (type, payload) => {
        if (isRecord(payload)) emitted.push({ type, payload });
      },
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent(
      "channel.bits.use",
      {
        user_id: "power-user-id",
        user_login: "poweruser",
        user_name: "PowerUser",
        broadcaster_user_id: "999000111",
        broadcaster_user_login: "hero_stream",
        broadcaster_user_name: "HeroStream",
        bits: 100,
        type: "power_up",
        power_up: {
          type: "celebration",
        },
      },
      {
        message_id: "eventsub-power-up-raw-smoke",
        message_timestamp: "2024-01-01T00:00:00.123456789Z",
      },
    );
    const gift = emitted.find((event) => event.type === "gift");
    expect(gift).toBeDefined();
    const queued = await enqueue("platform:gift", "twitch", gift?.payload ?? {});

    expect(queued.type).toBe("platform:gift");
    expect(queued.platform).toBe("twitch");
    expect(queued.data.username).toBe("PowerUser");
    expect(queued.data.amount).toBe(100);
    expect(queued.data.currency).toBe("bits");
    expect(queued.data.eventType).toBe("power_up");
    expect(queued.data.displayMessage).toBe(
      "PowerUser used Celebration Power-up with 100 bits",
    );
  });

  test("routes raw Twitch gifted sub EventSub payload to final display queue data", async () => {
    const { enqueue } = createNotificationHarness();
    const emitted: TwitchRouterEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: (type, payload) => {
        if (isRecord(payload)) emitted.push({ type, payload });
      },
      logRawPlatformData: async () => {},
      logError: () => {},
    });
    const raw = getSyntheticFixture("twitch", "eventsub-gift-subscription") as {
      metadata: Record<string, unknown>;
      payload: { event: Record<string, unknown> };
    };

    router.handleNotificationEvent(
      "channel.subscription.gift",
      raw.payload.event,
      raw.metadata,
    );
    const gift = emitted.find((event) => event.type === "paypiggyGift");
    expect(gift).toBeDefined();
    const queued = await enqueue("platform:giftpaypiggy", "twitch", gift?.payload ?? {});

    expect(queued.type).toBe("platform:giftpaypiggy");
    expect(queued.platform).toBe("twitch");
    expect(queued.data.username).toBe("GiftSender");
    expect(queued.data.giftCount).toBe(5);
    expect(queued.data.displayMessage).toEqual(expect.stringContaining("5"));
  });

  test("routes raw TikTok gift payload to final display queue data", async () => {
    const { enqueue } = createNotificationHarness();
    const platform = createTikTokPlatform();
    const emitted: EmittedPlatformPayload[] = [];
    platform.handlers.onGift = (payload: unknown) => {
      if (isRecord(payload)) emitted.push(payload);
    };

    await platform.handleTikTokGift({
      ...(getSyntheticFixture("tiktok", "gift-event") as Record<string, unknown>),
      repeatEnd: 1,
    });
    const queued = await enqueue("platform:gift", "tiktok", requireFirstPayload(emitted));

    expect(queued.type).toBe("platform:gift");
    expect(queued.platform).toBe("tiktok");
    expect(queued.data.username).toBe("TestGifter");
    expect(queued.data.giftType).toBe("Rose");
    expect(queued.data.giftCount).toBe(1);
    expect(queued.data.currency).toBe("coins");
    expect(queued.data.displayMessage).toEqual(expect.stringContaining("Rose"));
  });
});
