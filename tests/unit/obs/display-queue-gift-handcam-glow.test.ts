import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { createHandcamConfigFixture } from "../../helpers/config-fixture";
import { PRIORITY_LEVELS } from "../../../src/core/constants";

import { DisplayQueue } from "../../../src/obs/display-queue.ts";
import { EventEmitter } from "events";

describe("DisplayQueue gift effects handcam glow", () => {
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

  function createQueue(handcamEnabled = true) {
    const recordedTexts: string[] = [];
    const mockSourcesManager = {
      updateTextSource: createMockFn<[string, string?], Promise<void>>((_source, text) => {
        if (text !== undefined) {
        recordedTexts.push(text);
        }
        return Promise.resolve();
      }),
      clearTextSource: createMockFn<[string], Promise<void>>(() => Promise.resolve()),
      updateChatMsgText: createMockFn<[string, string, string], Promise<void>>(() => Promise.resolve()),
      getSceneItemId: createMockFn<[string, string], Promise<{ sceneItemId: number }>>(async () => ({ sceneItemId: 1 })),
      setSourceVisibility: createMockFn<[string, string, boolean], Promise<void>>(() => Promise.resolve()),
      setNotificationDisplayVisibility: createMockFn<[boolean], Promise<void>>(() => Promise.resolve()),
      setChatDisplayVisibility: createMockFn<[boolean], Promise<void>>(() => Promise.resolve()),
      hideAllDisplays: createMockFn<[], Promise<void>>(() => Promise.resolve()),
      setPlatformLogoVisibility: createMockFn<[string, Record<string, unknown>], Promise<void>>(() => Promise.resolve()),
      setNotificationPlatformLogoVisibility: createMockFn<[string, Record<string, unknown>], Promise<void>>(() => Promise.resolve()),
      hideAllPlatformLogos: createMockFn<[Record<string, unknown>], Promise<void>>(() => Promise.resolve()),
      hideAllNotificationPlatformLogos: createMockFn<[Record<string, unknown>], Promise<void>>(() => Promise.resolve()),
      getGroupSceneItemId: createMockFn<[string, string], Promise<{ sceneItemId: number }>>(async () => ({ sceneItemId: 1 })),
      setGroupSourceVisibility: createMockFn<[string, string | null | undefined, boolean], Promise<void>>(() => Promise.resolve()),
      setSourceFilterEnabled: createMockFn<[string, string, boolean], Promise<void>>(() => Promise.resolve()),
      getSourceFilterSettings: createMockFn<[string, string], Promise<Record<string, unknown>>>(async () => ({})),
      setSourceFilterSettings: createMockFn<[string, string, Record<string, unknown>], Promise<void>>(() => Promise.resolve()),
      clearSceneItemCache: createMockFn<[], void>(() => {}),
    };

    const obsManager = {
      call: createMockFn().mockResolvedValue({}),
      isConnected: () => true,
      isReady: () => Promise.resolve(true),
    };

    const mockGoalsManager = {
      processDonationGoal: createMockFn().mockResolvedValue({ success: true }),
      processPaypiggyGoal: createMockFn().mockResolvedValue({ success: true }),
      initializeGoalDisplay: createMockFn<[], Promise<void>>(() => Promise.resolve()),
      updateAllGoalDisplays: createMockFn<[], Promise<void>>(() => Promise.resolve()),
      updateGoalDisplay: createMockFn<[string, string?], Promise<void>>(() => Promise.resolve()),
      getCurrentGoalStatus: createMockFn<[string], Record<string, unknown> | null>(() => null),
      getAllCurrentGoalStatuses: createMockFn<[], Record<string, unknown>>(() => ({})),
    };

    const queue = new DisplayQueue(
      obsManager,
      {
        ttsEnabled: true,
        chat: {},
        notification: {},
        obs: { ttsTxt: "testTtsTxt" },
        handcam: createHandcamConfigFixture({ enabled: handcamEnabled }),
      },
      { PRIORITY_LEVELS },
      new EventEmitter(),
      {
        sourcesManager: mockSourcesManager,
        goalsManager: mockGoalsManager,
        delay: async () => {},
      },
    );

    return { queue, recordedTexts, mockGoalsManager, obsManager };
  }

  it("processes gift notification effects without errors when handcam enabled", async () => {
    const { queue, recordedTexts } = createQueue(true);

    await expect(
      queue.handleNotificationEffects({
        type: "platform:gift",
        platform: "tiktok",
        data: {
          username: "test-gifter",
          displayMessage: "sent a gift",
          ttsMessage: "test-gifter sent a gift",
          giftType: "rose",
          giftCount: 1,
          amount: 1,
          currency: "coins",
        },
      }),
    ).resolves.toBeUndefined();

    expect(recordedTexts.length).toBeGreaterThan(0);
  });

  it("updates TTS text source for gift notifications", async () => {
    const { queue, recordedTexts } = createQueue(true);

    await queue.handleNotificationEffects({
      type: "platform:gift",
      platform: "tiktok",
      data: {
        username: "test-gifter",
        ttsMessage: "test-gifter sent a rose",
        displayMessage: "sent a rose",
      },
    });

    expect(recordedTexts).toContain("test-gifter sent a rose");
  });

  it("processes gift notification without handcam glow when disabled", async () => {
    const { queue, recordedTexts } = createQueue(false);

    await expect(
      queue.handleNotificationEffects({
        type: "platform:gift",
        platform: "tiktok",
        data: {
          username: "test-gifter",
          ttsMessage: "test-gifter sent a gift",
          displayMessage: "sent a gift",
        },
      }),
    ).resolves.toBeUndefined();

    expect(recordedTexts.length).toBeGreaterThan(0);
  });
});
