import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../../helpers/mock-factories";
import { createConfigFixture } from "../../../../helpers/config-fixture";

import { PlatformEventRouter } from "../../../../../src/services/PlatformEventRouter.ts";
import { PlatformEvents } from "../../../../../src/interfaces/PlatformEvents";
import { TikTokPlatform } from "../../../../../src/platforms/tiktok.ts";
import * as testClock from "../../../../helpers/test-clock";

type PlatformEventPayload = {
  platform: string;
  type: string;
  data: Record<string, unknown>;
};

type RecordedBusEvent = {
  eventName: string;
  payload: PlatformEventPayload;
};

type EventHandler = (payload: PlatformEventPayload) => void | Promise<void>;

type MockEventBus = {
  emitted: RecordedBusEvent[];
  handlers: Record<string, EventHandler[]>;
  emit: (eventName: string, payload: unknown) => void;
  subscribe: (eventName: string, handler: EventHandler) => () => void;
};

type RuntimeCalls = {
  handleChatMessage: unknown[][];
  handleFollowNotification: unknown[][];
  handleGiftNotification: unknown[][];
};

type TestRuntime = {
  handleChatMessage: (...args: unknown[]) => void;
  handleFollowNotification: (...args: unknown[]) => void;
  handleGiftNotification: (...args: unknown[]) => void;
  handlePaypiggyNotification: ReturnType<typeof createMockFn>;
  handleRaidNotification: ReturnType<typeof createMockFn>;
  _calls: RuntimeCalls;
};

type ShareEvent = PlatformEventPayload & {
  type: typeof PlatformEvents.SHARE;
};

type ChatEvent = PlatformEventPayload & {
  type: typeof PlatformEvents.CHAT_MESSAGE;
  data: {
    message?: {
      text?: string;
    };
  };
};

const isShareEvent = (value: PlatformEventPayload): value is ShareEvent =>
  value.type === PlatformEvents.SHARE;

const isChatEvent = (value: PlatformEventPayload): value is ChatEvent =>
  value.type === PlatformEvents.CHAT_MESSAGE;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const platformEventPayload = (value: unknown): PlatformEventPayload => {
  if (!isRecord(value) || typeof value.platform !== "string" || typeof value.type !== "string" || !isRecord(value.data)) {
    throw new Error("Expected platform event payload");
  }
  return value as PlatformEventPayload;
};

const recordPayload = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error("Expected TikTok event data record");
  }
  return value;
};

describe("TikTokPlatform unified event contract (expected behavior)", () => {
  let platform: TikTokPlatform;
  let mockEventBus: MockEventBus;
  let runtime: TestRuntime;

  afterEach(() => {
    restoreAllMocks();
  });

  beforeEach(() => {
    mockEventBus = {
      emitted: [],
      handlers: {},
      emit(eventName: string, payload: unknown) {
        const typedPayload = platformEventPayload(payload);
        (this.handlers[eventName] || []).forEach((handler) => handler(typedPayload));
        this.emitted.push({ eventName, payload: typedPayload });
      },
      subscribe(eventName: string, handler: EventHandler) {
        this.handlers[eventName] = this.handlers[eventName] || [];
        this.handlers[eventName].push(handler);
        return () => {
          this.handlers[eventName] = (this.handlers[eventName] || []).filter(
            (h: EventHandler) => h !== handler,
          );
        };
      },
    };

    const runtimeCalls: RuntimeCalls = {
      handleChatMessage: [],
      handleFollowNotification: [],
      handleGiftNotification: [],
    };
    runtime = {
      handleChatMessage: (...args: unknown[]) =>
        void runtimeCalls.handleChatMessage.push(args),
      handleFollowNotification: (...args: unknown[]) =>
        void runtimeCalls.handleFollowNotification.push(args),
      handleGiftNotification: (...args: unknown[]) =>
        void runtimeCalls.handleGiftNotification.push(args),
      handlePaypiggyNotification: createMockFn(),
      handleRaidNotification: createMockFn(),
      _calls: runtimeCalls,
    };

    new PlatformEventRouter({
      eventBus: mockEventBus,
      runtime,
      notificationManager: { handleNotification: createMockFn() },
      config: createConfigFixture({
        general: {
          followsEnabled: true,
          giftsEnabled: true,
          messagesEnabled: true,
        },
      }),
      logger: noOpLogger,
    });

    const mockDependencies = {
      logger: noOpLogger,
      connectionFactory: {
        createConnection: createMockFn().mockReturnValue({
          connect: createMockFn().mockResolvedValue(),
          disconnect: createMockFn().mockResolvedValue(),
          on: createMockFn(),
          removeAllListeners: createMockFn(),
        }),
      },
      TikTokWebSocketClient: class MockConnection {
        constructor() {}
        connect() {
          return Promise.resolve();
        }
        disconnect() {
          return Promise.resolve();
        }
        on() {}
        removeAllListeners() {}
      },
      WebcastEvent: {
        CHAT: "chat",
        GIFT: "gift",
        FOLLOW: "follow",
        SOCIAL: "social",
        ROOM_USER: "roomUser",
        ERROR: "error",
        DISCONNECT: "disconnect",
      },
      ControlEvent: {},
      timestampService: {
        extractTimestamp: createMockFn(() =>
          new Date(testClock.now()).toISOString(),
        ),
      },
    };

    platform = new TikTokPlatform(
      { enabled: false, username: "user" },
      {
        ...mockDependencies,
        eventBus: mockEventBus,
      },
    );

    const platformHandlers = {
      onChat: (data: unknown) =>
        mockEventBus.emit("platform:event", {
          platform: "tiktok",
          type: PlatformEvents.CHAT_MESSAGE,
          data: recordPayload(data),
        }),
      onFollow: (data: unknown) =>
        mockEventBus.emit("platform:event", {
          platform: "tiktok",
          type: PlatformEvents.FOLLOW,
          data: recordPayload(data),
        }),
      onGift: (data: unknown) =>
        mockEventBus.emit("platform:event", {
          platform: "tiktok",
          type: PlatformEvents.GIFT,
          data: recordPayload(data),
        }),
      onShare: (data: unknown) =>
        mockEventBus.emit("platform:event", {
          platform: "tiktok",
          type: PlatformEvents.SHARE,
          data: recordPayload(data),
        }),
    };

    platform.handlers = { ...platform.handlers, ...platformHandlers };
  });

  it("routes chat events through platform:event to PlatformEventRouter", async () => {
    await platform._handleChatMessage({
      user: {
        userId: "tt-user-1",
        uniqueId: "user1",
        nickname: "User1",
      },
      comment: "hello world",
      common: { createTime: testClock.now() },
    });

    expect(runtime._calls.handleChatMessage).toHaveLength(1);
    expect(
      mockEventBus.emitted.find((e) => e.eventName === "platform:event"),
    ).toBeDefined();
  });

  it("routes follow events through platform:event to PlatformEventRouter", async () => {
    await platform._handleFollow({
      user: {
        userId: "tt-follow-1",
        uniqueId: "follower",
        nickname: "Follower",
      },
      common: { createTime: testClock.now() },
    });

    expect(runtime._calls.handleFollowNotification).toHaveLength(1);
    expect(
      mockEventBus.emitted.find((e) => e.eventName === "platform:event"),
    ).toBeDefined();
  });

  it("routes gift events through platform:event to PlatformEventRouter", async () => {
    const timestamp = new Date(testClock.now()).toISOString();
    await platform._handleGift({
      platform: "tiktok",
      userId: "tt-gift-1",
      username: "gifter",
      giftType: "Rose",
      giftCount: 2,
      repeatCount: 2,
      amount: 20,
      currency: "coins",
      unitAmount: 10,
      timestamp,
      id: "gift-msg-1",
    });

    expect(runtime._calls.handleGiftNotification).toHaveLength(1);
    expect(
      mockEventBus.emitted.find((e) => e.eventName === "platform:event"),
    ).toBeDefined();
  });

  it("emits share events through platform:event when only default handlers are available", () => {
    const emitted: PlatformEventPayload[] = [];
    platform.handlers = platform._createDefaultHandlers();
    mockEventBus.subscribe("platform:event", (payload) => {
      emitted.push(payload);
    });

    const sharePayload = { username: "user123", actionType: "share" };
    const shareHandler = platform.handlers.onShare;
    if (!shareHandler) {
      throw new Error("Expected TikTok share handler");
    }
    shareHandler(sharePayload);

    const shareEvent = emitted.find(
      isShareEvent,
    );

    expect(shareEvent).toBeDefined();
    if (!shareEvent) {
      throw new Error("Expected TikTok share platform event");
    }
    expect(shareEvent.data).toEqual(sharePayload);
  });

  it("emits platform:event for chat without relying on bridge shims", async () => {
    const emitted: PlatformEventPayload[] = [];
    mockEventBus.subscribe("platform:event", (payload) => {
      emitted.push(payload);
    });

    await platform._handleChatMessage({
      user: {
        userId: "tt-user-2",
        uniqueId: "user-no-bridge",
        nickname: "NoBridgeUser",
      },
      comment: "hello from no bridge",
      common: { createTime: testClock.now() },
    });

    const chatEvent = emitted.find(
      isChatEvent,
    );
    expect(chatEvent).toBeDefined();
    if (!chatEvent) {
      throw new Error("Expected TikTok chat platform event");
    }
    expect(chatEvent.data?.message?.text).toContain("hello from no bridge");
  });

  it("emits local platform:event for routed events", () => {
    const emitted: PlatformEventPayload[] = [];
    platform.on("platform:event", (payload) => emitted.push(payload));

    const payload = { platform: "tiktok", message: { text: "hello" } };
    platform._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, payload);

    expect(emitted).toEqual([
      {
        platform: "tiktok",
        type: PlatformEvents.CHAT_MESSAGE,
        data: payload,
      },
    ]);
  });
});
