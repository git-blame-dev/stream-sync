import { describe, test, afterEach, expect } from "bun:test";
import EventEmitter from "events";

import NotificationManager from "../../src/notifications/NotificationManager";
import { PlatformEventRouter } from "../../src/services/PlatformEventRouter.ts";
import { TikTokPlatform } from "../../src/platforms/tiktok";
import * as coreConstants from "../../src/core/constants";
import { createConfigFixture } from "../helpers/config-fixture";
import { createMockDisplayQueue, noOpLogger } from "../helpers/mock-factories";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import {
  useFakeTimers,
  useRealTimers,
  setSystemTime,
  advanceTimersByTime,
  clearAllTimers,
} from "../helpers/bun-timers";
import {
  setupTikTokEventListeners,
  cleanupTikTokEventListeners,
} from "../../src/platforms/tiktok/events/event-router.ts";

type EventHandler = (payload: unknown) => void | Promise<void>;

const createEventBus = () => {
  const emitter = new EventEmitter();
  return {
    emit: (event: string, payload: unknown) => emitter.emit(event, payload),
    subscribe: (event: string, handler: EventHandler) => {
      emitter.on(event, handler);
      return () => emitter.off(event, handler);
    },
  };
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

const giftRuntimePayload = (value: Record<string, unknown>): GiftRuntimeCall["payload"] => value;
const shareRuntimePayload = (value: Record<string, unknown>): ShareRuntimeCall["payload"] => value;

describe("TikTok event pipeline (integration)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("routes chat, gift, and share through platform:event", async () => {
    const eventBus = createEventBus();
    const logger = noOpLogger;
    const runtimeCalls = {
      chat: [] as ChatRuntimeCall[],
      gift: [] as GiftRuntimeCall[],
      share: [] as ShareRuntimeCall[],
    };
    const runtime = {
      handleChatMessage: (platform: string, message: Record<string, unknown>) =>
        void runtimeCalls.chat.push({ platform, message: chatRuntimeMessage(message) }),
      handleGiftNotification: (
        platform: string,
        username: unknown,
        payload: Record<string, unknown>,
      ) =>
        void runtimeCalls.gift.push({ platform, username, payload: giftRuntimePayload(payload) }),
      handleShareNotification: (
        platform: string,
        username: unknown,
        payload: Record<string, unknown>,
      ) =>
        void runtimeCalls.share.push({ platform, username, payload: shareRuntimePayload(payload) }),
    };
    const displayQueue = createMockDisplayQueue();
    const config = createConfigFixture({
      general: {
        messagesEnabled: true,
        giftsEnabled: true,
        sharesEnabled: true,
      },
      tiktok: {
        enabled: true,
      },
      obs: { enabled: false },
    });
    const notificationManager = new NotificationManager({
      displayQueue,
      logger,
      eventBus,
      config,
      constants: coreConstants,
      obsGoals: { processDonationGoal: createMockFn() },
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue(null),
      },
      userTrackingService: {
        isFirstMessage: createMockFn().mockResolvedValue(false),
      },
    });

    const router = new PlatformEventRouter({
      eventBus,
      runtime,
      notificationManager,
      config,
      logger,
    });

    const connection = new FakeTikTokConnection();

    const platform = new TikTokPlatform(
      {
        enabled: true,
        username: "test-user",
        giftAggregationEnabled: false,
      },
      {
        logger,
        eventBus,
        TikTokWebSocketClient: createMockFn(),
        WebcastEvent,
        ControlEvent,
        connectionFactory: { createConnection: createMockFn() },
      },
    );

    platform.connection = connection;
    const routerPlatform = asRouterPlatform(platform);
    setupTikTokEventListeners(routerPlatform);

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

    try {
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
    } finally {
      router.dispose();
      cleanupTikTokEventListeners(routerPlatform);
    }
  });

  test("routes emote-only TikTok chat payloads through platform:event chat path", async () => {
    const eventBus = createEventBus();
    const logger = noOpLogger;
    const runtimeCalls = {
      chat: [] as ChatRuntimeCall[],
    };
    const runtime = {
      handleChatMessage: (platform: string, message: Record<string, unknown>) =>
        void runtimeCalls.chat.push({ platform, message: chatRuntimeMessage(message) }),
    };
    const displayQueue = createMockDisplayQueue();
    const config = createConfigFixture({
      general: {
        messagesEnabled: true,
      },
      tiktok: {
        enabled: true,
      },
      obs: { enabled: false },
    });
    const notificationManager = new NotificationManager({
      displayQueue,
      logger,
      eventBus,
      config,
      constants: coreConstants,
      obsGoals: { processDonationGoal: createMockFn() },
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue(null),
      },
      userTrackingService: {
        isFirstMessage: createMockFn().mockResolvedValue(false),
      },
    });

    const router = new PlatformEventRouter({
      eventBus,
      runtime,
      notificationManager,
      config,
      logger,
    });

    const connection = new FakeTikTokConnection();

    const platform = new TikTokPlatform(
      {
        enabled: true,
        username: "test-user",
        giftAggregationEnabled: false,
      },
      {
        logger,
        eventBus,
        TikTokWebSocketClient: createMockFn(),
        WebcastEvent,
        ControlEvent,
        connectionFactory: { createConnection: createMockFn() },
      },
    );

    platform.connection = connection;
    const routerPlatform = asRouterPlatform(platform);
    setupTikTokEventListeners(routerPlatform);

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

    try {
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
    } finally {
      router.dispose();
      cleanupTikTokEventListeners(routerPlatform);
    }
  });

  test("routes only fresh unique chats during mixed replay bursts", async () => {
    useFakeTimers();
    setSystemTime(new Date("2025-01-20T12:05:00.000Z"));

    const eventBus = createEventBus();
    const logger = noOpLogger;
    const runtimeCalls = {
      chat: [] as ChatRuntimeCall[],
    };
    const runtime = {
      handleChatMessage: (platform: string, message: Record<string, unknown>) =>
        void runtimeCalls.chat.push({ platform, message: chatRuntimeMessage(message) }),
    };
    const displayQueue = createMockDisplayQueue();
    const config = createConfigFixture({
      general: {
        messagesEnabled: true,
      },
      tiktok: {
        enabled: true,
      },
      obs: { enabled: false },
    });
    const notificationManager = new NotificationManager({
      displayQueue,
      logger,
      eventBus,
      config,
      constants: coreConstants,
      obsGoals: { processDonationGoal: createMockFn() },
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue(null),
      },
      userTrackingService: {
        isFirstMessage: createMockFn().mockResolvedValue(false),
      },
    });

    const router = new PlatformEventRouter({
      eventBus,
      runtime,
      notificationManager,
      config,
      logger,
    });

    const connection = new FakeTikTokConnection();

    const platform = new TikTokPlatform(
      {
        enabled: true,
        username: "test-user",
        giftAggregationEnabled: false,
      },
      {
        logger,
        eventBus,
        TikTokWebSocketClient: createMockFn(),
        WebcastEvent,
        ControlEvent,
        connectionFactory: { createConnection: createMockFn() },
      },
    );

    platform.connection = connection;
    const routerPlatform = asRouterPlatform(platform);
    setupTikTokEventListeners(routerPlatform);

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

    try {
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
    } finally {
      router.dispose();
      cleanupTikTokEventListeners(routerPlatform);
      clearAllTimers();
      useRealTimers();
    }
  });

  test("aggregates rapid distinct gift message ids when aggregation is enabled", async () => {
    useFakeTimers();
    setSystemTime(new Date("2025-01-20T12:00:00.000Z"));

    const eventBus = createEventBus();
    const logger = noOpLogger;
    const runtimeCalls = {
      gift: [] as GiftRuntimeCall[],
    };
    const runtime = {
      handleGiftNotification: (
        platform: string,
        username: unknown,
        payload: Record<string, unknown>,
      ) =>
        void runtimeCalls.gift.push({ platform, username, payload: giftRuntimePayload(payload) }),
    };
    const displayQueue = createMockDisplayQueue();
    const config = createConfigFixture({
      general: {
        giftsEnabled: true,
      },
      tiktok: {
        enabled: true,
        giftAggregationEnabled: true,
      },
      obs: { enabled: false },
    });
    const notificationManager = new NotificationManager({
      displayQueue,
      logger,
      eventBus,
      config,
      constants: coreConstants,
      obsGoals: { processDonationGoal: createMockFn() },
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue(null),
      },
      userTrackingService: {
        isFirstMessage: createMockFn().mockResolvedValue(false),
      },
    });

    const router = new PlatformEventRouter({
      eventBus,
      runtime,
      notificationManager,
      config,
      logger,
    });

    const connection = new FakeTikTokConnection();

    const platform = new TikTokPlatform(
      {
        enabled: true,
        username: "test-user",
        giftAggregationEnabled: true,
      },
      {
        logger,
        eventBus,
        TikTokWebSocketClient: createMockFn(),
        WebcastEvent,
        ControlEvent,
        connectionFactory: { createConnection: createMockFn() },
      },
    );

    platform.connection = connection;
    const routerPlatform = asRouterPlatform(platform);
    setupTikTokEventListeners(routerPlatform);

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

    try {
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
    } finally {
      router.dispose();
      cleanupTikTokEventListeners(routerPlatform);
      clearAllTimers();
      useRealTimers();
    }
  });
});
