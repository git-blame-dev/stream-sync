import { describe, expect, it } from "bun:test";
import {
  extractTikTokUserData,
  extractTikTokAvatarUrl,
  extractTikTokGiftData,
  formatCoinAmount,
} from "../../../src/utils/tiktok-data-extraction.ts";
describe("extractTikTokUserData", () => {
  it("throws when payload is missing", () => {
    expect(() => extractTikTokUserData(null)).toThrow("TikTok user payload");
  });

  it("extracts canonical fields from nested user data", () => {
    const data = {
      user: {
        userId: "test_user_id_nested",
        uniqueId: "testUserNested",
        nickname: "TestNestedDisplay",
      },
    };
    expect(extractTikTokUserData(data)).toEqual({
      userId: "testUserNested",
      username: "TestNestedDisplay",
    });
  });
});

describe("extractTikTokGiftData", () => {
  const gift = (overrides: Record<string, unknown> = {}) => ({
    giftDetails: { giftName: "Synthetic Rose", diamondCount: 2, giftType: 0 }, repeatCount: 3, ...overrides,
  });

  it("rejects invalid integer domains and unsafe products without publishing totals", () => {
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, true, [1], {}, "", "invalid"]) {
      for (const field of ["diamondCount", "giftType"]) {
        expect(() => extractTikTokGiftData(gift({ giftDetails: {
          giftName: "Synthetic Rose", diamondCount: 2, giftType: 0, [field]: value,
        } }))).toThrow(`requires giftDetails.${field}`);
      }
      expect(() => extractTikTokGiftData(gift({ repeatCount: value }))).toThrow("requires repeatCount");
    }
    expect(() => extractTikTokGiftData(gift({ repeatCount: Number.MAX_SAFE_INTEGER }))).toThrow("safe integer amount");
  });

  it("preserves zero-diamond placeholders, native type zero/two and numeric strings", () => {
    expect(extractTikTokGiftData(gift({ giftDetails: { giftName: "Synthetic Placeholder", diamondCount: 0, giftType: 0 } })))
      .toMatchObject({ unitAmount: 0, amount: 0, comboType: 0, combo: false });
    expect(extractTikTokGiftData(gift({ giftDetails: { giftName: "Synthetic Rose", diamondCount: "2.0", giftType: "2" }, repeatCount: " 3 " })))
      .toMatchObject({ unitAmount: 2, amount: 6, giftCount: 3, comboType: 2, combo: false });
    expect(() => extractTikTokGiftData(gift({ repeatCount: 0 }))).toThrow("requires repeatCount");
  });

  it("normalizes explicit completion flags and treats unknown flags as incomplete", () => {
    for (const repeatEnd of [1, true, "1", "true", " TRUE "]) {
      expect(extractTikTokGiftData(gift({ repeatEnd })).repeatEnd).toBe(true);
    }
    for (const repeatEnd of [0, false, "0", "false", " FALSE ", undefined, null, "", "yes", 2, {}, []]) {
      expect(extractTikTokGiftData(gift({ repeatEnd })).repeatEnd).toBe(false);
    }
  });

  it("allows only trimmed HTTP(S) image URLs and keeps safe avatar fallback", () => {
    for (const url of ["javascript:alert(1)", "data:image/png;base64,synthetic", "file:///synthetic", "invalid"]) {
      expect(extractTikTokGiftData(gift({ gift: { giftPictureUrl: url } })).giftImageUrl).toBeUndefined();
      expect(extractTikTokAvatarUrl({ user: { profilePictureUrl: url,
        profilePicture: { url: [" https://example.invalid/fallback.webp "] } } })).toBe("https://example.invalid/fallback.webp");
    }
    expect(extractTikTokGiftData(gift({ gift: { giftPictureUrl: " http://example.invalid/gift.webp " } })).giftImageUrl)
      .toBe("http://example.invalid/gift.webp");
  });

  it("throws on invalid payloads", () => {
    expect(() => extractTikTokGiftData(null)).toThrow("gift payload");
  });

  it("detects combo gift type and propagates repeat metadata", () => {
    const result = extractTikTokGiftData({
      giftDetails: { giftName: "TestGiftLion", diamondCount: 29, giftType: 1 },
      repeatCount: 3,
      groupId: "test_combo_1",
      repeatEnd: 1,
    });

    expect(result.giftType).toBe("TestGiftLion");
    expect(result.giftCount).toBe(3);
    expect(result.unitAmount).toBe(29);
    expect(result.amount).toBe(87);
    expect(result.currency).toBe("coins");
    expect(result.combo).toBe(true);
    expect(result.comboType).toBe(1);
    expect(result.groupId).toBe("test_combo_1");
    expect(result.repeatEnd).toBe(true);
  });

  it("throws when giftDetails are missing", () => {
    const build = () =>
      extractTikTokGiftData({
        extendedGiftInfo: { name: "TestGiftGalaxy", combo: true },
        repeatCount: 4,
      });

    expect(build).toThrow("requires giftDetails");
  });

  it("throws when repeatCount is missing", () => {
    const build = () =>
      extractTikTokGiftData({
        giftDetails: {
          giftName: "TestGiftNoRepeat",
          diamondCount: 1,
          giftType: 0,
        },
      });

    expect(build).toThrow("requires repeatCount");
  });

  it("extracts giftImageUrl from TikTok gift payload image fields", () => {
    const result = extractTikTokGiftData({
      giftDetails: { giftName: "TestGiftRose", diamondCount: 2, giftType: 1 },
      gift: {
        giftPictureUrl: "https://example.invalid/tiktok/gifts/rose.webp",
      },
      repeatCount: 5,
    });

    expect(result.giftImageUrl).toBe(
      "https://example.invalid/tiktok/gifts/rose.webp",
    );
  });
});

describe("extractTikTokAvatarUrl", () => {
  it("returns profilePictureUrl when available", () => {
    const avatarUrl = extractTikTokAvatarUrl({
      user: {
        profilePictureUrl: "https://example.invalid/tiktok-avatar-direct.jpg",
      },
    });

    expect(avatarUrl).toBe("https://example.invalid/tiktok-avatar-direct.jpg");
  });

  it("falls back to first profilePicture.url entry", () => {
    const avatarUrl = extractTikTokAvatarUrl({
      user: {
        profilePicture: {
          url: ["https://example.invalid/tiktok-avatar-array.jpg"],
        },
      },
    });

    expect(avatarUrl).toBe("https://example.invalid/tiktok-avatar-array.jpg");
  });

  it("returns empty string when user avatar data is missing", () => {
    expect(extractTikTokAvatarUrl({ user: { uniqueId: "test-id" } })).toBe("");
  });
});

describe("formatCoinAmount", () => {
  it("returns formatted coin strings or empty when no coins", () => {
    expect(formatCoinAmount(15)).toBe(" [15 coins]");
    expect(formatCoinAmount(1)).toBe(" [1 coin]");
    expect(formatCoinAmount(0)).toBe("");
  });
});
