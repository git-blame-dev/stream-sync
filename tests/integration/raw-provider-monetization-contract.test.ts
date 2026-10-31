import { vi, describe, test, expect, afterEach, spyOn } from 'bun:test';

import { YouTubePlatform } from "../../src/platforms/youtube";
import { InnertubeService } from "../../src/services/innertube-service.ts";
import { YouTubeStreamDetectionService } from "../../src/services/youtube-stream-detection-service.ts";
import { createTwitchEventSubEventRouter } from "../../src/platforms/twitch/events/event-router.ts";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture.ts";
import { createTikTokLifetimeFixture } from "../helpers/tiktok-connector-fixture.ts";
import { getSyntheticFixture } from "../helpers/platform-test-data";
import { createYouTubeConfigFixture } from "../helpers/config-fixture";
import { noOpLogger } from "../helpers/mock-factories";


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

const requireFirstPayload = (payloads: EmittedPlatformPayload[]) => {
  const payload = payloads[0];
  expect(payload).toBeDefined();
  if (!payload) {
    throw new Error("Expected platform payload");
  }
  return payload;
};

describe("Raw provider monetization contract smokes", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  const registerCleanup = (fn: () => Promise<void> | void) => {
    let executed = false;
    const idempotentFn = async () => {
      if (executed) return;
      executed = true;
      await fn();
    };
    cleanups.push(idempotentFn);
    return idempotentFn;
  };

  const runCleanups = async () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      if (cleanup) {
        await cleanup();
      }
    }
  };

  afterEach(async () => {
    try {
      await runCleanups();
    } finally {
      vi.restoreAllMocks();
    }
  });

  const createNotificationHarness = async () => {
    const presentation = await createMainPresentationFixture();
    presentation.config.general.debugEnabled = false;
    presentation.config.general.envFileReadEnabled = false;
    presentation.config.general.envFileWriteEnabled = false;
    presentation.config.general.giftsEnabled = true;
    presentation.config.general.paypiggiesEnabled = true;
    presentation.config.logging.file.enabled = false;

    presentation.config.tiktok.enabled = false;
    presentation.config.tiktok.dataLoggingEnabled = false;
    presentation.config.tiktok.giftsEnabled = true;
    presentation.config.tiktok.paypiggiesEnabled = true;

    presentation.config.twitch.enabled = false;
    presentation.config.twitch.dataLoggingEnabled = false;
    presentation.config.twitch.giftsEnabled = true;
    presentation.config.twitch.paypiggiesEnabled = true;

    presentation.config.youtube.enabled = false;
    presentation.config.youtube.username = "test-channel";
    presentation.config.youtube.dataLoggingEnabled = false;
    presentation.config.youtube.giftsEnabled = true;
    presentation.config.youtube.paypiggiesEnabled = true;

    await presentation.start();
    const addItemSpy = spyOn(presentation.queue, "addItem");

    registerCleanup(async () => {
      vi.restoreAllMocks();
      await presentation.dispose();
    });

    const enqueue = async (
      notificationType: MonetizationType,
      platform: PlatformKey,
      payload: Record<string, unknown>,
    ) => {
      await presentation.runtime.notificationManager.handleNotification(
        notificationType,
        platform,
        payload,
      );
      await presentation.drain();
      const lastCall = addItemSpy.mock.calls.at(-1);
      return requireQueueItem(lastCall?.[0]);
    };

    return { presentation, addItemSpy, enqueue };
  };

  const createYouTubePlatform = () => {
    const innertubeService = new InnertubeService(
      {
        createWithTimeout: async () => ({
          getChannel: async () => ({
            videos: [],
            getLiveStreams: async () => ({ videos: [] }),
          }),
          search: async () => ({ videos: [] }),
          getInfo: async (id: string) => ({
            basic_info: {
              id,
              is_live: false,
              is_live_content: false,
              view_count: 0,
            },
          }),
        }),
      },
      { logger: noOpLogger },
    );
    const streamDetectionService = new YouTubeStreamDetectionService(
      innertubeService,
      { logger: noOpLogger },
    );
    const platform = new YouTubePlatform(
      createYouTubeConfigFixture({
        enabled: true,
        username: "test-channel",
        dataLoggingEnabled: false,
        envFileReadEnabled: false,
        envFileWriteEnabled: false,
      }),
      {
        logger: noOpLogger,
        USER_AGENTS: ["test-agent"],
        innertubeService,
        streamDetectionService,
      },
    );

    registerCleanup(async () => {
      await platform.cleanup();
      await innertubeService.dispose();
    });

    return platform;
  };

  const createTikTokPlatform = () => {
    const fixture = createTikTokLifetimeFixture({
      enabled: true,
      giftAggregationEnabled: false,
      dataLoggingEnabled: false,
    });
    registerCleanup(async () => {
      await fixture.cleanup();
    });
    return fixture.platform;
  };

  test("routes raw YouTube Super Chat to final display queue data", async () => {
    const { enqueue } = await createNotificationHarness();
    const platform = createYouTubePlatform();
    const emitted: EmittedPlatformPayload[] = [];
    platform.handlers.onGift = (payload: unknown) => {
      if (isRecord(payload)) emitted.push(payload);
    };

    try {
      await platform.handleSuperChat(
        getSyntheticFixture("youtube", "superchat"),
      );
      const queued = await enqueue(
        "platform:gift",
        "youtube",
        requireFirstPayload(emitted),
      );

      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("youtube");
      expect(queued.data.username).toBe("SuperChatDonor");
      expect(queued.data.giftType).toBe("Super Chat");
      expect(queued.data.amount).toBe(25);
      expect(queued.data.currency).toBe("USD");
      expect(queued.data.displayMessage).toEqual(
        expect.stringContaining("Super Chat"),
      );
    } finally {
      await runCleanups();
    }
  });

  test("routes raw YouTube gift purchase count aliases to final display queue data", async () => {
    const { enqueue } = await createNotificationHarness();
    const platform = createYouTubePlatform();
    const emitted: EmittedPlatformPayload[] = [];
    platform.handlers.onGiftPaypiggy = (payload: unknown) => {
      if (isRecord(payload)) emitted.push(payload);
    };
    const fixture = getSyntheticFixture(
      "youtube",
      "gift-purchase-header",
    ) as Record<string, unknown>;
    const item = { ...(fixture.item as Record<string, unknown>) };
    delete item.giftMembershipsCount;
    item.membershipGiftCount = "9";

    try {
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
      expect(queued.data.displayMessage).toEqual(
        expect.stringContaining("9"),
      );
    } finally {
      await runCleanups();
    }
  });

  test("routes raw YouTube Jewels gifts without user IDs to final display queue data", async () => {
    const { enqueue } = await createNotificationHarness();
    const platform = createYouTubePlatform();
    const emitted: EmittedPlatformPayload[] = [];
    platform.handlers.onGift = (payload: unknown) => {
      if (isRecord(payload)) emitted.push(payload);
    };

    try {
      await platform.handleGiftMessageView({
        item: {
          type: "GiftMessageView",
          id: "LCC.raw-jewels-no-user-id",
          timestamp_usec: "1704067200000000",
          text: { content: "sent Girl power for 300 Jewels" },
          authorName: { content: "@JewelsFan " },
        },
      });
      const queued = await enqueue(
        "platform:gift",
        "youtube",
        requireFirstPayload(emitted),
      );

      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("youtube");
      expect(queued.data.username).toBe("JewelsFan");
      expect(queued.data.userId).toBeUndefined();
      expect(queued.data.giftType).toBe("Girl power");
      expect(queued.data.amount).toBe(300);
      expect(queued.data.currency).toBe("jewels");
      expect(queued.data.displayMessage).toEqual(
        expect.stringContaining("Girl power"),
      );
    } finally {
      await runCleanups();
    }
  });

  test("routes raw Twitch bits EventSub payload to final display queue data", async () => {
    const { enqueue } = await createNotificationHarness();
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

    try {
      router.handleNotificationEvent(
        "channel.bits.use",
        getSyntheticFixture("twitch", "eventsub-bits") as Record<
          string,
          unknown
        >,
        {
          message_id: "eventsub-bits-raw-smoke",
          message_timestamp: "2024-01-01T00:00:00.123456789Z",
        },
      );
      const gift = emitted.find((event) => event.type === "gift");
      expect(gift).toBeDefined();
      const queued = await enqueue(
        "platform:gift",
        "twitch",
        gift?.payload ?? {},
      );

      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("twitch");
      expect(queued.data.username).toBe("TwitchCheerer");
      expect(queued.data.amount).toBe(100);
      expect(queued.data.currency).toBe("bits");
      expect(queued.data.displayMessage).toBe(
        "TwitchCheerer sent 100 bits: Great stream!",
      );
    } finally {
      await runCleanups();
    }
  });

  test("routes raw Twitch Power-up EventSub payload to final display queue data", async () => {
    const { enqueue } = await createNotificationHarness();
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

    try {
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
      const queued = await enqueue(
        "platform:gift",
        "twitch",
        gift?.payload ?? {},
      );

      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("twitch");
      expect(queued.data.username).toBe("PowerUser");
      expect(queued.data.amount).toBe(100);
      expect(queued.data.currency).toBe("bits");
      expect(queued.data.eventType).toBe("power_up");
      expect(queued.data.displayMessage).toBe(
        "PowerUser used Celebration Power-up with 100 bits",
      );
    } finally {
      await runCleanups();
    }
  });

  test("routes raw Twitch gifted sub EventSub payload to final display queue data", async () => {
    const { enqueue } = await createNotificationHarness();
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
    const raw = getSyntheticFixture(
      "twitch",
      "eventsub-gift-subscription",
    ) as {
      metadata: Record<string, unknown>;
      payload: { event: Record<string, unknown> };
    };

    try {
      router.handleNotificationEvent(
        "channel.subscription.gift",
        raw.payload.event,
        raw.metadata,
      );
      const gift = emitted.find((event) => event.type === "paypiggyGift");
      expect(gift).toBeDefined();
      const queued = await enqueue(
        "platform:giftpaypiggy",
        "twitch",
        gift?.payload ?? {},
      );

      expect(queued.type).toBe("platform:giftpaypiggy");
      expect(queued.platform).toBe("twitch");
      expect(queued.data.username).toBe("GiftSender");
      expect(queued.data.giftCount).toBe(5);
      expect(queued.data.displayMessage).toEqual(
        expect.stringContaining("5"),
      );
    } finally {
      await runCleanups();
    }
  });

  test("routes raw TikTok gift payload to final display queue data", async () => {
    const { enqueue } = await createNotificationHarness();
    const platform = createTikTokPlatform();
    const emitted: EmittedPlatformPayload[] = [];
    platform.handlers.onGift = (payload: unknown) => {
      if (isRecord(payload)) emitted.push(payload);
    };

    try {
      await platform.handleTikTokGift({
        ...(getSyntheticFixture("tiktok", "gift-event") as Record<
          string,
          unknown
        >),
        repeatEnd: 1,
      });
      const queued = await enqueue(
        "platform:gift",
        "tiktok",
        requireFirstPayload(emitted),
      );

      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("tiktok");
      expect(queued.data.username).toBe("TestGifter");
      expect(queued.data.giftType).toBe("Rose");
      expect(queued.data.giftCount).toBe(1);
      expect(queued.data.currency).toBe("coins");
      expect(queued.data.displayMessage).toEqual(
        expect.stringContaining("Rose"),
      );
    } finally {
      await runCleanups();
    }
  });
});
