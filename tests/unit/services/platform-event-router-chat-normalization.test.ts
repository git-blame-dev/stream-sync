import { describe, it, expect, afterEach } from "bun:test";
import { createMockFn, clearAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { PlatformEventRouter } from "../../../src/services/PlatformEventRouter.ts";

describe("PlatformEventRouter chat normalization", () => {
  afterEach(() => {
    clearAllMocks();
  });

  const platform = "twitch";
  const baseEvent = {
    platform,
    type: "platform:chat-message",
    data: {},
  };

  const createRouter = (runtimeOverrides = {}) => {
    const runtime = {
      handleChatMessage: createMockFn(),
      ...runtimeOverrides,
    };
    const eventBus = {
      subscribe: createMockFn(() => createMockFn()),
      emit: createMockFn(),
    };
    const config = createConfigFixture({ general: { messagesEnabled: true } });
    const notificationManager = { handleNotification: createMockFn() };
    return {
      router: new PlatformEventRouter({
        runtime,
        eventBus,
        notificationManager,
        config,
        logger: noOpLogger,
      }),
      runtime,
    };
  };

  it("flattens nested user/message fields so chat handler receives username", async () => {
    const { router, runtime } = createRouter();

    const event = {
      ...baseEvent,
      data: {
        username: "testUsername",
        userId: "testUserId",
        message: { text: "testMessageText" },
        timestamp: "2025-11-20T12:18:40.192Z",
        isMod: false,
        isPaypiggy: false,
        metadata: { isMod: false, isPaypiggy: false },
      },
    };

    await router.routeEvent(event);

    expect(runtime.handleChatMessage).toHaveBeenCalledTimes(1);
    const [calledPlatform, normalized] =
      runtime.handleChatMessage.mock.calls[0];
    expect(calledPlatform).toBe(platform);
    expect(normalized.username).toBe("testUsername");
    expect(normalized.userId).toBe("testUserId");
    expect(normalized.message).toEqual({ text: "testMessageText" });
    expect(normalized.timestamp).toBe("2025-11-20T12:18:40.192Z");
    expect(normalized.isMod).toBe(false);
    expect(normalized.isPaypiggy).toBe(false);
  });

  it("handles string message payloads and falls back to top-level fields", async () => {
    const { router, runtime } = createRouter();

    const event = {
      ...baseEvent,
      data: {
        userId: "testUserId123",
        username: "testStringUser",
        message: { text: "testPlainMessage" },
        timestamp: "2025-11-20T14:00:00.000Z",
        isMod: true,
        metadata: {},
      },
    };

    await router.routeEvent(event);

    expect(runtime.handleChatMessage).toHaveBeenCalledTimes(1);
    const [, normalized] = runtime.handleChatMessage.mock.calls[0];
    expect(normalized.username).toBe("testStringUser");
    expect(normalized.userId).toBe("testUserId123");
    expect(normalized.message).toEqual({ text: "testPlainMessage" });
    expect(normalized.timestamp).toBe("2025-11-20T14:00:00.000Z");
    expect(normalized.isMod).toBe(true);
  });

  it("preserves trimmed avatarUrl when provided on chat payload", async () => {
    const { router, runtime } = createRouter();

    const event = {
      ...baseEvent,
      data: {
        userId: "test-user-id-avatar",
        username: "testAvatarUser",
        avatarUrl: "  https://example.invalid/chat-avatar.png  ",
        message: { text: "test avatar message" },
        timestamp: "2025-11-20T15:00:00.000Z",
      },
    };

    await router.routeEvent(event);

    expect(runtime.handleChatMessage).toHaveBeenCalledTimes(1);
    const [, normalized] = runtime.handleChatMessage.mock.calls[0];
    expect(normalized.avatarUrl).toBe(
      "https://example.invalid/chat-avatar.png",
    );
  });

  it("accepts TikTok emote-only chat payloads when message.parts are present", async () => {
    const { router, runtime } = createRouter();

    const event = {
      ...baseEvent,
      platform: "tiktok",
      data: {
        userId: "test-user-id-emote-only",
        username: "testEmoteUser",
        message: {
          text: "   ",
          parts: [
            {
              type: "emote",
              platform: "tiktok",
              emoteId: "1234512345",
              imageUrl: "https://example.invalid/tiktok-emote.webp",
            },
          ],
        },
        timestamp: "2025-11-20T15:30:00.000Z",
        metadata: {},
      },
    };

    await router.routeEvent(event);

    expect(runtime.handleChatMessage).toHaveBeenCalledTimes(1);
    const [, normalized] = runtime.handleChatMessage.mock.calls[0];
    expect(normalized.message).toEqual({
      text: "",
      parts: [
        {
          type: "emote",
          platform: "tiktok",
          emoteId: "1234512345",
          imageUrl: "https://example.invalid/tiktok-emote.webp",
        },
      ],
    });
  });

  it("accepts non-TikTok emote-only chat payloads when message.parts are present", async () => {
    const { router, runtime } = createRouter();

    const event = {
      ...baseEvent,
      platform: "twitch",
      data: {
        userId: "test-user-id-strict",
        username: "testStrictUser",
        message: {
          text: "   ",
          parts: [
            {
              type: "emote",
              platform: "twitch",
              emoteId: "1234512345",
              imageUrl: "https://example.invalid/twitch-emote.webp",
            },
          ],
        },
        timestamp: "2025-11-20T15:45:00.000Z",
      },
    };

    await router.routeEvent(event);

    expect(runtime.handleChatMessage).toHaveBeenCalledTimes(1);
    const [, normalized] = runtime.handleChatMessage.mock.calls[0];
    expect(normalized.message).toEqual({
      text: "",
      parts: [
        {
          type: "emote",
          platform: "twitch",
          emoteId: "1234512345",
          imageUrl: "https://example.invalid/twitch-emote.webp",
        },
      ],
    });
  });

  it("preserves metadata fields while normalizing canonical chat payload", async () => {
    const { router, runtime } = createRouter();

    const event = {
      ...baseEvent,
      platform: "twitch",
      data: {
        userId: "test-user-id-metadata",
        username: "testMetadataUser",
        message: {
          text: "",
          parts: [
            {
              type: "emote",
              platform: "twitch",
              emoteId: "1234512345",
              imageUrl: "https://example.invalid/twitch-emote.webp",
            },
          ],
        },
        timestamp: "2025-11-20T15:55:00.000Z",
        metadata: {
          channelId: "test-channel-id",
          correlationId: "test-correlation-id",
        },
      },
    };

    await router.routeEvent(event);

    expect(runtime.handleChatMessage).toHaveBeenCalledTimes(1);
    const [, normalized] = runtime.handleChatMessage.mock.calls[0];
    expect(normalized.message).toEqual({
      text: "",
      parts: [
        {
          type: "emote",
          platform: "twitch",
          emoteId: "1234512345",
          imageUrl: "https://example.invalid/twitch-emote.webp",
        },
      ],
    });
    expect(normalized.metadata).toEqual({
      channelId: "test-channel-id",
      correlationId: "test-correlation-id",
    });
  });

  it("allows degraded chat payloads when metadata.missingFields marks missing identity and timestamp", async () => {
    const { router, runtime } = createRouter();

    const event = {
      ...baseEvent,
      platform: "twitch",
      data: {
        message: {
          text: "partial chat content",
        },
        metadata: {
          missingFields: ["username", "userId", "timestamp"],
        },
      },
    };

    await router.routeEvent(event);

    expect(runtime.handleChatMessage).toHaveBeenCalledTimes(1);
    const [, normalized] = runtime.handleChatMessage.mock.calls[0];
    expect(normalized.username).toBe("Unknown Username");
    expect(normalized.userId).toBeUndefined();
    expect(normalized.timestamp).toBeUndefined();
    expect(normalized.message).toEqual({ text: "partial chat content" });
    expect(normalized.metadata.missingFields).toEqual([
      "username",
      "userId",
      "timestamp",
    ]);
  });

  it("allows degraded chat payloads with unknown-message placeholder when message is marked missing", async () => {
    const { router, runtime } = createRouter();

    const event = {
      ...baseEvent,
      platform: "twitch",
      data: {
        metadata: {
          missingFields: ["message", "username", "userId", "timestamp"],
        },
      },
    };

    await router.routeEvent(event);

    expect(runtime.handleChatMessage).toHaveBeenCalledTimes(1);
    const [, normalized] = runtime.handleChatMessage.mock.calls[0];
    expect(normalized.message).toEqual({ text: "Unknown Message" });
    expect(normalized.username).toBe("Unknown Username");
    expect(normalized.userId).toBeUndefined();
    expect(normalized.timestamp).toBeUndefined();
    expect(normalized.metadata.missingFields).toEqual([
      "message",
      "username",
      "userId",
      "timestamp",
    ]);
  });
});
