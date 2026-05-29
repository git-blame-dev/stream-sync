import { describe, it, expect, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../helpers/mock-factories";

import { TwitchPlatform } from "../../../../src/platforms/twitch.ts";
import { TwitchEventSub } from "../../../../src/platforms/twitch-eventsub.ts";
import {
  secrets,
  _resetForTesting,
  initializeStaticSecrets,
} from "../../../../src/core/secrets";
import { createTwitchNotificationPayload } from "../../../helpers/avatar-source-matrix-fixtures";
import { DEFAULT_AVATAR_URL } from "../../../../src/constants/avatar";

type TwitchAuthFake = {
  ready?: boolean;
  userId?: string;
};

type CapturedEvent = Record<string, unknown> & {
  avatarUrl?: string;
  badgeImages?: unknown[];
  giftImageUrl?: string;
  isBroadcaster?: boolean;
  isError?: boolean;
  isMod?: boolean;
  isPaypiggy?: boolean;
  metadata?: Record<string, unknown>;
  timestamp?: string;
  userId?: string;
  username?: string;
};

type TwitchApiClientFake = {
  getBroadcasterId: (channel: string) => Promise<string>;
  getStreamInfo: (channelName: string) => Promise<{
    isLive: boolean;
    stream: unknown | null;
    viewerCount: number;
  }>;
  getGlobalChatBadges: () => Promise<unknown[]>;
  getChannelChatBadges: (broadcasterId: unknown) => Promise<unknown[]>;
  getCheermotes?: (broadcasterId: unknown) => Promise<unknown[]>;
  getUserById?: (userId: string) => Promise<unknown | null>;
};

type TwitchEventSubFake = {
  initialize: () => Promise<void>;
  on: (eventName: string, handler: (...args: unknown[]) => void) => void;
  isConnected: () => boolean;
  isActive: () => boolean;
  sendMessage: (message: string) => Promise<void>;
};

class TestTwitchApiClient implements TwitchApiClientFake {
  getBroadcasterId = createMockFn<[string], Promise<string>>().mockResolvedValue("test-broadcaster-id");
  getStreamInfo = createMockFn<[string], Promise<{ isLive: boolean; stream: unknown | null; viewerCount: number }>>()
    .mockResolvedValue({ isLive: false, stream: null, viewerCount: 0 });
  getGlobalChatBadges = createMockFn<[], Promise<unknown[]>>().mockResolvedValue([]);
  getChannelChatBadges = createMockFn<[unknown], Promise<unknown[]>>().mockResolvedValue([]);
}

class TestTwitchEventSub implements TwitchEventSubFake {
  initialize = createMockFn<[], Promise<void>>().mockResolvedValue();
  on = createMockFn<[string, (...args: unknown[]) => void], void>();
  isConnected = createMockFn<[], boolean>().mockReturnValue(true);
  isActive = createMockFn<[], boolean>().mockReturnValue(true);
  sendMessage = createMockFn<[string], Promise<void>>().mockResolvedValue();
}

type NotificationScenarioKey = "paypiggy" | "giftpaypiggy" | "raid" | "gift";
type NotificationMethodName =
  | "handlePaypiggyEvent"
  | "handlePaypiggyGiftEvent"
  | "handleRaidEvent"
  | "handleGiftEvent";
type AvatarFactoryEventType = NotificationScenarioKey | "follow";
type AvatarFactoryMethodName =
  | "createFollowEvent"
  | "createPaypiggyEvent"
  | "createGiftPaypiggyEvent"
  | "createRaidEvent"
  | "createGiftEvent";

const isCapturedEvent = (payload: unknown): payload is CapturedEvent =>
  typeof payload === "object" && payload !== null;

const captureEvent = (events: CapturedEvent[]) => (payload: unknown) => {
  if (!isCapturedEvent(payload)) {
    throw new TypeError("Expected platform event payload object");
  }
  events.push(payload);
};

const capturedAt = (events: CapturedEvent[], index: number) => {
  const event = events[index];
  if (!event) {
    throw new Error(`Expected captured event at index ${index}`);
  }
  return event;
};

const createApiClientFake = (
  overrides: Partial<TwitchApiClientFake> = {},
): TwitchApiClientFake => ({
  getBroadcasterId: async () => "test-broadcaster-id",
  getStreamInfo: async () => ({ isLive: false, stream: null, viewerCount: 0 }),
  getGlobalChatBadges: async () => [],
  getChannelChatBadges: async () => [],
  ...overrides,
});

const createTwitchAuth = (overrides: TwitchAuthFake = {}) => ({
  isReady: createMockFn().mockReturnValue(overrides.ready ?? true),
  refreshTokens: createMockFn().mockResolvedValue(true),
  getUserId: createMockFn().mockReturnValue(overrides.userId || "test-user-id"),
  ...overrides,
});

const createNotificationPayloadWithUserId = (
  type: NotificationScenarioKey,
  overrides: Record<string, unknown> & { userId: string },
): Record<string, unknown> & { userId: string } => {
  const payload = createTwitchNotificationPayload(type, overrides);
  return { ...payload, userId: overrides.userId };
};

const TEST_USER_ID = "test-user-id";
const FALLBACK_AVATAR_URL = DEFAULT_AVATAR_URL;

const baseConfig = {
  enabled: true,
  username: "tester",
  channel: "tester",
  dataLoggingEnabled: false,
};

describe("TwitchPlatform event behaviors", () => {
  afterEach(() => {
    restoreAllMocks();
    _resetForTesting();
    initializeStaticSecrets();
  });

  it("accepts centralized auth for EventSub validation without raw tokens", async () => {
    _resetForTesting();
    initializeStaticSecrets();
    secrets.twitch.accessToken = "centralized-token";
    const MockWebSocket = class {
      constructor() {}
    };
    const eventSub = new TwitchEventSub(
      {
        enabled: true,
        broadcasterId: TEST_USER_ID,
        clientId: "test-client-id",
      },
      {
        twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
        logger: noOpLogger,
        WebSocketCtor: MockWebSocket,
      },
    );

    const validation = await eventSub._validateConfig();

    expect(validation.valid).toBe(true);
    expect(validation.components.configuration.issues).toHaveLength(0);
    expect(validation.components.twitchAuth.details.ready).toBe(true);
  });

  it("keeps stream lifecycle transitions from crashing when polling hooks are missing", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      TwitchApiClient: TestTwitchApiClient,
      TwitchEventSub: TestTwitchEventSub,
      logger: noOpLogger,
    });

    await platform.initialize({});

    expect(() =>
      platform.handleStreamOnlineEvent({ timestamp: "2024-01-01T00:00:00Z" }),
    ).not.toThrow();
  });

  it("emits raid events with normalized user shape and metadata", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    const received: CapturedEvent[] = [];
    platform.handlers = { onRaid: captureEvent(received) };

    await platform.handleRaidEvent({
      username: "RaidLeader",
      userId: "raid-1",
      viewerCount: 42,
      timestamp: "2024-01-01T00:00:00Z",
    });

    expect(received).toHaveLength(1);
    const event = capturedAt(received, 0);
    expect(event.username).toBe("RaidLeader");
    expect(event.userId).toBe("raid-1");
    expect(event.metadata?.correlationId).toBeDefined();
  });

  it("emits paypiggy error payloads when timestamps are missing", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    const received: CapturedEvent[] = [];
    platform.handlers = { onPaypiggy: captureEvent(received) };

    await platform.handlePaypiggyEvent({
      username: "Subscriber",
      userId: "sub-1",
      tier: "1000",
      months: 6,
      is_gift: false,
    });

    expect(received).toHaveLength(1);
    const event = capturedAt(received, 0);
    expect(event).toMatchObject({
      platform: "twitch",
      isError: true,
    });
    expect(event.avatarUrl).toBe(FALLBACK_AVATAR_URL);
    expect(event.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("uses injected processing timestamp for monetization error envelopes", async () => {
    const processingTimestamp = "2024-01-11T12:34:56.000Z";
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
      getErrorEnvelopeTimestampISO: () => processingTimestamp,
    });

    const received: CapturedEvent[] = [];
    platform.handlers = { onPaypiggy: captureEvent(received) };

    await platform.handlePaypiggyEvent({
      username: "test-subscriber",
      userId: "test-sub-1",
      tier: "1000",
    });

    expect(received).toHaveLength(1);
    const event = capturedAt(received, 0);
    expect(event.isError).toBe(true);
    expect(event.timestamp).toBe(processingTimestamp);
  });

  it("emits gift error payloads when usernames are missing", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    const received: CapturedEvent[] = [];
    platform.handlers = { onGift: captureEvent(received) };

    await platform.handleGiftEvent({
      userId: "test-gift-1",
      giftType: "subscription",
      giftCount: 2,
      amount: 4.99,
      currency: "USD",
      timestamp: "2024-01-01T00:00:00Z",
    });

    expect(received).toHaveLength(1);
    const event = capturedAt(received, 0);
    expect(event).toMatchObject({
      platform: "twitch",
      isError: true,
      userId: "test-gift-1",
    });
    expect(event.avatarUrl).toBe(FALLBACK_AVATAR_URL);
    expect(event.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("enriches Twitch bits gifts with Helix cheermote image URL when single-type cheer metadata exists", async () => {
    const getCheermotes = createMockFn<[unknown], Promise<unknown[]>>().mockImplementation(
      async (broadcasterId) => {
        if (broadcasterId !== "test-broadcaster-id") {
          return [];
        }

        return [
          {
            prefix: "Cheer",
            tiers: [
              {
                id: "100",
                images: {
                  dark: {
                    animated: {
                      "3": "https://example.invalid/twitch/cheer-100-dark-animated-3.gif",
                    },
                  },
                },
              },
            ],
          },
        ];
      },
    );

    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });
    platform.apiClient = createApiClientFake({ getCheermotes });
    platform.broadcasterId = "test-broadcaster-id";

    const received: CapturedEvent[] = [];
    platform.handlers = { onGift: captureEvent(received) };

    await platform.handleGiftEvent({
      username: "test-cheerer",
      userId: "test-cheerer-id",
      giftType: "bits",
      giftCount: 1,
      amount: 100,
      currency: "bits",
      id: "test-cheer-id",
      timestamp: "2024-01-01T00:00:00Z",
      cheermoteInfo: {
        cleanPrefix: "Cheer",
        tier: 100,
        isMixed: false,
      },
    });

    expect(received).toHaveLength(1);
    expect(capturedAt(received, 0).giftImageUrl).toBe(
      "https://example.invalid/twitch/cheer-100-dark-animated-3.gif",
    );
  });

  it("skips Twitch cheermote image enrichment for mixed bits gifts", async () => {
    const getCheermotes = createMockFn<[unknown], Promise<unknown[]>>().mockImplementation(async () => [
      {
        prefix: "Cheer",
        tiers: [
          {
            id: "100",
            images: {
              dark: {
                animated: {
                  "3": "https://example.invalid/twitch/cheer-100-dark-animated-3.gif",
                },
              },
            },
          },
        ],
      },
    ]);
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });
    platform.apiClient = createApiClientFake({ getCheermotes });
    platform.broadcasterId = "test-broadcaster-id";

    const received: CapturedEvent[] = [];
    platform.handlers = { onGift: captureEvent(received) };

    await platform.handleGiftEvent({
      username: "test-cheerer",
      userId: "test-cheerer-id",
      giftType: "mixed bits",
      giftCount: 1,
      amount: 201,
      currency: "bits",
      id: "test-cheer-id-mixed",
      timestamp: "2024-01-01T00:00:00Z",
      cheermoteInfo: {
        cleanPrefix: "Cheer",
        tier: 100,
        isMixed: true,
        types: [
          { prefix: "Cheer", count: 1 },
          { prefix: "Uni", count: 1 },
        ],
      },
    });

    expect(received).toHaveLength(1);
    expect(capturedAt(received, 0).giftImageUrl).toBeUndefined();
  });

  it("reuses cached Twitch cheermote catalog across repeated bits gifts", async () => {
    let requestCount = 0;
    const getCheermotes = createMockFn<[unknown], Promise<unknown[]>>().mockImplementation(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return [
          {
            prefix: "Cheer",
            tiers: [
              {
                id: "100",
                images: {
                  dark: {
                    animated: {
                      "3": "https://example.invalid/twitch/cheer-100-dark-animated-3.gif",
                    },
                  },
                },
              },
            ],
          },
        ];
      }

      return [];
    });

    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });
    platform.apiClient = createApiClientFake({ getCheermotes });
    platform.broadcasterId = "test-broadcaster-id";

    const received: CapturedEvent[] = [];
    platform.handlers = { onGift: captureEvent(received) };

    await platform.handleGiftEvent({
      username: "test-cheerer",
      userId: "test-cheerer-id",
      giftType: "bits",
      giftCount: 1,
      amount: 100,
      currency: "bits",
      id: "test-cheer-id-1",
      timestamp: "2024-01-01T00:00:00Z",
      cheermoteInfo: {
        cleanPrefix: "Cheer",
        tier: 100,
        isMixed: false,
      },
    });

    await platform.handleGiftEvent({
      username: "test-cheerer",
      userId: "test-cheerer-id",
      giftType: "bits",
      giftCount: 1,
      amount: 100,
      currency: "bits",
      id: "test-cheer-id-2",
      timestamp: "2024-01-01T00:00:01Z",
      cheermoteInfo: {
        cleanPrefix: "Cheer",
        tier: 100,
        isMixed: false,
      },
    });

    expect(received).toHaveLength(2);
    expect(capturedAt(received, 0).giftImageUrl).toBe(
      "https://example.invalid/twitch/cheer-100-dark-animated-3.gif",
    );
    expect(capturedAt(received, 1).giftImageUrl).toBe(
      "https://example.invalid/twitch/cheer-100-dark-animated-3.gif",
    );
  });

  it("emits giftpaypiggy error payloads when timestamps are missing", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    const received: CapturedEvent[] = [];
    platform.handlers = { onGiftPaypiggy: captureEvent(received) };

    await platform.handlePaypiggyGiftEvent({
      username: "testGifter",
      userId: "test-gift-2",
      giftCount: 3,
      tier: "2000",
    });

    expect(received).toHaveLength(1);
    const event = capturedAt(received, 0);
    expect(event).toMatchObject({
      platform: "twitch",
      isError: true,
      username: "testGifter",
      userId: "test-gift-2",
    });
    expect(event.avatarUrl).toBe(FALLBACK_AVATAR_URL);
    expect(event.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("skips follow event emission when timestamp is missing", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    const received: CapturedEvent[] = [];
    platform.handlers = { onFollow: captureEvent(received) };

    await platform.handleFollowEvent({
      username: "testFollower",
      userId: "test-follow-1",
    });

    expect(received).toHaveLength(0);
  });

  it("emits chat events from EventSub payloads", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    const events: CapturedEvent[] = [];
    platform.handlers = { onChat: captureEvent(events) };

    await platform.onMessageHandler({
      chatter_user_id: "chat-1",
      chatter_user_name: "chatter",
      broadcaster_user_id: "broadcaster-1",
      message: { text: "Hello world" },
      badges: { subscriber: "1" },
      timestamp: "2024-01-01T00:00:00Z",
    });

    expect(events).toHaveLength(1);
    const event = capturedAt(events, 0);
    expect(event.avatarUrl).toBe(FALLBACK_AVATAR_URL);
    expect(event.isMod).toBe(false);
    expect(event.isBroadcaster).toBe(false);
    expect(event.isPaypiggy).toBe(true);
    expect(event.metadata?.isPaypiggy).toBe(true);
    expect(event.metadata?.correlationId).toBeDefined();
  });

  it("resolves twitch badge image urls into canonical badgeImages", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    platform.apiClient = createApiClientFake({
      getGlobalChatBadges: createMockFn<[], Promise<unknown[]>>().mockResolvedValue([
        {
          set_id: "moderator",
          versions: [
            {
              id: "1",
              title: "Moderator",
              image_url_4x: "https://example.invalid/twitch-mod-4x.png",
            },
          ],
        },
        {
          set_id: "premium",
          versions: [
            {
              id: "1",
              title: "Prime Gaming",
              image_url_4x: "https://example.invalid/twitch-prime-4x.png",
            },
          ],
        },
      ]),
      getChannelChatBadges: createMockFn<[unknown], Promise<unknown[]>>().mockResolvedValue([
        {
          set_id: "founder",
          versions: [
            {
              id: "0",
              title: "Founder",
              image_url_4x: "https://example.invalid/twitch-founder-4x.png",
            },
          ],
        },
      ]),
    });

    const events: CapturedEvent[] = [];
    platform.handlers = { onChat: captureEvent(events) };

    await platform.onMessageHandler({
      chatter_user_id: "test-user-id",
      chatter_user_name: "test-user",
      broadcaster_user_id: "test-broadcaster-id",
      message: { text: "hello" },
      badges: [
        { set_id: "moderator", id: "1", info: "" },
        { set_id: "founder", id: "0", info: "10" },
        { set_id: "premium", id: "1", info: "" },
      ],
      timestamp: "2024-01-01T00:00:00Z",
    });

    expect(events).toHaveLength(1);
    expect(capturedAt(events, 0).badgeImages).toEqual([
      {
        imageUrl: "https://example.invalid/twitch-mod-4x.png",
        source: "twitch",
        label: "Moderator",
      },
      {
        imageUrl: "https://example.invalid/twitch-founder-4x.png",
        source: "twitch",
        label: "Founder",
      },
      {
        imageUrl: "https://example.invalid/twitch-prime-4x.png",
        source: "twitch",
        label: "Prime Gaming",
      },
    ]);
  });

  it("falls back to global twitch badge version when channel version is missing", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    platform.apiClient = createApiClientFake({
      getGlobalChatBadges: createMockFn<[], Promise<unknown[]>>().mockResolvedValue([
        {
          set_id: "moderator",
          versions: [
            {
              id: "1",
              title: "Moderator",
              image_url_4x: "https://example.invalid/twitch-global-mod-4x.png",
            },
          ],
        },
      ]),
      getChannelChatBadges: createMockFn<[unknown], Promise<unknown[]>>().mockResolvedValue([
        {
          set_id: "moderator",
          versions: [
            {
              id: "2",
              title: "Channel Mod Alt",
              image_url_4x: "https://example.invalid/twitch-channel-mod-4x.png",
            },
          ],
        },
      ]),
    });

    const events: CapturedEvent[] = [];
    platform.handlers = { onChat: captureEvent(events) };

    await platform.onMessageHandler({
      chatter_user_id: "test-user-id",
      chatter_user_name: "test-user",
      broadcaster_user_id: "test-broadcaster-id",
      message: { text: "hello" },
      badges: [{ set_id: "moderator", id: "1", info: "" }],
      timestamp: "2024-01-01T00:00:00Z",
    });

    expect(events).toHaveLength(1);
    expect(capturedAt(events, 0).badgeImages).toEqual([
      {
        imageUrl: "https://example.invalid/twitch-global-mod-4x.png",
        source: "twitch",
        label: "Moderator",
      },
    ]);
  });

  it("reloads badge catalogs once when initial cache misses incoming badge keys", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    const getGlobalChatBadges = createMockFn<[], Promise<unknown[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          set_id: "moderator",
          versions: [
            {
              id: "1",
              title: "Moderator",
              image_url_4x:
                "https://example.invalid/twitch-mod-reloaded-4x.png",
            },
          ],
        },
      ]);
    const getChannelChatBadges = createMockFn<[unknown], Promise<unknown[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    platform.apiClient = createApiClientFake({
      getGlobalChatBadges,
      getChannelChatBadges,
    });

    const events: CapturedEvent[] = [];
    platform.handlers = { onChat: captureEvent(events) };

    await platform.onMessageHandler({
      chatter_user_id: "test-user-id",
      chatter_user_name: "test-user",
      broadcaster_user_id: "test-broadcaster-id",
      message: { text: "hello" },
      badges: [{ set_id: "moderator", id: "1", info: "" }],
      timestamp: "2024-01-01T00:00:00Z",
    });

    expect(events).toHaveLength(1);
    expect(capturedAt(events, 0).badgeImages).toEqual([
      {
        imageUrl: "https://example.invalid/twitch-mod-reloaded-4x.png",
        source: "twitch",
        label: "Moderator",
      },
    ]);
  });

  it("resolves and caches Twitch avatar by user id for repeated events", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    const lookupCalls: string[] = [];
    platform.apiClient = createApiClientFake({
      getUserById: createMockFn<[string], Promise<unknown | null>>().mockImplementation(async (userId) => {
        lookupCalls.push(userId);
        return {
          id: userId,
          profile_image_url: "https://example.invalid/twitch-user-avatar.jpg",
        };
      }),
    });

    const received: CapturedEvent[] = [];
    platform.handlers = { onFollow: captureEvent(received) };

    await platform.handleFollowEvent({
      username: "lookup-user",
      userId: "lookup-user-id",
      timestamp: "2024-01-01T00:00:00Z",
    });

    await platform.handleFollowEvent({
      username: "lookup-user",
      userId: "lookup-user-id",
      timestamp: "2024-01-01T00:00:01Z",
    });

    expect(received).toHaveLength(2);
    expect(capturedAt(received, 0).avatarUrl).toBe(
      "https://example.invalid/twitch-user-avatar.jpg",
    );
    expect(capturedAt(received, 1).avatarUrl).toBe(
      "https://example.invalid/twitch-user-avatar.jpg",
    );
    expect(lookupCalls).toEqual(["lookup-user-id"]);
  });

  it("resolves and caches avatar URLs for Twitch notification families without source avatars", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    const lookupCalls: string[] = [];
    platform.apiClient = createApiClientFake({
      getUserById: createMockFn<[string], Promise<unknown | null>>().mockImplementation(async (userId) => {
        lookupCalls.push(userId);
        return {
          id: userId,
          profile_image_url: `https://example.invalid/twitch/${userId}.png`,
        };
      }),
    });

    const received: Record<NotificationScenarioKey, CapturedEvent[]> = {
      paypiggy: [],
      giftpaypiggy: [],
      raid: [],
      gift: [],
    };
    platform.handlers = {
      onPaypiggy: captureEvent(received.paypiggy),
      onGiftPaypiggy: captureEvent(received.giftpaypiggy),
      onRaid: captureEvent(received.raid),
      onGift: captureEvent(received.gift),
    };

    const scenarios: Array<{
      key: NotificationScenarioKey;
      methodName: NotificationMethodName;
      avatarUserId: string;
      payload: Record<string, unknown>;
      repeatedPayload: Record<string, unknown>;
    }> = [
      {
        key: "paypiggy",
        methodName: "handlePaypiggyEvent",
        avatarUserId: "test-paypiggy-avatar-user-id",
        payload: createTwitchNotificationPayload("paypiggy", {
          userId: "test-paypiggy-avatar-user-id",
          timestamp: "2024-01-01T00:00:00.000Z",
        }),
        repeatedPayload: createTwitchNotificationPayload("paypiggy", {
          userId: "test-paypiggy-avatar-user-id",
          timestamp: "2024-01-01T00:00:01.000Z",
        }),
      },
      {
        key: "giftpaypiggy",
        methodName: "handlePaypiggyGiftEvent",
        avatarUserId: "test-giftpaypiggy-avatar-user-id",
        payload: createTwitchNotificationPayload("giftpaypiggy", {
          userId: "test-giftpaypiggy-avatar-user-id",
          timestamp: "2024-01-01T00:00:02.000Z",
        }),
        repeatedPayload: createTwitchNotificationPayload("giftpaypiggy", {
          userId: "test-giftpaypiggy-avatar-user-id",
          timestamp: "2024-01-01T00:00:03.000Z",
        }),
      },
      {
        key: "raid",
        methodName: "handleRaidEvent",
        avatarUserId: "test-raid-avatar-user-id",
        payload: createTwitchNotificationPayload("raid", {
          userId: "test-raid-avatar-user-id",
          timestamp: "2024-01-01T00:00:04.000Z",
        }),
        repeatedPayload: createTwitchNotificationPayload("raid", {
          userId: "test-raid-avatar-user-id",
          timestamp: "2024-01-01T00:00:05.000Z",
        }),
      },
      {
        key: "gift",
        methodName: "handleGiftEvent",
        avatarUserId: "test-gift-avatar-user-id",
        payload: createTwitchNotificationPayload("gift", {
          userId: "test-gift-avatar-user-id",
          timestamp: "2024-01-01T00:00:06.000Z",
        }),
        repeatedPayload: createTwitchNotificationPayload("gift", {
          userId: "test-gift-avatar-user-id",
          timestamp: "2024-01-01T00:00:07.000Z",
        }),
      },
    ];

    for (const scenario of scenarios) {
      await platform[scenario.methodName](scenario.payload);
      await platform[scenario.methodName](scenario.repeatedPayload);

      expect(received[scenario.key]).toHaveLength(2);
      expect(capturedAt(received[scenario.key], 0).avatarUrl).toBe(
        `https://example.invalid/twitch/${scenario.avatarUserId}.png`,
      );
      expect(capturedAt(received[scenario.key], 1).avatarUrl).toBe(
        `https://example.invalid/twitch/${scenario.avatarUserId}.png`,
      );
    }

    expect(lookupCalls).toEqual([
      "test-paypiggy-avatar-user-id",
      "test-giftpaypiggy-avatar-user-id",
      "test-raid-avatar-user-id",
      "test-gift-avatar-user-id",
    ]);
  });

  it("resolves avatarUrl before Twitch notification factory methods build event payloads", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    const lookupCalls: string[] = [];
    platform.apiClient = createApiClientFake({
      getUserById: createMockFn<[string], Promise<unknown | null>>().mockImplementation(async (userId) => {
        lookupCalls.push(userId);
        return {
          id: userId,
          profile_image_url: `https://example.invalid/twitch/resolved-${userId}.png`,
        };
      }),
    });

    const factoryInputByEventType: Partial<Record<AvatarFactoryEventType, CapturedEvent>> = {};
    const recordFactoryInput = (
      eventType: AvatarFactoryEventType,
      payload: unknown,
    ): CapturedEvent => {
      if (!isCapturedEvent(payload)) {
        throw new TypeError("Expected event factory payload object");
      }
      factoryInputByEventType[eventType] = payload;
      return payload;
    };

    const wrapFactoryMethod = (
      factoryMethodName: AvatarFactoryMethodName,
      eventType: AvatarFactoryEventType,
    ) => {
      if (factoryMethodName === "createFollowEvent") {
        const originalMethod = platform.eventFactory.createFollowEvent.bind(platform.eventFactory);
        platform.eventFactory.createFollowEvent = (payload) => originalMethod(recordFactoryInput(eventType, payload));
        return;
      }
      if (factoryMethodName === "createPaypiggyEvent") {
        const originalMethod = platform.eventFactory.createPaypiggyEvent.bind(platform.eventFactory);
        platform.eventFactory.createPaypiggyEvent = (payload) => originalMethod(recordFactoryInput(eventType, payload));
        return;
      }
      if (factoryMethodName === "createGiftPaypiggyEvent") {
        const originalMethod = platform.eventFactory.createGiftPaypiggyEvent.bind(platform.eventFactory);
        platform.eventFactory.createGiftPaypiggyEvent = (payload) => originalMethod(recordFactoryInput(eventType, payload));
        return;
      }
      if (factoryMethodName === "createRaidEvent") {
        const originalMethod = platform.eventFactory.createRaidEvent.bind(platform.eventFactory);
        platform.eventFactory.createRaidEvent = (payload) => originalMethod(recordFactoryInput(eventType, payload));
        return;
      }
      const originalMethod = platform.eventFactory.createGiftEvent.bind(platform.eventFactory);
      platform.eventFactory.createGiftEvent = (payload) => originalMethod(recordFactoryInput(eventType, payload));
    };

    wrapFactoryMethod("createFollowEvent", "follow");
    wrapFactoryMethod("createPaypiggyEvent", "paypiggy");
    wrapFactoryMethod("createGiftPaypiggyEvent", "giftpaypiggy");
    wrapFactoryMethod("createRaidEvent", "raid");
    wrapFactoryMethod("createGiftEvent", "gift");

    const scenarios: Array<{
      eventType: AvatarFactoryEventType;
      methodName: NotificationMethodName | "handleFollowEvent";
      payload: Record<string, unknown> & { userId: string };
    }> = [
      {
        eventType: "follow",
        methodName: "handleFollowEvent",
        payload: {
          username: "test-follow-avatar-user",
          userId: "test-follow-avatar-user-id",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      },
      {
        eventType: "paypiggy",
        methodName: "handlePaypiggyEvent",
        payload: createNotificationPayloadWithUserId("paypiggy", {
          userId: "test-paypiggy-avatar-user-id",
          timestamp: "2024-01-01T00:00:01.000Z",
        }),
      },
      {
        eventType: "giftpaypiggy",
        methodName: "handlePaypiggyGiftEvent",
        payload: createNotificationPayloadWithUserId("giftpaypiggy", {
          userId: "test-giftpaypiggy-avatar-user-id",
          timestamp: "2024-01-01T00:00:02.000Z",
        }),
      },
      {
        eventType: "raid",
        methodName: "handleRaidEvent",
        payload: createNotificationPayloadWithUserId("raid", {
          userId: "test-raid-avatar-user-id",
          timestamp: "2024-01-01T00:00:03.000Z",
        }),
      },
      {
        eventType: "gift",
        methodName: "handleGiftEvent",
        payload: createNotificationPayloadWithUserId("gift", {
          userId: "test-gift-avatar-user-id",
          timestamp: "2024-01-01T00:00:04.000Z",
        }),
      },
    ];

    for (const scenario of scenarios) {
      await platform[scenario.methodName](scenario.payload);
      expect(factoryInputByEventType[scenario.eventType]?.avatarUrl).toBe(
        `https://example.invalid/twitch/resolved-${scenario.payload.userId}.png`,
      );
    }

    expect(lookupCalls).toEqual([
      "test-follow-avatar-user-id",
      "test-paypiggy-avatar-user-id",
      "test-giftpaypiggy-avatar-user-id",
      "test-raid-avatar-user-id",
      "test-gift-avatar-user-id",
    ]);
  });

  it("caches fallback avatar for repeated events when Helix lookup returns no avatar", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    const lookupCalls: string[] = [];
    platform.apiClient = createApiClientFake({
      getUserById: createMockFn<[string], Promise<unknown | null>>().mockImplementation(async (userId) => {
        lookupCalls.push(userId);
        return null;
      }),
    });

    const received: CapturedEvent[] = [];
    platform.handlers = { onFollow: captureEvent(received) };

    await platform.handleFollowEvent({
      username: "fallback-user",
      userId: "fallback-user-id",
      timestamp: "2024-01-01T00:00:00Z",
    });
    await platform.handleFollowEvent({
      username: "fallback-user",
      userId: "fallback-user-id",
      timestamp: "2024-01-01T00:00:01Z",
    });

    expect(received).toHaveLength(2);
    expect(capturedAt(received, 0).avatarUrl).toBe(FALLBACK_AVATAR_URL);
    expect(capturedAt(received, 1).avatarUrl).toBe(FALLBACK_AVATAR_URL);
    expect(lookupCalls).toEqual(["fallback-user-id"]);
  });

  it("caches fallback avatar for repeated events when Helix lookup throws", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    const lookupCalls: string[] = [];
    platform.apiClient = createApiClientFake({
      getUserById: createMockFn<[string], Promise<unknown | null>>().mockImplementation(async (userId) => {
        lookupCalls.push(userId);
        throw new Error("helix unavailable");
      }),
    });

    const received: CapturedEvent[] = [];
    platform.handlers = { onFollow: captureEvent(received) };

    await platform.handleFollowEvent({
      username: "error-user",
      userId: "error-user-id",
      timestamp: "2024-01-01T00:00:00Z",
    });
    await platform.handleFollowEvent({
      username: "error-user",
      userId: "error-user-id",
      timestamp: "2024-01-01T00:00:01Z",
    });

    expect(received).toHaveLength(2);
    expect(capturedAt(received, 0).avatarUrl).toBe(FALLBACK_AVATAR_URL);
    expect(capturedAt(received, 1).avatarUrl).toBe(FALLBACK_AVATAR_URL);
    expect(lookupCalls).toEqual(["error-user-id"]);
  });

  it("evicts oldest avatar cache entries when configured cache size is exceeded", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
      avatarCacheMaxSize: 2,
    });

    const received: CapturedEvent[] = [];
    platform.handlers = { onFollow: captureEvent(received) };

    await platform.handleFollowEvent({
      username: "user-one",
      userId: "u1",
      avatarUrl: "https://example.invalid/u1.png",
      timestamp: "2024-01-01T00:00:00Z",
    });
    await platform.handleFollowEvent({
      username: "user-two",
      userId: "u2",
      avatarUrl: "https://example.invalid/u2.png",
      timestamp: "2024-01-01T00:00:01Z",
    });
    await platform.handleFollowEvent({
      username: "user-three",
      userId: "u3",
      avatarUrl: "https://example.invalid/u3.png",
      timestamp: "2024-01-01T00:00:02Z",
    });

    await platform.handleFollowEvent({
      username: "user-one",
      userId: "u1",
      timestamp: "2024-01-01T00:00:03Z",
    });
    await platform.handleFollowEvent({
      username: "user-two",
      userId: "u2",
      timestamp: "2024-01-01T00:00:04Z",
    });

    expect(received).toHaveLength(5);
    expect(capturedAt(received, 0).avatarUrl).toBe("https://example.invalid/u1.png");
    expect(capturedAt(received, 1).avatarUrl).toBe("https://example.invalid/u2.png");
    expect(capturedAt(received, 2).avatarUrl).toBe("https://example.invalid/u3.png");
    expect(capturedAt(received, 3).avatarUrl).toBe(FALLBACK_AVATAR_URL);
    expect(capturedAt(received, 4).avatarUrl).toBe("https://example.invalid/u2.png");
  });

  it("clears avatar cache during cleanup", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    const received: CapturedEvent[] = [];
    platform.handlers = { onFollow: captureEvent(received) };

    await platform.handleFollowEvent({
      username: "cleanup-user",
      userId: "cleanup-user-id",
      avatarUrl: "https://example.invalid/cleanup-user.png",
      timestamp: "2024-01-01T00:00:00Z",
    });

    await platform.cleanup();
    platform.handlers = { onFollow: captureEvent(received) };

    await platform.handleFollowEvent({
      username: "cleanup-user",
      userId: "cleanup-user-id",
      timestamp: "2024-01-01T00:00:01Z",
    });

    expect(received).toHaveLength(2);
    expect(capturedAt(received, 0).avatarUrl).toBe(
      "https://example.invalid/cleanup-user.png",
    );
    expect(capturedAt(received, 1).avatarUrl).toBe(FALLBACK_AVATAR_URL);
  });

  it("returns user-friendly errors when sending without an EventSub connection", async () => {
    const platform = new TwitchPlatform(baseConfig, {
      twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
      logger: noOpLogger,
    });

    await expect(platform.sendMessage("hello")).rejects.toThrow(
      /twitch chat is unavailable/i,
    );
  });

  it("applies data logging toggles across chat and stream events", async () => {
    const recorded: Array<{
      platform: string;
      eventType: string;
      data: unknown;
    }> = [];
    class RecordingLoggingService {
      logRawPlatformData = createMockFn<
        [platform: string, eventType: string, data: unknown],
        Promise<void>
      >().mockImplementation(async (platform, eventType, data) => {
        recorded.push({ platform, eventType, data });
      });

      constructor() {}
    }

    const platform = new TwitchPlatform(
      { ...baseConfig, dataLoggingEnabled: true },
      {
        twitchAuth: createTwitchAuth({ userId: TEST_USER_ID }),
        logger: noOpLogger,
        ChatFileLoggingService: RecordingLoggingService,
      },
    );

    platform.handlers = {
      onChat: createMockFn(),
      onStreamStatus: createMockFn(),
    };

    await platform.onMessageHandler({
      chatter_user_id: "log-1",
      chatter_user_name: "logger",
      broadcaster_user_id: "broadcaster-1",
      message: { text: "Log this" },
      badges: {},
      timestamp: "2024-01-01T00:00:00Z",
    });

    platform.handleStreamOfflineEvent({ timestamp: "2024-01-01T00:00:05Z" });

    await new Promise(setImmediate);

    expect(recorded.find((entry) => entry.eventType === "chat")).toBeDefined();
    expect(
      recorded.find((entry) => entry.eventType === "stream-offline"),
    ).toBeDefined();
  });
});
