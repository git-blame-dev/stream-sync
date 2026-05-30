import { describe, expect, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { initializeTestLogging } from "../../helpers/test-setup";
import { DisplayQueue } from "../../../src/obs/display-queue.ts";
import { createMockOBSManager } from "../../helpers/mock-factories";
import { PRIORITY_LEVELS } from "../../../src/core/constants";

initializeTestLogging();

type Queue = InstanceType<typeof DisplayQueue>;
type QueueItem = Queue["queue"][number];
type DisplayQueueConfig = ConstructorParameters<typeof DisplayQueue>[1];
type DisplayQueueConstants = ConstructorParameters<typeof DisplayQueue>[2];
type DisplayQueueEventBus = ConstructorParameters<typeof DisplayQueue>[3];
type DisplayQueueDependencies = ConstructorParameters<typeof DisplayQueue>[4];
type DisplayQueueObsManager = ConstructorParameters<typeof DisplayQueue>[0];
type DisplayRow = { eventName: string; payload: Record<string, unknown> };

const expectLastChatMessage = (queue: Queue, message: string) => {
  expect(queue.lastChatItem).not.toBeNull();
  expect(queue.lastChatItem?.data.message).toBe(message);
};

const expectQueuedItem = (queue: Queue, index: number): QueueItem => {
  const item = queue.queue[index];
  expect(item).toBeDefined();
  if (!item) {
    throw new Error(`Expected queued item at index ${index}`);
  }
  return item;
};

const createReadyObsManager = (ready: boolean | (() => Promise<boolean>)): DisplayQueueObsManager => ({
  isReady: typeof ready === "boolean" ? async () => ready : ready,
  call: async () => ({}),
});

describe("DisplayQueue control", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const constants: DisplayQueueConstants = {
    PRIORITY_LEVELS,
    CHAT_MESSAGE_DURATION: 4500,
    CHAT_TRANSITION_DELAY: 200,
    NOTIFICATION_CLEAR_DELAY: 100,
  };

  const createConfig = (overrides: Partial<DisplayQueueConfig> = {}): DisplayQueueConfig => ({
    autoProcess: false,
    maxQueueSize: 3,
    chat: {
      sourceName: "chat",
      sceneName: "scene",
      groupName: "group",
      platformLogos: {},
    },
    notification: {
      sourceName: "notification",
      sceneName: "scene",
      groupName: "group",
      platformLogos: {},
    },
    ...overrides,
  });

  const createMockDependencies = (): NonNullable<DisplayQueueDependencies> => ({
    sourcesManager: {
      updateTextSource: createMockFn<[string, string?], Promise<void>>().mockResolvedValue(),
      clearTextSource: createMockFn<[string], Promise<void>>().mockResolvedValue(),
      updateChatMsgText: createMockFn<[string, string, string], Promise<void>>().mockResolvedValue(),
      getSceneItemId: createMockFn<[string, string], Promise<{ sceneItemId: number; sceneName?: string }>>().mockResolvedValue({ sceneItemId: 1 }),
      setSourceVisibility: createMockFn<[string, string, boolean], Promise<void>>().mockResolvedValue(),
      getGroupSceneItemId: createMockFn<[string, string], Promise<{ sceneItemId: number; sceneName?: string }>>().mockResolvedValue({ sceneItemId: 1 }),
      setGroupSourceVisibility: createMockFn<[string, string | null | undefined, boolean], Promise<void>>().mockResolvedValue(),
      setNotificationDisplayVisibility: createMockFn<[boolean, string, Record<string, unknown>], Promise<void>>().mockResolvedValue(),
      setChatDisplayVisibility: createMockFn<[boolean, string, Record<string, unknown>], Promise<void>>().mockResolvedValue(),
      hideAllDisplays: createMockFn<[], Promise<void>>().mockResolvedValue(),
      setPlatformLogoVisibility: createMockFn<[string, Record<string, unknown>], Promise<void>>().mockResolvedValue(),
      setNotificationPlatformLogoVisibility: createMockFn<[string, Record<string, unknown>], Promise<void>>().mockResolvedValue(),
      hideAllPlatformLogos: createMockFn<[Record<string, unknown>], Promise<void>>().mockResolvedValue(),
      hideAllNotificationPlatformLogos: createMockFn<[Record<string, unknown>], Promise<void>>().mockResolvedValue(),
      setSourceFilterEnabled: createMockFn<[string, string, boolean], Promise<void>>().mockResolvedValue(),
      getSourceFilterSettings: createMockFn<[string, string], Promise<Record<string, unknown>>>().mockResolvedValue({}),
      setSourceFilterSettings: createMockFn<[string, string, Record<string, unknown>], Promise<void>>().mockResolvedValue(),
      clearSceneItemCache: createMockFn<[], void>(),
    },
    goalsManager: {
      processDonationGoal: createMockFn().mockResolvedValue({ success: true }),
      processPaypiggyGoal: createMockFn().mockResolvedValue({ success: true }),
      initializeGoalDisplay: createMockFn().mockResolvedValue(),
      updateAllGoalDisplays: createMockFn().mockResolvedValue(),
      updateGoalDisplay: createMockFn().mockResolvedValue(),
      getCurrentGoalStatus: createMockFn().mockReturnValue(null),
      getAllCurrentGoalStatuses: createMockFn().mockReturnValue({}),
    },
    delay: () => Promise.resolve(),
  });

  const createQueue = (configOverrides: Partial<DisplayQueueConfig> = {}) => {
    const config = createConfig(configOverrides);
    const queue = new DisplayQueue(
      createMockOBSManager("connected"),
      config,
      constants,
      null,
      createMockDependencies(),
    );
    queue.getDuration = createMockFn().mockReturnValue(0);
    return queue;
  };

  describe("platform validation", () => {
    it("rejects items without platform", () => {
      const queue = createQueue();

      expect(() => {
        queue.addItem({
          type: "platform:gift",
          data: { username: "test-user" },
        } as QueueItem);
      }).toThrow("platform");
    });
  });

  describe("priority mapping", () => {
    it("falls back to chat priority when constants are missing", () => {
      const queue = new DisplayQueue(
        createMockOBSManager("connected"),
        createConfig(),
        {},
        null,
        createMockDependencies(),
      );

      expect(queue.getTypePriority("platform:gift")).toBe(PRIORITY_LEVELS.CHAT);
      expect(queue.getTypePriority("unknown")).toBe(PRIORITY_LEVELS.CHAT);
    });
  });

  describe("delegation helpers", () => {
    it("delegates TTS helpers to the effects module", async () => {
      const queue = createQueue();
      const ttsUpdates: string[] = [];

      queue.effects.isTTSEnabled = () => true;
      queue.effects.setTTSText = async (text: string) => {
        ttsUpdates.push(text);
      };

      expect(queue.isTTSEnabled()).toBe(true);

      await queue.setTTSText("test-tts");

      expect(ttsUpdates).toEqual(["test-tts"]);
    });
  });

  describe("maxQueueSize enforcement", () => {
    it("rejects items when queue is at maxQueueSize capacity", () => {
      const queue = createQueue({ maxQueueSize: 2 });

      queue.addItem({
        type: "platform:gift",
        platform: "twitch",
        data: {
          username: "test-user-1",
          giftType: "Rose",
          giftCount: 1,
          amount: 10,
          currency: "coins",
        },
      });
      queue.addItem({
        type: "platform:gift",
        platform: "twitch",
        data: {
          username: "test-user-2",
          giftType: "Rose",
          giftCount: 1,
          amount: 10,
          currency: "coins",
        },
      });

      expect(queue.queue.length).toBe(2);

      expect(() => {
        queue.addItem({
          type: "platform:gift",
          platform: "twitch",
          data: {
            username: "test-user-3",
            giftType: "Rose",
            giftCount: 1,
            amount: 10,
            currency: "coins",
          },
        });
      }).toThrow();
    });
  });

  describe("chat item preservation", () => {
    it("preserves earlier chat entries and records the latest message", () => {
      const queue = createQueue();

      queue.addItem({
        type: "chat",
        platform: "twitch",
        data: { username: "test-user", message: "first" },
      });
      queue.addItem({
        type: "chat",
        platform: "twitch",
        data: { username: "test-user", message: "second" },
      });

      expect(queue.queue.map((item) => item.data.message)).toEqual([
        "first",
        "second",
      ]);
      expectLastChatMessage(queue, "second");
    });
  });

  describe("processChatMessage autoProcess respect", () => {
    it("does not auto-process when autoProcess is false", async () => {
      const queue = createQueue({ autoProcess: false });
      let processed = false;
      queue.displayItem = createMockFn(async () => {
        processed = true;
        return true;
      });

      await queue.processChatMessage({
        type: "chat",
        platform: "twitch",
        data: { username: "test-user", message: "hello" },
      });

      expect(queue.queue.length).toBe(1);
      expect(processed).toBe(false);
    });

    it("rejects non-chat items", async () => {
      const queue = createQueue({ autoProcess: false });

      await expect(
        queue.processChatMessage({
          type: "platform:gift",
          platform: "twitch",
          data: {
            username: "test-user",
            giftType: "rose",
            giftCount: 1,
            amount: 1,
            currency: "coins",
          },
        }),
      ).rejects.toThrow("Invalid chat item");
    });

    it("auto-processes chat when autoProcess is true", async () => {
      const queue = createQueue({ autoProcess: true });
      let processed = false;
      queue.processQueue = createMockFn(async () => {
        processed = true;
      });

      await queue.processChatMessage({
        type: "chat",
        platform: "twitch",
        data: { username: "test-user", message: "hello" },
      });

      expect(processed).toBe(true);
    });
  });

  describe("auto-process behavior", () => {
    it("starts processing when autoProcess is enabled and idle", () => {
      const queue = createQueue({ autoProcess: true });
      let processed = false;
      queue.processQueue = createMockFn(async () => {
        processed = true;
      });

      queue.addItem({
        type: "platform:gift",
        platform: "twitch",
        data: {
          username: "test-user",
          giftType: "rose",
          giftCount: 1,
          amount: 1,
          currency: "coins",
        },
      });

      expect(processed).toBe(true);
    });

    it("does not emit chat display row when queue item is only enqueued", () => {
      const emittedRows: DisplayRow[] = [];
      const eventBus = {
        emit: (eventName: string, payload: Record<string, unknown>) => {
          emittedRows.push({ eventName, payload });
        },
      } satisfies NonNullable<DisplayQueueEventBus>;

      const queue = new DisplayQueue(
        createMockOBSManager("connected"),
        createConfig({ autoProcess: false }),
        constants,
        eventBus,
        createMockDependencies(),
      );

      queue.addItem({
        type: "chat",
        platform: "twitch",
        data: {
          username: "test-user",
          userId: "test-user-id",
          message: "hello",
        },
      });

      expect(emittedRows.length).toBe(0);
    });

    it("emits chat display row when chat item is displayed", async () => {
      const emittedRows: DisplayRow[] = [];
      const eventBus = {
        emit: (eventName: string, payload: Record<string, unknown>) => {
          emittedRows.push({ eventName, payload });
        },
      } satisfies NonNullable<DisplayQueueEventBus>;

      const queue = new DisplayQueue(
        createMockOBSManager("connected"),
        createConfig({ autoProcess: false }),
        constants,
        eventBus,
        createMockDependencies(),
      );

      queue.renderer.displayChatItem = createMockFn().mockResolvedValue(true);

      const displayResult = await queue.displayChatItem({
        type: "chat",
        platform: "twitch",
        data: {
          username: "test-user",
          userId: "test-user-id",
          message: "hello",
        },
      });

      expect(displayResult).toBe(true);
      expect(emittedRows.length).toBe(1);
      const firstRow = emittedRows[0];
      expect(firstRow).toBeDefined();
      expect(firstRow?.eventName).toBe("display:row");
      expect(firstRow?.payload.type).toBe("chat");
      expect(firstRow?.payload.platform).toBe("twitch");
    });

    it("emits notification display row only when notification is displayed", async () => {
      const emittedRows: DisplayRow[] = [];
      const eventBus = {
        emit: (eventName: string, payload: Record<string, unknown>) => {
          emittedRows.push({ eventName, payload });
        },
      } satisfies NonNullable<DisplayQueueEventBus>;

      const queue = new DisplayQueue(
        createMockOBSManager("connected"),
        createConfig({ autoProcess: false, timing: { transitionDelay: 0 } }),
        constants,
        eventBus,
        createMockDependencies(),
      );

      queue.renderer.displayNotificationItem =
        createMockFn().mockResolvedValue(true);
      queue.handleNotificationEffects = createMockFn().mockResolvedValue();

      queue.addItem({
        type: "platform:gift",
        platform: "tiktok",
        data: {
          username: "test-user",
          userId: "test-user-id",
          giftType: "Rose",
          giftCount: 1,
          amount: 1,
          currency: "coins",
        },
      });

      expect(
        emittedRows.find((entry) => entry.payload?.type === "platform:gift"),
      ).toBeUndefined();

      const displayResult = await queue.displayNotificationItem(expectQueuedItem(queue, 0));
      expect(displayResult).toBe(true);
      expect(
        emittedRows.some(
          (entry) =>
            entry.eventName === "display:row" &&
            entry.payload?.type === "platform:gift",
        ),
      ).toBe(true);
    });
  });

  describe("processQueue readiness", () => {
    it("clears retry flag when OBS is not ready and queue is empty", async () => {
      const queue = new DisplayQueue(
        createReadyObsManager(false),
        createConfig(),
        constants,
        null,
        createMockDependencies(),
      );

      await queue.processQueue();

      expect(queue.isRetryScheduled).toBe(false);
      expect(queue.isProcessing).toBe(false);
    });

    it("clears retry flag when OBS readiness check throws", async () => {
      const queue = new DisplayQueue(
        createReadyObsManager(async () => {
            throw new Error("readiness failed");
          }),
        createConfig(),
        constants,
        null,
        createMockDependencies(),
      );
      queue.addItem({
        type: "platform:gift",
        platform: "twitch",
        data: {
          username: "test-user",
          giftType: "Rose",
          giftCount: 1,
          amount: 10,
          currency: "coins",
        },
      });

      await queue.processQueue();

      expect(queue.isRetryScheduled).toBe(false);
      expect(queue.isProcessing).toBe(false);
      expect(queue.getQueueLength()).toBe(1);
    });
  });

  describe("display routing", () => {
    it("routes chat and non-chat items to the correct display handlers", async () => {
      const queue = createQueue();
      const routed: string[] = [];

      queue.displayChatItem = createMockFn(async () => {
        routed.push("chat");
        return true;
      });
      queue.displayNotificationItem = createMockFn(async () => {
        routed.push("notification");
        return true;
      });

      await queue.displayItem({
        type: "chat",
        platform: "twitch",
        data: { username: "test-user", message: "hello" },
      });
      await queue.displayItem({
        type: "platform:gift",
        platform: "twitch",
        data: {
          username: "test-user",
          giftType: "rose",
          giftCount: 1,
          amount: 1,
          currency: "coins",
        },
      });

      expect(routed).toEqual(["chat", "notification"]);
    });
  });

  describe("notification effects gating", () => {
    it("skips notification effects when renderer declines display", async () => {
      const queue = createQueue();
      let effectsHandled = false;
      queue.renderer.displayNotificationItem = async () => false;
      queue.handleNotificationEffects = async () => {
        effectsHandled = true;
      };

      await queue.displayNotificationItem({
        type: "platform:follow",
        platform: "twitch",
        data: { username: "test-user", displayMessage: "test-user followed" },
      });

      expect(effectsHandled).toBe(false);
    });

    it("still runs paid notification side effects when OBS render fails", async () => {
      const emittedRows: DisplayRow[] = [];
      const eventBus = {
        emit: (eventName: string, payload: Record<string, unknown>) => {
          emittedRows.push({ eventName, payload });
        },
      } satisfies NonNullable<DisplayQueueEventBus>;
      const queue = new DisplayQueue(
        createMockOBSManager("connected"),
        createConfig({ autoProcess: false, timing: { transitionDelay: 0 } }),
        constants,
        eventBus,
        createMockDependencies(),
      );
      const effectTypes: string[] = [];
      queue.renderer.displayNotificationItem = async () => false;
      queue.handleNotificationEffects = async (item) => {
        effectTypes.push(item.type);
      };
      queue.hideCurrentDisplay = async () => {
        throw new Error("Failed notification render should not hide current display");
      };

      const itemDataByType: Record<string, Record<string, unknown>> = {
        "platform:gift": {
          username: "test-user",
          userId: "test-user-id",
          giftType: "Rose",
          giftCount: 1,
          amount: 1,
          currency: "coins",
        },
        "platform:paypiggy": { username: "member", userId: "member-id" },
        "platform:giftpaypiggy": { username: "gifter", userId: "gifter-id", giftCount: 2 },
        "platform:envelope": {
          username: "sender",
          userId: "sender-id",
          giftType: "treasure chest",
          giftCount: 1,
          amount: 10,
          currency: "coins",
        },
      };

      for (const [type, data] of Object.entries(itemDataByType)) {
        const result = await queue.displayNotificationItem({
          type,
          platform: "tiktok",
          data,
        });
        expect(result).toBe(false);
      }

      expect(effectTypes).toEqual(["platform:gift", "platform:paypiggy", "platform:giftpaypiggy", "platform:envelope"]);
      expect(emittedRows.map((row) => row.payload.type)).toEqual(effectTypes);
    });
  });

  describe("processQueue flow", () => {
    it("processes queued items, hides after display, and shows lingering chat", async () => {
      const config = createConfig({
        timing: { transitionDelay: 0, notificationClearDelay: 0 },
      });
      const queue = new DisplayQueue(
        createReadyObsManager(true),
        config,
        constants,
        null,
        createMockDependencies(),
      );
      const displayed: string[] = [];
      const hidden: string[] = [];

      queue.delay = async () => {};
      queue.getDuration = () => 0;
      queue.displayChatItem = async (item) => {
        displayed.push(item.type);
        return true;
      };
      queue.displayNotificationItem = async (item) => {
        displayed.push(item.type);
        return true;
      };
      queue.hideCurrentDisplay = async (item) => {
        if (item) {
          hidden.push(item.type);
        }
      };
      queue.displayLingeringChat = async () => {
        displayed.push("lingering");
      };

      queue.addItem({
        type: "chat",
        platform: "twitch",
        priority: 10,
        data: { username: "test-user", message: "hello" },
      });
      queue.addItem({
        type: "platform:follow",
        platform: "twitch",
        priority: 5,
        data: { username: "test-user", displayMessage: "followed" },
      });

      await queue.processQueue();

      expect(displayed).toEqual(["chat", "platform:follow", "lingering"]);
      expect(hidden).toEqual(["chat", "platform:follow"]);
      expect(queue.isProcessing).toBe(false);
    });

    it("preserves chat messages queued behind gift and greeting blockers", async () => {
      const queue = createQueue({
        maxQueueSize: 10,
        timing: { transitionDelay: 0, notificationClearDelay: 0 },
      });
      const displayedChatMessages: unknown[] = [];

      queue.delay = async () => {};
      queue.getDuration = () => 0;
      queue.displayItem = async (item) => {
        if (item.type === "chat") {
          displayedChatMessages.push(item.data.message);
        }
        return true;
      };
      queue.hideCurrentDisplay = async () => {};
      queue.displayLingeringChat = async () => {};

      queue.addItem({
        type: "platform:gift",
        platform: "tiktok",
        priority: PRIORITY_LEVELS.GIFT,
        data: {
          username: "test-gifter",
          giftType: "Test Gift",
          giftCount: 3,
          amount: 15,
          currency: "coins",
          displayMessage: "test-gifter sent 3x Test Gift (15 coins)",
        },
      });
      queue.addItem({
        type: "chat",
        platform: "tiktok",
        priority: PRIORITY_LEVELS.CHAT,
        data: { username: "test-viewer", message: "first queued chat" },
      });
      queue.addItem({
        type: "greeting",
        platform: "tiktok",
        priority: PRIORITY_LEVELS.GREETING,
        data: {
          username: "test-viewer",
          displayMessage: "Welcome, test-viewer!",
        },
      });
      queue.addItem({
        type: "chat",
        platform: "tiktok",
        priority: PRIORITY_LEVELS.CHAT,
        data: { username: "test-viewer", message: "second queued chat" },
      });

      await queue.processQueue();

      expect(displayedChatMessages).toEqual([
        "first queued chat",
        "second queued chat",
      ]);
      expectLastChatMessage(queue, "second queued chat");
    });

    it("continues draining when new work arrives during teardown", async () => {
      const queue = createQueue({
        autoProcess: false,
        timing: { transitionDelay: 0, notificationClearDelay: 0 },
      });
      const processedTypes: string[] = [];
      let teardownInjectionDone = false;

      queue.delay = async () => {};
      queue.getDuration = () => 0;
      queue.displayItem = async (item) => {
        processedTypes.push(item.type);
        return true;
      };
      queue.hideCurrentDisplay = async () => {};
      queue.displayLingeringChat = async () => {
        if (teardownInjectionDone) {
          return;
        }

        teardownInjectionDone = true;
        queue.addItem({
          type: "platform:gift",
          platform: "tiktok",
          priority: PRIORITY_LEVELS.GIFT,
          data: {
            username: "test-user",
            userId: "test-user-id",
            giftType: "Rose",
            giftCount: 5,
            amount: 5,
            currency: "coins",
            displayMessage: "test-user sent 5x Rose gift (5 coins)",
          },
        });
      };

      queue.addItem({
        type: "chat",
        platform: "tiktok",
        priority: PRIORITY_LEVELS.CHAT,
        data: {
          username: "test-user",
          userId: "test-user-id",
          message: "test wakeup trigger",
        },
      });

      queue.config.autoProcess = true;

      await queue.processQueue();

      expect(processedTypes).toEqual(["chat", "platform:gift"]);
      expect(queue.getQueueLength()).toBe(0);
    });

    it("clears current display when notification rendering is declined", async () => {
      const queue = createQueue({
        autoProcess: false,
        timing: { transitionDelay: 0, notificationClearDelay: 0 },
      });

      queue.renderer.displayNotificationItem =
        createMockFn().mockResolvedValue(false);
      queue.handleNotificationEffects = createMockFn().mockResolvedValue();
      queue.hideCurrentDisplay = createMockFn().mockResolvedValue();

      queue.addItem({
        type: "platform:follow",
        platform: "twitch",
        priority: PRIORITY_LEVELS.FOLLOW,
        data: {
          username: "test-user",
          userId: "test-user-id",
          displayMessage: "test-user followed",
        },
      });

      await queue.processQueue();

      expect(queue.currentDisplay === null).toBe(true);
    });
  });

  describe("stop() behavior", () => {
    it("clears all state when stopping", async () => {
      const queue = createQueue();
      queue.currentDisplay = {
        type: "platform:gift",
        platform: "twitch",
        data: { username: "test-user" },
      };
      queue.isProcessing = true;
      queue.queue.push({
        type: "chat",
        platform: "twitch",
        data: { username: "test-user", message: "test" },
      });

      await queue.stop();

      expect(queue.currentDisplay === null).toBe(true);
      expect(queue.isProcessing).toBe(false);
      expect(queue.queue.length).toBe(0);
    });

    it("aborts active processing loop when stop is called", async () => {
      const queue = createQueue();
      const processed: unknown[] = [];
      let itemCount = 0;

      queue.displayItem = createMockFn(async (item) => {
        processed.push(item.data.username);
        itemCount++;
        if (itemCount === 1) {
          queue.stop();
        }
        return true;
      });

      queue.addItem({
        type: "platform:gift",
        platform: "twitch",
        data: {
          username: "test-user-1",
          giftType: "Rose",
          giftCount: 1,
          amount: 10,
          currency: "coins",
        },
      });
      queue.addItem({
        type: "platform:gift",
        platform: "twitch",
        data: {
          username: "test-user-2",
          giftType: "Rose",
          giftCount: 1,
          amount: 10,
          currency: "coins",
        },
      });
      queue.addItem({
        type: "platform:gift",
        platform: "twitch",
        data: {
          username: "test-user-3",
          giftType: "Rose",
          giftCount: 1,
          amount: 10,
          currency: "coins",
        },
      });

      await queue.processQueue();

      expect(processed.length).toBe(1);
    });
  });

  describe("clearQueue behavior", () => {
    it("clears queue even when state is unset", () => {
      const queue = createQueue();
      Object.defineProperty(queue, "state", { value: null, writable: true });
      queue.queue = [
        { type: "chat", platform: "twitch", data: { username: "test-user", message: "hello" } },
      ];
      queue.isRetryScheduled = true;
      queue.isProcessing = true;
      queue.currentDisplay = {
        type: "chat",
        platform: "twitch",
        data: { username: "test-user", message: "hello" },
      };

      queue.clearQueue();

      expect(queue.queue.length).toBe(0);
      expect(queue.isRetryScheduled).toBe(false);
      expect(queue.isProcessing).toBe(false);
      expect(queue.currentDisplay === null).toBe(true);
    });
  });
});
