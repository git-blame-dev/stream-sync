import { describe, test, afterEach, expect, spyOn } from "bun:test";
import EventEmitter from "events";
import { restoreAllMocks } from "../helpers/bun-mock-utils";
import {
  advanceTimersByTime,
  clearAllTimers,
  setSystemTime,
  useFakeTimers,
  useRealTimers,
} from "../helpers/bun-timers";
import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture";
import { noOpLogger } from "../helpers/mock-factories";
import { TikTokPlatform } from "../../src/platforms/tiktok.ts";
import { TikTokWebSocketClient } from "../../src/platforms/tiktok-websocket-client.ts";
import {
  cleanupTikTokEventListeners,
  setupTikTokEventListeners,
} from "../../src/platforms/tiktok/events/event-router.ts";

type MainPresentationFixture = Awaited<
  ReturnType<typeof createMainPresentationFixture>
>;

const assertNonEmptyString = (value: unknown) => {
  expect(typeof value).toBe("string");
  if (typeof value !== "string") {
    throw new Error("Expected non-empty string");
  }
  expect(value.trim()).not.toBe("");
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

type QueuedNotification = {
  type: string;
  data: {
    displayMessage: string;
    ttsMessage: string;
    logMessage: string;
    username?: string;
    giftType?: string;
    giftCount?: number;
    aggregatedCount?: number;
    avatarUrl?: string;
  };
};

const isQueuedNotification = (value: unknown): value is QueuedNotification =>
  !!value &&
  typeof value === "object" &&
  "type" in value &&
  "data" in value &&
  typeof value.data === "object" &&
  value.data !== null;

const firstQueuedNotification = (addItemSpy: {
  mock: { calls: unknown[][] };
}): QueuedNotification => {
  const queued = addItemSpy.mock.calls[0]?.[0];
  if (!isQueuedNotification(queued)) {
    throw new Error("Expected a queued TikTok notification");
  }
  return queued;
};

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

describe("TikTok event pipeline (smoke E2E)", () => {
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

  const startTikTokSmokeFixture = async (options: {
    messagesEnabled?: boolean;
    giftsEnabled?: boolean;
    tiktokMessagesEnabled?: boolean;
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
    presentation.config.general.greetingsEnabled = false;
    presentation.config.general.logChatMessages = false;
    presentation.config.tiktok.messagesEnabled =
      options.tiktokMessagesEnabled ?? options.messagesEnabled ?? false;
    presentation.config.tiktok.giftsEnabled = options.giftsEnabled ?? false;
    presentation.config.tiktok.greetingsEnabled = false;
    presentation.config.tiktok.giftAggregationEnabled =
      options.giftAggregationEnabled ?? false;
    presentation.config.tiktok.dataLoggingEnabled = false;

    await presentation.start();

    const routerRuntime = presentation.runtime.platformEventRouter.runtime;
    const handleChatSpy = spyOn(routerRuntime, "handleChatMessage");
    const addItemSpy = spyOn(presentation.queue, "addItem");
    const runtimeCalls = {
      get chat(): ChatRuntimeCall[] {
        return handleChatSpy.mock.calls.map(([platform, message]) => ({
          platform: String(platform),
          message: chatRuntimeMessage(message as Record<string, unknown>),
        }));
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
      displayQueue: { addItem: addItemSpy },
    };
  };

  test("routes chat and gift into user-facing notifications", async () => {
    const { connection, runtimeCalls, displayQueue } =
      await startTikTokSmokeFixture({
        messagesEnabled: true,
        giftsEnabled: true,
        tiktokMessagesEnabled: false,
        giftAggregationEnabled: false,
      });
    setSystemTime(new Date("2025-01-20T12:00:00.000Z"));

    const eventTimestamp = Date.parse("2025-01-20T12:00:00.000Z");
    const chatPayload = {
      comment: "hello from tiktok",
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
          "https://example.invalid/tiktok-smoke-immediate-avatar.jpg",
      },
      repeatCount: 1,
      repeatEnd: true,
      giftDetails: { giftName: "Rose", diamondCount: 1, giftType: 0 },
      common: { createTime: eventTimestamp, msgId: "test-gift-msg-1" },
    };

    connection.emit(WebcastEvent.CHAT, chatPayload);
    connection.emit(WebcastEvent.GIFT, giftPayload);

    await new Promise(setImmediate);

    expect(runtimeCalls.chat).toHaveLength(1);
    const firstChatCall = runtimeCalls.chat[0]!;
    expect(firstChatCall.message.message.text).toBe("hello from tiktok");
    expect(firstChatCall.message.username).toBe("test-user-one");

    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const queued = firstQueuedNotification(displayQueue.addItem);
    assertNonEmptyString(queued.data.displayMessage);
    assertNonEmptyString(queued.data.ttsMessage);
    assertNonEmptyString(queued.data.logMessage);
    expectNoTechnicalArtifacts(queued.data.displayMessage);
    expectNoTechnicalArtifacts(queued.data.ttsMessage);
    expectNoTechnicalArtifacts(queued.data.logMessage);
    expect(queued.data.username).toBe("test-user-two");
    expect(queued.data.giftType).toBe("Rose");
    expect(queued.data.avatarUrl).toBe(
      "https://example.invalid/tiktok-smoke-immediate-avatar.jpg",
    );
  });

  test("routes emote-only TikTok chat into runtime chat handling", async () => {
    const { connection, runtimeCalls } = await startTikTokSmokeFixture({
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
        userId: "test-user-id-emote-smoke",
        uniqueId: "test-user-emote-smoke",
        nickname: "test-user-emote-smoke",
      },
      common: { createTime: eventTimestamp },
    };

    connection.emit(WebcastEvent.CHAT, chatPayload);

    await new Promise(setImmediate);

    expect(runtimeCalls.chat).toHaveLength(1);
    const firstChatCall = runtimeCalls.chat[0]!;
    expect(firstChatCall.message.message).toEqual({
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

  test("suppresses duplicate replay chats while allowing fresh chats", async () => {
    const { connection, runtimeCalls } = await startTikTokSmokeFixture({
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
        userId: "test-user-id-smoke",
        uniqueId: "test-user-smoke",
        nickname: "test-user-smoke",
      },
      common: { createTime: eventTimestamp, msgId },
    });

    connection.emit(
      WebcastEvent.CHAT,
      makeChatPayload("test-chat-msg-smoke-1", "hello once"),
    );
    connection.emit(
      WebcastEvent.CHAT,
      makeChatPayload("test-chat-msg-smoke-1", "hello duplicate"),
    );
    connection.emit(
      WebcastEvent.CHAT,
      makeChatPayload("test-chat-msg-smoke-2", "hello twice"),
    );

    await new Promise(setImmediate);

    expect(runtimeCalls.chat).toHaveLength(2);
    expect(
      runtimeCalls.chat.map((entry) => entry.message.message.text),
    ).toEqual(["hello once", "hello twice"]);
  });

  test("produces one aggregated user-facing gift notification for rapid burst", async () => {
    const { connection, platform, displayQueue } =
      await startTikTokSmokeFixture({
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
          url: ["https://example.invalid/tiktok-smoke-aggregated-avatar.jpg"],
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

    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const queued = firstQueuedNotification(displayQueue.addItem);
    expect(queued.type).toBe("platform:gift");
    expect(queued.data.giftType).toBe("Hand Heart");
    expect(queued.data.giftCount).toBe(4);
    expect(queued.data.aggregatedCount).toBe(4);
    assertNonEmptyString(queued.data.displayMessage);
    assertNonEmptyString(queued.data.ttsMessage);
    assertNonEmptyString(queued.data.logMessage);
    expectNoTechnicalArtifacts(queued.data.displayMessage);
    expectNoTechnicalArtifacts(queued.data.ttsMessage);
    expectNoTechnicalArtifacts(queued.data.logMessage);
    expect(queued.data.avatarUrl).toBe(
      "https://example.invalid/tiktok-smoke-aggregated-avatar.jpg",
    );
  });

  test("emits terminal no-reconnect lifecycle signal for terminal disconnect reasons", async () => {
    const { connection, platform } = await startTikTokSmokeFixture({});

    const emittedEvents: Array<{
      type: string;
      data: { willReconnect?: boolean };
    }> = [];
    platform.on(
      "platform:event",
      (event: { type: string; data: { willReconnect?: boolean } }) => {
        emittedEvents.push(event);
      },
    );

    connection.emit(ControlEvent.DISCONNECTED, { message: "private account" });
    await new Promise(setImmediate);

    const statusEvent = emittedEvents.find(
      (event) => event.type === "platform:stream-status",
    );
    expect(statusEvent).toBeDefined();
    if (!statusEvent) {
      throw new Error("Expected stream status event");
    }
    expect(statusEvent.data.willReconnect).toBe(false);
  });
});
