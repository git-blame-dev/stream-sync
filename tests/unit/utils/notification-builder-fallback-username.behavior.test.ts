import { describe, test, expect } from "bun:test";
import { NotificationBuilder } from "../../../src/utils/notification-builder.ts";
describe("notification builder error message behavior", () => {
  test("generates generic error message when sanitized username is empty", () => {
    const ttsMessage = NotificationBuilder.generateTtsMessage({
      type: "platform:gift",
      username: "   ",
      isError: true,
    });

    expect(ttsMessage).toBe("Error processing gift");
  });

  test("includes username in error message when username is valid", () => {
    const ttsMessage = NotificationBuilder.generateTtsMessage({
      type: "platform:gift",
      username: "TestUser",
      isError: true,
    });

    expect(ttsMessage).toBe("Error processing gift from TestUser");
  });
});
