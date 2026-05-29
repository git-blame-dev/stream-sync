import { describe, it, beforeEach, expect } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { ChatNotificationRouter } from "../../../src/services/ChatNotificationRouter.ts";

describe("ChatNotificationRouter TTS behavior", () => {
  let mockLogger: typeof noOpLogger;
  let testConfig: ReturnType<typeof createConfigFixture>;

  type RuntimeOverrides = Record<string, unknown>;
  type QueuedItem = { type?: string; data?: { message?: unknown } };

  beforeEach(() => {
    mockLogger = noOpLogger;
    testConfig = createConfigFixture();
  });

  const baseMessage = {
    message: "Test message",
    displayName: "testViewer",
    username: "testviewer",
    userId: "test-user-1",
    timestamp: new Date().toISOString(),
  };

  const createRouter = ({
    runtime: runtimeOverrides,
    config = testConfig,
  }: { runtime?: RuntimeOverrides; config?: ReturnType<typeof createConfigFixture> } = {}) => {
    const baseRuntime = {
      config: {
        general: { greetingsEnabled: true, messagesEnabled: true, maxMessageLength: 500 },
        cooldowns: { cmdCooldownMs: 0, heavyCommandCooldownMs: 0, globalCmdCooldownMs: 0 },
        farewell: { enabled: true, command: "!bye", timeout: 0 },
        twitch: { greetingsEnabled: true, messagesEnabled: true },
        tiktok: { greetingsEnabled: true, messagesEnabled: true },
      },
      displayQueue: {
        addItem: createMockFn(),
      },
      platformLifecycleService: {
        getPlatformConnectionTime: createMockFn().mockReturnValue(null),
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
    };

    const runtime = { ...baseRuntime, ...runtimeOverrides };

    const router = new ChatNotificationRouter({
      runtime,
      logger: mockLogger,
      config,
    });

    return { router, runtime };
  };

  it("enqueues chat message with expected data structure", async () => {
    const { router, runtime } = createRouter();

    await router.handleChatMessage("tiktok", {
      ...baseMessage,
      message: "test great stream",
    });

    const queuedChat = runtime.displayQueue.addItem.mock.calls
      .map((call: unknown[]) => call[0] as QueuedItem)
      .find((item: QueuedItem) => item.type === "chat");
    expect(queuedChat).toBeDefined();
    expect(queuedChat?.data?.message).toEqual({ text: "test great stream" });
  });

  it("enqueues valid chat messages", async () => {
    const { router, runtime } = createRouter();

    await router.handleChatMessage("tiktok", {
      ...baseMessage,
      message: "test cheer100",
    });

    const queuedChat = runtime.displayQueue.addItem.mock.calls
      .map((call: unknown[]) => call[0] as QueuedItem)
      .find((item: QueuedItem) => item.type === "chat");
    expect(queuedChat).toBeDefined();
  });
});
