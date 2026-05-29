import { describe, expect, it } from "bun:test";

import { NotificationInputValidator } from "../../../src/notifications/notification-input-validator";

type PlatformValidationResult = ReturnType<
  NotificationInputValidator["validatePlatform"]
>;
type DataValidationResult = ReturnType<NotificationInputValidator["validateData"]>;
type TypeValidationResult = ReturnType<NotificationInputValidator["validateType"]>;

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
});
