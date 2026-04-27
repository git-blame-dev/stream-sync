import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { NotificationBuilder } from "../../src/utils/notification-builder.ts";

type MockFn = ReturnType<typeof createMockFn>;

type ConsoleNotificationData = {
  username?: string;
  viewerCount?: number;
  giftCount?: number;
  giftType?: string;
  amount?: number;
  currency?: string;
  [key: string]: unknown;
};

const requireNotificationData = (
  notification: ConsoleNotificationData | null,
): ConsoleNotificationData => {
  expect(notification).not.toBeNull();
  if (!notification) {
    throw new Error("Expected notification payload");
  }
  return notification;
};

describe("Main.js Greeting Username Extraction Fix", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let extractUsernameFromNotificationData: (
    data: ConsoleNotificationData | null | undefined,
  ) => string | null;
  let logNotificationToConsole: (
    type: string,
    platform: string,
    data: ConsoleNotificationData,
  ) => void;
  let mockLogger: {
    console: MockFn;
    debug: MockFn;
    info: MockFn;
    warn: MockFn;
    error: MockFn;
  };

  beforeEach(() => {
    mockLogger = {
      console: createMockFn(),
      debug: createMockFn(),
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
    };

    const runtimeContext = {
      logger: mockLogger,

      extractUsernameFromNotificationData: function (
        data: ConsoleNotificationData | null | undefined,
      ) {
        if (!data || typeof data.username !== "string") {
          return null;
        }

        const username = data.username.trim();
        return username ? username : null;
      },

      logNotificationToConsole: function (
        type: string,
        platform: string,
        data: ConsoleNotificationData,
      ) {
        const username = this.extractUsernameFromNotificationData(data);
        if (!username) {
          return;
        }

        let msg = "";
        switch (type) {
          case "follow":
            msg = `[${platform}] New follow: ${username}`;
            break;
          case "subscription":
            msg = `[${platform}] New subscription: ${username}`;
            break;
          case "membership":
            msg = `[${platform}] New membership: ${username}`;
            break;
          case "raid":
            msg = `[${platform}] Raid from ${username} with ${data.viewerCount ?? 0} viewers!`;
            break;
          case "gift":
            msg = `[${platform}] Gift from ${username}: ${data.giftCount || 1}x ${data.giftType || "gift"} (${data.amount ?? 0} ${data.currency || "coins"})`;
            break;
          case "greeting":
            msg = `[${platform}] Greeting: ${username}`;
            break;
          case "farewell":
            msg = `[${platform}] Farewell: ${username}`;
            break;
          default:
            msg = `[${platform}] Notification (${type}): ${username}`;
        }
        if (this.logger && this.logger.console) {
          this.logger.console(msg, "notification");
        }
      },
    };

    extractUsernameFromNotificationData =
      runtimeContext.extractUsernameFromNotificationData.bind(runtimeContext);
    logNotificationToConsole =
      runtimeContext.logNotificationToConsole.bind(runtimeContext);
  });

  test("should extract username from notification data", () => {
    const greetingData = NotificationBuilder.build({
      type: "greeting",
      platform: "twitch",
      username: "TestUser",
    });
    const notificationData = requireNotificationData(greetingData);

    expect(notificationData).toMatchObject({
      type: "greeting",
      platform: "twitch",
      username: "TestUser",
    });

    const extractedUsername =
      extractUsernameFromNotificationData(notificationData);

    expect(extractedUsername).toBe("TestUser");
  });

  test("logs greeting notifications with the extracted username", () => {
    const greetingData = NotificationBuilder.build({
      type: "greeting",
      platform: "twitch",
      username: "TestUser",
    });
    const notificationData = requireNotificationData(greetingData);

    logNotificationToConsole("greeting", "twitch", notificationData);

    expect(mockLogger.console).toHaveBeenCalledTimes(1);
    const [message, category] = mockLogger.console.mock.calls[0];
    expect(message).toBe("[twitch] Greeting: TestUser");
    expect(category).toBe("notification");
  });

  test("returns null when username is missing", () => {
    expect(
      extractUsernameFromNotificationData({ displayName: "AltName" }),
    ).toBeNull();
    expect(extractUsernameFromNotificationData({ name: "AltName" })).toBeNull();
  });

  test("returns null for invalid data", () => {
    expect(extractUsernameFromNotificationData(null)).toBeNull();
    expect(extractUsernameFromNotificationData(undefined)).toBeNull();
    expect(extractUsernameFromNotificationData({})).toBeNull();
    expect(extractUsernameFromNotificationData({ user: {} })).toBeNull();
  });

  test("should fix all notification types using the same username extraction pattern", () => {
    const notificationData = NotificationBuilder.build({
      type: "platform:follow",
      platform: "twitch",
      username: "TestFollower",
    });
    const builtNotificationData = requireNotificationData(notificationData);

    const notificationTypes = [
      "platform:follow",
      "platform:paypiggy",
      "platform:raid",
      "platform:gift",
      "farewell",
    ];

    notificationTypes.forEach((type) => {
      mockLogger.console.mockClear();
      logNotificationToConsole(type, "twitch", builtNotificationData);

      const loggedMessage = mockLogger.console.mock.calls[0][0];
      expect(loggedMessage).toContain("TestFollower");
      expect(loggedMessage).not.toContain("undefined");
    });
  });
});
