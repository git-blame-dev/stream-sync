import { describe, expect, it } from "bun:test";

import {
  PlatformEvents,
  PlatformEventValidator,
} from "../../../../../src/interfaces/PlatformEvents";
import { DEFAULT_AVATAR_URL } from "../../../../../src/constants/avatar";

describe("TikTok event factory behavior", () => {
  const canonicalGift = (extra: Record<string, unknown> = {}) => ({
    userId: " synthetic-viewer ", username: " Synthetic Viewer ", giftType: "Synthetic Rose",
    giftCount: 2, amount: 6, unitAmount: 3, currency: "coins", timestamp: "2025-01-20T12:00:00Z", ...extra,
  });

  it("requires nonblank canonical gift identity even with injected identity normalization", () => {
    const { createTikTokEventFactory } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");
    const factory = createTikTokEventFactory({ getPlatformMessageId: () => "synthetic-id" });
    for (const field of ["username", "userId"]) {
      for (const value of [" ", undefined, {}, true]) {
        expect(() => factory.createGift(canonicalGift({ [field]: value }))).toThrow(field);
      }
    }
    expect(factory.createGift(canonicalGift())).toMatchObject({ userId: "synthetic-viewer", username: "Synthetic Viewer" });
    const malformedNormalizer = createTikTokEventFactory({ getPlatformMessageId: () => "synthetic-id",
      normalizeUserData: () => ({ userId: " ", username: " " }) });
    expect(() => malformedNormalizer.createGift(canonicalGift())).toThrow("identity");
  });

  it("validates all paid gift numeric fields while retaining numeric-string input", () => {
    const { createTikTokEventFactory } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");
    const factory = createTikTokEventFactory({ getPlatformMessageId: () => "synthetic-id" });
    for (const field of ["giftCount", "amount", "unitAmount", "repeatCount", "aggregatedCount"]) {
      for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, true, [1], {}, " "]) {
        expect(() => factory.createGift(canonicalGift({ [field]: value }))).toThrow(field);
      }
    }
    expect(factory.createGift(canonicalGift({ giftCount: "2.0", amount: " 6 ", unitAmount: "3", repeatCount: "2" })))
      .toMatchObject({ giftCount: 2, amount: 6, repeatCount: 2 });
    expect(() => factory.createGift(canonicalGift({ enhancedGiftData: { giftCount: [2] } }))).toThrow("giftCount");
  });

  it("normalizes gift IDs, timestamp and sourceType without overriding injected ID ownership", () => {
    const { createTikTokEventFactory } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");
    const factory = createTikTokEventFactory({ getPlatformMessageId: () => " injected-id " });
    expect(factory.createGift(canonicalGift({ id: "payload-id", sourceType: " official ",
      timestamp: Date.parse("2025-01-20T12:00:00.000Z") }))).toMatchObject({ id: "injected-id",
      timestamp: "2025-01-20T12:00:00.000Z", sourceType: "official" });
    const standalone = createTikTokEventFactory();
    expect(standalone.createGift(canonicalGift({ common: { msgId: " common-id " }, sourceType: " " })))
      .toMatchObject({ id: "common-id", timestamp: "2025-01-20T12:00:00.000Z" });
    expect(standalone.createGift(canonicalGift({ common: { msgId: "common-id" }, sourceType: " " })).sourceType).toBeUndefined();
    for (const timestamp of ["not a timestamp", " ", 0, null]) {
      expect(() => factory.createGift(canonicalGift({ timestamp }))).toThrow("timestamp");
    }
    for (const id of [" ", {}, true]) {
      expect(() => standalone.createGift(canonicalGift({ id }))).toThrow("msgId");
    }
  });

  it("rejects unsafe gift and avatar image schemes without inventing asset data", () => {
    const { createTikTokEventFactory } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");
    const factory = createTikTokEventFactory({ getPlatformMessageId: () => "synthetic-id" });
    for (const url of ["javascript:alert(1)", "data:image/png;base64,synthetic", "file:///synthetic", "invalid"]) {
      const event = factory.createGift(canonicalGift({ avatarUrl: url, giftImageUrl: url }));
      expect(event.avatarUrl).toBe(DEFAULT_AVATAR_URL);
      expect(event.giftImageUrl).toBeUndefined();
    }
  });

  it("preserves authoritative aggregated amounts and asset enrichment without repricing", () => {
    const { createTikTokEventFactory } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");
    const factory = createTikTokEventFactory({ getPlatformMessageId: () => "synthetic-aggregate-id" });
    const enhancedGiftData = { giftCount: 3, amount: 12,
      originalData: { asset: { resourceUri: "https://example.invalid/synthetic-asset.zip" } } };
    const event = factory.createGift(canonicalGift({ giftCount: 3, amount: 12, unitAmount: 5,
      isAggregated: true, enhancedGiftData }));
    expect(event).toMatchObject({ giftCount: 3, amount: 12, aggregatedCount: 3 });
    expect(event.enhancedGiftData).toBe(enhancedGiftData);
  });

  it("includes boolean fields in chat message events", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      generateCorrelationId: () => "corr-chat-123",
    });

    const event = eventFactory.createChatMessage(
      {},
      {
        normalizedData: {
          userId: "test-user-id",
          username: "test-username",
          message: "test message",
          avatarUrl: "https://example.invalid/tiktok-chat-avatar.jpg",
          timestamp: "2026-01-30T12:00:00.000Z",
          isMod: true,
          isPaypiggy: false,
          isBroadcaster: true,
        },
      },
    );

    expect(event.type).toBe(PlatformEvents.CHAT_MESSAGE);
    expect(event.platform).toBe("tiktok");
    expect(event.isMod).toBe(true);
    expect(event.isPaypiggy).toBe(false);
    expect(event.isBroadcaster).toBe(true);
    expect(event.avatarUrl).toBe(
      "https://example.invalid/tiktok-chat-avatar.jpg",
    );
  });

  it("accepts canonical message object text for chat message events", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      generateCorrelationId: () => "corr-chat-object-123",
    });

    const event = eventFactory.createChatMessage(
      {},
      {
        normalizedData: {
          userId: "test-user-id",
          username: "test-username",
          message: {
            text: "  test object message  ",
          },
          timestamp: "2026-01-30T12:00:00.000Z",
        },
      },
    );

    expect(event.message).toEqual({
      text: "test object message",
    });
  });

  it("emits canonical badgeImages for chat message events", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      generateCorrelationId: () => "corr-chat-badges-123",
    });

    const event = eventFactory.createChatMessage(
      {},
      {
        normalizedData: {
          userId: "test-user-id",
          username: "test-username",
          message: {
            text: "test message",
          },
          badgeImages: [
            { imageUrl: "   ", source: "tiktok", label: "invalid" },
            {
              imageUrl: " https://example.invalid/badge-1.png ",
              source: "tiktok",
              label: "Level 22",
            },
            {
              imageUrl: "https://example.invalid/badge-1.png",
              source: "tiktok",
              label: "Level 22",
            },
            {
              imageUrl: "https://example.invalid/badge-2.png",
              source: "tiktok",
              label: "Fans",
            },
          ],
          timestamp: "2026-01-30T12:00:00.000Z",
        },
      },
    );

    expect(event.badgeImages).toEqual([
      {
        imageUrl: "https://example.invalid/badge-1.png",
        source: "tiktok",
        label: "Level 22",
      },
      {
        imageUrl: "https://example.invalid/badge-2.png",
        source: "tiktok",
        label: "Fans",
      },
    ]);
  });

  it("preserves avatarUrl on gift events", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      getPlatformMessageId: () => "test-msg-id-1",
    });

    const event = eventFactory.createGift({
      userId: "test-user-id",
      username: "test-username",
      avatarUrl: "https://example.invalid/tiktok-gift-avatar.jpg",
      giftImageUrl: "https://example.invalid/tiktok-gifts/rose.webp",
      giftType: "Rose",
      giftCount: 1,
      amount: 1,
      unitAmount: 1,
      currency: "coins",
      timestamp: "2026-01-30T12:00:00.000Z",
    });

    expect(event.avatarUrl).toBe(
      "https://example.invalid/tiktok-gift-avatar.jpg",
    );
    expect(event.giftImageUrl).toBe(
      "https://example.invalid/tiktok-gifts/rose.webp",
    );
  });

  it("preserves avatarUrl on follow events", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
    });

    const event = eventFactory.createFollow({
      userId: "test-user-id",
      username: "test-username",
      avatarUrl: "https://example.invalid/tiktok-follow-avatar.jpg",
      timestamp: "2026-01-30T12:00:00.000Z",
    });

    expect(event.avatarUrl).toBe(
      "https://example.invalid/tiktok-follow-avatar.jpg",
    );
  });

  it("emits fallback avatarUrl for follow events when payload avatar is missing", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
    });

    const event = eventFactory.createFollow({
      userId: "test-user-id",
      username: "test-username",
      timestamp: "2026-01-30T12:00:00.000Z",
    });

    expect(event.avatarUrl).toBe(DEFAULT_AVATAR_URL);
  });

  it("emits fallback avatarUrl for gift events when payload avatar is missing", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      getPlatformMessageId: () => "test-msg-id-fallback",
    });

    const event = eventFactory.createGift({
      userId: "test-user-id",
      username: "test-username",
      giftType: "Rose",
      giftCount: 1,
      amount: 1,
      unitAmount: 1,
      currency: "coins",
      timestamp: "2026-01-30T12:00:00.000Z",
    });

    expect(event.avatarUrl).toBe(DEFAULT_AVATAR_URL);
  });

  it("extracts avatarUrl for follow events from nested TikTok user profile pictures", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
    });

    const event = eventFactory.createFollow({
      userId: "test-user-id",
      username: "test-username",
      user: {
        profilePicture: {
          url: ["https://example.invalid/tiktok-follow-nested-avatar.webp"],
        },
      },
      timestamp: "2026-01-30T12:00:00.000Z",
    });

    expect(event.avatarUrl).toBe(
      "https://example.invalid/tiktok-follow-nested-avatar.webp",
    );
  });

  it("extracts avatarUrl for gift events from nested TikTok user profile pictures", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      getPlatformMessageId: () => "test-msg-id-nested-avatar",
    });

    const event = eventFactory.createGift({
      userId: "test-user-id",
      username: "test-username",
      user: {
        profilePicture: {
          url: ["https://example.invalid/tiktok-gift-nested-avatar.webp"],
        },
      },
      giftType: "Rose",
      giftCount: 1,
      amount: 1,
      unitAmount: 1,
      currency: "coins",
      timestamp: "2026-01-30T12:00:00.000Z",
    });

    expect(event.avatarUrl).toBe(
      "https://example.invalid/tiktok-gift-nested-avatar.webp",
    );
  });

  it("defaults boolean fields to false when not provided", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      generateCorrelationId: () => "corr-chat-456",
    });

    const event = eventFactory.createChatMessage(
      {},
      {
        normalizedData: {
          userId: "test-user-id",
          username: "test-username",
          message: "test message",
          timestamp: "2026-01-30T12:00:00.000Z",
        },
      },
    );

    expect(event.isMod).toBe(false);
    expect(event.isPaypiggy).toBe(false);
    expect(event.isBroadcaster).toBe(false);
  });

  it("builds error events with top-level timestamp", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      generateCorrelationId: () => "corr-error-123",
    });

    const error = new Error("Connection failed");
    error.name = "ConnectionError";

    const event = eventFactory.createError(error, { operation: "connect" });

    expect(event.type).toBe(PlatformEvents.ERROR);
    expect(event.platform).toBe("tiktok");
    expect(event.error).toEqual({
      message: "Connection failed",
      name: "ConnectionError",
    });
    expect(event.context).toEqual({
      operation: "connect",
      correlationId: "corr-error-123",
    });
    expect(event.recoverable).toBe(true);
    expect(event.timestamp).toBeDefined();
    expect(typeof event.timestamp).toBe("string");
    expect(event.metadata.timestamp).toBeUndefined();
  });

  it("normalizes non-object error context to canonical object", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      generateCorrelationId: () => "corr-error-context-123",
    });

    const error = new Error("Connection failed");
    const event = eventFactory.createError(error, "invalid-context");

    expect(event.context).toEqual({
      correlationId: "corr-error-context-123",
    });
  });

  it("normalizes non-boolean recoverable to default true", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      generateCorrelationId: () => "corr-error-recoverable-123",
    });

    const error = new Error("Connection failed");
    const event = eventFactory.createError(error, {
      operation: "connect",
      recoverable: "sometimes",
    });

    expect(event.context).toEqual({
      operation: "connect",
      recoverable: "sometimes",
      correlationId: "corr-error-recoverable-123",
    });
    expect(event.recoverable).toBe(true);
  });

  it("produces connection lifecycle events that satisfy platform schemas", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      generateCorrelationId: () => "corr-connection-123",
    });
    const validator = new PlatformEventValidator();

    const connected = eventFactory.createConnection("test-connection-id");
    const disconnected = eventFactory.createDisconnection("stream ended", true);

    expect(validator.validate(connected)).toEqual({ valid: true, errors: [] });
    expect(validator.validate(disconnected)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("rejects chat events when text is empty and message parts are missing", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      generateCorrelationId: () => "corr-chat-empty-123",
    });

    expect(() =>
      eventFactory.createChatMessage(
        {},
        {
          normalizedData: {
            userId: "test-user-id",
            username: "test-username",
            message: "   ",
            timestamp: "2026-01-30T12:00:00.000Z",
          },
        },
      ),
    ).toThrow("Missing TikTok message text");
  });

  it("allows degraded chat events when metadata.missingFields marks missing identity and timestamp", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      generateCorrelationId: () => "corr-tiktok-missing-identity",
    });

    const event = eventFactory.createChatMessage(
      {},
      {
        normalizedData: {
          message: {
            text: "partial tiktok chat message",
          },
          metadata: {
            missingFields: ["userId", "username", "timestamp"],
          },
        },
      },
    );

    expect(event.username).toBe("Unknown Username");
    expect(event.userId).toBeUndefined();
    expect(event.timestamp).toBeUndefined();
    expect(event.message).toEqual({ text: "partial tiktok chat message" });
    expect(event.metadata.missingFields).toEqual([
      "userId",
      "username",
      "timestamp",
    ]);
  });

  it("allows degraded chat events with unknown-message placeholder when message is marked missing", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      generateCorrelationId: () => "corr-tiktok-missing-message",
    });

    const event = eventFactory.createChatMessage(
      {},
      {
        normalizedData: {
          metadata: {
            missingFields: ["message", "userId", "username", "timestamp"],
          },
        },
      },
    );

    expect(event.username).toBe("Unknown Username");
    expect(event.userId).toBeUndefined();
    expect(event.timestamp).toBeUndefined();
    expect(event.message).toEqual({ text: "Unknown Message" });
    expect(event.metadata.missingFields).toEqual([
      "message",
      "userId",
      "username",
      "timestamp",
    ]);
  });

  it("emits canonical message.parts for emote-only chat payloads", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      generateCorrelationId: () => "corr-chat-parts-only",
    });

    const event = eventFactory.createChatMessage(
      {},
      {
        normalizedData: {
          userId: "test-user-id",
          username: "test-username",
          message: {
            text: "",
            parts: [
              {
                type: "emote",
                platform: "tiktok",
                emoteId: "1234512345",
                imageUrl: "https://example.invalid/tiktok-emote.webp",
              },
            ],
          },
          timestamp: "2026-01-30T12:00:00.000Z",
        },
      },
    );

    expect(event.message).toEqual({
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

  it("creates subscription paypiggy event with extracted nested avatar", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
    });

    const event = eventFactory.createSubscription({
      user: {
        userId: "7000000000000000000",
        uniqueId: "test_subscriber",
        nickname: "TestSubscriber",
        profilePicture: {
          url: ["https://example.invalid/sub-avatar.webp"],
        },
      },
      tier: "tier-1",
      months: 3,
      message: "happy to support",
      timestamp: "2026-01-30T12:00:00.000Z",
    });

    expect(event).toEqual(
      expect.objectContaining({
        type: PlatformEvents.PAYPIGGY,
        platform: "tiktok",
        username: "TestSubscriber",
        userId: "test_subscriber",
        avatarUrl: "https://example.invalid/sub-avatar.webp",
        tier: "tier-1",
        months: 3,
        message: "happy to support",
      }),
    );
  });

  it("creates superfan paypiggy event with superfan tier", () => {
    const {
      createTikTokEventFactory,
    } = require("../../../../../src/platforms/tiktok/events/event-factory.ts");

    const eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
    });

    const event = eventFactory.createSuperfan({
      user: {
        userId: "7000000000000000001",
        uniqueId: "test_superfan",
        nickname: "TestSuperfan",
      },
      months: 2,
      message: "superfan hype",
      timestamp: "2026-01-30T12:00:00.000Z",
    });

    expect(event).toEqual(
      expect.objectContaining({
        type: PlatformEvents.PAYPIGGY,
        platform: "tiktok",
        username: "TestSuperfan",
        userId: "test_superfan",
        tier: "superfan",
        months: 2,
        message: "superfan hype",
      }),
    );
  });
});
