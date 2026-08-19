import { describe, expect, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks, type TestMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";

import { PlatformEventRouter } from "../../../src/services/PlatformEventRouter.ts";
import { UserTrackingService } from "../../../src/services/UserTrackingService.ts";

type RouterOptions = ConstructorParameters<typeof PlatformEventRouter>[0];
type ChatMessageHandlerMock = TestMockFn<[string, Record<string, unknown>], unknown>;
type RuntimeNotificationMock = TestMockFn<[string, unknown, Record<string, unknown>], unknown>;
type StreamDetectedHandlerMock = TestMockFn<[string, Record<string, unknown>], unknown>;
type ViewerCountHandlerMock = TestMockFn<[string, number], unknown>;
type NotificationManagerMock = TestMockFn<[string, string, Record<string, unknown>], unknown>;
type RuntimeFake = {
  handleChatMessage: ChatMessageHandlerMock;
  handleGiftNotification: RuntimeNotificationMock;
  handlePaypiggyNotification: RuntimeNotificationMock;
  handleGiftPaypiggyNotification: RuntimeNotificationMock;
  handleEnvelopeNotification: StreamDetectedHandlerMock;
  handleStreamDetected: StreamDetectedHandlerMock;
  handleRaidNotification: RuntimeNotificationMock;
  handleShareNotification: RuntimeNotificationMock;
  handleFollowNotification: RuntimeNotificationMock;
  updateViewerCount: ViewerCountHandlerMock;
};
type NotificationManagerFake = {
  handleNotification: NotificationManagerMock;
};
type BuildRouterOverrides = {
  runtime?: Partial<RuntimeFake>;
  config?: RouterOptions["config"];
  notificationManager?: Partial<NotificationManagerFake>;
  userTrackingService?: UserTrackingService;
};

const firstMockCall = <Args extends unknown[]>(calls: Args[]): Args => {
  const [call] = calls;
  if (!call) {
    throw new Error("Expected mock to have at least one call");
  }
  return call;
};

describe("PlatformEventRouter validation", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const buildRouter = (overrides: BuildRouterOverrides = {}) => {
    const runtime = {
      handleChatMessage: createMockFn<[string, Record<string, unknown>], unknown>(),
      handleGiftNotification: createMockFn<[string, unknown, Record<string, unknown>], unknown>(),
      handlePaypiggyNotification: createMockFn<[string, unknown, Record<string, unknown>], unknown>(),
      handleGiftPaypiggyNotification: createMockFn<[string, unknown, Record<string, unknown>], unknown>(),
      handleEnvelopeNotification: createMockFn<[string, Record<string, unknown>], unknown>(),
      handleStreamDetected: createMockFn<[string, Record<string, unknown>], unknown>(),
      handleRaidNotification: createMockFn<[string, unknown, Record<string, unknown>], unknown>(),
      handleShareNotification: createMockFn<[string, unknown, Record<string, unknown>], unknown>(),
      handleFollowNotification: createMockFn<[string, unknown, Record<string, unknown>], unknown>(),
      updateViewerCount: createMockFn<[string, number], unknown>(),
      ...overrides.runtime,
    };
    const config = overrides.config || createConfigFixture();
    const notificationManager = {
      handleNotification: createMockFn<[string, string, Record<string, unknown>], unknown>(),
      ...overrides.notificationManager,
    };
    const eventBus = {
      subscribe: createMockFn(() => createMockFn()),
    };
    const userTrackingService = overrides.userTrackingService || new UserTrackingService();

    return {
      router: new PlatformEventRouter({
        runtime,
        eventBus,
        notificationManager,
        config,
        logger: noOpLogger,
        userTrackingService,
      }),
      runtime,
      notificationManager,
      userTrackingService,
    };
  };

  it("rejects paid alias event types", async () => {
    const { router, runtime } = buildRouter();

    await expect(
      router.routeEvent({
        platform: "twitch",
        type: "subscription",
        data: {
          username: "SubUser",
          userId: "u1",
          timestamp: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow("Unsupported paid alias event type: subscription");

    expect(runtime.handlePaypiggyNotification).not.toHaveBeenCalled();
  });

  it("routes platform chat messages with timestamps", async () => {
    const { router, runtime } = buildRouter();
    const timestamp = new Date().toISOString();

    await router.routeEvent({
      platform: "twitch",
      type: "platform:chat-message",
      data: {
        username: "User",
        userId: "u1",
        message: { text: "hello" },
        timestamp,
      },
    });

    const [calledPlatform, calledPayload] =
      firstMockCall(runtime.handleChatMessage.mock.calls);
    expect(calledPlatform).toBe("twitch");
    expect(calledPayload.message).toEqual({ text: "hello" });
    expect(calledPayload.timestamp).toBe(timestamp);
    expect(calledPayload.isStreamSupporter).toBe(false);
  });

  it("qualifies all canonical identified monetization senders as stream supporters", async () => {
    const { router, userTrackingService } = buildRouter();
    const timestamp = new Date().toISOString();
    const cases = [
      {
        platform: "tiktok",
        type: "platform:gift",
        data: { id: "gift-1", giftType: "rose", giftCount: 1, amount: 1, currency: "coins" },
      },
      { platform: "youtube", type: "platform:paypiggy", data: {} },
      { platform: "twitch", type: "platform:giftpaypiggy", data: { giftCount: 1 } },
      {
        platform: "tiktok",
        type: "platform:envelope",
        data: { id: "envelope-1", giftType: "envelope", giftCount: 1, amount: 1, currency: "coins" },
      },
    ];

    for (const [index, event] of cases.entries()) {
      const userId = `supporter-${index}`;
      await router.routeEvent({
        platform: event.platform,
        type: event.type,
        data: { ...event.data, username: `test-supporter-${index}`, userId, timestamp },
      });
      expect(userTrackingService.isStreamSupporter(event.platform, userId)).toBe(true);
    }
  });

  it("qualifies supporters even when their notification category is hidden", async () => {
    const config = createConfigFixture();
    config.twitch.giftsEnabled = false;
    const { router, runtime, userTrackingService } = buildRouter({ config });

    await router.routeEvent({
      platform: "twitch",
      type: "platform:gift",
      data: {
        id: "hidden-gift-1",
        giftType: "bits",
        giftCount: 1,
        amount: 1,
        currency: "bits",
        username: "hidden-supporter",
        userId: "hidden-supporter-id",
        timestamp: new Date().toISOString(),
      },
    });

    expect(runtime.handleGiftNotification).not.toHaveBeenCalled();
    expect(userTrackingService.isStreamSupporter("twitch", "hidden-supporter-id")).toBe(true);
  });

  it("annotates only later same-platform chat without changing membership", async () => {
    const { router, runtime } = buildRouter();
    const timestamp = new Date().toISOString();
    const chat = {
      username: "test-supporter",
      userId: "supporter-id",
      message: { text: "hello" },
      timestamp,
      isPaypiggy: false,
    };

    await router.routeEvent({ platform: "twitch", type: "platform:chat-message", data: chat });
    await router.routeEvent({
      platform: "twitch",
      type: "platform:paypiggy",
      data: { username: chat.username, userId: chat.userId, timestamp },
    });
    await router.routeEvent({ platform: "twitch", type: "platform:chat-message", data: chat });
    await router.routeEvent({ platform: "youtube", type: "platform:chat-message", data: chat });

    const chatCalls = runtime.handleChatMessage.mock.calls;
    expect(chatCalls[0]?.[1]).toEqual(expect.objectContaining({ isPaypiggy: false, isStreamSupporter: false }));
    expect(chatCalls[1]?.[1]).toEqual(expect.objectContaining({ isPaypiggy: false, isStreamSupporter: true }));
    expect(chatCalls[2]?.[1]).toEqual(expect.objectContaining({ isPaypiggy: false, isStreamSupporter: false }));
  });

  it("promotes a missing-ID YouTube gift handle when the sender next chats", async () => {
    const { router, runtime } = buildRouter();
    const timestamp = new Date().toISOString();

    await router.routeEvent({
      platform: "youtube",
      type: "platform:gift",
      data: {
        id: "test-supporter-gift-1",
        giftType: "Hiding",
        giftCount: 1,
        amount: 1,
        currency: "jewels",
        username: " @TestSupporterHandle ",
        timestamp,
        metadata: { missingFields: ["userId"] },
      },
    });
    await router.routeEvent({
      platform: "youtube",
      type: "platform:chat-message",
      data: {
        username: "TestOtherUser",
        userId: "test-other-channel-id",
        message: { text: "hello" },
        timestamp,
      },
    });
    await router.routeEvent({
      platform: "youtube",
      type: "platform:chat-message",
      data: {
        username: "TestSupporterHandle",
        userId: "test-youtube-channel-id",
        message: { text: "thank you" },
        timestamp,
        isPaypiggy: false,
      },
    });

    expect(runtime.handleChatMessage.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      userId: "test-other-channel-id",
      isStreamSupporter: false,
    }));
    expect(runtime.handleChatMessage.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      userId: "test-youtube-channel-id",
      isPaypiggy: false,
      isStreamSupporter: true,
    }));
  });

  it("does not qualify anonymous, error, or identity-less monetization", async () => {
    const { router, userTrackingService } = buildRouter();
    const timestamp = new Date().toISOString();

    await router.routeEvent({
      platform: "twitch",
      type: "platform:gift",
      data: { id: "anon", giftType: "bits", giftCount: 1, amount: 1, currency: "bits", isAnonymous: true, timestamp },
    });
    await router.routeEvent({
      platform: "tiktok",
      type: "platform:gift",
      data: { username: "error-user", userId: "error-id", isError: true, timestamp },
    });
    await router.routeEvent({
      platform: "youtube",
      type: "platform:gift",
      data: {
        id: "missing-id",
        giftType: "Girl power",
        giftCount: 1,
        amount: 1,
        currency: "jewels",
        username: "missing-id-user",
        timestamp,
        metadata: { missingFields: ["userId"] },
      },
    });

    expect(userTrackingService.isStreamSupporter("tiktok", "error-id")).toBe(false);
    expect(userTrackingService.isStreamSupporter("twitch", "anon")).toBe(false);
    expect(userTrackingService.isStreamSupporter("youtube", "missing-id")).toBe(false);
  });

  it("clears one platform only for an exact terminal stream status", async () => {
    const { router, userTrackingService } = buildRouter();
    userTrackingService.markStreamSupporter("twitch", "supporter-id");
    userTrackingService.markStreamSupporter("youtube", "supporter-id");

    await router.routeEvent({
      platform: "twitch",
      type: "platform:stream-status",
      data: { isLive: false, status: "reconnecting", timestamp: new Date().toISOString() },
    });
    expect(userTrackingService.isStreamSupporter("twitch", "supporter-id")).toBe(true);

    await router.routeEvent({
      platform: "twitch",
      type: "platform:stream-status",
      data: { isLive: false, status: "stream-ended", timestamp: new Date().toISOString() },
    });

    expect(userTrackingService.isStreamSupporter("twitch", "supporter-id")).toBe(false);
    expect(userTrackingService.isStreamSupporter("youtube", "supporter-id")).toBe(true);
  });

  it("clears a pending YouTube gift handle at authoritative stream end", async () => {
    const { router, runtime } = buildRouter();
    const timestamp = new Date().toISOString();

    await router.routeEvent({
      platform: "youtube",
      type: "platform:gift",
      data: {
        id: "pending-gift",
        giftType: "Hiding",
        giftCount: 1,
        amount: 1,
        currency: "jewels",
        username: "TestSupporterHandle",
        timestamp,
        metadata: { missingFields: ["userId"] },
      },
    });
    await router.routeEvent({
      platform: "youtube",
      type: "platform:stream-status",
      data: { isLive: false, status: "stream-ended", timestamp },
    });
    await router.routeEvent({
      platform: "youtube",
      type: "platform:chat-message",
      data: {
        username: "TestSupporterHandle",
        userId: "test-youtube-channel-id",
        message: { text: "new stream" },
        timestamp,
      },
    });

    expect(runtime.handleChatMessage.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      isStreamSupporter: false,
    }));
  });

  it("rejects monetization payloads missing required fields when not marked isError", async () => {
    const { router, runtime } = buildRouter();

    await expect(
      router.routeEvent({
        platform: "tiktok",
        type: "platform:gift",
        data: {
          username: "gifter",
          userId: "u2",
          amount: 50,
          currency: "coins",
          timestamp: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow(
      "Notification payload requires id, giftType, giftCount, amount, and currency",
    );

    expect(runtime.handleGiftNotification).not.toHaveBeenCalled();
  });

  it("allows monetization payloads with isError even when fields are missing", async () => {
    const { router, runtime } = buildRouter();

    await router.routeEvent({
      platform: "tiktok",
      type: "platform:gift",
      data: {
        username: "gifter",
        userId: "u3",
        isError: true,
        timestamp: new Date().toISOString(),
      },
    });

    expect(runtime.handleGiftNotification).toHaveBeenCalledTimes(1);
  });

  it("allows anonymous gift payloads without identity fields", async () => {
    const { router, runtime } = buildRouter();

    await router.routeEvent({
      platform: "twitch",
      type: "platform:gift",
      data: {
        id: "gift-anon-1",
        giftType: "bits",
        giftCount: 1,
        amount: 25,
        currency: "bits",
        isAnonymous: true,
        timestamp: new Date().toISOString(),
      },
    });

    expect(runtime.handleGiftNotification).toHaveBeenCalledTimes(1);
    const [, , payload] = firstMockCall(runtime.handleGiftNotification.mock.calls);
    expect(payload.isAnonymous).toBe(true);
    expect(payload.username).toBeUndefined();
    expect(payload.userId).toBeUndefined();
  });

  it("allows YouTube jewels gifts without userId only when missing-field metadata marks userId", async () => {
    const { router, runtime } = buildRouter();

    await router.routeEvent({
      platform: "youtube",
      type: "platform:gift",
      data: {
        id: "gift-yt-jewels-1",
        giftType: "Girl power",
        giftCount: 1,
        amount: 300,
        currency: "jewels",
        username: "test-jewels-user",
        timestamp: new Date().toISOString(),
        metadata: {
          missingFields: ["userId"],
        },
      },
    });

    expect(runtime.handleGiftNotification).toHaveBeenCalledTimes(1);
    const [, , payload] = firstMockCall(runtime.handleGiftNotification.mock.calls);
    expect(payload.userId).toBeUndefined();
    expect(payload.metadata).toEqual({ missingFields: ["userId"] });
  });

  it("allows amountless YouTube jewels gifts when metadata marks amount and userId missing", async () => {
    const { router, runtime } = buildRouter();

    await router.routeEvent({ platform: "youtube", type: "platform:gift", data: {
      id: "gift-yt-jewels-amountless-1", giftType: "Girl power", giftCount: 1,
      currency: "jewels", username: "test-jewels-user", timestamp: new Date().toISOString(),
      metadata: { missingFields: ["amount", "userId"] },
    }});

    expect(runtime.handleGiftNotification).toHaveBeenCalledTimes(1);
  });

  it("rejects amountless non-jewels gifts even when metadata marks amount missing", async () => {
    const { router, runtime } = buildRouter();

    await expect(router.routeEvent({ platform: "youtube", type: "platform:gift", data: {
      id: "gift-yt-superchat-amountless-1", giftType: "Super Chat", giftCount: 1,
      currency: "USD", username: "test-user", userId: "yt-user",
      timestamp: new Date().toISOString(), metadata: { missingFields: ["amount"] },
    }})).rejects.toThrow("Notification payload requires id, giftType, giftCount, amount, and currency");
    expect(runtime.handleGiftNotification).not.toHaveBeenCalled();
  });

  it("rejects YouTube jewels gifts without userId when missing-field metadata is absent", async () => {
    const { router, runtime } = buildRouter();

    await expect(
      router.routeEvent({
        platform: "youtube",
        type: "platform:gift",
        data: {
          id: "gift-yt-jewels-2",
          giftType: "Girl power",
          giftCount: 1,
          amount: 300,
          currency: "jewels",
          username: "test-jewels-user",
          timestamp: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow("Notification payload requires userId");

    expect(runtime.handleGiftNotification).not.toHaveBeenCalled();
  });

  it("allows anonymous giftpaypiggy payloads without identity fields", async () => {
    const { router, runtime } = buildRouter();

    await router.routeEvent({
      platform: "twitch",
      type: "platform:giftpaypiggy",
      data: {
        giftCount: 5,
        tier: "1000",
        isAnonymous: true,
        timestamp: new Date().toISOString(),
      },
    });

    expect(runtime.handleGiftPaypiggyNotification).toHaveBeenCalledTimes(1);
    const [, , payload] = firstMockCall(runtime.handleGiftPaypiggyNotification.mock.calls);
    expect(payload.isAnonymous).toBe(true);
    expect(payload.username).toBeUndefined();
    expect(payload.userId).toBeUndefined();
  });

  it("routes paypiggy and giftpaypiggy notifications without ids", async () => {
    const { router, runtime } = buildRouter();
    const timestamp = new Date().toISOString();

    await router.routeEvent({
      platform: "twitch",
      type: "platform:paypiggy",
      data: {
        username: "PaidFan",
        userId: "paid-1",
        timestamp,
      },
    });
    await router.routeEvent({
      platform: "twitch",
      type: "platform:giftpaypiggy",
      data: {
        username: "GiftSubFan",
        userId: "gift-sub-1",
        giftCount: 2,
        timestamp,
      },
    });

    expect(runtime.handlePaypiggyNotification).toHaveBeenCalledTimes(1);
    expect(runtime.handleGiftPaypiggyNotification).toHaveBeenCalledTimes(1);
  });

  it("routes gift notifications with canonical types", async () => {
    const { router, runtime } = buildRouter();
    const timestamp = new Date().toISOString();

    await router.routeEvent({
      platform: "tiktok",
      type: "platform:gift",
      data: {
        id: "gift-1",
        username: "gifter",
        userId: "u9",
        giftType: "rose",
        giftCount: 1,
        amount: 5,
        currency: "coins",
        timestamp,
      },
    });

    const [, , payload] = firstMockCall(runtime.handleGiftNotification.mock.calls);
    expect(payload.type).toBe("platform:gift");
    expect(payload.timestamp).toBe(timestamp);
  });

  it("routes stream-detected events to runtime stream handler", async () => {
    const { router, runtime } = buildRouter();

    await router.routeEvent({
      platform: "youtube",
      type: "platform:stream-detected",
      data: {
        eventType: "stream-detected",
        newStreamIds: ["stream-1"],
      },
    });

    expect(runtime.handleStreamDetected).toHaveBeenCalledTimes(1);
    const [calledPlatform, calledPayload] =
      firstMockCall(runtime.handleStreamDetected.mock.calls);
    expect(calledPlatform).toBe("youtube");
    expect(calledPayload.eventType).toBe("stream-detected");
  });

  it("rejects dead contract event types with no runtime producers", async () => {
    const { router } = buildRouter();
    const deadEventTypes = [
      "platform:chat-connected",
      "platform:chat-disconnected",
      "platform:connection-status",
      "platform:connection",
      "platform:error",
      "platform:health-check",
    ];

    for (const type of deadEventTypes) {
      await expect(
        router.routeEvent({
          platform: "twitch",
          type,
          data: {
            timestamp: new Date().toISOString(),
          },
        }),
      ).rejects.toThrow(`Unsupported platform event type: ${type}`);
    }
  });

  it("routes envelope events to runtime envelope handler", async () => {
    const { router, runtime } = buildRouter();
    const timestamp = new Date().toISOString();

    await router.routeEvent({
      platform: "tiktok",
      type: "platform:envelope",
      data: {
        id: "env-1",
        username: "test-envelope-user",
        userId: "test-envelope-user-id",
        giftType: "Coins",
        giftCount: 1,
        amount: 10,
        currency: "USD",
        timestamp,
      },
    });

    expect(runtime.handleEnvelopeNotification).toHaveBeenCalledTimes(1);
    const [calledPlatform, calledPayload] =
      firstMockCall(runtime.handleEnvelopeNotification.mock.calls);
    expect(calledPlatform).toBe("tiktok");
    expect(calledPayload.id).toBe("env-1");
    expect(calledPayload.sourceType).toBe("platform:envelope");
    expect(calledPayload.type).toBe("platform:envelope");
  });

  it("forwards configured default notification types to notification manager", async () => {
    const { router, notificationManager } = buildRouter();
    const timestamp = new Date().toISOString();

    await router.routeEvent({
      platform: "twitch",
      type: "farewell",
      data: {
        username: "test-farewell-user",
        userId: "test-farewell-user-id",
        timestamp,
      },
    });

    expect(notificationManager.handleNotification).toHaveBeenCalledTimes(1);
    const [notificationType, notificationPlatform, notificationPayload] =
      firstMockCall(notificationManager.handleNotification.mock.calls);
    expect(notificationType).toBe("farewell");
    expect(notificationPlatform).toBe("twitch");
    expect(notificationPayload.username).toBe("test-farewell-user");
    expect(notificationPayload.userId).toBe("test-farewell-user-id");
    expect(notificationPayload.type).toBe("farewell");
    expect(notificationPayload.sourceType).toBe("farewell");
  });

  it("rejects short notification types at the routing boundary", async () => {
    const { router, runtime } = buildRouter();

    await expect(
      router.routeEvent({
        platform: "twitch",
        type: "gift",
        data: {
          username: "test-user",
          userId: "u99",
          timestamp: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow("Unsupported platform event type: gift");

    expect(runtime.handleGiftNotification).not.toHaveBeenCalled();
  });

  it("rejects monetization payloads missing timestamps", async () => {
    const { router, runtime } = buildRouter();

    await expect(
      router.routeEvent({
        platform: "tiktok",
        type: "platform:gift",
        data: {
          username: "gifter",
          userId: "u2",
          id: "gift-2",
          giftType: "rose",
          giftCount: 1,
          amount: 5,
          currency: "coins",
        },
      }),
    ).rejects.toThrow("Notification payload requires ISO timestamp");

    expect(runtime.handleGiftNotification).not.toHaveBeenCalled();
  });

  it("normalizes userId to string when routing notifications", async () => {
    const { router, runtime } = buildRouter();

    await router.routeEvent({
      platform: "twitch",
      type: "platform:follow",
      data: {
        username: "Follower",
        userId: 12345,
        timestamp: new Date().toISOString(),
      },
    });

    const [, , payload] = firstMockCall(runtime.handleFollowNotification.mock.calls);
    expect(payload.userId).toBe("12345");
  });

  it("rejects notification payloads with whitespace-only userId", async () => {
    const { router, runtime } = buildRouter();

    await expect(
      router.routeEvent({
        platform: "twitch",
        type: "platform:follow",
        data: {
          username: "Follower",
          userId: "   ",
          timestamp: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow("Notification payload requires userId");

    expect(runtime.handleFollowNotification).not.toHaveBeenCalled();
  });

  it("trims notification userId before routing to runtime handlers", async () => {
    const { router, runtime } = buildRouter();

    await router.routeEvent({
      platform: "twitch",
      type: "platform:follow",
      data: {
        username: "Follower",
        userId: " 12345 ",
        timestamp: new Date().toISOString(),
      },
    });

    const [, , payload] = firstMockCall(runtime.handleFollowNotification.mock.calls);
    expect(payload.userId).toBe("12345");
  });

  it("preserves notification avatarUrl through runtime routing sanitization", async () => {
    const { router, runtime } = buildRouter();

    await router.routeEvent({
      platform: "twitch",
      type: "platform:follow",
      data: {
        username: "Follower",
        userId: "follower-1",
        avatarUrl: "https://example.invalid/follow-avatar.png",
        timestamp: new Date().toISOString(),
      },
    });

    const [, , payload] = firstMockCall(runtime.handleFollowNotification.mock.calls);
    expect(payload.avatarUrl).toBe("https://example.invalid/follow-avatar.png");
  });

  it("rejects viewer-count events with non-finite counts", async () => {
    const { router, runtime } = buildRouter();

    await expect(
      router.routeEvent({
        platform: "twitch",
        type: "platform:viewer-count",
        data: { count: "nope", timestamp: new Date().toISOString() },
      }),
    ).rejects.toThrow("Viewer-count event requires numeric count");

    expect(runtime.updateViewerCount).not.toHaveBeenCalled();
  });

  it("rejects viewer-count events missing timestamps", async () => {
    const { router, runtime } = buildRouter();

    await expect(
      router.routeEvent({
        platform: "twitch",
        type: "platform:viewer-count",
        data: { count: 3 },
      }),
    ).rejects.toThrow("Viewer-count event requires ISO timestamp");

    expect(runtime.updateViewerCount).not.toHaveBeenCalled();
  });

  it("rejects chat messages with empty text after trimming", async () => {
    const { router, runtime } = buildRouter();

    await expect(
      router.routeEvent({
        platform: "twitch",
        type: "platform:chat-message",
        data: {
          username: "User",
          userId: "u4",
          message: { text: "   " },
          timestamp: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow("Chat event requires non-empty message text");

    expect(runtime.handleChatMessage).not.toHaveBeenCalled();
  });
});
