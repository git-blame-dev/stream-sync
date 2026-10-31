import { vi, describe, expect, it, beforeEach, afterEach } from 'bun:test';


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
    vi.restoreAllMocks();
  });

  function createQueue(platformConfig = {}) {
    const mockSourcesManager = {
      updateTextSource: vi.fn<(...args: [string, string?]) => Promise<void>>(() => Promise.resolve()),
      clearTextSource: vi.fn<(...args: [string]) => Promise<void>>(() => Promise.resolve()),
      updateChatMsgText: vi.fn<(...args: [string, string, string]) => Promise<void>>(() => Promise.resolve()),
      setSourceVisibility: vi.fn<(...args: [string, string, boolean]) => Promise<void>>(() => Promise.resolve()),
      setNotificationDisplayVisibility: vi.fn<(...args: [boolean]) => Promise<void>>(() => Promise.resolve()),
      setChatDisplayVisibility: vi.fn<(...args: [boolean]) => Promise<void>>(() => Promise.resolve()),
      hideAllDisplays: vi.fn<(...args: []) => Promise<void>>(() => Promise.resolve()),
      setPlatformLogoVisibility: vi.fn<(...args: [string, Record<string, unknown>]) => Promise<void>>(() => Promise.resolve()),
      setNotificationPlatformLogoVisibility: vi.fn<(...args: [string, Record<string, unknown>]) => Promise<void>>(() => Promise.resolve()),
      hideAllPlatformLogos: vi.fn<(...args: [Record<string, unknown>]) => Promise<void>>(() => Promise.resolve()),
      hideAllNotificationPlatformLogos: vi.fn<(...args: [Record<string, unknown>]) => Promise<void>>(() => Promise.resolve()),
      setGroupSourceVisibility: vi.fn<(...args: [string, string | null | undefined, boolean]) => Promise<void>>(() => Promise.resolve()),
      getSceneItemId: vi.fn<(...args: [string, string]) => Promise<{ sceneItemId: number }>>(async () => ({ sceneItemId: 1 })),
      getGroupSceneItemId: vi.fn<(...args: [string, string]) => Promise<{ sceneItemId: number }>>(async () => ({ sceneItemId: 1 })),
      setSourceFilterEnabled: vi.fn<(...args: [string, string, boolean]) => Promise<void>>(() => Promise.resolve()),
      getSourceFilterSettings: vi.fn<(...args: [string, string]) => Promise<Record<string, unknown>>>(async () => ({})),
      setSourceFilterSettings: vi.fn<(...args: [string, string, Record<string, unknown>]) => Promise<void>>(() => Promise.resolve()),
      clearSceneItemCache: vi.fn<(...args: []) => void>(() => {}),
    };

    const obsManager = {
      call: vi.fn<(...args: unknown[]) => Promise<{}>>().mockResolvedValue({}),
      isConnected: () => true,
      isReady: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
    };

    const config = {
      autoProcess: false,
      ttsChatEnabled: false,
      ttsNotificationsEnabled: false,
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
      obs: {},
      youtube: {},
      twitch: {},
      tiktok: {},
      ...platformConfig,
    };

    const mockGoalsManager = {
      processDonationGoal: vi.fn<(...args: [unknown, number]) => Promise<{ success: boolean }>>(async () => ({ success: true })),
      processPaypiggyGoal: vi.fn<(...args: [string]) => Promise<{ success: boolean }>>(async () => ({ success: true })),
      initializeGoalDisplay: vi.fn<(...args: []) => Promise<void>>(() => Promise.resolve()),
      updateAllGoalDisplays: vi.fn<(...args: []) => Promise<void>>(() => Promise.resolve()),
      updateGoalDisplay: vi.fn<(...args: [string, string?]) => Promise<void>>(() => Promise.resolve()),
      getCurrentGoalStatus: vi.fn<(...args: [string]) => Record<string, unknown> | null>(() => null),
      getAllCurrentGoalStatuses: vi.fn<(...args: []) => Record<string, unknown>>(() => ({})),
    };

    const eventBus = new EventEmitter();
    const queue = new DisplayQueue(
      obsManager,
      config,
      { PRIORITY_LEVELS },
       eventBus,
      { sourcesManager: mockSourcesManager, goalsManager: mockGoalsManager },
    );

    return { queue, mockSourcesManager, mockGoalsManager, eventBus };
  }

  it("displays notification for configured platform", async () => {
    const { queue, mockSourcesManager, eventBus } = createQueue({
      twitch: { messagesEnabled: true },
    });
    const rows: Record<string, unknown>[] = [];
    eventBus.on("display:row", (row: Record<string, unknown>) => rows.push(row));

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

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ type: "platform:follow", platform: "twitch" }));
    expect(mockSourcesManager.setNotificationDisplayVisibility).not.toHaveBeenCalled();
  });

  it("displays notification for platforms without explicit config", async () => {
    const { queue, mockSourcesManager, eventBus } = createQueue({});
    const rows: Record<string, unknown>[] = [];
    eventBus.on("display:row", (row: Record<string, unknown>) => rows.push(row));

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

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ type: "platform:follow", platform: "youtube" }));
    expect(mockSourcesManager.setNotificationDisplayVisibility).not.toHaveBeenCalled();
  });
});
