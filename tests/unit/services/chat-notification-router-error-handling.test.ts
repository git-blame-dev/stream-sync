import { vi, type Mock, describe, it, beforeEach, expect } from 'bun:test';
import type { DisplayQueueItem } from "../../../src/interfaces/DisplayQueue";

import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { ChatNotificationRouter } from "../../../src/services/ChatNotificationRouter.ts";

type TestConfig = ReturnType<typeof createConfigFixture>;
type QueueItem = DisplayQueueItem;
type ChatMessage = {
  message: string;
  displayName: string;
  username: string;
  userId: string;
  timestamp: string;
};
type DisplayQueueAddItem = Mock<(...args: [QueueItem]) => readonly QueueItem[]>;
type RouterRuntime = {
  config: TestConfig;
  platformLifecycleService: { getPlatformConnectionTime: Mock<(...args: [platform: string]) => null> };
  displayQueue: {
    addItem: DisplayQueueAddItem;
    addSequence: Mock<(...args: [QueueItem[]]) => readonly QueueItem[]>;
  };
  commandCooldownService: {
    checkUserCooldown: Mock<(...args: [userId: unknown, perUserCooldown: number, heavyCooldown: number]) => boolean>;
    checkGlobalCooldown: Mock<(...args: [commandName: string, globalCooldownMs: number]) => boolean>;
    updateUserCooldown: Mock<(...args: [userId: unknown]) => void>;
    updateGlobalCooldown: Mock<(...args: [commandName: string]) => void>;
  };
  userTrackingService: { isFirstMessage: Mock<(...args: [userId: unknown, context: Record<string, unknown>]) => boolean> };
  commandParser: { getVFXConfig: Mock<(...args: [commandKey: string, message: string | null]) => null> };
  isFirstMessage: Mock<(...args: [userId: unknown, context: Record<string, unknown>]) => boolean>;
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
      getPlatformConnectionTime: vi.fn<(...args: [platform: string]) => null>().mockReturnValue(null),
    },
    displayQueue: {
      addItem: displayQueueBehavior,
      addSequence: vi.fn<(...args: [QueueItem[]]) => readonly QueueItem[]>((items) => {
        items.forEach((item) => displayQueueBehavior(item));
        return items;
      }),
    },
    commandCooldownService: {
      checkUserCooldown: vi.fn<(...args: [unknown, number, number]) => boolean>().mockReturnValue(true),
      checkGlobalCooldown: vi.fn<(...args: [string, number]) => boolean>().mockReturnValue(true),
      updateUserCooldown: vi.fn<(...args: [unknown]) => void>(),
      updateGlobalCooldown: vi.fn<(...args: [string]) => void>(),
    },
    userTrackingService: {
      isFirstMessage: vi.fn<(...args: [unknown, Record<string, unknown>]) => boolean>().mockReturnValue(false),
    },
    commandParser: {
      getVFXConfig: vi.fn<(...args: [string, string | null]) => null>().mockReturnValue(null),
    },
    isFirstMessage: vi.fn<(...args: [unknown, Record<string, unknown>]) => boolean>().mockReturnValue(false),
  });

  it("handles display queue failures gracefully without crashing", async () => {
    const runtime = createRuntime(
      vi.fn<(...args: [QueueItem]) => readonly QueueItem[]>((item) => [item]).mockImplementation(() => {
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
      vi.fn<(...args: [QueueItem]) => readonly QueueItem[]>((item) => [item]).mockImplementation(() => {
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
