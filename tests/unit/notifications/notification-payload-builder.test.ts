import { describe, expect, it } from "bun:test";
import { NotificationBuilder } from "../../../src/utils/notification-builder.ts";

import { NotificationPayloadBuilder } from "../../../src/notifications/notification-payload-builder";

const createPayloadBuilder = () =>
  new NotificationPayloadBuilder({
    build(input) {
      const notification = NotificationBuilder.build(input);
      if (notification === null) {
        throw new Error("NotificationBuilder.build returned null");
      }
      return notification;
    },
  });

describe("NotificationPayloadBuilder", () => {
  it("strips internal fields and merges sourceType into metadata for non-monetization", () => {
    const payloadBuilder = createPayloadBuilder();
    const data = {
      type: "platform:follow",
      platform: "tiktok",
      username: "test-user",
      userId: "test-user-id",
      displayName: "Test User",
      isSuperfan: true,
      isGift: true,
      isBits: true,
      message: "hello",
      metadata: { origin: "custom" },
      sourceType: "test-source",
    };

    const result = payloadBuilder.buildPayload({
      canonicalType: "platform:follow",
      platform: "tiktok",
      data,
      originalType: "platform:follow",
      isMonetizationType: false,
    });

    expect(result.notificationData.metadata).toEqual({
      origin: "custom",
      sourceType: "test-source",
    });
    expect(result.notificationData.sourceType).toBe("test-source");
    expect(result.notificationData.type).toBe("platform:follow");
  });

  it("removes metadata and writes sourceType at top-level for monetization", () => {
    const payloadBuilder = createPayloadBuilder();
    const data = {
      type: "platform:gift",
      platform: "tiktok",
      username: "test-user",
      giftType: "rose",
      giftCount: 1,
      amount: 100,
      currency: "coins",
      metadata: { origin: "custom" },
      sourceType: "test-source",
    };

    const result = payloadBuilder.buildPayload({
      canonicalType: "platform:gift",
      platform: "tiktok",
      data,
      originalType: "platform:gift",
      isMonetizationType: true,
    });

    expect(result.notificationData.metadata).toBeUndefined();
    expect(result.notificationData.sourceType).toBe("test-source");
  });

  it("overwrites notification type with the canonical type", () => {
    const payloadBuilder = createPayloadBuilder();
    const data = {
      type: "platform:follow",
      platform: "tiktok",
      username: "test-user",
    };

    const result = payloadBuilder.buildPayload({
      canonicalType: "platform:follow",
      platform: "tiktok",
      data,
      originalType: "platform:follow",
      isMonetizationType: false,
    });

    expect(result.notificationData.type).toBe("platform:follow");
  });
});
