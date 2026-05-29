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

type EventHandler = (payload: unknown) => void | Promise<void>;
type EventHandlerMap = Record<string, EventHandler>;
type PlatformEventPayload = Record<string, unknown> & {
  type?: string;
  platform?: string;
  userId?: string;
  username?: string;
  giftType?: string;
  giftCount?: number;
  amount?: number;
  currency?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
  count?: number;
  viewerCount?: number;
  isLive?: boolean;
  tier?: string;
};

const expectDefined = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error("Expected value to be defined");
  }
  return value;
};

const emitCapturedEvent = (
  eventHandlers: EventHandlerMap,
  eventName: string,
  payload: unknown,
): void | Promise<void> => expectDefined(eventHandlers[eventName])(payload);

const capturePayload = (target: PlatformEventPayload[]) => (data: unknown) => {
  if (isPlatformEventPayload(data)) {
    target.push(data);
  }
};

const isPlatformEventPayload = (data: unknown): data is PlatformEventPayload =>
  typeof data === "object" && data !== null;

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
      STREAM_END: "streamEnd",
    } as const;

    const dependencies = {
      ...createMockTikTokPlatformDependencies({ webcastEvent }),
      WebcastEvent: webcastEvent,
      connectionFactory: {
        createConnection: createMockFn().mockReturnValue({
          on: createMockFn(),
          connect: createMockFn().mockResolvedValue(undefined),
          disconnect: createMockFn().mockResolvedValue(undefined),
          removeAllListeners: createMockFn(),
        }),
        cleanup: createMockFn(),
      },
    };
    const platform = new TikTokPlatform(baseConfig, dependencies);

    const eventHandlers: EventHandlerMap = {};
    platform.connection = {
      on: createMockFn<[event: string, handler: EventHandler], void>((event, handler) => {
        eventHandlers[event] = handler;
        return platform.connection;
      }),
      connect: createMockFn().mockResolvedValue(undefined),
      disconnect: createMockFn().mockResolvedValue(undefined),
      removeAllListeners: createMockFn(),
    };

    const envelopes: PlatformEventPayload[] = [];
    const shares: PlatformEventPayload[] = [];
    const follows: PlatformEventPayload[] = [];
    const gifts: PlatformEventPayload[] = [];
    const paypiggies: PlatformEventPayload[] = [];
    const viewerCounts: PlatformEventPayload[] = [];
    const raids: PlatformEventPayload[] = [];
    const streamStatuses: PlatformEventPayload[] = [];
    platform.handlers = {
      ...platform.handlers,
      onEnvelope: capturePayload(envelopes),
      onShare: capturePayload(shares),
      onFollow: capturePayload(follows),
      onGift: capturePayload(gifts),
      onPaypiggy: capturePayload(paypiggies),
      onViewerCount: capturePayload(viewerCounts),
      onRaid: capturePayload(raids),
      onStreamStatus: capturePayload(streamStatuses),
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

    await emitCapturedEvent(eventHandlers, webcastEvent.ENVELOPE, envelopePayload);

    expect(envelopes).toHaveLength(1);
    const envelope = expectDefined(envelopes[0]);
    expect(envelope.type).toBe("platform:envelope");
    expect(envelope.userId).toBe("envelopeUser");
    expect(envelope.username).toBe("EnvelopeUser");
    expect(envelope.giftType).toBe("Treasure Chest");
    expect(envelope.giftCount).toBe(1);
    expect(envelope.amount).toBe(42);
    expect(envelope.currency).toBe("coins");
    expect(envelope.avatarUrl).toBe(fallbackAvatarUrl);
    expect(envelope.metadata).toBeUndefined();
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

    await emitCapturedEvent(eventHandlers, webcastEvent.SOCIAL, socialPayload);

    expect(shares).toHaveLength(1);
    const share = expectDefined(shares[0]);
    expect(share.metadata?.interactionType).toBe("share");
    expect(share.username).toBe("ShareUser");
    expect(share.avatarUrl).toBe(fallbackAvatarUrl);
    expect(follows).toHaveLength(0);
  });

  it("emits social (share) events with avatarUrl extracted from nested user profile pictures", async () => {
    const { eventHandlers, shares, webcastEvent } = createPlatformUnderTest();
    const socialPayload = createTikTokSocialNotificationFixture("share");

    await emitCapturedEvent(eventHandlers, webcastEvent.SOCIAL, socialPayload);

    expect(shares).toHaveLength(1);
    expect(expectDefined(shares[0]).avatarUrl).toBe(
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

    await emitCapturedEvent(eventHandlers, webcastEvent.SOCIAL, socialPayload);

    expect(follows).toHaveLength(1);
    expect(shares).toHaveLength(0);
    const follow = expectDefined(follows[0]);
    expect(follow.username).toBe("FollowUser");
    expect(follow.avatarUrl).toBe(fallbackAvatarUrl);
  });

  it("emits follow events with avatarUrl extracted from nested user profile pictures", async () => {
    const { eventHandlers, follows, webcastEvent } = createPlatformUnderTest();
    const followPayload = createTikTokSocialNotificationFixture("follow");

    await emitCapturedEvent(eventHandlers, webcastEvent.SOCIAL, followPayload);

    expect(follows).toHaveLength(1);
    expect(expectDefined(follows[0]).avatarUrl).toBe(
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

    await emitCapturedEvent(eventHandlers, webcastEvent.FOLLOW, followPayload);

    expect(shares).toHaveLength(1);
    const share = expectDefined(shares[0]);
    expect(share.metadata?.interactionType).toBe("share");
    expect(share.username).toBe("ShareUser");
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

    await emitCapturedEvent(eventHandlers, webcastEvent.SOCIAL, socialPayload);
    await emitCapturedEvent(eventHandlers, webcastEvent.FOLLOW, followPayload);

    expect(shares).toHaveLength(1);
    expect(expectDefined(shares[0]).username).toBe("ShareUser");
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

    await emitCapturedEvent(eventHandlers, webcastEvent.FOLLOW, payload);
    await emitCapturedEvent(eventHandlers, webcastEvent.SOCIAL, payload);

    expect(shares).toHaveLength(1);
    expect(expectDefined(shares[0]).username).toBe("ShareUser");
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

    await emitCapturedEvent(eventHandlers, webcastEvent.SOCIAL, firstPayload);
    await emitCapturedEvent(eventHandlers, webcastEvent.SOCIAL, secondPayload);

    expect(shares).toHaveLength(1);
    expect(expectDefined(shares[0]).username).toBe("Test Share User");
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

    await emitCapturedEvent(eventHandlers, webcastEvent.SOCIAL, socialPayload);
    await emitCapturedEvent(eventHandlers, webcastEvent.FOLLOW, followPayload);

    expect(shares).toHaveLength(1);
    expect(expectDefined(shares[0]).username).toBe("Test Share User");
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

    await emitCapturedEvent(eventHandlers, webcastEvent.SOCIAL, firstUserPayload);
    await emitCapturedEvent(eventHandlers, webcastEvent.SOCIAL, secondUserPayload);

    expect(shares).toHaveLength(2);
    expect(expectDefined(shares[0]).username).toBe("Test Share User One");
    expect(expectDefined(shares[1]).username).toBe("Test Share User Two");
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

    await emitCapturedEvent(eventHandlers, webcastEvent.SUBSCRIBE, subscribePayload);

    expect(paypiggies).toHaveLength(1);
    const event = expectDefined(paypiggies[0]);
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

    await emitCapturedEvent(eventHandlers, webcastEvent.SUPER_FAN, superfanPayload);

    expect(paypiggies).toHaveLength(1);
    const event = expectDefined(paypiggies[0]);
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

    emitCapturedEvent(eventHandlers, webcastEvent.ROOM_USER, viewerPayload);

    expect(viewerCounts).toHaveLength(1);
    const viewerCount = expectDefined(viewerCounts[0]);
    expect(viewerCount.platform).toBe("tiktok");
    expect(viewerCount.count).toBe(777);
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
    const raid = expectDefined(raids[0]);
    expect(raid.username).toBe("test-raider");
    expect(raid.viewerCount).toBe(150);
    expect(raid.platform).toBe("tiktok");
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
    const streamStatus = expectDefined(streamStatuses[0]);
    expect(streamStatus.isLive).toBe(false);
    expect(streamStatus.platform).toBe("tiktok");
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
    const gift = expectDefined(gifts[0]);
    expect(gift.type).toBe("platform:gift");
    expect(gift.avatarUrl).toBe(fallbackAvatarUrl);
  });

  it("emits gift notifications with avatarUrl extracted from nested user profile pictures", async () => {
    const { platform, gifts } = createPlatformUnderTest();

    await platform.handleTikTokGift(createTikTokGiftNotificationFixture());

    expect(gifts).toHaveLength(1);
    expect(expectDefined(gifts[0]).avatarUrl).toBe(
      "https://example.invalid/tiktok/test-gift-avatar.webp",
    );
  });
});
