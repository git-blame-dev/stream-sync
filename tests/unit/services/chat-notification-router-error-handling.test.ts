import { describe, it, beforeEach, expect } from "bun:test";
import { createMockFn, type TestMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { ChatNotificationRouter } from "../../../src/services/ChatNotificationRouter.ts";

type TestConfig = ReturnType<typeof createConfigFixture>;
type QueueItem = Record<string, unknown>;
type ChatMessage = {
  message: string;
  displayName: string;
  username: string;
  userId: string;
  timestamp: string;
};
type DisplayQueueAddItem = TestMockFn<[QueueItem], void>;
type RouterRuntime = {
  config: TestConfig;
  platformLifecycleService: { getPlatformConnectionTime: TestMockFn<[platform: string], null> };
  displayQueue: { addItem: DisplayQueueAddItem };
  commandCooldownService: {
    checkUserCooldown: TestMockFn<[userId: unknown, perUserCooldown: number, heavyCooldown: number], boolean>;
    checkGlobalCooldown: TestMockFn<[commandName: string, globalCooldownMs: number], boolean>;
    updateUserCooldown: TestMockFn<[userId: unknown], void>;
    updateGlobalCooldown: TestMockFn<[commandName: string], void>;
  };
  userTrackingService: { isFirstMessage: TestMockFn<[userId: unknown, context: Record<string, unknown>], boolean> };
  commandParser: { getVFXConfig: TestMockFn<[commandKey: string, message: string | null], null> };
  isFirstMessage: TestMockFn<[userId: unknown, context: Record<string, unknown>], boolean>;
};

describe("ChatNotificationRouter error handling", () => {
  let mockLogger: typeof noOpLogger;
  let testConfig: TestConfig;
  let baseMessage: ChatMessage;

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

  const createRuntime = (displayQueueBehavior: DisplayQueueAddItem): RouterRuntime => ({
    config: {
      ...testConfig,
      general: { ...testConfig.general, messagesEnabled: true, greetingsEnabled: true },
      twitch: { ...testConfig.twitch },
    },
    platformLifecycleService: {
      getPlatformConnectionTime: createMockFn<[platform: string], null>().mockReturnValue(null),
    },
    displayQueue: {
      addItem: displayQueueBehavior,
    },
    commandCooldownService: {
      checkUserCooldown: createMockFn<[unknown, number, number], boolean>().mockReturnValue(true),
      checkGlobalCooldown: createMockFn<[string, number], boolean>().mockReturnValue(true),
      updateUserCooldown: createMockFn<[unknown], void>(),
      updateGlobalCooldown: createMockFn<[string], void>(),
    },
    userTrackingService: {
      isFirstMessage: createMockFn<[unknown, Record<string, unknown>], boolean>().mockReturnValue(false),
    },
    commandParser: {
      getVFXConfig: createMockFn<[string, string | null], null>().mockReturnValue(null),
    },
    isFirstMessage: createMockFn<[unknown, Record<string, unknown>], boolean>().mockReturnValue(false),
  });

  it("handles display queue failures gracefully without crashing", async () => {
    const runtime = createRuntime(
      createMockFn<[QueueItem], void>().mockImplementation(() => {
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
      createMockFn<[QueueItem], void>().mockImplementation(() => {
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
