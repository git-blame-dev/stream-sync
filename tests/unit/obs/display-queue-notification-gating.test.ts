import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";

import { DisplayQueue } from "../../../src/obs/display-queue.ts";
import { EventEmitter } from "events";
import { PRIORITY_LEVELS } from "../../../src/core/constants";

describe("DisplayQueue platform notification gating", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    restoreAllMocks();
  });

  function createQueue(platformConfig = {}) {
    const mockSourcesManager = {
      updateTextSource: createMockFn<[string, string?], Promise<void>>(() => Promise.resolve()),
      clearTextSource: createMockFn<[string], Promise<void>>(() => Promise.resolve()),
      updateChatMsgText: createMockFn<[string, string, string], Promise<void>>(() => Promise.resolve()),
      setSourceVisibility: createMockFn<[string, string, boolean], Promise<void>>(() => Promise.resolve()),
      setNotificationDisplayVisibility: createMockFn<[boolean], Promise<void>>(() => Promise.resolve()),
      setChatDisplayVisibility: createMockFn<[boolean], Promise<void>>(() => Promise.resolve()),
      hideAllDisplays: createMockFn<[], Promise<void>>(() => Promise.resolve()),
      setPlatformLogoVisibility: createMockFn<[string, Record<string, unknown>], Promise<void>>(() => Promise.resolve()),
      setNotificationPlatformLogoVisibility: createMockFn<[string, Record<string, unknown>], Promise<void>>(() => Promise.resolve()),
      hideAllPlatformLogos: createMockFn<[Record<string, unknown>], Promise<void>>(() => Promise.resolve()),
      hideAllNotificationPlatformLogos: createMockFn<[Record<string, unknown>], Promise<void>>(() => Promise.resolve()),
      setGroupSourceVisibility: createMockFn<[string, string | null | undefined, boolean], Promise<void>>(() => Promise.resolve()),
      getSceneItemId: createMockFn<[string, string], Promise<{ sceneItemId: number }>>(async () => ({ sceneItemId: 1 })),
      getGroupSceneItemId: createMockFn<[string, string], Promise<{ sceneItemId: number }>>(async () => ({ sceneItemId: 1 })),
      setSourceFilterEnabled: createMockFn<[string, string, boolean], Promise<void>>(() => Promise.resolve()),
      getSourceFilterSettings: createMockFn<[string, string], Promise<Record<string, unknown>>>(async () => ({})),
      setSourceFilterSettings: createMockFn<[string, string, Record<string, unknown>], Promise<void>>(() => Promise.resolve()),
      clearSceneItemCache: createMockFn<[], void>(() => {}),
    };

    const obsManager = {
      call: createMockFn().mockResolvedValue({}),
      isConnected: () => true,
      isReady: createMockFn().mockResolvedValue(true),
    };

    const config = {
      autoProcess: false,
      ttsEnabled: false,
      maxQueueSize: 100,
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
      timing: {
        transitionDelay: 200,
        notificationClearDelay: 500,
        chatMessageDuration: 4500,
      },
      handcam: { enabled: false },
      gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
      obs: { ttsTxt: "tts-text" },
      youtube: {},
      twitch: {},
      tiktok: {},
      ...platformConfig,
    };

    const mockGoalsManager = {
      processDonationGoal: createMockFn<[unknown, number], Promise<{ success: boolean }>>(async () => ({ success: true })),
      processPaypiggyGoal: createMockFn<[string], Promise<{ success: boolean }>>(async () => ({ success: true })),
      initializeGoalDisplay: createMockFn<[], Promise<void>>(() => Promise.resolve()),
      updateAllGoalDisplays: createMockFn<[], Promise<void>>(() => Promise.resolve()),
      updateGoalDisplay: createMockFn<[string, string?], Promise<void>>(() => Promise.resolve()),
      getCurrentGoalStatus: createMockFn<[string], Record<string, unknown> | null>(() => null),
      getAllCurrentGoalStatuses: createMockFn<[], Record<string, unknown>>(() => ({})),
    };

    const queue = new DisplayQueue(
      obsManager,
      config,
      { PRIORITY_LEVELS },
      new EventEmitter(),
      { sourcesManager: mockSourcesManager, goalsManager: mockGoalsManager },
    );

    return { queue, mockSourcesManager, mockGoalsManager };
  }

  it("displays notification for configured platform", async () => {
    const { queue, mockSourcesManager } = createQueue({});

    const notificationItem = {
      type: "platform:follow",
      platform: "twitch",
      data: {
        username: "testFollower",
        displayMessage: "testFollower just followed!",
      },
      priority: 2,
      duration: 5000,
    };

    await queue.displayNotificationItem(notificationItem);

    expect(
      mockSourcesManager.setNotificationDisplayVisibility,
    ).toHaveBeenCalled();
  });

  it("displays notification for platforms without explicit config", async () => {
    const { queue, mockSourcesManager } = createQueue({});

    const notificationItem = {
      type: "platform:follow",
      platform: "youtube",
      data: {
        username: "testFollower",
        displayMessage: "testFollower just subscribed!",
      },
      priority: 2,
      duration: 5000,
    };

    await queue.displayNotificationItem(notificationItem);

    expect(
      mockSourcesManager.setNotificationDisplayVisibility,
    ).toHaveBeenCalled();
  });
});
