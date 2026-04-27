import { describe, it, beforeEach, expect } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { ChatNotificationRouter } from "../../../src/services/ChatNotificationRouter.ts";

describe("ChatNotificationRouter error handling", () => {
  let mockLogger;
  let testConfig;
  let baseMessage;

  beforeEach(() => {
    mockLogger = noOpLogger;
    testConfig = createConfigFixture();

    baseMessage = {
      message: "Test message",
      displayName: "testViewer",
      username: "testviewer",
      userId: "test-user-1",
      timestamp: new Date().toISOString(),
    };
  });

  const createRuntime = (displayQueueBehavior) => ({
    config: {
      general: { messagesEnabled: true, greetingsEnabled: true },
      twitch: {},
    },
    platformLifecycleService: {
      getPlatformConnectionTime: createMockFn().mockReturnValue(null),
    },
    displayQueue: {
      addItem: displayQueueBehavior,
    },
    commandCooldownService: {
      checkUserCooldown: createMockFn().mockReturnValue(true),
      checkGlobalCooldown: createMockFn().mockReturnValue(true),
      updateUserCooldown: createMockFn(),
      updateGlobalCooldown: createMockFn(),
    },
    userTrackingService: {
      isFirstMessage: createMockFn().mockReturnValue(false),
    },
    commandParser: {
      getVFXConfig: createMockFn().mockReturnValue(null),
    },
    isFirstMessage: createMockFn().mockReturnValue(false),
  });

  it("handles display queue failures gracefully without crashing", async () => {
    const runtime = createRuntime(
      createMockFn().mockImplementation(() => {
        throw new Error("queue failure");
      }),
    );

    const router = new ChatNotificationRouter({
      runtime,
      logger: mockLogger,
      config: testConfig,
    });

    await expect(
      router.handleChatMessage("twitch", baseMessage),
    ).resolves.toBeUndefined();
  });

  it("handles non-Error thrown values without crashing", async () => {
    const runtime = createRuntime(
      createMockFn().mockImplementation(() => {
        throw "string failure";
      }),
    );

    const router = new ChatNotificationRouter({
      runtime,
      logger: mockLogger,
      config: testConfig,
    });

    await expect(
      router.handleChatMessage("twitch", baseMessage),
    ).resolves.toBeUndefined();
  });
});
