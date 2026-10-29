import { describe, expect, it } from "bun:test";
import { createSyntheticGiftFromAggregated } from "../../../src/notifications/aggregated-donation-transformer";

type AggregatedDonationFixture = Parameters<
  typeof createSyntheticGiftFromAggregated
>[0];

const createAggregatedDonationFixture = (
  overrides: Partial<AggregatedDonationFixture> = {},
): AggregatedDonationFixture => ({
  userId: "test",
  username: "test",
  giftTypes: [],
  totalGifts: 0,
  totalCoins: 0,
  message: "",
  ...overrides,
});

describe("createSyntheticGiftFromAggregated", () => {
  it("preserves residual currency and independently freezes compact source inputs", () => {
    const source = { platform: "twitch", type: "platform:gift", data: {
      id: "test-bits-source", timestamp: "2026-01-01T00:00:00.000Z", amount: 9,
      giftCount: 3, currency: "bits", rawData: "test-only-omitted", message: "test-only"
    } };
    const result = createSyntheticGiftFromAggregated(createAggregatedDonationFixture({
      currency: "bits", totalCoins: 9, totalGifts: 3, contributions: [source]
    }));
    source.data.amount = 99;
    expect(result.currency).toBe("bits");
    expect(result.amount).toBe(9);
    expect(result.giftCount).toBe(3);
    expect(result.contributions).toEqual([{ platform: "twitch", type: "platform:gift", data: {
      id: "test-bits-source", timestamp: "2026-01-01T00:00:00.000Z", amount: 9, giftCount: 3, currency: "bits"
    } }]);
    expect(Object.isFrozen(result.contributions?.[0]?.data)).toBe(true);
  });
  it("creates synthetic gift with isAggregated flag", () => {
    const result = createSyntheticGiftFromAggregated(createAggregatedDonationFixture({
      userId: "testUser123",
      username: "testDonor",
      giftTypes: ["Rose"],
      totalGifts: 5,
      totalCoins: 100,
      message: "Thanks!",
    }));

    expect(result.isAggregated).toBe(true);
  });

  it("preserves userId, username, and optional avatarUrl", () => {
    const result = createSyntheticGiftFromAggregated(createAggregatedDonationFixture({
      userId: "testId",
      username: "testName",
      avatarUrl: " https://example.invalid/donor-avatar.png ",
    }));

    expect(result.userId).toBe("testId");
    expect(result.username).toBe("testName");
    expect(result.avatarUrl).toBe("https://example.invalid/donor-avatar.png");
  });

  it("formats multiple gift types in giftType string", () => {
    const result = createSyntheticGiftFromAggregated(createAggregatedDonationFixture({
      giftTypes: ["Rose", "Heart", "Star"],
      totalGifts: 10,
      totalCoins: 500,
    }));

    expect(result.giftType).toBe("Multiple Gifts (Rose, Heart, Star)");
  });

  it("maps totalGifts to giftCount", () => {
    const result = createSyntheticGiftFromAggregated(createAggregatedDonationFixture({
      giftTypes: ["Rose"],
      totalGifts: 15,
      totalCoins: 300,
    }));

    expect(result.giftCount).toBe(15);
  });

  it("maps totalCoins to amount with coins currency", () => {
    const result = createSyntheticGiftFromAggregated(createAggregatedDonationFixture({
      giftTypes: ["Rose"],
      totalGifts: 5,
      totalCoins: 250,
    }));

    expect(result.amount).toBe(250);
    expect(result.currency).toBe("coins");
  });

  it("preserves message", () => {
    const result = createSyntheticGiftFromAggregated(createAggregatedDonationFixture({
      message: "Test message!",
    }));

    expect(result.message).toBe("Test message!");
  });

  it("handles empty giftTypes array", () => {
    const result = createSyntheticGiftFromAggregated(createAggregatedDonationFixture());

    expect(result.giftType).toBe("Multiple Gifts ()");
  });

  it("handles single gift type", () => {
    const result = createSyntheticGiftFromAggregated(createAggregatedDonationFixture({
      giftTypes: ["Diamond"],
      totalGifts: 1,
      totalCoins: 1000,
    }));

    expect(result.giftType).toBe("Multiple Gifts (Diamond)");
  });
});
