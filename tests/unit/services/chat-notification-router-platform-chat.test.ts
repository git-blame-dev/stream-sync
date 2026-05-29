import { describe, it, beforeEach, expect } from "bun:test";
import { createMockFn, type TestMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { ChatNotificationRouter } from "../../../src/services/ChatNotificationRouter.ts";
import * as testClock from "../../helpers/test-clock";

type TestConfig = ReturnType<typeof createConfigFixture>;
type RouterDependencies = ConstructorParameters<typeof ChatNotificationRouter>[0];
type Runtime = RouterDependencies["runtime"];
type Logger = RouterDependencies["logger"];
type DisplayQueueItem = Parameters<NonNullable<Runtime["displayQueue"]>["addItem"]>[0];
type TestRuntime = Runtime & {
  displayQueue: { addItem: TestMockFn<[DisplayQueueItem], void> };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getRecordProperty(value: unknown, property: string): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[property])) {
    throw new Error(`Expected ${property} to be an object`);
  }
  return value[property];
}

function findQueuedChat(runtime: TestRuntime): DisplayQueueItem | undefined {
  return runtime.displayQueue.addItem.mock.calls
    .map((call) => call[0])
    .find((item: DisplayQueueItem) => item.type === "chat");
}

function expectQueuedChat(runtime: TestRuntime): DisplayQueueItem {
  const queued = findQueuedChat(runtime);
  expect(queued).toBeDefined();
  if (!queued) {
    throw new Error("Expected queued chat item");
  }
  return queued;
}

describe("ChatNotificationRouter platform chat behavior", () => {
  let mockLogger: Logger;
  let testConfig: TestConfig;

  beforeEach(() => {
    mockLogger = noOpLogger;
    testConfig = createConfigFixture();
  });

  const baseMessage = {
    message: "Test message",
    displayName: "testViewer",
    username: "testviewer",
    userId: "test-user-1",
    timestamp: new Date(testClock.now()).toISOString(),
  };

  const createRouter = ({
    runtime: runtimeOverrides,
    config = testConfig,
  }: {
    runtime?: Pick<Partial<Runtime>, "config" | "platformLifecycleService">;
    config?: TestConfig;
  } = {}) => {
    const baseRuntime: TestRuntime = {
      config: createConfigFixture({
        general: { greetingsEnabled: true, messagesEnabled: true },
        tiktok: { greetingsEnabled: true, messagesEnabled: true },
        twitch: { greetingsEnabled: true, messagesEnabled: true },
        youtube: { greetingsEnabled: true, messagesEnabled: true },
      }),
      platformLifecycleService: {
        getPlatformConnectionTime: createMockFn().mockReturnValue(null),
      },
      displayQueue: {
        addItem: createMockFn<[DisplayQueueItem], void>(),
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
      isFirstMessage: createMockFn().mockReturnValue(false),
    };

    const runtime: TestRuntime = { ...baseRuntime, ...runtimeOverrides };

    const router = new ChatNotificationRouter({
      runtime,
      logger: mockLogger,
      config,
    });

    return { router, runtime };
  };

  it("queues chat on TikTok when enabled", async () => {
    const { router, runtime } = createRouter();
    await router.handleChatMessage("tiktok", {
      ...baseMessage,
      message: "test ni hao",
    });

    const queued = expectQueuedChat(runtime);
    expect(queued.platform).toBe("tiktok");
  });

  it("skips chat on Twitch when messages disabled for platform", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        config: createConfigFixture({
          general: { greetingsEnabled: true, messagesEnabled: true },
          twitch: { greetingsEnabled: true, messagesEnabled: false },
        }),
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "test hi",
    });

    const queued = findQueuedChat(runtime);
    expect(queued).toBeUndefined();
  });

  it("sanitizes Twitch chat payload with HTML and enqueues", async () => {
    const { router, runtime } = createRouter();
    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "<b>Test Hi</b>",
    });

    const queued = expectQueuedChat(runtime);
    expect(getRecordProperty(queued, "data").message).toEqual({ text: "Test Hi" });
  });

  it("queues chat on YouTube when enabled", async () => {
    const { router, runtime } = createRouter();

    await router.handleChatMessage("youtube", {
      ...baseMessage,
      username: "testytuser",
      message: "test hello youtube",
    });

    const queued = expectQueuedChat(runtime);
    expect(queued.platform).toBe("youtube");
    expect(getRecordProperty(queued, "data").message).toEqual({ text: "test hello youtube" });
  });

  it("preserves canonical badgeImages on queued chat rows", async () => {
    const { router, runtime } = createRouter();

    await router.handleChatMessage("youtube", {
      ...baseMessage,
      username: "testytuser",
      message: "test hello youtube",
      badgeImages: [
        {
          imageUrl: "https://example.invalid/badge-1.png",
          source: "youtube",
          label: "member",
        },
        {
          imageUrl: "https://example.invalid/badge-1.png",
          source: "youtube",
          label: "dupe",
        },
      ],
    });

    const queued = expectQueuedChat(runtime);
    expect(getRecordProperty(queued, "data").badgeImages).toEqual([
      {
        imageUrl: "https://example.invalid/badge-1.png",
        source: "youtube",
        label: "member",
      },
    ]);
  });

  it("skips chat on YouTube when messages disabled for platform", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        config: createConfigFixture({
          general: { greetingsEnabled: true, messagesEnabled: true },
          youtube: { greetingsEnabled: true, messagesEnabled: false },
        }),
      },
    });

    await router.handleChatMessage("youtube", {
      ...baseMessage,
      message: "test hello youtube",
    });

    const queued = findQueuedChat(runtime);
    expect(queued).toBeUndefined();
  });

  it("skips all platform chat when global messagesEnabled is false", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        config: createConfigFixture({
          general: { greetingsEnabled: true, messagesEnabled: false },
          tiktok: { greetingsEnabled: true, messagesEnabled: false },
          twitch: { greetingsEnabled: true, messagesEnabled: false },
          youtube: { greetingsEnabled: true, messagesEnabled: false },
        }),
      },
    });

    await router.handleChatMessage("tiktok", {
      ...baseMessage,
      message: "test blocked globally",
    });

    expect(runtime.displayQueue.addItem).not.toHaveBeenCalled();
  });

  it("skips chat messages that are only whitespace", async () => {
    const { router, runtime } = createRouter();

    await router.handleChatMessage("tiktok", {
      ...baseMessage,
      message: "   ",
    });

    expect(runtime.displayQueue.addItem).not.toHaveBeenCalled();
  });

  it("skips chat sent before platform connection time", async () => {
    const connectionTime = testClock.now();
    const { router, runtime } = createRouter({
      runtime: {
        config: createConfigFixture({
          general: {
            greetingsEnabled: true,
            messagesEnabled: true,
            filterOldMessages: true,
          },
          tiktok: { greetingsEnabled: true, messagesEnabled: true },
        }),
        platformLifecycleService: {
          getPlatformConnectionTime:
            createMockFn().mockReturnValue(connectionTime),
        },
      },
    });

    const oldTimestamp = new Date(connectionTime - 1000).toISOString();
    await router.handleChatMessage("tiktok", {
      ...baseMessage,
      message: "test late arrival",
      timestamp: oldTimestamp,
    });

    expect(runtime.displayQueue.addItem).not.toHaveBeenCalled();
  });
});
