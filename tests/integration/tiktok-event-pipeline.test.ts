import { describe, test, afterEach, expect, spyOn } from "bun:test";
import EventEmitter from "events";
import { restoreAllMocks } from "../helpers/bun-mock-utils";
import {
  useFakeTimers,
  useRealTimers,
  setSystemTime,
  advanceTimersByTime,
  clearAllTimers,
} from "../helpers/bun-timers";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture";
import { noOpLogger } from "../helpers/mock-factories";
import { TikTokPlatform } from "../../src/platforms/tiktok";
import { TikTokWebSocketClient } from "../../src/platforms/tiktok-websocket-client.ts";
import {
  setupTikTokEventListeners,
  cleanupTikTokEventListeners,
} from "../../src/platforms/tiktok/events/event-router.ts";

type MainPresentationFixture = Awaited<
  ReturnType<typeof createMainPresentationFixture>
>;

type ChatRuntimeCall = {
  platform: string;
  message: {
    message: {
      text: string;
      parts?: unknown[];
    };
    username: string;
  };
};

type GiftRuntimeCall = {
  platform: string;
  username: unknown;
  payload: {
    giftType?: string;
    giftCount?: number;
    aggregatedCount?: number;
    isAggregated?: boolean;
    avatarUrl?: string;
  };
};

type ShareRuntimeCall = {
  platform: string;
  username: unknown;
  payload: {
    username?: string;
  };
};

const WebcastEvent = {
  CHAT: "chat",
  GIFT: "gift",
  FOLLOW: "follow",
  SOCIAL: "social",
  ROOM_USER: "roomUser",
  ERROR: "error",
  DISCONNECT: "disconnect",
} as const;

const ControlEvent = {
  DISCONNECTED: "disconnected",
  ERROR: "error",
} as const;

class FakeTikTokConnection extends EventEmitter {
  [key: string]: unknown;

  async connect(): Promise<unknown> {
    return undefined;
  }

  async disconnect(): Promise<unknown> {
    return undefined;
  }

  override on(
    eventName: string,
    handler: (payload: unknown) => void | Promise<void>,
  ): this {
    return super.on(eventName, handler);
  }
}

type TikTokRouterPlatform = Parameters<typeof setupTikTokEventListeners>[0];

const asRouterPlatform = (platform: TikTokPlatform): TikTokRouterPlatform =>
  Object.create(platform, {
    constructor: {
      value: {
        resolveEventTimestampMs: TikTokPlatform.resolveEventTimestampMs,
      },
    },
  });

const chatRuntimeMessage = (
  value: Record<string, unknown>,
): ChatRuntimeCall["message"] => {
  if (
    typeof value.message !== "object" ||
    value.message === null ||
    !("text" in value.message)
  ) {
    throw new Error("Expected TikTok chat runtime message");
  }

  return value as ChatRuntimeCall["message"];
};

const giftRuntimePayload = (
  value: Record<string, unknown>,
): GiftRuntimeCall["payload"] => value;
const shareRuntimePayload = (
  value: Record<string, unknown>,
): ShareRuntimeCall["payload"] => value;

describe("TikTok event pipeline (integration)", () => {
  let activePresentation: MainPresentationFixture | null = null;
  let activePlatform: TikTokPlatform | null = null;
  let activeRouterPlatform: TikTokRouterPlatform | null = null;
  let fakeTimersActive = false;

  afterEach(async () => {
    const routerPlatform = activeRouterPlatform;
    const platform = activePlatform;
    const presentation = activePresentation;
    const hadFakeTimers = fakeTimersActive;
    activeRouterPlatform = null;
    activePlatform = null;
    activePresentation = null;
    fakeTimersActive = false;

    try {
      if (routerPlatform) {
        cleanupTikTokEventListeners(routerPlatform);
      }
      if (platform) {
        await platform.cleanup();
      }
    } finally {
      if (hadFakeTimers) {
        clearAllTimers();
        useRealTimers();
      }
      setSystemTime();
      restoreAllMocks();
      if (presentation) {
        await presentation.dispose();
      }
    }
  });

  const startTikTokIntegrationFixture = async (options: {
    messagesEnabled?: boolean;
    giftsEnabled?: boolean;
    sharesEnabled?: boolean;
    giftAggregationEnabled?: boolean;
  }) => {
    const presentation = await createMainPresentationFixture();
    activePresentation = presentation;

    presentation.config.general.envFileReadEnabled = false;
    presentation.config.general.envFileWriteEnabled = false;
    presentation.config.logging.file.enabled = false;
    presentation.config.logging.chat.enabled = false;
    presentation.config.general.messagesEnabled =
      options.messagesEnabled ?? false;
    presentation.config.general.giftsEnabled = options.giftsEnabled ?? false;
    presentation.config.general.sharesEnabled = options.sharesEnabled ?? false;
    presentation.config.general.greetingsEnabled = false;
    presentation.config.general.logChatMessages = false;
    presentation.config.tiktok.messagesEnabled =
      options.messagesEnabled ?? false;
    presentation.config.tiktok.giftsEnabled = options.giftsEnabled ?? false;
    presentation.config.tiktok.sharesEnabled = options.sharesEnabled ?? false;
    presentation.config.tiktok.greetingsEnabled = false;
    presentation.config.tiktok.giftAggregationEnabled =
      options.giftAggregationEnabled ?? false;
    presentation.config.tiktok.dataLoggingEnabled = false;

    await presentation.start();

    const routerRuntime = presentation.runtime.platformEventRouter.runtime;
    const handleChatSpy = spyOn(routerRuntime, "handleChatMessage");
    const handleGiftSpy = spyOn(routerRuntime, "handleGiftNotification");
    const handleShareSpy = spyOn(routerRuntime, "handleShareNotification");

    const runtimeCalls = {
      get chat(): ChatRuntimeCall[] {
        return handleChatSpy.mock.calls.map(([platform, message]) => ({
          platform: String(platform),
          message: chatRuntimeMessage(message as Record<string, unknown>),
        }));
      },
      get gift(): GiftRuntimeCall[] {
        return handleGiftSpy.mock.calls.map(([platform, username, payload]) => ({
          platform: String(platform),
          username,
          payload: giftRuntimePayload(payload as Record<string, unknown>),
        }));
      },
      get share(): ShareRuntimeCall[] {
        return handleShareSpy.mock.calls.map(
          ([platform, username, payload]) => ({
            platform: String(platform),
            username,
            payload: shareRuntimePayload(payload as Record<string, unknown>),
          }),
        );
      },
    };

    const connection = new FakeTikTokConnection();
    const platform = new TikTokPlatform(
      {
        ...presentation.config.tiktok,
        enabled: true,
        username: "test-user",
        giftAggregationEnabled: options.giftAggregationEnabled ?? false,
        dataLoggingEnabled: false,
      },
      {
        logger: noOpLogger,
        eventBus: presentation.bus,
        TikTokWebSocketClient,
        WebcastEvent,
        ControlEvent,
      },
    );
    activePlatform = platform;
    platform.connection = connection;

    const routerPlatform = asRouterPlatform(platform);
    activeRouterPlatform = routerPlatform;
    setupTikTokEventListeners(routerPlatform);

    return {
      presentation,
      connection,
      platform,
      routerPlatform,
      runtimeCalls,
    };
  };

  test("routes chat, gift, and share through platform:event", async () => {
    const { connection, runtimeCalls } = await startTikTokIntegrationFixture({
      messagesEnabled: true,
      giftsEnabled: true,
      sharesEnabled: true,
      giftAggregationEnabled: false,
    });
    setSystemTime(new Date("2025-01-20T12:00:00.000Z"));

    const eventTimestamp = Date.parse("2025-01-20T12:00:00.000Z");
    const chatPayload = {
      comment: "hello there",
      user: {
        userId: "test-user-id-1",
        uniqueId: "test-user-1",
        nickname: "test-user-one",
      },
      common: { createTime: eventTimestamp },
    };
    const giftPayload = {
      user: {
        userId: "test-user-id-2",
        uniqueId: "test-user-2",
        nickname: "test-user-two",
        profilePictureUrl:
          "https://example.invalid/tiktok-integration-immediate-avatar.jpg",
      },
      repeatCount: 2,
      repeatEnd: true,
      giftDetails: { giftName: "Rose", diamondCount: 1, giftType: 0 },
      common: { createTime: eventTimestamp, msgId: "test-gift-msg-1" },
    };
    const sharePayload = {
      user: {
        userId: "test-user-id-3",
        uniqueId: "test-user-3",
        nickname: "test-user-three",
      },
      displayType: "share",
      common: { createTime: eventTimestamp },
    };

    connection.emit(WebcastEvent.CHAT, chatPayload);
    connection.emit(WebcastEvent.GIFT, giftPayload);
    connection.emit(WebcastEvent.SOCIAL, sharePayload);

    await new Promise(setImmediate);

    expect(runtimeCalls.chat).toHaveLength(1);
    const chatCall = runtimeCalls.chat[0];
    if (!chatCall) {
      throw new Error("Expected TikTok chat runtime call");
    }
    expect(chatCall.message.message.text).toBe("hello there");
    expect(chatCall.message.username).toBe("test-user-one");

    expect(runtimeCalls.gift).toHaveLength(1);
    const giftCall = runtimeCalls.gift[0];
    if (!giftCall) {
      throw new Error("Expected TikTok gift runtime call");
    }
    expect(giftCall.payload.giftType).toBe("Rose");
    expect(giftCall.payload.giftCount).toBe(2);
    expect(giftCall.payload.avatarUrl).toBe(
      "https://example.invalid/tiktok-integration-immediate-avatar.jpg",
    );

    expect(runtimeCalls.share).toHaveLength(1);
    const shareCall = runtimeCalls.share[0];
    if (!shareCall) {
      throw new Error("Expected TikTok share runtime call");
    }
    expect(shareCall.payload.username).toBe("test-user-three");
  });

  test("routes emote-only TikTok chat payloads through platform:event chat path", async () => {
    const { connection, runtimeCalls } = await startTikTokIntegrationFixture({
      messagesEnabled: true,
      giftAggregationEnabled: false,
    });
    setSystemTime(new Date("2025-01-20T12:00:00.000Z"));

    const eventTimestamp = Date.parse("2025-01-20T12:00:00.000Z");
    const chatPayload = {
      comment: " ",
      emotes: [
        {
          placeInComment: 0,
          emote: {
            emoteId: "1234512345123451234",
            image: {
              imageUrl: "https://example.invalid/tiktok-emote.webp",
            },
          },
        },
      ],
      user: {
        userId: "test-user-id-emote",
        uniqueId: "test-user-emote",
        nickname: "test-user-emote",
      },
      common: { createTime: eventTimestamp },
    };

    connection.emit(WebcastEvent.CHAT, chatPayload);

    await new Promise(setImmediate);

    expect(runtimeCalls.chat).toHaveLength(1);
    const chatCall = runtimeCalls.chat[0];
    if (!chatCall) {
      throw new Error("Expected TikTok chat runtime call");
    }
    expect(chatCall.message.message).toEqual({
      text: "",
      parts: [
        {
          type: "emote",
          platform: "tiktok",
          emoteId: "1234512345123451234",
          imageUrl: "https://example.invalid/tiktok-emote.webp",
          placeInComment: 0,
        },
      ],
    });
  });

  test("routes only fresh unique chats during mixed replay bursts", async () => {
    const { connection, runtimeCalls } = await startTikTokIntegrationFixture({
      messagesEnabled: true,
      giftAggregationEnabled: false,
    });
    useFakeTimers();
    fakeTimersActive = true;
    setSystemTime(new Date("2025-01-20T12:05:00.000Z"));

    const eventTimestamp = Date.parse("2025-01-20T12:05:00.000Z");
    const makeChatPayload = (msgId: string, comment: string) => ({
      comment,
      user: {
        userId: "test-user-id-mixed",
        uniqueId: "test-user-mixed",
        nickname: "test-user-mixed",
      },
      common: { createTime: eventTimestamp, msgId },
    });

    connection.emit(
      WebcastEvent.CHAT,
      makeChatPayload("test-chat-msg-a", "first"),
    );
    connection.emit(
      WebcastEvent.CHAT,
      makeChatPayload("test-chat-msg-b", "second"),
    );
    connection.emit(
      WebcastEvent.CHAT,
      makeChatPayload("test-chat-msg-a", "first-duplicate"),
    );
    connection.emit(
      WebcastEvent.CHAT,
      makeChatPayload("test-chat-msg-c", "third"),
    );
    connection.emit(
      WebcastEvent.CHAT,
      makeChatPayload("test-chat-msg-b", "second-duplicate"),
    );

    await new Promise(setImmediate);

    expect(runtimeCalls.chat).toHaveLength(3);
    expect(
      runtimeCalls.chat.map((entry) => entry.message.message.text),
    ).toEqual(["first", "second", "third"]);
  });

  test("aggregates rapid distinct gift message ids when aggregation is enabled", async () => {
    const { connection, platform, runtimeCalls } =
      await startTikTokIntegrationFixture({
        giftsEnabled: true,
        giftAggregationEnabled: true,
      });
    useFakeTimers();
    fakeTimersActive = true;
    setSystemTime(new Date("2025-01-20T12:00:00.000Z"));

    const baseEventTimestamp = Date.parse("2025-01-20T12:00:00.000Z");
    const buildGiftPayload = (msgId: string, offsetMs: number) => ({
      user: {
        userId: "test-user-id-2",
        uniqueId: "test-user-2",
        nickname: "test-user-two",
        profilePicture: {
          url: [
            "https://example.invalid/tiktok-integration-aggregated-avatar.jpg",
          ],
        },
      },
      repeatCount: 1,
      repeatEnd: 0,
      giftDetails: { giftName: "Hand Heart", diamondCount: 100, giftType: 2 },
      common: { createTime: baseEventTimestamp + offsetMs, msgId },
    });

    connection.emit(
      WebcastEvent.GIFT,
      buildGiftPayload("test-gift-msg-1", 10),
    );
    connection.emit(
      WebcastEvent.GIFT,
      buildGiftPayload("test-gift-msg-2", 20),
    );
    connection.emit(
      WebcastEvent.GIFT,
      buildGiftPayload("test-gift-msg-3", 30),
    );
    connection.emit(
      WebcastEvent.GIFT,
      buildGiftPayload("test-gift-msg-4", 40),
    );

    await new Promise(setImmediate);
    await advanceTimersByTime(platform.giftAggregationDelay + 500);
    await new Promise(setImmediate);

    expect(runtimeCalls.gift).toHaveLength(1);
    const giftCall = runtimeCalls.gift[0];
    if (!giftCall) {
      throw new Error("Expected TikTok gift runtime call");
    }
    expect(giftCall.payload.giftType).toBe("Hand Heart");
    expect(giftCall.payload.giftCount).toBe(4);
    expect(giftCall.payload.aggregatedCount).toBe(4);
    expect(giftCall.payload.isAggregated).toBe(true);
    expect(giftCall.payload.avatarUrl).toBe(
      "https://example.invalid/tiktok-integration-aggregated-avatar.jpg",
    );
  });
});
