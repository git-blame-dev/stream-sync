import type { DisplayQueueItem } from "../../../src/interfaces/DisplayQueue";
import { describe, it, beforeEach, expect } from "bun:test";
import { createMockFn, type TestMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { ChatNotificationRouter } from "../../../src/services/ChatNotificationRouter.ts";

type TestConfig = ReturnType<typeof createConfigFixture>;
type QueueItem = DisplayQueueItem;
type RouterRuntime = {
  config: TestConfig;
  displayQueue: {
    addItem: TestMockFn<[QueueItem], readonly QueueItem[]>;
    addSequence: TestMockFn<[QueueItem[]], readonly QueueItem[]>;
  };
  platformLifecycleService: { getPlatformConnectionTime: TestMockFn<[platform: string], null> };
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
    const addItem = createMockFn<[QueueItem], readonly QueueItem[]>((item) => [item]);
    const baseRuntime: RouterRuntime = {
      config: {
        ...testConfig,
        general: { ...testConfig.general, greetingsEnabled: true, messagesEnabled: true },
        twitch: { ...testConfig.twitch, greetingsEnabled: true, messagesEnabled: true },
      },
      displayQueue: {
        addItem,
        addSequence: createMockFn<[QueueItem[]], readonly QueueItem[]>((items) => {
          items.forEach((item) => addItem(item));
          return items;
        }),
      },
      platformLifecycleService: {
        getPlatformConnectionTime: createMockFn<[platform: string], null>().mockReturnValue(null),
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
        isFirstMessage: createMockFn<[unknown, Record<string, unknown>], boolean>().mockReturnValue(true),
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
        isFirstMessage: createMockFn<[unknown, Record<string, unknown>], boolean>().mockReturnValue(true),
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
