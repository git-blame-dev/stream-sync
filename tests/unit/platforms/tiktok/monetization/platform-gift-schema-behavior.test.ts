import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../../../helpers/bun-mock-utils";
import {
  useFakeTimers,
  useRealTimers,
  runOnlyPendingTimers,
} from "../../../../helpers/bun-timers";

import { TikTokPlatform } from "../../../../../src/platforms/tiktok.ts";
import { createMockTikTokPlatformDependencies } from "../../../../helpers/mock-factories";
import * as testClock from "../../../../helpers/test-clock";

describe("TikTokPlatform gift aggregation and schema behavior", () => {
  type GiftEvent = {
    userId: string;
    username: string;
    amount: number;
    giftType: string;
    giftCount: number;
    repeatCount: number;
    currency: string;
    giftImageUrl?: string;
    aggregatedCount?: number;
    isAggregated: boolean;
  };
  type ChatEvent = {
    userId: string;
    username: string;
    message: { text: string };
  };

  const baseConfig = {
    enabled: true,
    username: "gift_tester",
    giftAggregationEnabled: true,
  };

  const createDependencies = () => ({
    ...createMockTikTokPlatformDependencies(),
    WebcastEvent: {
      CHAT: "chat",
      GIFT: "gift",
      FOLLOW: "follow",
      SOCIAL: "social",
      ROOM_USER: "roomUser",
      ERROR: "error",
      DISCONNECT: "disconnect",
    },
    timestampService: {
      extractTimestamp: createMockFn(() =>
        new Date(testClock.now()).toISOString(),
      ),
    },
    connectionFactory: {
      createConnection: createMockFn(() => ({
        on: createMockFn(),
        removeAllListeners: createMockFn(),
        connect: createMockFn().mockResolvedValue(true),
        disconnect: createMockFn(),
        isConnected: false,
      })),
    },
  });

  const createGiftEvent = (repeatCount = 1) => {
    const timestamp = testClock.now();
    return {
      user: {
        userId: "tt-gifter-1",
        uniqueId: "gifter123",
        nickname: "Gifter One",
      },
      giftDetails: { giftName: "Rose", diamondCount: 1, giftType: 0 },
      repeatCount,
      giftType: 0,
      common: { msgId: `gift-${timestamp}`, createTime: timestamp },
      timestamp: new Date(timestamp).toISOString(),
    };
  };

  const runAllGiftTimers = async () => {
    runOnlyPendingTimers();
    await Promise.resolve();
  };

  const requireFirst = <T>(items: T[]): T => {
    const first = items[0];
    if (first === undefined) {
      throw new Error("Expected at least one emitted event");
    }
    return first;
  };

  beforeEach(() => {
    useFakeTimers();
  });

  afterEach(() => {
    useRealTimers();
    restoreAllMocks();
  });

  it("emits aggregated gifts with normalized user schema and correct amount", async () => {
    const platform = new TikTokPlatform(baseConfig, createDependencies());
    const emittedGifts: GiftEvent[] = [];
    platform.handlers = {
      ...platform.handlers,
      onGift: (data: unknown) => {
        emittedGifts.push(data as GiftEvent);
      },
    };

    await platform.handleTikTokGift(createGiftEvent(1));
    await platform.handleTikTokGift(createGiftEvent(3));

    await runAllGiftTimers();

    expect(emittedGifts).toHaveLength(1);
    const giftEvent = requireFirst(emittedGifts);
    expect(giftEvent.userId).toBe("gifter123");
    expect(giftEvent.username).toBe("Gifter One");
    expect(giftEvent.amount).toBe(3);
    expect(giftEvent.giftType).toBe("Rose");
    expect(giftEvent.isAggregated).toBe(true);
  });

  it("emits chat messages with normalized user schema", async () => {
    const platform = new TikTokPlatform(baseConfig, createDependencies());
    const chatEvents: ChatEvent[] = [];
    platform.handlers = {
      ...platform.handlers,
      onChat: (data: unknown) => {
        chatEvents.push(data as ChatEvent);
      },
    };

    await platform._handleChatMessage({
      user: {
        userId: "tt-chatter-1",
        uniqueId: "chatter",
        nickname: "Chatter Box",
      },
      comment: "Hello TikTok!",
      common: { createTime: testClock.now() },
    });

    expect(chatEvents).toHaveLength(1);
    const chatEvent = requireFirst(chatEvents);
    expect(chatEvent.userId).toBe("chatter");
    expect(chatEvent.username).toBe("Chatter Box");
    expect(chatEvent.message).toEqual({ text: "Hello TikTok!" });
  });

  it("emits TikTok gifts with giftType/amount/currency fields", async () => {
    const platform = new TikTokPlatform(
      { ...baseConfig, giftAggregationEnabled: false },
      createDependencies(),
    );
    const emittedGifts: GiftEvent[] = [];
    platform.handlers = {
      ...platform.handlers,
      onGift: (data: unknown) => {
        emittedGifts.push(data as GiftEvent);
      },
    };

    await platform.handleTikTokGift({
      user: {
        userId: "tt-gifter-2",
        uniqueId: "gifter123",
        nickname: "Gifter One",
      },
      giftDetails: { giftName: "Heart Me", diamondCount: 25, giftType: 0 },
      gift: {
        giftPictureUrl: "https://example.invalid/tiktok-gifts/heart-me.png",
      },
      repeatCount: 3,
      repeatEnd: true,
      common: { msgId: "gift-msg-1", createTime: testClock.now() },
      timestamp: new Date(testClock.now()).toISOString(),
    });

    expect(emittedGifts).toHaveLength(1);
    const giftEvent = requireFirst(emittedGifts);
    expect(giftEvent.giftType).toBe("Heart Me");
    expect(giftEvent.giftCount).toBe(3);
    expect(giftEvent.repeatCount).toBe(3);
    expect(giftEvent.amount).toBe(75);
    expect(giftEvent.currency).toBe("coins");
    expect(giftEvent.giftImageUrl).toBe(
      "https://example.invalid/tiktok-gifts/heart-me.png",
    );
    expect(giftEvent.isAggregated).toBe(false);
  });

  it("emits aggregated TikTok gifts with normalized amount and metadata", async () => {
    const platform = new TikTokPlatform(
      { ...baseConfig, giftAggregationEnabled: true, giftAggregationDelay: 25 },
      createDependencies(),
    );
    const emittedGifts: GiftEvent[] = [];
    platform.handlers = {
      ...platform.handlers,
      onGift: (data: unknown) => {
        emittedGifts.push(data as GiftEvent);
      },
    };

    await platform.handleTikTokGift({
      user: {
        userId: "tt-gifter-3",
        uniqueId: "gifter123",
        nickname: "Gifter One",
      },
      giftDetails: { giftName: "User", diamondCount: 5, giftType: 0 },
      repeatCount: 2,
      repeatEnd: true,
      common: { msgId: "gift-msg-2", createTime: testClock.now() },
      timestamp: new Date(testClock.now()).toISOString(),
    });

    await runAllGiftTimers();

    expect(emittedGifts).toHaveLength(1);
    const giftEvent = requireFirst(emittedGifts);
    expect(giftEvent.giftType).toBe("User");
    expect(giftEvent.giftCount).toBe(2);
    expect(giftEvent.repeatCount).toBe(2);
    expect(giftEvent.amount).toBe(10);
    expect(giftEvent.aggregatedCount).toBe(2);
    expect(giftEvent.isAggregated).toBe(true);
    expect(giftEvent.currency).toBe("coins");
  });
});
