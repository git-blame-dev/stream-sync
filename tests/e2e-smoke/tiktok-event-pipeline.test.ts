import { describe, test, afterEach, expect } from "bun:test";
import EventEmitter from "events";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import {
  advanceTimersByTime,
  clearAllTimers,
  setSystemTime,
  useFakeTimers,
  useRealTimers,
} from "../helpers/bun-timers";
import { createConfigFixture } from "../helpers/config-fixture";
import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";
import { createMockDisplayQueue, noOpLogger } from "../helpers/mock-factories";
import NotificationManager from "../../src/notifications/NotificationManager";
import * as coreConstants from "../../src/core/constants";
import { TikTokPlatform } from "../../src/platforms/tiktok.ts";
import {
  cleanupTikTokEventListeners,
  setupTikTokEventListeners,
} from "../../src/platforms/tiktok/events/event-router.ts";
import { PlatformEventRouter } from "../../src/services/PlatformEventRouter.ts";

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

type GiftNotificationPayload = {
  type: string;
  giftType?: string;
  giftCount?: number;
  aggregatedCount?: number;
  avatarUrl?: string;
};

const giftNotificationPayload = (
  value: Record<string, unknown>,
): GiftNotificationPayload => {
  if (typeof value.type !== "string") {
    throw new Error("Expected TikTok gift notification type");
  }
  return value as GiftNotificationPayload;
};

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

const firstQueuedNotification = (
  displayQueue: ReturnType<typeof createMockDisplayQueue>,
): QueuedNotification => {
  const queued = displayQueue.addItem.mock.calls[0]?.[0];
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
  afterEach(() => {
    restoreAllMocks();
  });

  test("routes chat and gift into user-facing notifications", async () => {
    const eventBus = createEventBus();
    const logger = noOpLogger;
    const displayQueue = createMockDisplayQueue();
    const config = createConfigFixture({
      general: {
        messagesEnabled: true,
        giftsEnabled: true,
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
    const runtimeCalls: { chat: ChatRuntimeCall[] } = { chat: [] };
    const runtime = {
      handleChatMessage: (platform: string, message: Record<string, unknown>) =>
        void runtimeCalls.chat.push({ platform, message: chatRuntimeMessage(message) }),
      handleGiftNotification: async (
        platform: string,
        _username: unknown,
        payload: Record<string, unknown>,
      ) => {
        const notificationPayload = giftNotificationPayload(payload);
        return notificationManager.handleNotification(
          notificationPayload.type,
          platform,
          notificationPayload,
        );
      },
    };

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

    try {
      connection.emit(WebcastEvent.CHAT, chatPayload);
      connection.emit(WebcastEvent.GIFT, giftPayload);

      await new Promise(setImmediate);

      expect(runtimeCalls.chat).toHaveLength(1);
      const firstChatCall = runtimeCalls.chat[0]!;
      expect(firstChatCall.message.message.text).toBe("hello from tiktok");
      expect(firstChatCall.message.username).toBe("test-user-one");

      expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
      const queued = firstQueuedNotification(displayQueue);
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
    } finally {
      router.dispose();
      cleanupTikTokEventListeners(routerPlatform);
    }
  });

  test("routes emote-only TikTok chat into runtime chat handling", async () => {
    const eventBus = createEventBus();
    const logger = noOpLogger;
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
    const runtimeCalls: { chat: ChatRuntimeCall[] } = { chat: [] };
    const runtime = {
      handleChatMessage: (platform: string, message: Record<string, unknown>) =>
        void runtimeCalls.chat.push({ platform, message: chatRuntimeMessage(message) }),
    };

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
        userId: "test-user-id-emote-smoke",
        uniqueId: "test-user-emote-smoke",
        nickname: "test-user-emote-smoke",
      },
      common: { createTime: eventTimestamp },
    };

    try {
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
    } finally {
      router.dispose();
      cleanupTikTokEventListeners(routerPlatform);
    }
  });

  test("suppresses duplicate replay chats while allowing fresh chats", async () => {
    useFakeTimers();
    setSystemTime(new Date("2025-01-20T12:05:00.000Z"));

    const eventBus = createEventBus();
    const logger = noOpLogger;
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
    const runtimeCalls: { chat: ChatRuntimeCall[] } = { chat: [] };
    const runtime = {
      handleChatMessage: (platform: string, message: Record<string, unknown>) =>
        void runtimeCalls.chat.push({ platform, message: chatRuntimeMessage(message) }),
    };

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
        userId: "test-user-id-smoke",
        uniqueId: "test-user-smoke",
        nickname: "test-user-smoke",
      },
      common: { createTime: eventTimestamp, msgId },
    });

    try {
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
    } finally {
      router.dispose();
      cleanupTikTokEventListeners(routerPlatform);
      clearAllTimers();
      useRealTimers();
    }
  });

  test("produces one aggregated user-facing gift notification for rapid burst", async () => {
    useFakeTimers();
    setSystemTime(new Date("2025-01-20T12:00:00.000Z"));

    const eventBus = createEventBus();
    const logger = noOpLogger;
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
    const runtime = {
      handleGiftNotification: async (
        platform: string,
        _username: unknown,
        payload: Record<string, unknown>,
      ) => {
        const notificationPayload = giftNotificationPayload(payload);
        return notificationManager.handleNotification(
          notificationPayload.type,
          platform,
          notificationPayload,
        );
      },
    };

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
          url: ["https://example.invalid/tiktok-smoke-aggregated-avatar.jpg"],
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

      expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
      const queued = firstQueuedNotification(displayQueue);
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
    } finally {
      router.dispose();
      cleanupTikTokEventListeners(routerPlatform);
      clearAllTimers();
      useRealTimers();
    }
  });

  test("emits terminal no-reconnect lifecycle signal for terminal disconnect reasons", async () => {
    const connection = new FakeTikTokConnection();

    const platform = new TikTokPlatform(
      {
        enabled: true,
        username: "test-user",
      },
      {
        logger: noOpLogger,
        TikTokWebSocketClient: createMockFn(),
        WebcastEvent,
        ControlEvent,
        connectionFactory: { createConnection: createMockFn() },
      },
    );

    platform.connection = connection;
    const routerPlatform = asRouterPlatform(platform);
    setupTikTokEventListeners(routerPlatform);
    const emittedEvents: Array<{ type: string; data: { willReconnect?: boolean } }> = [];
    platform.on("platform:event", (event: { type: string; data: { willReconnect?: boolean } }) => {
      emittedEvents.push(event);
    });

    try {
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
    } finally {
      cleanupTikTokEventListeners(routerPlatform);
    }
  });
});
