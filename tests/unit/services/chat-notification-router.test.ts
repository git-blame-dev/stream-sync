import { type Mock, vi, describe, it, beforeEach, expect } from 'bun:test';

import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { createRecordingLogger } from "../../helpers/recording-logger";
import { ChatNotificationRouter } from "../../../src/services/ChatNotificationRouter.ts";
import type { DisplayQueueItem } from "../../../src/interfaces/DisplayQueue";
import * as testClock from "../../helpers/test-clock";

type RouterDependencies = ConstructorParameters<typeof ChatNotificationRouter>[0];
type RouterRuntime = RouterDependencies["runtime"];
type RouterConfig = RouterDependencies["config"];
type LoggerLike = RouterDependencies["logger"];
type VfxCommandServiceLike = NonNullable<RouterRuntime["vfxCommandService"]>;
type SelectVfxCommand = NonNullable<VfxCommandServiceLike["selectVFXCommand"]>;
type VfxConfig = NonNullable<
  Awaited<ReturnType<SelectVfxCommand>>
>;
type QueuedItem = DisplayQueueItem;
type AddItemMock = Mock<(...args: [QueuedItem]) => readonly QueuedItem[]>;
type AddSequenceMock = Mock<(...args: [QueuedItem[]]) => readonly QueuedItem[]>;
type TestRuntime = RouterRuntime & {
  displayQueue: { addItem: AddItemMock; addSequence: AddSequenceMock };
  commandCooldownService: NonNullable<RouterRuntime["commandCooldownService"]>;
};
type ConfigOverride = Record<string, unknown> & {
  general?: Record<string, unknown>;
  cooldowns?: Partial<RouterConfig["cooldowns"]>;
  farewell?: Partial<RouterConfig["farewell"]>;
};
type RuntimeOverrides = Omit<
  Partial<RouterRuntime>,
  "config" | "displayQueue" | "vfxCommandService"
> & {
  config?: ConfigOverride;
  displayQueue?: { addItem: AddItemMock; addSequence?: AddSequenceMock };
  vfxCommandService?: RouterRuntime["vfxCommandService"] | null;
  commandParser?: Record<string, unknown>;
};

const hasTextMessage = (value: unknown): value is { text: unknown } =>
  value !== null && typeof value === "object" && "text" in value;

const getQueuedItems = (runtime: TestRuntime): QueuedItem[] =>
  runtime.displayQueue.addItem.mock.calls.map((call) => call[0]);

describe("ChatNotificationRouter", () => {
  let mockLogger: LoggerLike & { entries?: unknown[] };
  let testConfig: ReturnType<typeof createConfigFixture>;

  beforeEach(() => {
    mockLogger = noOpLogger;
    testConfig = createConfigFixture();
  });

  const baseMessage = {
    message: "Test message",
    displayName: "testViewer",
    username: "test-user-gamma",
    userId: "test-user-1",
    timestamp: new Date(testClock.now()).toISOString(),
  };

  const createRouter = ({
    runtime: runtimeOverrides,
    config = testConfig,
    publishChatMessage,
  }: {
    runtime?: RuntimeOverrides;
    config?: RouterConfig;
    publishChatMessage?: RouterDependencies["publishChatMessage"];
  } = {}) => {
    const baseConfig = {
        general: {
          maxMessageLength: 500,
          messagesEnabled: true,
          greetingsEnabled: true,
        },
        cooldowns: {
          cmdCooldownMs: 60000,
          heavyCommandCooldownMs: 300000,
          globalCmdCooldownMs: 45000,
        },
        farewell: {
          timeout: 300,
        },
        twitch: {
          greetingsEnabled: true,
          messagesEnabled: true,
          farewellsEnabled: true,
        },
        tiktok: {
          greetingsEnabled: true,
          messagesEnabled: true,
          farewellsEnabled: true,
        },
      };
    let runtime: TestRuntime;
    const addItem = vi.fn<(...args: [QueuedItem]) => readonly QueuedItem[]>((item) => [item]);
    const addSequence = vi.fn<(...args: [QueuedItem[]]) => readonly QueuedItem[]>((items) => {
      items.forEach((item) => addItem(item));
      return items;
    });
    const baseRuntime = {
      config: baseConfig,
      platformLifecycleService: {
        getPlatformConnectionTime: vi.fn<(...args: [string]) => number | null>().mockReturnValue(null),
      },
      displayQueue: {
        addItem,
        addSequence,
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
      vfxCommandService: {
        selectVFXCommand: vi.fn<(...args: [string, string]) => Promise<VfxConfig | null>>().mockResolvedValue(null),
        matchFarewell: vi.fn<(...args: [string, string]) => unknown>().mockReturnValue(null),
        getVFXConfig: vi.fn<(...args: [string, string | null]) => Promise<VfxConfig | null>>().mockResolvedValue(null),
      },
      prepareFarewellNotification: async (
        platform: string,
        username: string | undefined,
        options: Record<string, unknown>,
      ) => {
        return {
          success: true,
          item: {
            type: "farewell",
            platform,
            data: {
              username,
              command: options.command,
              displayMessage: `Goodbye, ${username}!`,
            },
          },
        };
      },
      isFirstMessage: vi.fn<(...args: [unknown, Record<string, unknown>]) => boolean>().mockReturnValue(false),
    };

    runtime = baseRuntime;
    Object.assign(runtime, runtimeOverrides);
    if (!runtime.displayQueue.addSequence) {
      runtime.displayQueue.addSequence = vi.fn<(...args: [QueuedItem[]]) => readonly QueuedItem[]>((items) => {
        items.forEach((item) => runtime.displayQueue.addItem(item));
        return items;
      });
    }
    runtime.config = {
      ...baseRuntime.config,
      ...runtimeOverrides?.config,
      general: {
        ...baseRuntime.config.general,
        ...runtimeOverrides?.config?.general,
      },
      cooldowns: {
        ...baseRuntime.config.cooldowns,
        ...runtimeOverrides?.config?.cooldowns,
      },
      farewell: {
        ...baseRuntime.config.farewell,
        ...runtimeOverrides?.config?.farewell,
      },
    };

    const router = new ChatNotificationRouter({
      runtime,
      logger: mockLogger,
      config,
      ...(publishChatMessage ? { publishChatMessage } : {}),
    });

    return { router, runtime };
  };

  it("queues chat messages with correct type and platform", async () => {
    const { router, runtime } = createRouter();

    await router.handleChatMessage("twitch", { ...baseMessage });

    expect(runtime.displayQueue.addItem).toHaveBeenCalledTimes(1);
    const queuedItem = getQueuedItems(runtime)[0];
    expect(queuedItem?.type).toBe("chat");
    expect(queuedItem?.platform).toBe("twitch");
  });

  it("publishes eligible normalized chat without display sanitization", async () => {
    const published: Array<[string, Record<string, unknown>]> = [];
    const { router } = createRouter({
      publishChatMessage: (platform, payload) => {
        published.push([platform, payload]);
      },
    });
    const message = "<b>a</b>\u200b";

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: { text: message },
    });

    expect(published).toHaveLength(1);
    expect(published[0]?.[0]).toBe("twitch");
    expect(published[0]?.[1].message).toEqual({ text: message });
  });

  it("does not publish messages filtered as older than the connection", async () => {
    const published: Array<[string, Record<string, unknown>]> = [];
    const { router } = createRouter({
      runtime: {
        config: { general: { filterOldMessages: true } },
        platformLifecycleService: {
          getPlatformConnectionTime: vi.fn<(...args: [string]) => number | null>()
            .mockReturnValue(testClock.now()),
        },
      },
      publishChatMessage: (platform, payload) => {
        published.push([platform, payload]);
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      timestamp: new Date(testClock.now() - 1).toISOString(),
    });

    expect(published).toHaveLength(0);
  });

  it("keeps private chat content in display rows without diagnostic payloads", async () => {
    mockLogger = createRecordingLogger();
    const { router, runtime } = createRouter();

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "test-private-router-message",
    });

    const queuedItem = getQueuedItems(runtime)[0];
    const serializedLogs = JSON.stringify(mockLogger.entries);
    const queuedMessage = queuedItem?.data?.message;
    expect(hasTextMessage(queuedMessage)).toBe(true);
    if (!hasTextMessage(queuedMessage)) {
      throw new Error("Expected queued chat row to contain a text message object");
    }
    expect(queuedMessage.text).toBe("test-private-router-message");
    expect(serializedLogs).not.toContain("test-private-router-message");
  });

  it("preserves timestamp on queued chat rows", async () => {
    const { router, runtime } = createRouter();

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      timestamp: "2026-01-02T03:04:05.000Z",
    });

    const queuedItem = getQueuedItems(runtime)[0];
    expect(queuedItem?.data?.timestamp).toBe("2026-01-02T03:04:05.000Z");
  });

  it("preserves canonical avatarUrl on queued chat rows", async () => {
    const { router, runtime } = createRouter();

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      avatarUrl: "https://example.invalid/chat-avatar.png",
    });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0],
    );
    const chatItem = queuedItems.find((item) => item.type === "chat");

    expect(chatItem).toBeDefined();
    expect(chatItem?.data?.avatarUrl).toBe(
      "https://example.invalid/chat-avatar.png",
    );
  });

  it("preserves isPaypiggy on queued chat rows", async () => {
    const { router, runtime } = createRouter();

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      isPaypiggy: true,
    });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0],
    );
    const chatItem = queuedItems.find((item) => item.type === "chat");

    expect(chatItem).toBeDefined();
    expect(chatItem?.data?.isPaypiggy).toBe(true);
  });

  it("preserves stream supporter state independently from membership", async () => {
    const { router, runtime } = createRouter();

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      isPaypiggy: false,
      isStreamSupporter: true,
    });

    const chatItem = getQueuedItems(runtime).find((item) => item.type === "chat");
    expect(chatItem?.data.isPaypiggy).toBe(false);
    expect(chatItem?.data.isStreamSupporter).toBe(true);
  });

  it("applies presentation only to an exactly-owned member profile", () => {
    const { router } = createRouter({
      runtime: {
        config: {
          profiles: {
            synthetic: { id: "synthetic", identities: ["youtube:test-user"], greetingCommand: "!greeting", spriteUrl: "https://example.invalid/member.gif", rowTheme: "red", rowEffects: ["sheen"] },
          },
        },
      },
    });

    const item = router.buildChatMessageItem("youtube", { ...baseMessage, username: "test-user", isPaypiggy: true }, "hello", [], router.resolveProfile("youtube", "test-user"));
    expect(item.data.presentationOverride).toEqual({ theme: "red", effects: ["sheen"], spriteUrl: "https://example.invalid/member.gif" });

    const nonMember = router.buildChatMessageItem(
      "youtube",
      { ...baseMessage, isPaypiggy: false },
      "hello",
    );
    expect(nonMember.data.presentationOverride).toBeUndefined();
  });

  it("attaches the resolved member sprite only to paypiggy chat rows", async () => {
    const { router, runtime } = createRouter();
    runtime.config.profiles = { profile: { id: "profile", identities: ["twitch:test-user-gamma"], greetingCommand: "!water", spriteUrl: "https://cdn.example/sprite.png" } };
    await router.handleChatMessage("twitch", {
      ...baseMessage,
      isPaypiggy: true,
    });

    const paypiggy = getQueuedItems(runtime).find((item) => item.type === "chat");
    expect(paypiggy?.data.presentationOverride).toEqual({ spriteUrl: "https://cdn.example/sprite.png" });
    const direct = router.buildChatMessageItem(
      "twitch",
      { ...baseMessage, isPaypiggy: false },
      "hello",
    );
    expect(direct.data.presentationOverride).toBeUndefined();
  });

  it("attaches the resolved member theme only to paypiggy chat rows", async () => {
    const { router, runtime } = createRouter();
    runtime.config.profiles = { profile: { id: "profile", identities: ["twitch:test-user-gamma"], greetingCommand: "!water", rowTheme: "red" } };
    await router.handleChatMessage("twitch", {
      ...baseMessage,
      isPaypiggy: true,
    });

    const paypiggy = getQueuedItems(runtime).find((item) => item.type === "chat");
    expect(paypiggy?.data.presentationOverride).toEqual({ theme: "red" });
    const direct = router.buildChatMessageItem(
      "twitch",
      { ...baseMessage, isPaypiggy: false },
      "hello",
      [],
      { id: "profile", identities: [], greetingCommand: "!water", rowTheme: "red" },
    );
    expect(direct.data.presentationOverride).toBeUndefined();
  });

  it("resolves member profiles with normalized platform casing", () => {
    const { router, runtime } = createRouter();
    runtime.config.profiles = { profile: { id: "profile", identities: ["youtube:test-user"], greetingCommand: "!water", spriteUrl: "https://cdn.example/sprite.png" } };

    expect(router.resolveProfile("  YouTube  ", "@@Test-User")).toEqual(
      expect.objectContaining({ id: "profile" }),
    );
  });

  it("queues greeting before command for first-time command messages", async () => {
    const commandConfig = { command: "!testboom" };
    const { router, runtime } = createRouter({
      runtime: {
        isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<typeof commandConfig>>().mockResolvedValue(commandConfig),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", { ...baseMessage });

    const calls = runtime.displayQueue.addItem.mock.calls.map((c) => c[0].type);
    expect(calls).toContain("greeting");
    expect(calls).toContain("command");
  });

  it("includes userId on queued greeting items for first-time messages", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
      },
    });

    await router.handleChatMessage("twitch", { ...baseMessage });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (c) => c[0],
    );
    const greetingItem = queuedItems.find((item) => item.type === "greeting");

    expect(greetingItem).toBeDefined();
    expect(greetingItem?.data?.userId).toBe(baseMessage.userId);
  });

  it("propagates avatarUrl on queued greeting items for first-time messages", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      avatarUrl: "https://example.invalid/greeting-avatar.png",
    });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0],
    );
    const greetingItem = queuedItems.find((item) => item.type === "greeting");

    expect(greetingItem).toBeDefined();
    expect(greetingItem?.data?.avatarUrl).toBe(
      "https://example.invalid/greeting-avatar.png",
    );
  });

  it("does not queue greeting when platform greetingsEnabled is false", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        config: {
          general: { greetingsEnabled: true, messagesEnabled: true },
          twitch: { greetingsEnabled: false, messagesEnabled: true },
        },
        isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
      },
    });

    await router.handleChatMessage("twitch", { ...baseMessage });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (c) => c[0],
    );
    const greetingItem = queuedItems.find((item) => item.type === "greeting");
    const chatItem = queuedItems.find((item) => item.type === "chat");

    expect(chatItem).toBeDefined();
    expect(greetingItem).toBeUndefined();
  });

  it("queues greeting when messages are disabled but greetings are enabled", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        config: {
          general: { greetingsEnabled: true, messagesEnabled: false },
          cooldowns: {
            cmdCooldownMs: 60000,
            heavyCommandCooldownMs: 300000,
            globalCmdCooldownMs: 45000,
          },
          twitch: {
            greetingsEnabled: true,
            messagesEnabled: false,
            farewellsEnabled: true,
          },
        },
        isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "hello everyone",
    });

    const queuedTypes = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0].type,
    );
    expect(queuedTypes).toContain("greeting");
    expect(queuedTypes).not.toContain("chat");
  });

  it("queues command when cooldowns pass", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({
            command: "!testboom",
          }),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", { ...baseMessage });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (c) => c[0],
    );
    const commandItem = queuedItems.find((item) => item.type === "command");
    expect(commandItem).toBeDefined();
    expect(commandItem?.vfxConfig?.command).toBe("!testboom");
  });

  it("queues command-triggering chat and command as one ordered sequence", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({ command: "!testboom" }),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!testboom now",
    });

    expect(runtime.displayQueue.addSequence).toHaveBeenCalledTimes(1);
    expect(runtime.displayQueue.addSequence.mock.calls[0]?.[0].map((item) => item.type)).toEqual([
      "chat",
      "command",
    ]);
  });

  it("uses the same source-first sequence for keyword command matches", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({ command: "!testboom" }),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "that keyword was explosive",
    });

    expect(runtime.displayQueue.addSequence.mock.calls[0]?.[0].map((item) => item.type)).toEqual([
      "chat",
      "command",
    ]);
  });

  it("queues command without source chat when messages are disabled", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        config: {
          twitch: {
            greetingsEnabled: false,
            messagesEnabled: false,
            farewellsEnabled: true,
          },
        },
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({ command: "!testboom" }),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!testboom now",
    });

    expect(runtime.displayQueue.addSequence).not.toHaveBeenCalled();
    expect(getQueuedItems(runtime).map((item) => item.type)).toEqual(["command"]);
  });

  it("keeps notification-only greeting and command sequences on normal pacing", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        config: {
          twitch: {
            greetingsEnabled: true,
            messagesEnabled: false,
            farewellsEnabled: true,
          },
        },
        isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({ command: "!testboom" }),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!testboom now",
    });

    expect(runtime.displayQueue.addSequence.mock.calls[0]?.[0].map((item) => item.type)).toEqual([
      "greeting",
      "command",
    ]);
  });

  it("queues only chat and preserves cooldown state when a command is blocked", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        commandCooldownService: {
          checkUserCooldown: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(false),
          checkGlobalCooldown: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
          updateUserCooldown: vi.fn<(userId: unknown) => void>(),
          updateGlobalCooldown: vi.fn<(commandName: string) => void>(),
        },
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({ command: "!testboom" }),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!testboom now",
    });

    expect(runtime.displayQueue.addSequence).not.toHaveBeenCalled();
    expect(getQueuedItems(runtime).map((item) => item.type)).toEqual(["chat"]);
    expect(runtime.commandCooldownService.updateUserCooldown).not.toHaveBeenCalled();
    expect(runtime.commandCooldownService.updateGlobalCooldown).not.toHaveBeenCalled();
  });

  it("falls back to chat without consuming state when sequence admission fails", async () => {
    const addItem = vi.fn<(...args: [QueuedItem]) => readonly QueuedItem[]>((item) => [item]);
    const addSequence = vi.fn<(...args: [QueuedItem[]]) => readonly QueuedItem[]>(() => {
      throw new Error("sequence admission failed");
    });
    const markMessageSeen = vi.fn<(...args: unknown[]) => unknown>();
    const { router, runtime } = createRouter({
      runtime: {
        displayQueue: { addItem, addSequence },
        userTrackingService: {
          hasSeenUser: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(false),
          markMessageSeen,
          isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        },
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({ command: "!testboom" }),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!testboom now",
    });

    expect(addSequence).toHaveBeenCalledTimes(1);
    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem.mock.calls[0]?.[0].type).toBe("chat");
    expect(markMessageSeen).not.toHaveBeenCalled();
    expect(runtime.commandCooldownService.updateUserCooldown).not.toHaveBeenCalled();
    expect(runtime.commandCooldownService.updateGlobalCooldown).not.toHaveBeenCalled();
  });

  it("does not duplicate admitted chat when post-admission state updates fail", async () => {
    const addItem = vi.fn<(...args: [QueuedItem]) => readonly QueuedItem[]>((item) => [item]);
    const addSequence = vi.fn<(...args: [QueuedItem[]]) => readonly QueuedItem[]>((items) => items);
    const { router, runtime } = createRouter({
      runtime: {
        displayQueue: { addItem, addSequence },
        commandCooldownService: {
          checkUserCooldown: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
          checkGlobalCooldown: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
          updateUserCooldown: vi.fn(() => {
            throw new Error("state update failed");
          }),
          updateGlobalCooldown: vi.fn<(commandName: string) => void>(),
        },
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({ command: "!testboom" }),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!testboom now",
    });

    expect(addSequence).toHaveBeenCalledTimes(1);
    expect(addItem).not.toHaveBeenCalled();
    expect(runtime.commandCooldownService.updateGlobalCooldown).toHaveBeenCalledTimes(1);
  });

  it("propagates avatarUrl on queued command notifications", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({
            command: "!testboom",
          }),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!testboom now",
      avatarUrl: "https://example.invalid/command-avatar.png",
    });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0],
    );
    const commandItem = queuedItems.find((item) => item.type === "command");

    expect(commandItem).toBeDefined();
    expect(commandItem?.data?.avatarUrl).toBe(
      "https://example.invalid/command-avatar.png",
    );
  });

  it("does not consume cooldowns when command enqueue fails", async () => {
    const addItem = vi.fn<(...args: [QueuedItem]) => readonly QueuedItem[]>((item) => {
      if (item.type === "command") {
        throw new Error("queue failed");
      }
      return [item];
    });
    const { router, runtime } = createRouter({
      runtime: {
        displayQueue: { addItem },
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({
            command: "!testboom",
          }),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", { ...baseMessage });

    expect(
      runtime.commandCooldownService.updateUserCooldown,
    ).not.toHaveBeenCalled();
    expect(
      runtime.commandCooldownService.updateGlobalCooldown,
    ).not.toHaveBeenCalled();
  });

it("marks first-message state only after greeting enqueue succeeds", async () => {
    const hasSeenUser = vi.fn<(...args: [unknown, Record<string, unknown>]) => boolean>().mockReturnValue(false);
    const markMessageSeen = vi.fn<(...args: unknown[]) => unknown>();
    const { router, runtime } = createRouter({
      runtime: {
        userTrackingService: {
          hasSeenUser,
          markMessageSeen,
          isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        },
        isFirstMessage: vi.fn<(...args: [unknown, Record<string, unknown>]) => boolean>().mockImplementation(() => {
          throw new Error("runtime first-message fallback should not be used");
        }),
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "hello there",
    });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0],
    );
  const greetingItem = queuedItems.find((item) => item.type === "greeting");
  expect(greetingItem).toBeDefined();
  expect(markMessageSeen).toHaveBeenCalledTimes(1);
  const [seenUserId, seenContext] = markMessageSeen.mock.calls[0] || [];
  expect(seenUserId).toBe("test-user-1");
  expect(seenContext).toEqual(
    expect.objectContaining({
      platform: "twitch",
      username: "test-user-gamma",
    }),
  );
});

  it("does not consume first-message state when command enqueue fails", async () => {
    const hasSeenUser = vi.fn<(...args: [unknown, Record<string, unknown>]) => boolean>().mockReturnValue(false);
    const markMessageSeen = vi.fn<(...args: unknown[]) => unknown>();
    const addItem = vi.fn<(...args: [QueuedItem]) => readonly QueuedItem[]>((item) => {
      if (item.type === "command") {
        throw new Error("command enqueue failed");
      }
      return [item];
    });
    const { router } = createRouter({
      runtime: {
        displayQueue: { addItem },
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({
            command: "!testboom",
          }),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
        config: {
          general: { greetingsEnabled: false, messagesEnabled: true },
          cooldowns: {
            cmdCooldownMs: 60000,
            heavyCommandCooldownMs: 300000,
            globalCmdCooldownMs: 45000,
          },
          twitch: {
            greetingsEnabled: false,
            messagesEnabled: true,
            farewellsEnabled: true,
          },
        },
        userTrackingService: {
          hasSeenUser,
          markMessageSeen,
          isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        },
        isFirstMessage: vi.fn<(...args: [unknown, Record<string, unknown>]) => boolean>().mockImplementation(() => {
          throw new Error("runtime first-message fallback should not be used");
        }),
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!testboom now",
    });

    expect(markMessageSeen).not.toHaveBeenCalled();
  });

  it("does not skip chat when timestamp is invalid even if connection time exists", async () => {
    const connectionTime = testClock.now();
    const { router, runtime } = createRouter({
      runtime: {
        platformLifecycleService: {
          getPlatformConnectionTime:
            vi.fn<(...args: unknown[]) => typeof connectionTime>().mockReturnValue(connectionTime),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      timestamp: "invalid-timestamp",
    });

    expect(runtime.displayQueue.addItem).toHaveBeenCalled();
  });

  it("includes VFX data in greeting when vfxCommandService returns VFX config", async () => {
    const greetingVfx = {
      command: "!testgreeting",
      commandKey: "greetings",
      filename: "greeting.mp4",
      mediaSource: "local",
      vfxFilePath: "/vfx/greeting.mp4",
      duration: 5000,
    };
    const { router, runtime } = createRouter({
      runtime: {
        isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        vfxCommandService: {
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<typeof greetingVfx>>().mockResolvedValue(greetingVfx),
        },
      },
    });

    await router.handleChatMessage("twitch", { ...baseMessage });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (c) => c[0],
    );
    const greetingItem = queuedItems.find((item) => item.type === "greeting");
    expect(greetingItem).toBeDefined();
    expect(greetingItem?.vfxConfig?.command).toBe("!testgreeting");
  });

  it("includes secondary VFX config in greeting for mapped greeting profile", async () => {
    const greetingVfx = {
      command: "!hello",
      commandKey: "greetings",
      filename: "hello.mp4",
      mediaSource: "vfx top",
      vfxFilePath: "/vfx",
      duration: 5000,
    };
    const secondaryVfx = {
      command: "!bye",
      commandKey: "bye",
      filename: "bye.mp4",
      mediaSource: "vfx bottom green",
      vfxFilePath: "/vfx",
      duration: 5000,
    };

    const { router, runtime } = createRouter({
      runtime: {
        config: {
          ...testConfig,
          general: {
            ...testConfig.general,
            logChatMessages: false,
          },
          twitch: {
            greetingsEnabled: true,
            messagesEnabled: true,
            farewellsEnabled: true,
          },
          greetings: { command: "!hello" },
          profiles: { main: { id: "main", identities: ["twitch:test-user-gamma"], greetingCommand: "!bye" } },
        },
        isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        vfxCommandService: {
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<typeof greetingVfx>>().mockResolvedValue(greetingVfx),
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<typeof secondaryVfx>>().mockResolvedValue(secondaryVfx),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      username: "test-user-gamma",
    });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (c) => c[0],
    );
    const greetingItem = queuedItems.find((item) => item.type === "greeting");
    expect(greetingItem).toBeDefined();
    expect(greetingItem?.secondaryVfxConfig).toEqual(
      expect.objectContaining({
        command: "!bye",
        commandKey: "bye",
      }),
    );
  });

  it("matches youtube greeting profile keys with mixed-case and leading-@ identity input", async () => {
    const greetingVfx = {
      command: "!hello",
      commandKey: "greetings",
      filename: "hello.mp4",
      mediaSource: "vfx top",
      vfxFilePath: "/vfx",
      duration: 5000,
    };
    const secondaryVfx = {
      command: "!bye",
      commandKey: "bye",
      filename: "bye.mp4",
      mediaSource: "vfx bottom green",
      vfxFilePath: "/vfx",
      duration: 5000,
    };

    const { router, runtime } = createRouter({
      runtime: {
        config: {
          ...testConfig,
          general: {
            ...testConfig.general,
            logChatMessages: false,
          },
          youtube: {
            greetingsEnabled: true,
            messagesEnabled: true,
            farewellsEnabled: true,
          },
          greetings: { command: "!hello" },
          profiles: { main: { id: "main", identities: ["youtube:test-user-yt-gamma"], greetingCommand: "!bye" } },
        },
        isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        vfxCommandService: {
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<typeof greetingVfx>>().mockResolvedValue(greetingVfx),
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<typeof secondaryVfx>>().mockResolvedValue(secondaryVfx),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
        },
      },
    });

    await router.handleChatMessage("youtube", {
      ...baseMessage,
      username: "@TeSt-UsEr-Yt-GaMmA",
    });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0],
    );
    const greetingItem = queuedItems.find((item) => item.type === "greeting");
    expect(greetingItem).toBeDefined();
    expect(greetingItem?.secondaryVfxConfig).toEqual(
      expect.objectContaining({
        command: "!bye",
        commandKey: "bye",
      }),
    );
  });

  it("matches tiktok greeting profiles by userId identity value rather than nickname", async () => {
    const greetingVfx = {
      command: "!hello",
      commandKey: "greetings",
      filename: "hello.mp4",
      mediaSource: "vfx top",
      vfxFilePath: "/vfx",
      duration: 5000,
    };
    const secondaryVfx = {
      command: "!bye",
      commandKey: "bye",
      filename: "bye.mp4",
      mediaSource: "vfx bottom green",
      vfxFilePath: "/vfx",
      duration: 5000,
    };

    const { router, runtime } = createRouter({
      runtime: {
        config: {
          ...testConfig,
          general: {
            ...testConfig.general,
            logChatMessages: false,
          },
          tiktok: {
            greetingsEnabled: true,
            messagesEnabled: true,
            farewellsEnabled: true,
          },
          greetings: { command: "!hello" },
          profiles: { main: { id: "main", identities: ["tiktok:test-unique-id-alpha"], greetingCommand: "!bye" } },
        },
        isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        vfxCommandService: {
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<typeof greetingVfx>>().mockResolvedValue(greetingVfx),
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<typeof secondaryVfx>>().mockResolvedValue(secondaryVfx),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
        },
      },
    });

    await router.handleChatMessage("tiktok", {
      ...baseMessage,
      userId: "TeSt-Unique-Id-Alpha",
      username: "DifferentNicknameShouldNotKeyMatch",
    });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0],
    );
    const greetingItem = queuedItems.find((item) => item.type === "greeting");
    expect(greetingItem).toBeDefined();
    expect(greetingItem?.secondaryVfxConfig).toEqual(
      expect.objectContaining({
        command: "!bye",
        commandKey: "bye",
      }),
    );
  });

  it("greets mapped profile only once across platforms", async () => {
    const trackedFirstMessageKeys = new Set<unknown>();
    const { router, runtime } = createRouter({
      runtime: {
        config: {
          ...testConfig,
          general: {
            ...testConfig.general,
            logChatMessages: false,
          },
          twitch: {
            greetingsEnabled: true,
            messagesEnabled: true,
            farewellsEnabled: true,
          },
          tiktok: {
            greetingsEnabled: true,
            messagesEnabled: true,
            farewellsEnabled: true,
          },
          greetings: { command: "!hello" },
          profiles: { main: { id: "main", identities: ["twitch:test-user-alpha", "tiktok:test-user-beta"], greetingCommand: "!bye" } },
        },
        isFirstMessage: vi.fn<(...args: [unknown, Record<string, unknown>]) => boolean>().mockImplementation((trackingKey) => {
          if (trackedFirstMessageKeys.has(trackingKey)) {
            return false;
          }
          trackedFirstMessageKeys.add(trackingKey);
          return true;
        }),
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      username: "test-user-alpha",
      userId: "tw-user-1",
    });
    await router.handleChatMessage("tiktok", {
      ...baseMessage,
      username: "test-user-beta",
      userId: "test-user-beta",
    });

    const greetingRows = runtime.displayQueue.addItem.mock.calls
      .map((call) => call[0])
      .filter((item) => item.type === "greeting");

    expect(greetingRows.length).toBe(1);
  });

  it("queues greeting before command for mapped first-time command message", async () => {
    const greetingVfx = {
      command: "!hello",
      commandKey: "greetings",
      filename: "hello.mp4",
      mediaSource: "vfx top",
      vfxFilePath: "/vfx",
      duration: 5000,
    };
    const secondaryVfx = {
      command: "!bye",
      commandKey: "bye",
      filename: "bye.mp4",
      mediaSource: "vfx bottom green",
      vfxFilePath: "/vfx",
      duration: 5000,
    };
    const commandVfx = { command: "!testboom" };
    const { router, runtime } = createRouter({
      runtime: {
        config: {
          ...testConfig,
          general: {
            ...testConfig.general,
            logChatMessages: false,
          },
          twitch: {
            greetingsEnabled: true,
            messagesEnabled: true,
            farewellsEnabled: true,
          },
          greetings: { command: "!hello" },
          profiles: { main: { id: "main", identities: ["twitch:test-user-gamma"], greetingCommand: "!bye" } },
        },
        isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        vfxCommandService: {
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<typeof greetingVfx>>().mockResolvedValue(greetingVfx),
          selectVFXCommand: vi.fn((trigger) => {
            if (trigger === "!bye") {
              return Promise.resolve(secondaryVfx);
            }
            return Promise.resolve(commandVfx);
          }),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!testboom hello",
      username: "test-user-gamma",
    });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (c) => c[0],
    );
    const queuedTypes = queuedItems.map((item) => item.type);
    expect(queuedTypes[0]).toBe("chat");
    expect(queuedTypes[1]).toBe("greeting");
    expect(queuedTypes[2]).toBe("command");
    expect(queuedItems[1]?.secondaryVfxConfig).toEqual(
      expect.objectContaining({ command: "!bye" }),
    );
    expect(runtime.displayQueue.addSequence).toHaveBeenCalledTimes(1);
    expect(runtime.displayQueue.addSequence.mock.calls[0]?.[0].map((item) => item.type)).toEqual([
      "chat",
      "greeting",
      "command",
    ]);
    expect(runtime.displayQueue.addSequence.mock.calls[0]?.[0][1]?.priority).toBeUndefined();
  });

  it("routes farewell messages into a user-visible farewell row", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
          matchFarewell: vi.fn<(...args: unknown[]) => string>().mockReturnValue("!bye"),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!bye everyone",
    });

    const queuedTypes = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0].type,
    );
    expect(queuedTypes).toContain("chat");
    expect(queuedTypes).toContain("farewell");
    expect(runtime.displayQueue.addSequence.mock.calls[0]?.[0].map((item) => item.type)).toEqual([
      "chat",
      "farewell",
    ]);
  });

  it("propagates avatarUrl to farewell notification payload options", async () => {
    const addItem = vi.fn<(...args: [QueuedItem]) => readonly QueuedItem[]>((item) => [item]);
    const { router, runtime } = createRouter({
      runtime: {
        displayQueue: { addItem },
        prepareFarewellNotification: vi.fn(
          async (
            platform: string,
            username: string | undefined,
            options: Record<string, unknown>,
          ) => {
            return {
              success: true,
              item: {
                type: "farewell",
                platform,
                data: {
                  username,
                  avatarUrl: options.avatarUrl,
                  command: options.command,
                },
              },
            };
          },
        ),
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
          matchFarewell: vi.fn<(...args: unknown[]) => string>().mockReturnValue("!bye"),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!bye everyone",
      avatarUrl: "https://example.invalid/farewell-avatar.png",
    });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0],
    );
    const farewellItem = queuedItems.find((item) => item.type === "farewell");

    expect(farewellItem).toBeDefined();
    expect(farewellItem?.data?.avatarUrl).toBe(
      "https://example.invalid/farewell-avatar.png",
    );
  });

  it("does not route commands when only runtime command parser is available", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        vfxCommandService: null,
        commandParser: {
          getVFXConfig: vi.fn<(...args: unknown[]) => { command: string; }>().mockReturnValue({
            command: "!testboom",
          }),
          getMatchingFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!testboom now",
    });

    const queuedTypes = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0].type,
    );
    expect(queuedTypes).toContain("chat");
    expect(queuedTypes).not.toContain("command");
  });

  it("does not emit farewell rows when farewells are disabled for platform", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        config: {
          general: { greetingsEnabled: true, messagesEnabled: true },
          cooldowns: {
            cmdCooldownMs: 60000,
            heavyCommandCooldownMs: 300000,
            globalCmdCooldownMs: 45000,
          },
          twitch: {
            greetingsEnabled: true,
            messagesEnabled: true,
            farewellsEnabled: false,
          },
        },
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
          matchFarewell: vi.fn<(...args: unknown[]) => string>().mockReturnValue("!bye"),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!bye everyone",
    });

    const queuedTypes = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0].type,
    );
    expect(queuedTypes).toContain("chat");
    expect(queuedTypes).not.toContain("farewell");
  });

  it("continues command routing when farewell is matched but disabled", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        config: {
          general: { greetingsEnabled: true, messagesEnabled: true },
          cooldowns: {
            cmdCooldownMs: 60000,
            heavyCommandCooldownMs: 300000,
            globalCmdCooldownMs: 45000,
          },
          twitch: {
            greetingsEnabled: true,
            messagesEnabled: true,
            farewellsEnabled: false,
          },
        },
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({
            command: "!testboom",
          }),
          matchFarewell: vi.fn<(...args: unknown[]) => string>().mockReturnValue("!bye"),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!bye everyone",
    });

    const queuedTypes = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0].type,
    );
    expect(queuedTypes).toContain("chat");
    expect(queuedTypes).not.toContain("farewell");
    expect(queuedTypes).toContain("command");
  });

  it("emits a single farewell row when farewell and command logic overlap", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        isFirstMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({
            command: "!testboom",
          }),
          matchFarewell: vi.fn<(...args: unknown[]) => string>().mockReturnValue("!bye"),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!bye and !testboom",
    });

    const queuedTypes = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0].type,
    );
    const farewellCount = queuedTypes.filter(
      (type) => type === "farewell",
    ).length;
    expect(farewellCount).toBe(1);
    expect(queuedTypes).not.toContain("command");
    expect(queuedTypes).not.toContain("greeting");
  });

  it("continues command routing when farewell notification reports failure", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        prepareFarewellNotification: vi.fn<(...args: unknown[]) => Promise<{ success: false; error: string; }>>().mockResolvedValue({
          success: false,
          error: "Notifications disabled",
        }),
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({
            command: "!testboom",
          }),
          matchFarewell: vi.fn<(...args: unknown[]) => string>().mockReturnValue("!bye"),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!bye everyone",
    });

    const queuedTypes = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0].type,
    );
    expect(queuedTypes).toContain("chat");
    expect(queuedTypes).toContain("command");
    expect(queuedTypes).not.toContain("farewell");
  });

  it("suppresses repeated farewell triggers on the same platform within timeout", async () => {
    const activeCooldowns = new Set<string>();
    const { router, runtime } = createRouter({
      runtime: {
        config: {
          general: { greetingsEnabled: true, messagesEnabled: true },
          cooldowns: {
            cmdCooldownMs: 60000,
            heavyCommandCooldownMs: 300000,
            globalCmdCooldownMs: 45000,
          },
          farewell: {
            timeout: 300,
          },
          twitch: {
            greetingsEnabled: true,
            messagesEnabled: true,
            farewellsEnabled: true,
          },
        },
        commandCooldownService: {
          checkUserCooldown: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
          checkGlobalCooldown: vi.fn<(...args: [string, number]) => boolean>().mockImplementation(
            (key) => !activeCooldowns.has(key),
          ),
          updateUserCooldown: vi.fn<(userId: unknown) => void>(),
          updateGlobalCooldown: vi.fn<(...args: [string]) => void>().mockImplementation((key) => {
            activeCooldowns.add(key);
          }),
        },
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({
            command: "!testboom",
          }),
          matchFarewell: vi.fn<(...args: unknown[]) => string>().mockReturnValue("!bye"),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!bye now",
    });
    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!bye again",
    });

    const queuedTypes = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0].type,
    );
    const farewellCount = queuedTypes.filter(
      (type) => type === "farewell",
    ).length;
    expect(farewellCount).toBe(1);
  });

  it("allows farewell triggers independently per platform within timeout window", async () => {
    const activeCooldowns = new Set<string>();
    const { router, runtime } = createRouter({
      runtime: {
        config: {
          general: { greetingsEnabled: true, messagesEnabled: true },
          cooldowns: {
            cmdCooldownMs: 60000,
            heavyCommandCooldownMs: 300000,
            globalCmdCooldownMs: 45000,
          },
          farewell: {
            timeout: 300,
          },
          twitch: {
            greetingsEnabled: true,
            messagesEnabled: true,
            farewellsEnabled: true,
          },
          tiktok: {
            greetingsEnabled: true,
            messagesEnabled: true,
            farewellsEnabled: true,
          },
        },
        commandCooldownService: {
          checkUserCooldown: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
          checkGlobalCooldown: vi.fn<(...args: [string, number]) => boolean>().mockImplementation(
            (key) => !activeCooldowns.has(key),
          ),
          updateUserCooldown: vi.fn<(userId: unknown) => void>(),
          updateGlobalCooldown: vi.fn<(...args: [string]) => void>().mockImplementation((key) => {
            activeCooldowns.add(key);
          }),
        },
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({
            command: "!testboom",
          }),
          matchFarewell: vi.fn<(...args: unknown[]) => string>().mockReturnValue("!bye"),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!bye twitch",
    });
    await router.handleChatMessage("tiktok", {
      ...baseMessage,
      message: "!bye tiktok",
    });

    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0],
    );
    const farewellPlatforms = queuedItems
      .filter((item) => item.type === "farewell")
      .map((item) => item.platform);
    expect(farewellPlatforms).toContain("twitch");
    expect(farewellPlatforms).toContain("tiktok");
  });

  it("treats cooldown-suppressed farewell as handled and does not fall through to commands", async () => {
    const activeCooldowns = new Set(["farewell:twitch"]);
    const { router, runtime } = createRouter({
      runtime: {
        config: {
          general: { greetingsEnabled: true, messagesEnabled: true },
          cooldowns: {
            cmdCooldownMs: 60000,
            heavyCommandCooldownMs: 300000,
            globalCmdCooldownMs: 45000,
          },
          farewell: {
            timeout: 300,
          },
          twitch: {
            greetingsEnabled: true,
            messagesEnabled: true,
            farewellsEnabled: true,
          },
        },
        commandCooldownService: {
          checkUserCooldown: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
          checkGlobalCooldown: vi.fn<(...args: [string, number]) => boolean>().mockImplementation(
            (key) => !activeCooldowns.has(key),
          ),
          updateUserCooldown: vi.fn<(userId: unknown) => void>(),
          updateGlobalCooldown: vi.fn<(...args: [string]) => void>().mockImplementation((key) => {
            activeCooldowns.add(key);
          }),
        },
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<{ command: string; }>>().mockResolvedValue({
            command: "!testboom",
          }),
          matchFarewell: vi.fn<(...args: unknown[]) => string>().mockReturnValue("!bye"),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!bye now",
    });

    const queuedTypes = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0].type,
    );
    expect(queuedTypes).not.toContain("farewell");
    expect(queuedTypes).not.toContain("command");
  });

  it("uses isolated farewell cooldown keys that do not block regular command cooldown keys", async () => {
    const activeCooldowns = new Set(["farewell:twitch"]);
    const checkGlobalCooldown = vi.fn<(...args: [string, number]) => boolean>().mockImplementation(
      (key) => !activeCooldowns.has(key),
    );
    const updateGlobalCooldown = vi.fn<(...args: [string]) => void>().mockImplementation((key) => {
      activeCooldowns.add(key);
    });
    const { router, runtime } = createRouter({
      runtime: {
        config: {
          general: { greetingsEnabled: true, messagesEnabled: true },
          cooldowns: {
            cmdCooldownMs: 60000,
            heavyCommandCooldownMs: 300000,
            globalCmdCooldownMs: 45000,
          },
          farewell: {
            timeout: 300,
          },
          twitch: {
            greetingsEnabled: true,
            messagesEnabled: true,
            farewellsEnabled: true,
          },
        },
        commandCooldownService: {
          checkUserCooldown: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
          checkGlobalCooldown,
          updateUserCooldown: vi.fn<(userId: unknown) => void>(),
          updateGlobalCooldown,
        },
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: [string, string]) => VfxConfig | null>().mockImplementation((trigger) => {
            if (trigger === "!testboom") {
              return { command: "!testboom" };
            }
            return null;
          }),
          matchFarewell: vi.fn<(...args: [string, string]) => string | null>().mockImplementation(
            (_message: string, trigger: string) => {
              if (trigger === "!bye") {
                return "!bye";
              }
              return null;
            },
          ),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!bye now",
    });
    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!testboom now",
    });

    const queuedTypes = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0].type,
    );
    expect(queuedTypes).not.toContain("farewell");
    expect(queuedTypes).toContain("command");
  });

  it("detects command triggers after sanitizing zero-width characters", async () => {
    const { router, runtime } = createRouter({
      runtime: {
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: [string, string]) => VfxConfig | null>().mockImplementation((trigger) => {
            if (trigger === "!testboom") {
              return { command: "!testboom" };
            }
            return null;
          }),
          matchFarewell: vi.fn<(...args: unknown[]) => null>().mockReturnValue(null),
        },
      },
    });

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!testboom\u200B now",
    });

    const queuedTypes = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0].type,
    );
    expect(queuedTypes).toContain("command");
  });

  it("queues emote-only TikTok chat rows when canonical message parts are present", async () => {
    const { router, runtime } = createRouter();

    await router.handleChatMessage("tiktok", {
      ...baseMessage,
      message: {
        text: "   ",
        parts: [
          {
            type: "emote",
            platform: "tiktok",
            emoteId: "1234512345",
            imageUrl: "https://example.invalid/tiktok-emote.webp",
          },
        ],
      },
    });

    expect(runtime.displayQueue.addItem).toHaveBeenCalled();
    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0],
    );
    const chatItem = queuedItems.find((item) => item.type === "chat");
    expect(chatItem).toBeDefined();
    expect(chatItem?.data?.message).toEqual({
      text: "",
      parts: [
        {
          type: "emote",
          platform: "tiktok",
          emoteId: "1234512345",
          imageUrl: "https://example.invalid/tiktok-emote.webp",
        },
      ],
    });
  });

  it("queues emote-only non-TikTok chat rows when canonical message parts are present", async () => {
    const { router, runtime } = createRouter();

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: {
        text: "   ",
        parts: [
          {
            type: "emote",
            platform: "twitch",
            emoteId: "1234512345",
            imageUrl: "https://example.invalid/twitch-emote.webp",
          },
        ],
      },
    });

    expect(runtime.displayQueue.addItem).toHaveBeenCalled();
    const queuedItems = runtime.displayQueue.addItem.mock.calls.map(
      (call) => call[0],
    );
    const chatItem = queuedItems.find((item) => item.type === "chat");
    expect(chatItem).toBeDefined();
    expect(chatItem?.data?.message).toEqual({
      text: "",
      parts: [
        {
          type: "emote",
          platform: "twitch",
          emoteId: "1234512345",
          imageUrl: "https://example.invalid/twitch-emote.webp",
        },
      ],
    });
  });

  it("builds safe farewell error details when non-Error values are thrown", async () => {
    const { router } = createRouter({
      runtime: {
        prepareFarewellNotification: async () => {
          throw "plain-farewell-failure";
        },
        vfxCommandService: {
          selectVFXCommand: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
          matchFarewell: vi.fn<(...args: unknown[]) => string>().mockReturnValue("!bye"),
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
      },
    });

    const capturedErrors: string[] = [];
    router._handleRouterError = vi.fn<(...args: [string]) => number>((message) =>
      capturedErrors.push(message),
    );

    await router.handleChatMessage("twitch", {
      ...baseMessage,
      message: "!bye everyone",
    });

    expect(capturedErrors.length).toBeGreaterThan(0);
    expect(capturedErrors[0]).toContain("plain-farewell-failure");
  });
});
