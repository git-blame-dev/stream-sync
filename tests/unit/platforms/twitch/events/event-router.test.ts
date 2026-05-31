import { describe, test, expect } from "bun:test";
import { noOpLogger } from "../../../../helpers/mock-factories";
import { createTwitchEventSubEventRouter } from "../../../../../src/platforms/twitch/events/event-router.ts";

type RouterPayload = Record<string, unknown> & {
  message?: unknown;
  payload?: Record<string, unknown>;
  cheermoteInfo?: unknown;
};

type EmittedEvent = { type: string; payload: RouterPayload };

const isRouterPayload = (payload: unknown): payload is RouterPayload =>
  payload !== null && typeof payload === "object";

const emitInto = (emitted: EmittedEvent[]) =>
  (type: string, payload: unknown): void => {
    if (!isRouterPayload(payload)) {
      throw new Error(`Expected routed ${type} payload to be an object`);
    }
    emitted.push({ type, payload });
  };

const requireEmitted = (emitted: EmittedEvent[], type: string): EmittedEvent => {
  const event = emitted.find((evt) => evt.type === type);
  if (!event) {
    throw new Error(`Expected ${type} event to be emitted`);
  }
  return event;
};

const requireMessageRecord = (payload: RouterPayload): Record<string, unknown> => {
  if (payload.message === null || typeof payload.message !== "object") {
    throw new Error("Expected message payload object");
  }
  if (!("text" in payload.message) && !("fragments" in payload.message)) {
    throw new Error("Expected Twitch message payload shape");
  }
  return payload.message;
};

describe("Twitch EventSub event router", () => {
  test("emits chat message payloads with metadata timestamp", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { channel: "streamer", dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent(
      "channel.chat.message",
      {
        chatter_user_id: "1",
        chatter_user_name: "viewer",
        broadcaster_user_id: "2",
        message: { text: "hi" },
      },
      {
        message_timestamp: "2024-01-01T00:00:00.123456789Z",
      },
    );

    const messageEvent = requireEmitted(emitted, "chatMessage");
    expect(requireMessageRecord(messageEvent.payload).text).toBe("hi");
    expect(messageEvent.payload.chatter_user_name).toBe("viewer");
    expect(messageEvent.payload.timestamp).toBe("2024-01-01T00:00:00.123Z");
  });

  test("keeps chat message fragments when applying metadata timestamp fallback", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { channel: "streamer", dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent(
      "channel.chat.message",
      {
        chatter_user_id: "test-chat-user-id",
        chatter_user_name: "test-chat-user-name",
        broadcaster_user_id: "test-broadcaster-id",
        message: {
          text: "testEmote test message",
          fragments: [
            {
              type: "emote",
              text: "testEmote",
              emote: {
                id: "emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7",
                format: ["static", "animated"],
              },
            },
            {
              type: "text",
              text: " test message",
            },
          ],
        },
      },
      {
        message_timestamp: "2024-01-01T00:00:00.123456789Z",
      },
    );

    const messageEvent = requireEmitted(emitted, "chatMessage");
    expect(messageEvent.payload.timestamp).toBe("2024-01-01T00:00:00.123Z");
    expect(requireMessageRecord(messageEvent.payload).fragments).toEqual([
      {
        type: "emote",
        text: "testEmote",
        emote: {
          id: "emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7",
          format: ["static", "animated"],
        },
      },
      {
        type: "text",
        text: " test message",
      },
    ]);
  });

  test("does not emit chat events when timestamp is missing", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { channel: "streamer", dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent("channel.chat.message", {
      chatter_user_id: "1",
      chatter_user_name: "viewer",
      broadcaster_user_id: "2",
      message: { text: "hi" },
    }, null);

    expect(emitted.find((evt) => evt.type === "chatMessage")).toBeUndefined();
  });

  test("does not emit follow events when followed_at is missing", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent("channel.follow", {
      user_name: "Follower",
      user_id: "follower-1",
      user_login: "follower",
    }, null);

    expect(emitted.find((evt) => evt.type === "follow")).toBeUndefined();
  });

  test("emits follow events when followed_at is present", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent("channel.follow", {
      user_name: "Follower",
      user_id: "follower-2",
      user_login: "follower",
      followed_at: "2024-02-01T00:00:00Z",
    }, null);

    const followEvent = requireEmitted(emitted, "follow");
    expect(followEvent.payload).toMatchObject({
      username: "Follower",
      userId: "follower-2",
      timestamp: "2024-02-01T00:00:00.000Z",
    });
  });

  test("emits bits gifts when cheermote data is missing", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleBitsUseEvent({
      user_name: "Cheerer",
      user_id: "777",
      user_login: "cheerer",
      bits: 50,
      id: "bits-msg-1",
      message: { text: "hello" },
      timestamp: "2024-01-01T00:00:00Z",
    });

    const giftEvent = requireEmitted(emitted, "gift");
    expect(giftEvent.payload.giftType).toBe("bits");
    expect(giftEvent.payload.message).toBe("hello");
    expect(giftEvent.payload.id).toBe("bits-msg-1");
    expect(giftEvent.payload.cheermoteInfo).toBeNull();
  });

  test("emits mixed bits gifts from EventSub cheermote fragments", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleBitsUseEvent({
      user_name: "MixedCheerer",
      user_id: "mixed-cheerer-id",
      user_login: "mixedcheerer",
      bits: 200,
      id: "mixed-bits-msg-1",
      message: {
        text: "Cheer100 Uni100 keep going",
        fragments: [
          {
            type: "cheermote",
            text: "Cheer100",
            cheermote: { prefix: "Cheer", bits: 100, tier: 100 },
          },
          {
            type: "cheermote",
            text: "Uni100",
            cheermote: { prefix: "Uni", bits: 100, tier: 100 },
          },
          { type: "text", text: " keep going" },
        ],
      },
      timestamp: "2024-01-01T00:00:00Z",
    });

    const giftEvent = requireEmitted(emitted, "gift");
    expect(giftEvent.payload).toMatchObject({
      giftType: "mixed bits",
      amount: 200,
      bits: 200,
      currency: "bits",
      message: "keep going",
      id: "mixed-bits-msg-1",
    });
    expect(giftEvent.payload.cheermoteInfo).toMatchObject({
      isMixed: true,
      totalBits: 200,
    });
  });

  test("does not emit stream status events without required timestamps", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent("stream.online", { id: "stream-1" }, null);
    router.handleNotificationEvent("stream.offline", { id: "stream-1" }, null);

    expect(emitted.find((evt) => evt.type === "streamOnline")).toBeUndefined();
    expect(emitted.find((evt) => evt.type === "streamOffline")).toBeUndefined();
  });

  test("suppresses gift subscription notifications for gift events", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handlePaypiggyEvent({
      user_name: "GiftedUser",
      user_id: "123",
      user_login: "gifteduser",
      is_gift: true,
    });

    expect(emitted).toEqual([]);
  });

  test("emits subscription payloads with normalized months and metadata timestamp", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent(
      "channel.subscribe",
      {
        user_name: "Subscriber",
        user_id: "sub-1",
        user_login: "subscriber",
        tier: "1000",
        cumulative_months: "6",
        is_gift: false,
      },
      {
        message_timestamp: "2024-03-01T00:00:00.111222333Z",
      },
    );

    const paypiggyEvent = requireEmitted(emitted, "paypiggy");
    expect(paypiggyEvent.payload).toMatchObject({
      username: "Subscriber",
      userId: "sub-1",
      tier: "1000",
      months: 6,
      timestamp: "2024-03-01T00:00:00.111Z",
    });
  });

  test("emits subscription message payloads with message text and metadata timestamp", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent(
      "channel.subscription.message",
      {
        user_name: "Resubber",
        user_id: "resub-1",
        user_login: "resubber",
        tier: "1000",
        cumulative_months: 12,
        message: { text: "Still here!" },
      },
      {
        message_timestamp: "2024-03-02T00:00:00.987654321Z",
      },
    );

    const messageEvent = requireEmitted(emitted, "paypiggyMessage");
    expect(messageEvent.payload).toMatchObject({
      username: "Resubber",
      userId: "resub-1",
      tier: "1000",
      months: 12,
      message: "Still here!",
      timestamp: "2024-03-02T00:00:00.987Z",
    });
  });

  test("emits resub chat notifications as subscription messages", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent(
      "channel.chat.notification",
      {
        notice_type: "resub",
        chatter_user_name: "Chat Resubber",
        chatter_user_id: "chat-resub-1",
        message: { text: "back again" },
        resub: {
          cumulative_months: 7,
          sub_tier: "1000",
        },
      },
      {
        message_timestamp: "2024-03-03T00:00:00.123456789Z",
      },
    );

    const messageEvent = requireEmitted(emitted, "paypiggyMessage");
    expect(messageEvent.payload).toMatchObject({
      username: "Chat Resubber",
      userId: "chat-resub-1",
      tier: "1000",
      months: 7,
      message: "back again",
      timestamp: "2024-03-03T00:00:00.123Z",
    });
  });

  test("dedupes chat notification resubs against subscription message resubs", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent(
      "channel.subscription.message",
      {
        user_name: "Resubber",
        user_id: "resub-dedupe-1",
        tier: "1000",
        cumulative_months: 12,
        message: { text: "Still here!" },
      },
      { message_timestamp: "2024-03-02T00:00:00.000Z" },
    );
    router.handleNotificationEvent(
      "channel.chat.notification",
      {
        notice_type: "shared_chat_resub",
        chatter_user_name: "Resubber",
        chatter_user_id: "resub-dedupe-1",
        message: { text: "Still here!" },
        shared_chat_resub: {
          cumulative_months: 12,
          sub_tier: "1000",
        },
      },
      { message_timestamp: "2024-03-02T00:00:01.000Z" },
    );

    expect(emitted.filter((event) => event.type === "paypiggyMessage").length).toBe(1);
  });

  test("extracts text content from bits.use fragments and emits a gift payload", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleBitsUseEvent({
      user_name: "Cheerer",
      user_id: "777",
      user_login: "cheerer",
      bits: 50,
      id: "bits-evt-1",
      message: {
        fragments: [
          {
            type: "cheermote",
            text: "Cheer50",
            cheermote: { prefix: "Cheer", bits: 50 },
          },
          { type: "text", text: "hello " },
          { type: "text", text: "world" },
        ],
      },
      timestamp: "2024-01-01T00:00:00Z",
    });

    const giftEvent = requireEmitted(emitted, "gift");
    expect(giftEvent.payload.username).toBe("Cheerer");
    expect(giftEvent.payload.userId).toBe("777");
    expect(giftEvent.payload.amount).toBe(50);
    expect(giftEvent.payload.currency).toBe("bits");
    expect(giftEvent.payload.giftCount).toBe(1);
    expect(giftEvent.payload.giftType).toBe("bits");
    expect(giftEvent.payload.message).toBe("hello world");
    expect(giftEvent.payload.repeatCount).toBe(1);
    expect(giftEvent.payload.id).toEqual(expect.any(String));
  });

  test("emits anonymous bits gifts without identity fields", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleBitsUseEvent({
      bits: 25,
      id: "bits-anon-1",
      is_anonymous: true,
      message: { text: "wow" },
      timestamp: "2024-01-02T00:00:00Z",
    });

    const giftEvent = requireEmitted(emitted, "gift");
    expect(giftEvent.payload.isAnonymous).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(giftEvent.payload, "username"),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(giftEvent.payload, "userId"),
    ).toBe(false);
  });

  test("does not emit bits gifts when metadata timestamp is missing", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent("channel.bits.use", {
      user_name: "Cheerer",
      user_id: "777",
      user_login: "cheerer",
      bits: 50,
      id: "bits-evt-missing-ts",
      message: {
        fragments: [
          {
            type: "cheermote",
            text: "Cheer50",
            cheermote: { prefix: "Cheer", bits: 50 },
          },
          { type: "text", text: "hello " },
          { type: "text", text: "world" },
        ],
      },
    }, null);

    const giftEvent = emitted.find((evt) => evt.type === "gift");
    expect(giftEvent).toBeUndefined();
  });

  test("emits bits gifts when metadata provides canonical id and payload has no message_id", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent(
      "channel.bits.use",
      {
        user_name: "Cheerer",
        user_id: "777",
        user_login: "cheerer",
        bits: 50,
        message: {
          fragments: [
            {
              type: "cheermote",
              text: "Cheer50",
              cheermote: { prefix: "Cheer", bits: 50 },
            },
            { type: "text", text: "hello " },
            { type: "text", text: "world" },
          ],
        },
      },
      {
        message_id: "eventsub-bits-id-1",
        message_timestamp: "2024-01-01T00:00:00.123456789Z",
      },
    );

    const giftEvent = requireEmitted(emitted, "gift");
    expect(giftEvent.payload.id).toBe("eventsub-bits-id-1");
    expect(giftEvent.payload.userId).toBe("777");
    expect(giftEvent.payload.timestamp).toBe("2024-01-01T00:00:00.123Z");
  });

  test("preserves routed bits event ids when metadata message_id is unavailable", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent(
      "channel.bits.use",
      {
        user_name: "Cheerer",
        user_id: "777",
        user_login: "cheerer",
        bits: 50,
        id: "bits-evt-from-event",
        message: {
          fragments: [
            {
              type: "cheermote",
              text: "Cheer50",
              cheermote: { prefix: "Cheer", bits: 50 },
            },
            { type: "text", text: "hello world" },
          ],
        },
      },
      {
        message_timestamp: "2024-01-01T00:00:00.123456789Z",
      },
    );

    const giftEvent = requireEmitted(emitted, "gift");
    expect(giftEvent.payload.id).toBe("bits-evt-from-event");
  });

  test("does not emit bits gifts when only event body message_id is provided", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent(
      "channel.bits.use",
      {
        user_name: "Cheerer",
        user_id: "777",
        user_login: "cheerer",
        bits: 50,
        message_id: "payload-message-id-should-not-be-used",
        message: {
          fragments: [
            {
              type: "cheermote",
              text: "Cheer50",
              cheermote: { prefix: "Cheer", bits: 50 },
            },
            { type: "text", text: "hello world" },
          ],
        },
      },
      {
        message_timestamp: "2024-01-01T00:00:00.123456789Z",
      },
    );

    const giftEvent = emitted.find((evt) => evt.type === "gift");
    expect(giftEvent).toBeUndefined();
  });

  test("emits paypiggyGift payloads with gift count and cumulative total", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent(
      "channel.subscription.gift",
      {
        user_name: "GiftPilot",
        user_id: "giftpilot-1",
        user_login: "giftpilot",
        tier: "1000",
        total: 3,
        cumulative_total: 12,
      },
      {
        message_timestamp: "2024-01-01T00:00:00.444555666Z",
      },
    );

    const giftEvent = requireEmitted(emitted, "paypiggyGift");
    expect(giftEvent.payload).toMatchObject({
      username: "GiftPilot",
      userId: "giftpilot-1",
      tier: "1000",
      giftCount: 3,
      cumulativeTotal: 12,
      timestamp: "2024-01-01T00:00:00.444Z",
    });
  });

  test("emits anonymous paypiggyGift payloads without identity fields", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent(
      "channel.subscription.gift",
      {
        tier: "1000",
        total: 2,
        is_anonymous: true,
      },
      {
        message_timestamp: "2024-01-03T00:00:00.123456789Z",
      },
    );

    const giftEvent = requireEmitted(emitted, "paypiggyGift");
    expect(giftEvent.payload.isAnonymous).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(giftEvent.payload, "username"),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(giftEvent.payload, "userId"),
    ).toBe(false);
  });

  test("uses metadata timestamp for stream offline notifications", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent("stream.online", {
      id: "stream-1",
      started_at: "2024-02-01T00:00:00Z",
    }, null);

    router.handleNotificationEvent(
      "stream.offline",
      {
        id: "stream-1",
      },
      {
        message_timestamp: "2024-02-01T01:00:00.456789123Z",
      },
    );

    const onlineEvent = requireEmitted(emitted, "streamOnline");
    const offlineEvent = requireEmitted(emitted, "streamOffline");
    expect(onlineEvent.payload).toMatchObject({
      streamId: "stream-1",
      timestamp: "2024-02-01T00:00:00.000Z",
    });
    expect(offlineEvent.payload).toMatchObject({
      streamId: "stream-1",
      timestamp: "2024-02-01T01:00:00.456Z",
    });
  });

  test("uses metadata timestamp for raid and gift notifications", () => {
    const emitted: EmittedEvent[] = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: false },
      logger: noOpLogger,
      emit: emitInto(emitted),
      logRawPlatformData: async () => {},
      logError: () => {},
    });

    router.handleNotificationEvent(
      "channel.raid",
      {
        from_broadcaster_user_name: "Raider",
        from_broadcaster_user_id: "raider-1",
        from_broadcaster_user_login: "raider",
        viewers: 8,
      },
      {
        message_timestamp: "2024-03-01T00:00:00.100200300Z",
      },
    );

    router.handleNotificationEvent(
      "channel.subscription.gift",
      {
        user_name: "Gifter",
        user_id: "gifter-1",
        user_login: "gifter",
        tier: "1000",
        total: 2,
      },
      {
        message_timestamp: "2024-03-01T00:01:00.400500600Z",
      },
    );

    const raidEvent = requireEmitted(emitted, "raid");
    const giftEvent = requireEmitted(emitted, "paypiggyGift");
    expect(raidEvent.payload.timestamp).toBe("2024-03-01T00:00:00.100Z");
    expect(giftEvent.payload.timestamp).toBe("2024-03-01T00:01:00.400Z");
  });

  test("logs raw events before timestamp fallback", () => {
    const logged: Array<[eventType: string, event: Record<string, unknown>]> = [];
    const router = createTwitchEventSubEventRouter({
      config: { dataLoggingEnabled: true },
      logger: noOpLogger,
      emit: () => {},
      logRawPlatformData: async (eventType, event): Promise<void> => {
        if (event === null || typeof event !== "object") {
          throw new Error("Expected raw event to be an object");
        }
        if (!("started_at" in event)) {
          throw new Error("Expected stream event shape");
        }
        logged.push([eventType, event]);
      },
      logError: () => {},
    });

    const rawEvent = {
      id: "stream-1",
      started_at: "2024-02-01T00:00:00Z",
    };

    router.handleNotificationEvent("stream.online", rawEvent, null);

    expect(logged).toHaveLength(1);
    const loggedEvent = logged[0]?.[1];
    expect(loggedEvent).toBeDefined();
    if (!loggedEvent) {
      throw new Error("Expected logged raw event");
    }
    expect(Object.prototype.hasOwnProperty.call(loggedEvent, "timestamp")).toBe(
      false,
    );
    expect(loggedEvent.started_at).toBe("2024-02-01T00:00:00Z");
  });
});
