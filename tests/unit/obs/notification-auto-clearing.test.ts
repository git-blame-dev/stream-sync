import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../helpers/bun-mock-utils";

import { noOpLogger } from "../../helpers/mock-factories";
import { setupAutomatedCleanup } from "../../helpers/mock-lifecycle";
import { createSourcesConfigFixture } from "../../helpers/config-fixture";
import { createOBSSourcesManager } from "../../../src/obs/sources.ts";
import { PRIORITY_LEVELS } from "../../../src/core/constants";
import { DisplayQueue } from "../../../src/obs/display-queue.ts";

setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true,
});

describe("Notification Auto-Clearing Behavior", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  type Queue = InstanceType<typeof DisplayQueue>;
  type QueueItem = Queue["queue"][number];
  type DisplayQueueConstants = ConstructorParameters<typeof DisplayQueue>[2];
  type DisplayQueueObsManager = ConstructorParameters<typeof DisplayQueue>[0];
  type ObsCallResult = Record<string, unknown>;
  type HiddenDisplayCall = QueueItem | null;
  type TestObsManager = Omit<DisplayQueueObsManager, "call"> & {
    call: (requestType: string, payload?: Record<string, unknown>) => Promise<unknown>;
    isConnected: () => boolean;
    ensureConnected: () => Promise<void>;
  };

  const createTestObsManager = (): TestObsManager => ({
    isConnected: createMockFn<[], boolean>().mockReturnValue(true),
    isReady: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
    call: createMockFn<[string, Record<string, unknown>?], Promise<ObsCallResult>>(
      async (method: string) => {
        if (method === "GetGroupSceneItemList") {
          return {
            sceneItems: [
              { sourceName: "tiktok_logo", sceneItemId: 1 },
              { sourceName: "twitch_logo", sceneItemId: 2 },
              { sourceName: "youtube_logo", sceneItemId: 3 },
              { sourceName: "chat_text", sceneItemId: 10 },
              { sourceName: "notification_text", sceneItemId: 11 },
              { sourceName: "tts_text", sceneItemId: 12 },
            ],
          };
        }
        if (method === "GetInputSettings") {
          return { inputSettings: {} };
        }
        if (method === "GetSceneItemId") {
          return { sceneItemId: 42 };
        }
        return {};
      },
    ),
    ensureConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
  });

  const createQueueItem = (
    type: string,
    data: QueueItem["data"],
    duration: number,
  ): QueueItem => ({
    type,
    data,
    platform: "twitch",
    duration,
  });

  let displayQueue: Queue;
  let mockObsManager: TestObsManager;
  let mockConstants: DisplayQueueConstants;

  beforeEach(() => {
    mockObsManager = createTestObsManager();

    mockConstants = {
      CHAT_MESSAGE_DURATION: 5000,
      CHAT_TRANSITION_DELAY: 200,
      NOTIFICATION_CLEAR_DELAY: 200,
      PRIORITY_LEVELS,
    };

    const configFixture = {
      autoProcess: false,
      maxQueueSize: 100,
      chat: {
        sourceName: "chat_text",
        sceneName: "main_scene",
        groupName: "chat_group",
        platformLogos: {
          tiktok: "tiktok_logo",
          twitch: "twitch_logo",
          youtube: "youtube_logo",
        },
      },
      notification: {
        sourceName: "notification_text",
        sceneName: "main_scene",
        groupName: "notification_group",
        platformLogos: {
          tiktok: "tiktok_logo",
          twitch: "twitch_logo",
          youtube: "youtube_logo",
        },
      },
      timing: {
        transitionDelay: 200,
        notificationClearDelay: 200,
        chatMessageDuration: 5000,
      },
      handcam: { enabled: false },
      gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
      obs: {
        ttsTxt: "tts_text",
      },
      youtube: {},
      twitch: {},
      tiktok: {},
      ttsEnabled: false,
    };

    // Create REAL sourcesManager with mocked OBS (mock at external boundary only)
    const realSourcesManager = createOBSSourcesManager(mockObsManager, {
      ...createSourcesConfigFixture(),
      logger: noOpLogger,
      ensureOBSConnected: createMockFn().mockResolvedValue(),
      obsCall: mockObsManager.call,
    });

    const mockGoalsManager = {
      processDonationGoal: createMockFn<[unknown, number], Promise<{ success: boolean }>>().mockResolvedValue({ success: true }),
      processPaypiggyGoal: createMockFn<[string], Promise<{ success: boolean }>>().mockResolvedValue({ success: true }),
      initializeGoalDisplay: createMockFn<[], Promise<void>>().mockResolvedValue(),
      updateAllGoalDisplays: createMockFn<[], Promise<void>>().mockResolvedValue(),
      updateGoalDisplay: createMockFn<[string], Promise<void>>().mockResolvedValue(),
      getCurrentGoalStatus: createMockFn<[string], { current: number; target: number } | null>().mockReturnValue(null),
      getAllCurrentGoalStatuses: createMockFn<[], Record<string, { current: number; target: number }>>().mockReturnValue({}),
    };

    displayQueue = new DisplayQueue(
      mockObsManager,
      configFixture,
      mockConstants,
      null,
      {
        sourcesManager: realSourcesManager,
        goalsManager: mockGoalsManager,
        delay: () => Promise.resolve(),
      },
    );
  });

  test("should hide notifications after their duration regardless of lingering chat", async () => {
    const chatItem = createQueueItem("chat", {
      username: "TestUser",
      message: "Hello world!",
    }, 5000);

    const notificationItem = createQueueItem("platform:follow", {
      username: "NewFollower",
      displayMessage: "NewFollower just followed!",
    }, 3000);

    const hiddenCalls: HiddenDisplayCall[] = [];
    displayQueue.hideCurrentDisplay = async (item) => {
      hiddenCalls.push(item);
    };

    displayQueue.addItem(chatItem);
    await displayQueue.processQueue();

    expect(displayQueue.lastChatItem).toBeDefined();

    hiddenCalls.length = 0;

    displayQueue.addItem(notificationItem);
    await displayQueue.processQueue();

    const hiddenTypesAfterNotification = hiddenCalls.map((item) => item?.type);
    expect(hiddenTypesAfterNotification).toContain("platform:follow");
  });

  test("lingering chat is shown after queue drains and skips OBS ops when OBS not ready", async () => {
    const chatItem = createQueueItem("chat", {
      username: "ChatUser",
      message: "This should linger",
    }, 3000);

    const hiddenCalls: HiddenDisplayCall[] = [];
    let obsReadyCallCount = 0;
    displayQueue.hideCurrentDisplay = async (item) => {
      hiddenCalls.push(item);
    };
    mockObsManager.isReady = async () => {
      obsReadyCallCount += 1;
      return false;
    };

    displayQueue.addItem(chatItem);
    await displayQueue.processQueue();

    await displayQueue.displayLingeringChat();

    const hiddenTypes = hiddenCalls.map((item) => item?.type);
    expect(hiddenTypes).not.toContain("chat");
    expect(obsReadyCallCount).toBeGreaterThan(0);
    expect(displayQueue.currentDisplay === null).toBe(true);
  });

test("clears notification rows while keeping chat rows persistent", async () => {
    const duration = 3000;

    const notificationItem = createQueueItem("command", {
      username: "CommandUser",
      displayMessage: "CommandUser used command hello",
    }, duration);

    const chatItem = createQueueItem("chat", {
      username: "ChatUser",
      message: "Regular chat message",
    }, duration);

    const hiddenCalls: HiddenDisplayCall[] = [];
    displayQueue.hideCurrentDisplay = async (item) => {
      hiddenCalls.push(item);
    };

    displayQueue.addItem(notificationItem);
    await displayQueue.processQueue();

    const hiddenAfterNotification = hiddenCalls.map((item) => item?.type);
    expect(hiddenAfterNotification).toContain("command");

    hiddenCalls.length = 0;

    displayQueue.addItem(chatItem);
    await displayQueue.processQueue();

    const hiddenAfterChat = hiddenCalls.map((item) => item?.type);
    expect(hiddenAfterChat).not.toContain("chat");
  });
});
