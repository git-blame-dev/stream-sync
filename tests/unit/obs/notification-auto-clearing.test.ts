import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  createMockFn,
  spyOn,
  restoreAllMocks,
} from "../../helpers/bun-mock-utils";

import { createMockOBSManager, noOpLogger } from "../../helpers/mock-factories";
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

  let displayQueue;
  let mockObsManager;
  let mockConstants;

  beforeEach(() => {
    mockObsManager = createMockOBSManager("connected");
    mockObsManager.call.mockImplementation((method) => {
      if (method === "GetGroupSceneItemList") {
        return Promise.resolve({
          sceneItems: [
            { sourceName: "tiktok_logo", sceneItemId: 1 },
            { sourceName: "twitch_logo", sceneItemId: 2 },
            { sourceName: "youtube_logo", sceneItemId: 3 },
            { sourceName: "chat_text", sceneItemId: 10 },
            { sourceName: "notification_text", sceneItemId: 11 },
            { sourceName: "tts_text", sceneItemId: 12 },
          ],
        });
      }
      if (method === "GetInputSettings") {
        return Promise.resolve({ inputSettings: {} });
      }
      if (method === "GetSceneItemId") {
        return Promise.resolve({ sceneItemId: 42 });
      }
      return Promise.resolve({});
    });

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
      processDonationGoal: createMockFn().mockResolvedValue({ success: true }),
      processPaypiggyGoal: createMockFn().mockResolvedValue({ success: true }),
      initializeGoalDisplay: createMockFn().mockResolvedValue(),
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
    const chatItem = {
      type: "chat",
      data: {
        username: "TestUser",
        message: "Hello world!",
      },
      platform: "twitch",
      duration: 5000,
    };

    const notificationItem = {
      type: "platform:follow",
      data: {
        username: "NewFollower",
        displayMessage: "NewFollower just followed!",
      },
      platform: "twitch",
      duration: 3000,
    };

    const hideDisplaySpy = spyOn(displayQueue, "hideCurrentDisplay");
    hideDisplaySpy.mockResolvedValue();

    displayQueue.addItem(chatItem);
    await displayQueue.processQueue();

    expect(displayQueue.lastChatItem).toBeDefined();

    hideDisplaySpy.mockClear();

    displayQueue.addItem(notificationItem);
    await displayQueue.processQueue();

  const hiddenTypesAfterNotification = hideDisplaySpy.mock.calls.map(
    ([item]) => item?.type,
  );
  expect(hiddenTypesAfterNotification).toContain("platform:follow");

    hideDisplaySpy.mockRestore();
  });

  test("lingering chat is shown after queue drains and skips OBS ops when OBS not ready", async () => {
    const chatItem = {
      type: "chat",
      data: {
        username: "ChatUser",
        message: "This should linger",
      },
      platform: "twitch",
      duration: 3000,
    };

    const hideDisplaySpy = spyOn(
      displayQueue,
      "hideCurrentDisplay",
    ).mockResolvedValue();
    const lingeringChatSpy = spyOn(displayQueue, "displayLingeringChat");
    const obsReadySpy = spyOn(mockObsManager, "isReady").mockResolvedValue(
      false,
    );

    displayQueue.addItem(chatItem);
    await displayQueue.processQueue();

    await displayQueue.displayLingeringChat();

  const hiddenTypes = hideDisplaySpy.mock.calls.map(([item]) => item?.type);
  expect(hiddenTypes).not.toContain("chat");
    expect(obsReadySpy).toHaveBeenCalled();
    expect(displayQueue.currentDisplay).toBeNull();

    hideDisplaySpy.mockRestore();
    lingeringChatSpy.mockRestore();
    obsReadySpy.mockRestore();
  });

test("clears notification rows while keeping chat rows persistent", async () => {
    const duration = 3000;

    const notificationItem = {
      type: "command",
      data: {
        username: "CommandUser",
        displayMessage: "CommandUser used command hello",
      },
      platform: "twitch",
      duration: duration,
    };

    const chatItem = {
      type: "chat",
      data: {
        username: "ChatUser",
        message: "Regular chat message",
      },
      platform: "twitch",
      duration: duration,
    };

    const hideDisplaySpy = spyOn(displayQueue, "hideCurrentDisplay");
    hideDisplaySpy.mockResolvedValue();

    displayQueue.addItem(notificationItem);
    await displayQueue.processQueue();

  const hiddenAfterNotification = hideDisplaySpy.mock.calls.map(
    ([item]) => item?.type,
  );
  expect(hiddenAfterNotification).toContain("command");

    hideDisplaySpy.mockClear();

    displayQueue.addItem(chatItem);
    await displayQueue.processQueue();

  const hiddenAfterChat = hideDisplaySpy.mock.calls.map(([item]) => item?.type);
  expect(hiddenAfterChat).not.toContain("chat");

    hideDisplaySpy.mockRestore();
  });
});
