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
