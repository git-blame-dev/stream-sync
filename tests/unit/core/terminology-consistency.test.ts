import { describe, test, expect } from "bun:test";

import { createMockFn } from "../../helpers/bun-mock-utils";
import { createConfigFixture } from "../../helpers/config-fixture";
import { setupAutomatedCleanup } from "../../helpers/mock-lifecycle";
import { generateLogMessage } from "../../helpers/notification-test-utils";
import { createTestUser, TEST_TIMEOUTS } from "../../helpers/test-setup";
import * as constants from "../../../src/core/constants";
import { PlatformEvents } from "../../../src/interfaces/PlatformEvents";
import { PlatformEventRouter } from "../../../src/services/PlatformEventRouter.ts";

setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true,
});

describe("Terminology Consistency", () => {
  const testOptions = { timeout: TEST_TIMEOUTS.FAST };

  type HandledNotification = {
    platform: string;
    username: unknown;
    data: Record<string, unknown>;
  };

  function firstHandled(handled: ReadonlyArray<HandledNotification>) {
    const notification = handled[0];
    expect(notification).toBeDefined();
    if (!notification) {
      throw new Error("Expected one handled notification");
    }
    return notification;
  }

  const buildRouterHarness = () => {
    const handled: HandledNotification[] = [];
    const runtime = {
      handlePaypiggyNotification: async (
        platform: string,
        username: unknown,
        data: Record<string, unknown>,
      ) => {
        handled.push({ platform, username, data });
      },
    };
    const eventBus = { subscribe: createMockFn(() => () => {}) };
    const notificationManager = {
      handleNotification: createMockFn(async () => true),
    };
    const config = createConfigFixture({
      general: { paypiggiesEnabled: true },
    });
    const logger = {
      debug: createMockFn(),
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
    };
    const router = new PlatformEventRouter({
      eventBus,
      runtime,
      notificationManager,
      config,
      logger,
    });
    return { handled, router };
  };

  describe("Event routing", () => {
    test(
      "YouTube paypiggy routes through PlatformEventRouter",
      async () => {
        const { handled, router } = buildRouterHarness();
        const user = createTestUser({
          username: "TestMember",
          platform: "youtube",
        });
        const membershipData = {
          username: user.username,
          userId: "user-1",
          timestamp: "2024-01-01T00:00:00Z",
        };

        await router.routeEvent({
          platform: "youtube",
          type: "platform:paypiggy",
          data: membershipData,
        });

        expect(handled).toHaveLength(1);
        const notification = firstHandled(handled);
        expect(notification.platform).toBe("youtube");
        expect(notification.username).toBe(user.username);
        expect(notification.data.userId).toBe("user-1");
        expect(notification.data.platform).toBe("youtube");
      },
      testOptions,
    );

    test(
      "Twitch subscription routes through PlatformEventRouter",
      async () => {
        const { handled, router } = buildRouterHarness();
        const user = createTestUser({
          username: "SubUser",
          platform: "twitch",
        });
        const subscriptionData = {
          username: user.username,
          userId: "user-2",
          timestamp: "2024-01-01T00:00:00Z",
        };

        await router.routeEvent({
          platform: "twitch",
          type: "platform:paypiggy",
          data: subscriptionData,
        });

        expect(handled).toHaveLength(1);
        const notification = firstHandled(handled);
        expect(notification.platform).toBe("twitch");
        expect(notification.username).toBe(user.username);
        expect(notification.data.userId).toBe("user-2");
        expect(notification.data.platform).toBe("twitch");
      },
      testOptions,
    );
  });

  describe("Log terminology", () => {
    test(
      "YouTube membership log uses membership terminology",
      () => {
        const logMessage = generateLogMessage("platform:paypiggy", {
          username: "TestMember",
          platform: "youtube",
          rewardTitle: "Member",
        });
        expect(logMessage).toContain("New member");
        expect(logMessage).toContain("TestMember");
      },
      testOptions,
    );

    test(
      'Twitch subscription log uses "subscription"',
      () => {
        const logMessage = generateLogMessage("platform:paypiggy", {
          username: "TwitchSub",
          platform: "twitch",
          tier: "Tier1",
          months: 3,
        });
        expect(logMessage.toLowerCase()).toContain("subscriber");
        expect(logMessage).toContain("TwitchSub");
      },
      testOptions,
    );
  });

  describe("Alias removal", () => {
    test(
      "resubscription aliases are not exposed in configs or priorities",
      () => {
        const notificationConfigs = constants.NOTIFICATION_CONFIGS as Record<string, unknown>;
        const priorityLevels = constants.PRIORITY_LEVELS as Record<string, unknown>;
        const exportedConstants = constants as Record<string, unknown>;
        const platformNotificationTypes = PlatformEvents.NOTIFICATION_TYPES as Record<string, unknown>;

        expect(notificationConfigs.resub).toBeUndefined();
        expect(notificationConfigs.resubscription).toBeUndefined();
        expect(priorityLevels.RESUB).toBeUndefined();
        expect(exportedConstants.NOTIFICATION_TYPES).toBeUndefined();
        expect(platformNotificationTypes.RESUB).toBeUndefined();
        expect(
          platformNotificationTypes.RESUBSCRIPTION,
        ).toBeUndefined();
      },
      testOptions,
    );
  });
});
