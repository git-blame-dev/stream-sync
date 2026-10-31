import { vi, describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { noOpLogger } from "../../../../helpers/mock-factories";

import { TikTokPlatform } from "../../../../../src/platforms/tiktok.ts";

describe("TikTok gift processing", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    vi.restoreAllMocks();
  });

  const buildGift = (overrides: Record<string, unknown> = {}) => ({
    platform: "tiktok",
    userId: "testTikTokUser1",
    username: "testUser1",
    giftType: "Rose",
    giftCount: 2,
    repeatCount: 2,
    unitAmount: 1,
    amount: 2,
    currency: "coins",
    id: "gift-msg-1",
    timestamp: "2025-01-02T03:04:05.000Z",
    ...overrides,
  });

  const createPlatform = (options: { aggregationEnabled?: boolean } = {}) => {
    const platform = new TikTokPlatform(
      {
        enabled: true,
        username: "testGiftUser",
        giftAggregationEnabled: options.aggregationEnabled ?? false,
      },
      {
        TikTokWebSocketClient: vi.fn(() => ({})),
        logger: noOpLogger,
      },
    );

    return { platform };
  };

  it("creates platform with gift aggregator", () => {
    const { platform } = createPlatform();
    expect(platform.giftAggregator).toBeDefined();
  });

  it("keeps real normalized combo progress filtered and delivers completion once", async () => {
    const { platform } = createPlatform({ aggregationEnabled: true });
    const events: unknown[] = [];
    platform.on("platform:event", (event: unknown) => events.push(event));
    const wireGift = {
      user: { uniqueId: "test-combo-user", nickname: "TestComboUser" },
      common: { msgId: "test-combo-message", createTime: 1735787045 },
      timestamp: "2025-01-02T03:04:05.000Z",
      groupId: "test-combo-group",
      giftDetails: { giftName: "Test Rose", giftType: 1, diamondCount: 2 },
    };
    for (const repeatCount of [1, 3]) {
      await platform.handleTikTokGift({ ...wireGift, repeatCount, repeatEnd: 0 });
    }
    expect(platform.giftAggregation).toEqual({});
    expect(events).toHaveLength(0);
    await platform.handleTikTokGift({ ...wireGift, repeatCount: 3, repeatEnd: 1 });
    await platform.giftAggregator.cleanupGiftAggregation();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ data: { giftCount: 3, amount: 6, currency: "coins" } });
  });

  it("handles gift processing via aggregator without throwing", async () => {
    const { platform } = createPlatform({ aggregationEnabled: false });
    const errorHandler = {
      handleEventProcessingError: vi.fn<(...args: unknown[]) => unknown>(),
      handleConnectionError: vi.fn<(...args: unknown[]) => unknown>(),
      handleCleanupError: vi.fn<(...args: unknown[]) => unknown>(),
    };
    platform.errorHandler = errorHandler;

    await expect(
      platform.giftAggregator.handleStandardGift(
        buildGift({
          userId: "testTikTokUser1",
          username: "testUser1",
          giftType: "Rose",
          giftCount: 2,
          repeatCount: 2,
          unitAmount: 1,
          amount: 2,
          currency: "coins",
          id: "gift-msg-1",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("handles gift aggregation mode without throwing", async () => {
    const { platform } = createPlatform({ aggregationEnabled: true });
    const errorHandler = {
      handleEventProcessingError: vi.fn<(...args: unknown[]) => unknown>(),
      handleConnectionError: vi.fn<(...args: unknown[]) => unknown>(),
      handleCleanupError: vi.fn<(...args: unknown[]) => unknown>(),
    };
    platform.errorHandler = errorHandler;

    await expect(
      platform.giftAggregator.handleStandardGift(
        buildGift({
          userId: "testTikTokUser2",
          username: "testUser2",
          giftType: "Sunglasses",
          giftCount: 5,
          repeatCount: 5,
          unitAmount: 10,
          amount: 50,
          currency: "coins",
          id: "gift-msg-2",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("processes gifts through platform handleStandardGift method", async () => {
    const { platform } = createPlatform({ aggregationEnabled: false });
    const errorHandler = {
      handleEventProcessingError: vi.fn<(...args: unknown[]) => unknown>(),
      handleConnectionError: vi.fn<(...args: unknown[]) => unknown>(),
      handleCleanupError: vi.fn<(...args: unknown[]) => unknown>(),
    };
    platform.errorHandler = errorHandler;

    await expect(
      platform.handleStandardGift(
        buildGift({
          userId: "testTikTokUser3",
          username: "testUser3",
          giftType: "Diamond",
          giftCount: 1,
          repeatCount: 1,
          unitAmount: 100,
          amount: 100,
          currency: "diamonds",
          id: "gift-msg-3",
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
