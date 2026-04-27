import { describe, expect, it, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../../../helpers/bun-mock-utils";

import { TikTokPlatform } from "../../../../../src/platforms/tiktok.ts";
import { PlatformEvents } from "../../../../../src/interfaces/PlatformEvents";
import { createMockTikTokPlatformDependencies } from "../../../../helpers/mock-factories";
const {
  createTikTokSocialNotificationFixture,
  createTikTokGiftNotificationFixture,
} = require("../../../../helpers/avatar-source-matrix-fixtures");
import { DEFAULT_AVATAR_URL } from "../../../../../src/constants/avatar";

describe("TikTokPlatform event emissions", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const baseConfig = { enabled: true, username: "event_tester" };
  const eventTimestamp = Date.parse("2024-01-01T00:00:00Z");
  const fallbackAvatarUrl = DEFAULT_AVATAR_URL;

  const createPlatformUnderTest = () => {
    const webcastEvent = {
      CHAT: "chat",
      GIFT: "gift",
      FOLLOW: "follow",
      ROOM_USER: "roomUser",
      ENVELOPE: "envelope",
      SUBSCRIBE: "subscribe",
      SUPER_FAN: "superfan",
      SOCIAL: "social",
      ERROR: "error",
      DISCONNECT: "disconnect",
    };

    const dependencies = createMockTikTokPlatformDependencies({ webcastEvent });
    dependencies.connectionFactory = {
      createConnection: createMockFn().mockReturnValue({
        on: createMockFn(),
        removeAllListeners: createMockFn(),
      }),
      cleanup: createMockFn(),
    };
    const platform = new TikTokPlatform(baseConfig, dependencies);

    const eventHandlers = {};
    platform.connection = {
      on: createMockFn((event, handler) => {
        eventHandlers[event] = handler;
        return platform.connection;
      }),
      removeAllListeners: createMockFn(),
    };

    const envelopes = [];
    const shares = [];
    const follows = [];
    const gifts = [];
    const paypiggies = [];
    const viewerCounts = [];
    const raids = [];
    const streamStatuses = [];
    platform.handlers = {
      ...platform.handlers,
      onEnvelope: (data) => envelopes.push(data),
      onShare: (data) => shares.push(data),
      onFollow: (data) => follows.push(data),
      onGift: (data) => gifts.push(data),
      onPaypiggy: (data) => paypiggies.push(data),
      onViewerCount: (data) => viewerCounts.push(data),
      onRaid: (data) => raids.push(data),
      onStreamStatus: (data) => streamStatuses.push(data),
    };

    platform.setupEventListeners();

    return {
      platform,
      eventHandlers,
      envelopes,
      shares,
      follows,
      gifts,
      paypiggies,
      viewerCounts,
      raids,
      streamStatuses,
      webcastEvent,
    };
  };

  it("emits envelope events with the normalized payload", async () => {
    const { eventHandlers, envelopes, webcastEvent } =
      createPlatformUnderTest();
    const envelopePayload = {
      common: { msgId: "envelope-msg-1" },
      amount: 42,
      currency: "coins",
      user: {
        userId: "envelope-user-id",
        uniqueId: "envelopeUser",
        nickname: "EnvelopeUser",
      },
    };

    await eventHandlers[webcastEvent.ENVELOPE](envelopePayload);

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].type).toBe("platform:envelope");
    expect(envelopes[0].userId).toBe("envelopeUser");
    expect(envelopes[0].username).toBe("EnvelopeUser");
    expect(envelopes[0].giftType).toBe("Treasure Chest");
    expect(envelopes[0].giftCount).toBe(1);
    expect(envelopes[0].amount).toBe(42);
    expect(envelopes[0].currency).toBe("coins");
    expect(envelopes[0].avatarUrl).toBe(fallbackAvatarUrl);
    expect(envelopes[0].metadata).toBeUndefined();
  });

  it("emits social (share) events through the share channel", async () => {
    const { eventHandlers, shares, follows, webcastEvent } =
      createPlatformUnderTest();
    const socialPayload = {
      user: {
        userId: "share-user-id",
        uniqueId: "shareUser",
        nickname: "ShareUser",
      },
      common: {
        displayText: {
          displayType: "pm_mt_guidance_share",
          defaultPattern: "{0:user} shared the LIVE",
        },
        createTime: eventTimestamp,
      },
    };

    await eventHandlers[webcastEvent.SOCIAL](socialPayload);

    expect(shares).toHaveLength(1);
    expect(shares[0].metadata.interactionType).toBe("share");
    expect(shares[0].username).toBe("ShareUser");
    expect(shares[0].avatarUrl).toBe(fallbackAvatarUrl);
    expect(follows).toHaveLength(0);
  });

  it("emits social (share) events with avatarUrl extracted from nested user profile pictures", async () => {
    const { eventHandlers, shares, webcastEvent } = createPlatformUnderTest();
    const socialPayload = createTikTokSocialNotificationFixture("share");

    await eventHandlers[webcastEvent.SOCIAL](socialPayload);

    expect(shares).toHaveLength(1);
    expect(shares[0].avatarUrl).toBe(
      "https://example.invalid/tiktok/test-social-avatar.webp",
    );
  });

  it("emits follow from social payloads that only include follow wording", async () => {
    const { eventHandlers, shares, follows, webcastEvent } =
      createPlatformUnderTest();
    const socialPayload = {
      user: {
        userId: "follow-user-id",
        uniqueId: "followUser",
        nickname: "FollowUser",
      },
      common: {
        displayText: { defaultPattern: "{0:user} followed the LIVE creator" },
        createTime: eventTimestamp,
      },
    };

    await eventHandlers[webcastEvent.SOCIAL](socialPayload);

    expect(follows).toHaveLength(1);
    expect(shares).toHaveLength(0);
    expect(follows[0].username).toBe("FollowUser");
    expect(follows[0].avatarUrl).toBe(fallbackAvatarUrl);
  });

  it("emits follow events with avatarUrl extracted from nested user profile pictures", async () => {
    const { eventHandlers, follows, webcastEvent } = createPlatformUnderTest();
    const followPayload = createTikTokSocialNotificationFixture("follow");

    await eventHandlers[webcastEvent.SOCIAL](followPayload);

    expect(follows).toHaveLength(1);
    expect(follows[0].avatarUrl).toBe(
      "https://example.invalid/tiktok/test-social-avatar.webp",
    );
  });

  it("treats share-shaped FOLLOW payloads as share events", async () => {
    const { eventHandlers, shares, follows, webcastEvent } =
      createPlatformUnderTest();
    const followPayload = {
      user: {
        userId: "share-user-id",
        uniqueId: "shareUser",
        nickname: "ShareUser",
      },
      common: {
        msgId: "msg_share_follow_1",
        displayText: {
          displayType: "pm_mt_guidance_share",
          defaultPattern: "{0:user} shared the LIVE",
        },
        createTime: eventTimestamp,
      },
    };

    await eventHandlers[webcastEvent.FOLLOW](followPayload);

    expect(shares).toHaveLength(1);
    expect(shares[0].metadata.interactionType).toBe("share");
    expect(shares[0].username).toBe("ShareUser");
    expect(follows).toHaveLength(0);
  });

  it("dedupes share events when SOCIAL then FOLLOW carry the same msgId", async () => {
    const { eventHandlers, shares, follows, webcastEvent } =
      createPlatformUnderTest();
    const socialPayload = {
      user: {
        userId: "share-user-id",
        uniqueId: "shareUser",
        nickname: "ShareUser",
      },
      common: {
        msgId: "msg_share_dupe_social_first",
        displayText: {
          displayType: "pm_mt_guidance_share",
          defaultPattern: "{0:user} shared the LIVE",
        },
        createTime: eventTimestamp,
      },
    };
    const followPayload = { ...socialPayload };

    await eventHandlers[webcastEvent.SOCIAL](socialPayload);
    await eventHandlers[webcastEvent.FOLLOW](followPayload);

    expect(shares).toHaveLength(1);
    expect(shares[0].username).toBe("ShareUser");
    expect(follows).toHaveLength(0);
  });

  it("dedupes share events when FOLLOW then SOCIAL carry the same msgId", async () => {
    const { eventHandlers, shares, follows, webcastEvent } =
      createPlatformUnderTest();
    const payload = {
      user: {
        userId: "share-user-id",
        uniqueId: "shareUser",
        nickname: "ShareUser",
      },
      common: {
        msgId: "msg_share_dupe_follow_first",
        displayText: {
          displayType: "pm_mt_guidance_share",
          defaultPattern: "{0:user} shared the LIVE",
        },
        createTime: eventTimestamp,
      },
    };

    await eventHandlers[webcastEvent.FOLLOW](payload);
    await eventHandlers[webcastEvent.SOCIAL](payload);

    expect(shares).toHaveLength(1);
    expect(shares[0].username).toBe("ShareUser");
    expect(follows).toHaveLength(0);
  });

  it("emits only one share per user in the same stream when msgIds differ", async () => {
    const { eventHandlers, shares, webcastEvent } = createPlatformUnderTest();
    const firstPayload = {
      user: {
        userId: "test-share-user-id",
        uniqueId: "test-share-user",
        nickname: "Test Share User",
      },
      common: {
        msgId: "msg_share_first",
        displayText: {
          displayType: "pm_mt_guidance_share",
          defaultPattern: "{0:user} shared the LIVE",
        },
        createTime: eventTimestamp,
      },
    };
    const secondPayload = {
      user: {
        userId: "test-share-user-id",
        uniqueId: "test-share-user",
        nickname: "Test Share User",
      },
      common: {
        msgId: "msg_share_second",
        displayText: {
          displayType: "pm_mt_guidance_share",
          defaultPattern: "{0:user} shared the LIVE",
        },
        createTime: eventTimestamp + 1000,
      },
    };

    await eventHandlers[webcastEvent.SOCIAL](firstPayload);
    await eventHandlers[webcastEvent.SOCIAL](secondPayload);

    expect(shares).toHaveLength(1);
    expect(shares[0].username).toBe("Test Share User");
  });

  it("suppresses repeat shares for the same user across SOCIAL and FOLLOW when msgIds differ", async () => {
    const { eventHandlers, shares, follows, webcastEvent } =
      createPlatformUnderTest();
    const socialPayload = {
      user: {
        userId: "test-share-user-id",
        uniqueId: "test-share-user",
        nickname: "Test Share User",
      },
      common: {
        msgId: "msg_share_social_variant",
        displayText: {
          displayType: "pm_mt_guidance_share",
          defaultPattern: "{0:user} shared the LIVE",
        },
        createTime: eventTimestamp,
      },
    };
    const followPayload = {
      user: {
        userId: "test-share-user-id",
        uniqueId: "test-share-user",
        nickname: "Test Share User",
      },
      common: {
        msgId: "msg_share_follow_variant",
        displayText: {
          displayType: "pm_mt_guidance_share",
          defaultPattern: "{0:user} shared the LIVE",
        },
        createTime: eventTimestamp + 1000,
      },
    };

    await eventHandlers[webcastEvent.SOCIAL](socialPayload);
    await eventHandlers[webcastEvent.FOLLOW](followPayload);

    expect(shares).toHaveLength(1);
    expect(shares[0].username).toBe("Test Share User");
    expect(follows).toHaveLength(0);
  });

  it("emits shares for different users in the same stream", async () => {
    const { eventHandlers, shares, webcastEvent } = createPlatformUnderTest();
    const firstUserPayload = {
      user: {
        userId: "test-share-user-id-1",
        uniqueId: "test-share-user-one",
        nickname: "Test Share User One",
      },
      common: {
        msgId: "msg_share_user_1",
        displayText: {
          displayType: "pm_mt_guidance_share",
          defaultPattern: "{0:user} shared the LIVE",
        },
        createTime: eventTimestamp,
      },
    };
    const secondUserPayload = {
      user: {
        userId: "test-share-user-id-2",
        uniqueId: "test-share-user-two",
        nickname: "Test Share User Two",
      },
      common: {
        msgId: "msg_share_user_2",
        displayText: {
          displayType: "pm_mt_guidance_share",
          defaultPattern: "{0:user} shared the LIVE",
        },
        createTime: eventTimestamp + 1000,
      },
    };

    await eventHandlers[webcastEvent.SOCIAL](firstUserPayload);
    await eventHandlers[webcastEvent.SOCIAL](secondUserPayload);

    expect(shares).toHaveLength(2);
    expect(shares[0].username).toBe("Test Share User One");
    expect(shares[1].username).toBe("Test Share User Two");
  });

  it("emits subscribe events as paypiggy notifications", async () => {
    const { eventHandlers, paypiggies, webcastEvent } =
      createPlatformUnderTest();
    const subscribePayload = {
      user: {
        userId: "sub-numeric-id",
        uniqueId: "sub123",
        nickname: "Subscriber",
      },
    };

    await eventHandlers[webcastEvent.SUBSCRIBE](subscribePayload);

    expect(paypiggies).toHaveLength(1);
    const event = paypiggies[0];
    expect(event.type).toBe("platform:paypiggy");
    expect(event.userId).toBe("sub123");
    expect(event.username).toBe("Subscriber");
    expect(event.avatarUrl).toBe(fallbackAvatarUrl);
  });

  it("emits superfan subscription events with SuperFan tier", async () => {
    const { eventHandlers, paypiggies, webcastEvent } =
      createPlatformUnderTest();
    const superfanPayload = {
      user: {
        userId: "sf-numeric-id",
        uniqueId: "sf123",
        nickname: "SuperFanUser",
      },
    };

    await eventHandlers[webcastEvent.SUPER_FAN](superfanPayload);

    expect(paypiggies).toHaveLength(1);
    const event = paypiggies[0];
    expect(event.type).toBe("platform:paypiggy");
    expect(event.platform).toBe("tiktok");
    expect(event.userId).toBe("sf123");
    expect(event.username).toBe("SuperFanUser");
    expect(event.tier).toBe("superfan");
    expect(event.metadata).toBeUndefined();
  });

  it("emits viewer count updates via PlatformEvents.VIEWER_COUNT", () => {
    const { eventHandlers, viewerCounts, webcastEvent } =
      createPlatformUnderTest();
    const viewerPayload = {
      viewerCount: 777,
      common: { createTime: eventTimestamp },
    };

    eventHandlers[webcastEvent.ROOM_USER](viewerPayload);

    expect(viewerCounts).toHaveLength(1);
    expect(viewerCounts[0].platform).toBe("tiktok");
    expect(viewerCounts[0].count).toBe(777);
  });

  it("routes raid events to onRaid handler via _emitPlatformEvent", () => {
    const { platform, raids } = createPlatformUnderTest();
    const raidPayload = {
      platform: "tiktok",
      username: "test-raider",
      userId: "test-raider-id",
      viewerCount: 150,
      timestamp: new Date(eventTimestamp).toISOString(),
    };

    platform._emitPlatformEvent(PlatformEvents.RAID, raidPayload);

    expect(raids).toHaveLength(1);
    expect(raids[0].username).toBe("test-raider");
    expect(raids[0].viewerCount).toBe(150);
    expect(raids[0].platform).toBe("tiktok");
  });

  it("routes stream-status events to onStreamStatus handler via _emitPlatformEvent", () => {
    const { platform, streamStatuses } = createPlatformUnderTest();
    const streamStatusPayload = {
      platform: "tiktok",
      isLive: false,
      timestamp: new Date(eventTimestamp).toISOString(),
    };

    platform._emitPlatformEvent(
      PlatformEvents.STREAM_STATUS,
      streamStatusPayload,
    );

    expect(streamStatuses).toHaveLength(1);
    expect(streamStatuses[0].isLive).toBe(false);
    expect(streamStatuses[0].platform).toBe("tiktok");
  });

  it("emits canonical gift error payload with fallback avatar from gift processing path", async () => {
    const { platform, gifts } = createPlatformUnderTest();

    await platform.handleTikTokGift({
      common: {
        createTime: eventTimestamp,
        msgId: "gift-error-msg-id",
      },
      user: {
        userId: "gift-error-user-id",
        uniqueId: "giftErrorUser",
        nickname: "Gift Error User",
      },
      repeatCount: 1,
    });

    expect(gifts).toHaveLength(1);
    expect(gifts[0].type).toBe("platform:gift");
    expect(gifts[0].avatarUrl).toBe(fallbackAvatarUrl);
  });

  it("emits gift notifications with avatarUrl extracted from nested user profile pictures", async () => {
    const { platform, gifts } = createPlatformUnderTest();

    await platform.handleTikTokGift(createTikTokGiftNotificationFixture());

    expect(gifts).toHaveLength(1);
    expect(gifts[0].avatarUrl).toBe(
      "https://example.invalid/tiktok/test-gift-avatar.webp",
    );
  });
});
