import { vi, type Mock, describe, it, beforeEach, expect } from 'bun:test';
import type { DisplayQueueItem } from "../../../src/interfaces/DisplayQueue";

import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { ChatNotificationRouter } from "../../../src/services/ChatNotificationRouter.ts";

type TestConfig = ReturnType<typeof createConfigFixture>;
type QueueItem = DisplayQueueItem;
type RouterRuntime = {
  config: TestConfig;
  displayQueue: {
    addItem: Mock<(...args: [QueueItem]) => readonly QueueItem[]>;
    addSequence: Mock<(...args: [QueueItem[]]) => readonly QueueItem[]>;
  };
  platformLifecycleService: { getPlatformConnectionTime: Mock<(...args: [platform: string]) => null> };
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

type ChatMessage = {
  message: string;
  displayName: string;
  username: string;
  userId: string;
  timestamp: string;
};

describe("ChatNotificationRouter lingering/priority/TTS", () => {
  let mockLogger: typeof noOpLogger;
  let testConfig: TestConfig;

  beforeEach(() => {
    mockLogger = noOpLogger;
    testConfig = createConfigFixture();
  });

  const baseMessage: ChatMessage = {
    message: "Test message",
    displayName: "testViewer",
    username: "testviewer",
    userId: "test-user-1",
    timestamp: new Date().toISOString(),
  };

  const createRouter = ({
    runtime: runtimeOverrides,
    config = testConfig,
  }: { runtime?: Partial<RouterRuntime>; config?: TestConfig } = {}) => {
    const addItem = vi.fn<(...args: [QueueItem]) => readonly QueueItem[]>((item) => [item]);
    const baseRuntime: RouterRuntime = {
      config: {
        ...testConfig,
        general: { ...testConfig.general, greetingsEnabled: true, messagesEnabled: true },
        twitch: { ...testConfig.twitch, greetingsEnabled: true, messagesEnabled: true },
      },
      displayQueue: {
        addItem,
        addSequence: vi.fn<(...args: [QueueItem[]]) => readonly QueueItem[]>((items) => {
          items.forEach((item) => addItem(item));
          return items;
        }),
      },
      platformLifecycleService: {
        getPlatformConnectionTime: vi.fn<(...args: [platform: string]) => null>().mockReturnValue(null),
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
    };

    const runtime: RouterRuntime = { ...baseRuntime, ...runtimeOverrides };

    const router = new ChatNotificationRouter({
      runtime,
      logger: mockLogger,
      config,
    });

    return { router, runtime };
  };

  it("queues first-message chat and greeting as one ordered sequence", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        isFirstMessage: vi.fn<(...args: [unknown, Record<string, unknown>]) => boolean>().mockReturnValue(true),
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "test first message",
    });

    const calls = runtime.displayQueue.addItem.mock.calls.map((c) => c[0]);
    const chatItem = calls.find((c) => c.type === "chat");
    const greetingItem = calls.find((c) => c.type === "greeting");

    expect(chatItem).toBeDefined();
    expect(greetingItem).toBeDefined();
    expect(runtime.displayQueue.addSequence).toHaveBeenCalledTimes(1);
    expect(runtime.displayQueue.addSequence.mock.calls[0]?.[0].map((item) => item.type)).toEqual([
      "chat",
      "greeting",
    ]);
  });

  it("does not enqueue greeting when platform greeting disabled", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        config: {
          ...testConfig,
          general: { ...testConfig.general, greetingsEnabled: true, messagesEnabled: true },
          twitch: { ...testConfig.twitch, greetingsEnabled: false, messagesEnabled: true },
        },
        isFirstMessage: vi.fn<(...args: [unknown, Record<string, unknown>]) => boolean>().mockReturnValue(true),
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "test first",
    });

    const types = runtime.displayQueue.addItem.mock.calls.map((c) => c[0].type);
    expect(types).toContain("chat");
    expect(types).not.toContain("greeting");
  });

  it("always enqueues chat for valid messages", async () => {
    const { router, runtime } = createRouter();

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "test hello",
    });

    const queuedChat = runtime.displayQueue.addItem.mock.calls
      .map((c) => c[0])
      .find((i) => i.type === "chat");
    expect(queuedChat).toBeDefined();
  });
});
