import { describe, test, expect } from "bun:test";

import { normalizeTikTokGiftEvent } from "../../../../../src/platforms/tiktok/events/event-normalizer.ts";

const baseGiftPayload = {
  user: {
    userId: "test-user-id-1",
    uniqueId: "test-user-1",
    nickname: "test-user-one",
  },
  giftDetails: {
    giftName: "Rose",
    diamondCount: 1,
    giftType: 0,
  },
  gift: {
    giftPictureUrl: "https://example.invalid/tiktok/gifts/rose.webp",
  },
  repeatCount: 1,
  common: {
    msgId: "test-msg-1",
    createTime: Date.parse("2025-01-20T12:00:00.000Z"),
  },
};

type GiftPayloadCommon = {
  createTime?: string | number | Date;
  msgId?: string | number | null;
};

function hasGiftPayloadCommon(payload: unknown): payload is { common: GiftPayloadCommon } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "common" in payload &&
    typeof payload.common === "object" &&
    payload.common !== null
  );
}

const normalizerOptions: Parameters<typeof normalizeTikTokGiftEvent>[1] = {
  getTimestamp: (payload) => {
    if (!hasGiftPayloadCommon(payload) || payload.common.createTime === undefined) {
      return null;
    }
    return new Date(payload.common.createTime).toISOString();
  },
  getPlatformMessageId: (payload) => {
    if (!hasGiftPayloadCommon(payload) || payload.common.msgId === undefined) {
      return null;
    }
    return payload.common.msgId === null ? null : String(payload.common.msgId);
  },
};

describe("normalizeTikTokGiftEvent", () => {
  test("normalizes provider and injected identity/time fields while preserving raw gift assets", () => {
    const asset = { resourceUri: "https://example.invalid/synthetic-asset.zip" };
    const payload = { ...baseGiftPayload, asset, sourceType: " official ", repeatCount: " 2.0 " };
    const event = normalizeTikTokGiftEvent(payload);
    expect(event).toMatchObject({ id: "test-msg-1", timestamp: "2025-01-20T12:00:00.000Z",
      sourceType: "official", giftCount: 2, repeatCount: 2, amount: 2 });
    expect(event.rawData).toBe(payload);
    expect(event.rawData.asset).toBe(asset);
    expect(normalizeTikTokGiftEvent(payload, { ...normalizerOptions, getPlatformMessageId: () => " injected-id " }).id)
      .toBe("injected-id");
    expect(normalizeTikTokGiftEvent(payload, { ...normalizerOptions, getPlatformMessageId: () => " " }).id).toBe("test-msg-1");
    expect(normalizeTikTokGiftEvent({ ...payload, sourceType: " " }).sourceType).toBeUndefined();
  });

  test("rejects invalid injected timestamps instead of accepting or replacing them", () => {
    for (const timestamp of ["not a timestamp", " ", "0"]) {
      expect(() => normalizeTikTokGiftEvent(baseGiftPayload, { ...normalizerOptions, getTimestamp: () => timestamp }))
        .toThrow("TikTok gift timestamp");
    }
    expect(normalizeTikTokGiftEvent(baseGiftPayload, { ...normalizerOptions,
      getTimestamp: () => "2025-01-20T12:00:00Z" }).timestamp).toBe("2025-01-20T12:00:00.000Z");
  });

  test("maps avatarUrl from user.profilePictureUrl", () => {
    const payload = {
      ...baseGiftPayload,
      user: {
        ...baseGiftPayload.user,
        profilePictureUrl: "https://example.invalid/tiktok-avatar-direct.jpg",
      },
    };

    const event = normalizeTikTokGiftEvent(payload, normalizerOptions);

    expect(event.avatarUrl).toBe(
      "https://example.invalid/tiktok-avatar-direct.jpg",
    );
  });

  test("maps avatarUrl from first user.profilePicture.url entry", () => {
    const payload = {
      ...baseGiftPayload,
      user: {
        ...baseGiftPayload.user,
        profilePicture: {
          url: ["https://example.invalid/tiktok-avatar-array.jpg"],
        },
      },
    };

    const event = normalizeTikTokGiftEvent(payload, normalizerOptions);

    expect(event.avatarUrl).toBe(
      "https://example.invalid/tiktok-avatar-array.jpg",
    );
  });

  test("maps giftImageUrl from gift image payload fields", () => {
    const event = normalizeTikTokGiftEvent(baseGiftPayload, normalizerOptions);

    expect(event.giftImageUrl).toBe(
      "https://example.invalid/tiktok/gifts/rose.webp",
    );
  });
});
