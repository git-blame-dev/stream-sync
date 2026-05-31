import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { noOpLogger } from "../../../../helpers/mock-factories";
import { createRecordingLogger } from "../../../../helpers/recording-logger";
const {
  useFakeTimers,
  useRealTimers,
  setSystemTime,
  advanceTimersByTime,
  getTimerCount,
} = require("../../../../helpers/bun-timers");
const {
  createTikTokGiftAggregator,
} = require("../../../../../src/platforms/tiktok/monetization/gift-aggregator.ts");

type GiftPayload = Record<string, unknown> & {
  giftCount?: number;
  aggregatedCount?: number;
  isAggregated?: boolean;
  avatarUrl?: string;
  giftImageUrl?: string;
  sourceType?: string;
};

type TestPlatform = {
  giftAggregation: Record<string, unknown>;
  giftAggregationDelay: number;
  logger: {
    debug: (message: string, category?: string, details?: unknown) => void;
    info: (message: string, category?: string, details?: unknown) => void;
    warn: (message: string, category?: string, details?: unknown) => void;
  };
  errorHandler: {
    handleEventProcessingError: (
      error: unknown,
      context: string,
      payload: unknown,
      message: string,
    ) => void;
  };
  _handleGift: (payload: GiftPayload) => Promise<unknown>;
};

describe("TikTok gift aggregator", () => {
  beforeEach(() => {
    useFakeTimers();
    setSystemTime(new Date("2025-01-15T12:00:00.000Z"));
  });

  afterEach(() => {
    useRealTimers();
  });

  const buildGift = (overrides: Record<string, unknown> = {}): GiftPayload => ({
    platform: "tiktok",
    userId: "tt-user1",
    username: "testUserOne",
    avatarUrl: "https://example.invalid/tiktok-avatar.jpg",
    giftType: "Rose",
    giftCount: 2,
    repeatCount: 2,
    unitAmount: 1,
    amount: 2,
    currency: "coins",
    id: "gift-msg-1",
    timestamp: "2025-01-15T12:00:00.000Z",
    ...overrides,
  });

  const createTestPlatform = (
    overrides: Partial<TestPlatform> = {},
  ): TestPlatform => ({
    giftAggregation: {},
    giftAggregationDelay: 2000,
    logger: noOpLogger,
    errorHandler: { handleEventProcessingError: () => {} },
    _handleGift: async () => undefined,
    ...overrides,
  });

  const firstHandledGift = (handledGifts: GiftPayload[]): GiftPayload => {
    const gift = handledGifts[0];
    if (!gift) {
      throw new Error("Expected at least one handled gift");
    }
    return gift;
  };

  describe("factory validation", () => {
    test("throws when platform is missing", () => {
      expect(() => createTikTokGiftAggregator({})).toThrow(
        "platform is required to create TikTok gift aggregator",
      );
    });

    test("throws when platform is null", () => {
      expect(() => createTikTokGiftAggregator({ platform: null })).toThrow(
        "platform is required to create TikTok gift aggregator",
      );
    });
  });

  describe("gift payload validation", () => {
    test("throws when gift payload is null", async () => {
      const giftAggregator = createTikTokGiftAggregator({
        platform: createTestPlatform(),
      });

      await expect(giftAggregator.handleStandardGift(null)).rejects.toThrow(
        "TikTok gift aggregation requires gift payload",
      );
    });

    test("throws when gift payload is not an object", async () => {
      const giftAggregator = createTikTokGiftAggregator({
        platform: createTestPlatform(),
      });

      await expect(
        giftAggregator.handleStandardGift("invalid"),
      ).rejects.toThrow("TikTok gift aggregation requires gift payload");
    });

    test("throws when giftCount is zero", async () => {
      const giftAggregator = createTikTokGiftAggregator({
        platform: createTestPlatform(),
      });

      await expect(
        giftAggregator.handleStandardGift(buildGift({ giftCount: 0 })),
      ).rejects.toThrow("TikTok gift aggregation requires giftCount");
    });

    test("throws when giftCount is negative", async () => {
      const giftAggregator = createTikTokGiftAggregator({
        platform: createTestPlatform(),
      });

      await expect(
        giftAggregator.handleStandardGift(buildGift({ giftCount: -1 })),
      ).rejects.toThrow("TikTok gift aggregation requires giftCount");
    });

    test("throws when unitAmount is not finite", async () => {
      const giftAggregator = createTikTokGiftAggregator({
        platform: createTestPlatform(),
      });

      await expect(
        giftAggregator.handleStandardGift(buildGift({ unitAmount: NaN })),
      ).rejects.toThrow("TikTok gift aggregation requires unitAmount");
    });
  });

  describe("gift aggregation behavior", () => {
    test("aggregates gifts and delivers after delay", async () => {
      const handledGifts: GiftPayload[] = [];
      const platform = createTestPlatform({
        _handleGift: async (payload) => handledGifts.push(payload),
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.handleStandardGift(buildGift({ giftCount: 3 }));

      expect(handledGifts).toHaveLength(0);

      await advanceTimersByTime(platform.giftAggregationDelay);

      expect(handledGifts).toHaveLength(1);
      expect(firstHandledGift(handledGifts).giftCount).toBe(3);
      expect(firstHandledGift(handledGifts).isAggregated).toBe(true);
    });

    test("updates aggregation using high-water delta for same message id", async () => {
      const handledGifts: GiftPayload[] = [];
      const platform = createTestPlatform({
        _handleGift: async (payload) => handledGifts.push(payload),
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.handleStandardGift(buildGift({ giftCount: 2 }));

      setSystemTime(new Date("2025-01-15T12:00:01.500Z"));
      await advanceTimersByTime(500);

      await giftAggregator.handleStandardGift(buildGift({ giftCount: 5 }));

      expect(handledGifts).toHaveLength(0);

      await advanceTimersByTime(platform.giftAggregationDelay);

      expect(handledGifts).toHaveLength(1);
      expect(firstHandledGift(handledGifts).giftCount).toBe(5);
    });

    test("accumulates distinct non-combo message ids with same counts", async () => {
      const handledGifts: GiftPayload[] = [];
      const platform = createTestPlatform({
        _handleGift: async (payload) => handledGifts.push(payload),
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.handleStandardGift(
        buildGift({ id: "gift-msg-1", giftCount: 1 }),
      );

      setSystemTime(new Date("2025-01-15T12:00:00.300Z"));
      await advanceTimersByTime(300);

      await giftAggregator.handleStandardGift(
        buildGift({ id: "gift-msg-2", giftCount: 1 }),
      );
      await giftAggregator.handleStandardGift(
        buildGift({ id: "gift-msg-3", giftCount: 1 }),
      );
      await giftAggregator.handleStandardGift(
        buildGift({ id: "gift-msg-4", giftCount: 1 }),
      );

      await advanceTimersByTime(platform.giftAggregationDelay);

      expect(handledGifts).toHaveLength(1);
      expect(firstHandledGift(handledGifts).giftCount).toBe(4);
      expect(firstHandledGift(handledGifts).aggregatedCount).toBe(4);
    });

    test("ignores retransmitted duplicate gift with same message id", async () => {
      const handledGifts: GiftPayload[] = [];
      const platform = createTestPlatform({
        _handleGift: async (payload) => handledGifts.push(payload),
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.handleStandardGift(buildGift({ giftCount: 2 }));

      setSystemTime(new Date("2025-01-15T12:00:00.500Z"));
      await advanceTimersByTime(500);

      await giftAggregator.handleStandardGift(buildGift({ giftCount: 2 }));

      await advanceTimersByTime(platform.giftAggregationDelay);

      expect(handledGifts).toHaveLength(1);
      expect(firstHandledGift(handledGifts).giftCount).toBe(2);
    });

    test("accumulates only delta for progressive updates on same message id", async () => {
      const handledGifts: GiftPayload[] = [];
      const platform = createTestPlatform({
        _handleGift: async (payload) => handledGifts.push(payload),
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.handleStandardGift(
        buildGift({ id: "gift-msg-9", giftCount: 1 }),
      );
      await giftAggregator.handleStandardGift(
        buildGift({ id: "gift-msg-9", giftCount: 2 }),
      );
      await giftAggregator.handleStandardGift(
        buildGift({ id: "gift-msg-9", giftCount: 3 }),
      );

      await advanceTimersByTime(platform.giftAggregationDelay);

      expect(handledGifts).toHaveLength(1);
      expect(firstHandledGift(handledGifts).giftCount).toBe(3);
    });

    test("deduplicates combo completion packets with same group id", async () => {
      const handledGifts: GiftPayload[] = [];
      const platform = createTestPlatform({
        _handleGift: async (payload) => handledGifts.push(payload),
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      const comboGift = {
        giftType: "GG",
        comboType: 1,
        repeatEnd: true,
        groupId: "combo-group-1",
        giftCount: 1,
      };

      await giftAggregator.handleStandardGift(
        buildGift({ ...comboGift, id: "gift-msg-a" }),
      );
      await giftAggregator.handleStandardGift(
        buildGift({ ...comboGift, id: "gift-msg-b" }),
      );

      await advanceTimersByTime(platform.giftAggregationDelay);

      expect(handledGifts).toHaveLength(1);
      expect(firstHandledGift(handledGifts).giftCount).toBe(1);
    });

    test("rejects combo completion payload when group id is missing", async () => {
      const platform = createTestPlatform();
      const giftAggregator = createTikTokGiftAggregator({ platform });

      await expect(
        giftAggregator.handleStandardGift(
          buildGift({
            giftType: "GG",
            comboType: 1,
            repeatEnd: true,
            groupId: undefined,
            giftCount: 1,
            id: "gift-msg-fallback",
          }),
        ),
      ).rejects.toThrow("TikTok combo completion requires groupId");
    });

    test("counts separate combo completion groups even when rapid and same count", async () => {
      const handledGifts: GiftPayload[] = [];
      const platform = createTestPlatform({
        _handleGift: async (payload) => handledGifts.push(payload),
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.handleStandardGift(
        buildGift({
          id: "gift-msg-c1",
          giftType: "GG",
          comboType: 1,
          repeatEnd: true,
          groupId: "combo-group-1",
          giftCount: 1,
        }),
      );

      setSystemTime(new Date("2025-01-15T12:00:00.600Z"));
      await advanceTimersByTime(600);

      await giftAggregator.handleStandardGift(
        buildGift({
          id: "gift-msg-c2",
          giftType: "GG",
          comboType: 1,
          repeatEnd: true,
          groupId: "combo-group-2",
          giftCount: 1,
        }),
      );

      await advanceTimersByTime(platform.giftAggregationDelay);

      expect(handledGifts).toHaveLength(1);
      expect(firstHandledGift(handledGifts).giftCount).toBe(2);
    });

    test("includes sourceType in delivered payload when present", async () => {
      const handledGifts: GiftPayload[] = [];
      const platform = createTestPlatform({
        _handleGift: async (payload) => handledGifts.push(payload),
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.handleStandardGift(
        buildGift({ sourceType: "streak" }),
      );
      await advanceTimersByTime(platform.giftAggregationDelay);

      expect(handledGifts).toHaveLength(1);
      expect(firstHandledGift(handledGifts).sourceType).toBe("streak");
    });

    test("includes avatarUrl in delivered aggregated payload", async () => {
      const handledGifts: GiftPayload[] = [];
      const platform = createTestPlatform({
        _handleGift: async (payload) => handledGifts.push(payload),
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.handleStandardGift(
        buildGift({
          avatarUrl: "https://example.invalid/tiktok-aggregated-avatar.jpg",
        }),
      );
      await advanceTimersByTime(platform.giftAggregationDelay);

      expect(handledGifts).toHaveLength(1);
      expect(firstHandledGift(handledGifts).avatarUrl).toBe(
        "https://example.invalid/tiktok-aggregated-avatar.jpg",
      );
    });

    test("includes giftImageUrl in delivered aggregated payload", async () => {
      const handledGifts: GiftPayload[] = [];
      const platform = createTestPlatform({
        _handleGift: async (payload) => handledGifts.push(payload),
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.handleStandardGift(
        buildGift({
          giftImageUrl: "https://example.invalid/tiktok-gifts/corgi.png",
        }),
      );
      await advanceTimersByTime(platform.giftAggregationDelay);

      expect(handledGifts).toHaveLength(1);
      expect(firstHandledGift(handledGifts).giftImageUrl).toBe(
        "https://example.invalid/tiktok-gifts/corgi.png",
      );
    });

    test("preserves last non-empty avatarUrl when later packets are empty", async () => {
      const handledGifts: GiftPayload[] = [];
      const platform = createTestPlatform({
        _handleGift: async (payload) => handledGifts.push(payload),
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.handleStandardGift(
        buildGift({
          id: "gift-msg-avatar-1",
          giftCount: 1,
          avatarUrl:
            "https://example.invalid/tiktok-aggregated-avatar-initial.jpg",
        }),
      );
      await giftAggregator.handleStandardGift(
        buildGift({
          id: "gift-msg-avatar-2",
          giftCount: 1,
          avatarUrl: "",
        }),
      );

      await advanceTimersByTime(platform.giftAggregationDelay);

      expect(handledGifts).toHaveLength(1);
      expect(firstHandledGift(handledGifts).giftCount).toBe(2);
      expect(firstHandledGift(handledGifts).avatarUrl).toBe(
        "https://example.invalid/tiktok-aggregated-avatar-initial.jpg",
      );
    });

    test("cleans up aggregation state after delivery", async () => {
      const platform = createTestPlatform({
        _handleGift: async () => undefined,
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.handleStandardGift(buildGift());

      expect(platform.giftAggregation["tt-user1-Rose"]).toBeDefined();

      await advanceTimersByTime(platform.giftAggregationDelay);

      expect(platform.giftAggregation["tt-user1-Rose"]).toBeUndefined();
    });

    test("cleans up aggregation state when delivery fails", async () => {
      const platform = createTestPlatform({
        _handleGift: async () => {
          throw new Error("Handler failed");
        },
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.handleStandardGift(buildGift());
      await advanceTimersByTime(platform.giftAggregationDelay);

      expect(platform.giftAggregation["tt-user1-Rose"]).toBeUndefined();
    });

    test("summarizes gift delivery failures without raw provider payloads", async () => {
      const logger = createRecordingLogger();
      const platform = createTestPlatform({
        logger,
        _handleGift: async () => {
          throw new Error("Handler failed");
        },
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.handleStandardGift(
        buildGift({
          rawData: {
            message: "test-private-chat-text",
            access_token: "test-access-token",
          },
        }),
      );
      await advanceTimersByTime(platform.giftAggregationDelay);

      const serializedLogs = JSON.stringify(logger.entries);
      expect(serializedLogs).toContain(
        "Gift data unavailable after notification handling error",
      );
      expect(serializedLogs).toContain("hasOriginalData");
      expect(serializedLogs).not.toContain("test-private-chat-text");
      expect(serializedLogs).not.toContain("test-access-token");
    });
  });

  describe("cleanupGiftAggregation", () => {
    test("flushes pending gifts exactly once and clears timers/state", async () => {
      const handledGifts: GiftPayload[] = [];
      const platform = createTestPlatform({
        _handleGift: async (payload) => handledGifts.push(payload),
      });

      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.handleStandardGift(buildGift());

      expect(getTimerCount()).toBe(1);

      await giftAggregator.cleanupGiftAggregation();

      expect(getTimerCount()).toBe(0);
      expect(platform.giftAggregation).toEqual({});
      expect(handledGifts).toHaveLength(1);
      expect(firstHandledGift(handledGifts).giftCount).toBe(2);

      await advanceTimersByTime(platform.giftAggregationDelay * 2);

      expect(handledGifts).toHaveLength(1);
    });

    test("handles empty aggregation state", async () => {
      const platform = createTestPlatform({ giftAggregation: {} });
      const giftAggregator = createTikTokGiftAggregator({ platform });

      await giftAggregator.cleanupGiftAggregation();

      expect(platform.giftAggregation).toEqual({});
    });
  });
});
