import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { createHandcamConfigFixture } from "../../helpers/config-fixture";
import { PRIORITY_LEVELS } from "../../../src/core/constants";

import { DisplayQueue } from "../../../src/obs/display-queue.ts";
import { EventEmitter } from "events";

describe("DisplayQueue gift effects handcam glow", () => {
  let originalNodeEnv;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    restoreAllMocks();
  });

  function createQueue(handcamEnabled = true) {
    const recordedTexts = [];
    const mockSourcesManager = {
      updateTextSource: createMockFn((source, text) => {
        recordedTexts.push(text);
        return Promise.resolve();
      }),
      clearTextSource: createMockFn().mockResolvedValue(),
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
    };

    const mockGoalsManager = {
      processDonationGoal: createMockFn().mockResolvedValue({ success: true }),
      processPaypiggyGoal: createMockFn().mockResolvedValue({ success: true }),
      initializeGoalDisplay: createMockFn().mockResolvedValue(),
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
