import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";

import { DisplayQueue } from "../../../src/obs/display-queue.ts";
import { EventEmitter } from "events";
import { PRIORITY_LEVELS } from "../../../src/core/constants";

describe("DisplayQueue platform notification gating", () => {
  let originalNodeEnv;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    restoreAllMocks();
  });

  function createQueue(platformConfig = {}) {
    const mockSourcesManager = {
      updateTextSource: createMockFn().mockResolvedValue(),
      clearTextSource: createMockFn().mockResolvedValue(),
      updateChatMsgText: createMockFn().mockResolvedValue(),
      setSourceVisibility: createMockFn().mockResolvedValue(),
      setNotificationDisplayVisibility: createMockFn().mockResolvedValue(),
      setChatDisplayVisibility: createMockFn().mockResolvedValue(),
      hideAllDisplays: createMockFn().mockResolvedValue(),
      setPlatformLogoVisibility: createMockFn().mockResolvedValue(),
      setNotificationPlatformLogoVisibility: createMockFn().mockResolvedValue(),
      setGroupSourceVisibility: createMockFn().mockResolvedValue(),
      setSourceFilterVisibility: createMockFn().mockResolvedValue(),
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
      processDonationGoal: createMockFn().mockResolvedValue({ success: true }),
      processPaypiggyGoal: createMockFn().mockResolvedValue({ success: true }),
      initializeGoalDisplay: createMockFn().mockResolvedValue(),
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
