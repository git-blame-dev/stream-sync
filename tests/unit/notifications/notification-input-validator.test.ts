import { describe, expect, it } from "bun:test";

import { NotificationInputValidator } from "../../../src/notifications/notification-input-validator";

type PlatformValidationResult = ReturnType<
  NotificationInputValidator["validatePlatform"]
>;
type DataValidationResult = ReturnType<NotificationInputValidator["validateData"]>;
type TypeValidationResult = ReturnType<NotificationInputValidator["validateType"]>;
type PayloadValidationResult = ReturnType<
  NotificationInputValidator["validateNotificationPayload"]
>;

function expectValidationFailure(
  result: PlatformValidationResult | DataValidationResult | TypeValidationResult,
  expectedError: string,
) {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected validation to fail");
  }
  expect(result.error).toBe(expectedError);
}

function expectTypeValidationSuccess(result: TypeValidationResult) {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error(`Expected type validation to succeed: ${result.error}`);
  }
  return result;
}

describe("NotificationInputValidator", () => {
  const notificationConfigs = {
    "platform:follow": { settingKey: "followsEnabled", commandKey: "follows" },
    "platform:gift": { settingKey: "giftsEnabled", commandKey: "gifts" },
    "platform:paypiggy": {
      settingKey: "paypiggiesEnabled",
      commandKey: "paypiggies",
    },
    "platform:giftpaypiggy": {
      settingKey: "giftPaypiggiesEnabled",
      commandKey: "giftpaypiggies",
    },
  };

  it("rejects non-string platform values", () => {
    const validator = new NotificationInputValidator(notificationConfigs);

    const result = validator.validatePlatform(123);

    expectValidationFailure(result, "Invalid platform type");
  });

  it("rejects unsupported platform values", () => {
    const validator = new NotificationInputValidator(notificationConfigs);

    const result = validator.validatePlatform("discord");

    expectValidationFailure(result, "Unsupported platform");
  });

  it("rejects non-object data payloads", () => {
    const validator = new NotificationInputValidator(notificationConfigs);

    const result = validator.validateData(null);

    expectValidationFailure(result, "Invalid notification data");
  });

  it("rejects unsupported paid alias types as unknown", () => {
    const validator = new NotificationInputValidator(notificationConfigs);

    const result = validator.validateType("subscription", {
      username: "test-user",
    });

    expectValidationFailure(result, "Unknown notification type");
  });

  it("rejects unknown notification types", () => {
    const validator = new NotificationInputValidator(notificationConfigs);

    const result = validator.validateType("platform:unknown", {
      username: "test-user",
    });

    expectValidationFailure(result, "Unknown notification type");
  });

  it("rejects incoming type mismatch", () => {
    const validator = new NotificationInputValidator(notificationConfigs);

    const result = validator.validateType("platform:follow", {
      type: "platform:gift",
      username: "test-user",
    });

    expectValidationFailure(result, "Unknown notification type");
  });

  it("returns canonical type metadata for valid input", () => {
    const validator = new NotificationInputValidator(notificationConfigs);

    const result = validator.validateType("platform:gift", {
      type: "platform:gift",
      username: "test-user",
    });

    const success = expectTypeValidationSuccess(result);
    expect(success.canonicalType).toBe("platform:gift");
    expect(success.config).toEqual(notificationConfigs["platform:gift"]);
    expect(success.isMonetizationType).toBe(true);
  });

  it("sanitizes notification payloads through the canonical contract", () => {
    const validator = new NotificationInputValidator(notificationConfigs);

    const result = validator.validateNotificationPayload(
      {
        type: "platform:paypiggy",
        platform: "TIKTOK",
        user: { id: "discarded" },
        displayName: "Discarded",
        username: " PaidFan ",
        userId: 123,
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      { notificationType: "platform:paypiggy", platform: "TikTok" },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Expected payload validation to succeed: ${result.error}`);
    }
    expect(result.payload).toEqual(
      expect.objectContaining({
        type: "platform:paypiggy",
        sourceType: "platform:paypiggy",
        platform: "tiktok",
        username: "PaidFan",
        userId: "123",
      }),
    );
    expect(result.payload.user).toBeUndefined();
    expect(result.payload.displayName).toBeUndefined();
  });

  it("does not require id for normal paypiggy or giftpaypiggy payloads", () => {
    const validator = new NotificationInputValidator(notificationConfigs);
    const paypiggy = validator.validateNotificationPayload(
      {
        username: "PaidFan",
        userId: "paid-1",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      { notificationType: "platform:paypiggy", platform: "twitch" },
    );
    const giftpaypiggy = validator.validateNotificationPayload(
      {
        username: "GiftSubFan",
        userId: "gift-sub-1",
        giftCount: 3,
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      { notificationType: "platform:giftpaypiggy", platform: "twitch" },
    );

    expect(paypiggy.success).toBe(true);
    expect(giftpaypiggy.success).toBe(true);
  });

  it("keeps normal gift validation strict while allowing error payloads", () => {
    const validator = new NotificationInputValidator(notificationConfigs);
    const normal = validator.validateNotificationPayload(
      {
        username: "Gifter",
        userId: "gift-1",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      { notificationType: "platform:gift", platform: "tiktok" },
    );
    const degraded = validator.validateNotificationPayload(
      {
        isError: true,
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      { notificationType: "platform:gift", platform: "tiktok" },
    );

    expectValidationFailure(normal as PayloadValidationResult, "Notification payload requires id, giftType, giftCount, amount, and currency");
    expect(degraded.success).toBe(true);
  });
});
