import { describe, expect, beforeEach, afterEach, it } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";

import { DisplayQueue } from "../../../src/obs/display-queue.ts";

type DisplayQueueConfig = ConstructorParameters<typeof DisplayQueue>[1];
type DisplayQueueConstants = ConstructorParameters<typeof DisplayQueue>[2];
type DisplayQueueDependencies = NonNullable<
  ConstructorParameters<typeof DisplayQueue>[4]
>;
type DisplayQueueObsManager = ConstructorParameters<typeof DisplayQueue>[0];
type TestDisplayQueueConfig = NonNullable<DisplayQueueConfig> & {
  goals: { enabled: boolean; targetAmount: number };
  timing: { transitionDelay: number; notificationClearDelay: number; chatMessageDuration: number };
};

function createObsManager(): DisplayQueueObsManager {
  return {
    call: createMockFn<
      [requestType: string, payload: Record<string, unknown>],
      Promise<unknown>
    >(async () => ({})),
    isReady: createMockFn<[], Promise<boolean>>(async () => true),
  };
}

function createSourcesManager(): NonNullable<
  DisplayQueueDependencies["sourcesManager"]
> {
  return {
    updateTextSource: createMockFn<[string, string?], Promise<void>>(
      async () => {},
    ),
    clearTextSource: createMockFn<[string], Promise<void>>(async () => {}),
    updateChatMsgText: createMockFn<[string, string, string], Promise<void>>(
      async () => {},
    ),
    getSceneItemId: async () => ({ sceneItemId: 1 }),
    setSourceVisibility: createMockFn<
      [string, string, boolean],
      Promise<void>
    >(async () => {}),
    getGroupSceneItemId: async () => ({ sceneItemId: 1 }),
    setGroupSourceVisibility: async () => {},
    setPlatformLogoVisibility: async () => {},
    setNotificationPlatformLogoVisibility: async () => {},
    hideAllPlatformLogos: async () => {},
    hideAllNotificationPlatformLogos: async () => {},
    setChatDisplayVisibility: createMockFn<[boolean], Promise<void>>(
      async () => {},
    ),
    setNotificationDisplayVisibility: createMockFn<[boolean], Promise<void>>(
      async () => {},
    ),
    hideAllDisplays: createMockFn<[], Promise<void>>(async () => {}),
    setSourceFilterEnabled: createMockFn<
      [string, string, boolean],
      Promise<void>
    >(async () => {}),
    getSourceFilterSettings: createMockFn<
      [string, string],
      Promise<Record<string, unknown>>
    >(async () => ({})),
    setSourceFilterSettings: createMockFn<
      [string, string, Record<string, unknown>],
      Promise<void>
    >(async () => {}),
    clearSceneItemCache: createMockFn<[], void>(() => {}),
  };
}

describe("Cross-Platform Goal Calculation", () => {
  let displayQueue: DisplayQueue;
  let mockOBSManager: DisplayQueueObsManager;
  let configFixture: TestDisplayQueueConfig;
  let mockConstants: DisplayQueueConstants;
  let goalTotals: Record<string, number>;

  beforeEach(() => {
    mockOBSManager = createObsManager();

    configFixture = {
      autoProcess: false,
      maxQueueSize: 100,
      goals: {
        enabled: true,
        targetAmount: 1000,
      },
      timing: {
        transitionDelay: 200,
        notificationClearDelay: 500,
        chatMessageDuration: 4500,
      },
      notification: {
        sourceName: "NotificationText",
        sceneName: "Main Scene",
        groupName: "NotificationGroup",
        platformLogos: {
          twitch: "TwitchLogo",
          youtube: "YoutubeLogo",
          tiktok: "TiktokLogo",
        },
      },
      chat: {
        sourceName: "ChatText",
        sceneName: "Main Scene",
        groupName: "ChatGroup",
        platformLogos: {
          twitch: "TwitchLogo",
          youtube: "YoutubeLogo",
          tiktok: "TiktokLogo",
        },
      },
      handcam: { enabled: false },
      gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
      obs: { ttsTxt: "tts-text" },
      youtube: {},
      twitch: {},
      tiktok: {},
      ttsEnabled: false,
    };

    mockConstants = {
      NOTIFICATION_CLEAR_DELAY: 200,
      NOTIFICATION_FADE_DURATION: 1000,
    };

    goalTotals = {};
    const mockDependencies: DisplayQueueDependencies = {
      sourcesManager: createSourcesManager(),
      goalsManager: {
        processDonationGoal: createMockFn<
          [platform: unknown, amount: number],
          Promise<{ success: boolean }>
        >(async (platform, amount) => {
          if (typeof platform === "string") {
            goalTotals[platform] = (goalTotals[platform] || 0) + amount;
          }
          return { success: true };
        }),
        processPaypiggyGoal: createMockFn<
          [platform: string],
          Promise<{ success: boolean }>
        >(async () => ({
          success: true,
        })),
        initializeGoalDisplay: createMockFn<[], Promise<void>>(async () => {}),
        updateAllGoalDisplays: createMockFn<[], Promise<void>>(async () => {}),
        updateGoalDisplay: createMockFn<[string], Promise<void>>(async () => {}),
        getCurrentGoalStatus: () => null,
        getAllCurrentGoalStatuses: () => ({}),
      },
      delay: async () => {},
    };

    displayQueue = new DisplayQueue(
      mockOBSManager,
      configFixture,
      mockConstants,
      null,
      mockDependencies,
    );
  });

  afterEach(() => {
    restoreAllMocks();
    if (displayQueue) {
      displayQueue.stop();
    }
  });

  describe("TikTok gifts should use total amount correctly", () => {
    it("should use the total TikTok amount for goal tracking", async () => {
      configFixture.goals.enabled = true;

      const tiktokGift = {
        type: "platform:gift",
        data: {
          username: "test-tiktok-user",
          displayName: "test-tiktok-user",
          giftType: "Rose",
          giftCount: 5,
          amount: 50,
          currency: "coins",
          displayMessage: "test-tiktok-user sent 5 Rose",
          platform: "tiktok",
        },
        platform: "tiktok",
        priority: 3,
      };

      displayQueue.addItem(tiktokGift);
      await displayQueue.processQueue();

      expect(goalTotals.tiktok).toBe(50);
    });

    it("should use TikTok total amount derived from repeat count", async () => {
      configFixture.goals.enabled = true;

      const tiktokDiamonds = {
        type: "platform:gift",
        data: {
          username: "test-tiktok-diamond-user",
          displayName: "test-tiktok-diamond-user",
          giftType: "Diamond",
          giftCount: 3,
          amount: 300,
          currency: "coins",
          displayMessage: "test-tiktok-diamond-user sent 3 Diamond",
          platform: "tiktok",
        },
        platform: "tiktok",
        priority: 3,
      };

      displayQueue.addItem(tiktokDiamonds);
      await displayQueue.processQueue();

      expect(goalTotals.tiktok).toBe(300);
    });
  });

  describe("YouTube donations should use total amount correctly", () => {
    it("should use the total YouTube amount for goal tracking", async () => {
      configFixture.goals.enabled = true;

      const youtubeDonation = {
        type: "platform:gift",
        data: {
          username: "test-youtube-user",
          displayName: "test-youtube-user",
          giftType: "Donation",
          giftCount: 2,
          amount: 10,
          currency: "USD",
          displayMessage: "test-youtube-user sent 2 Donation",
          platform: "youtube",
        },
        platform: "youtube",
        priority: 3,
      };

      displayQueue.addItem(youtubeDonation);
      await displayQueue.processQueue();

      expect(goalTotals.youtube).toBe(10);
    });
  });

  describe("Twitch bits should NOT multiply", () => {
    it("should use Twitch bits value directly without multiplication", async () => {
      configFixture.goals.enabled = true;

      const twitchBits = {
        type: "platform:gift",
        data: {
          username: "test-twitch-user",
          displayName: "test-twitch-user",
          message: "Cheer100",
          bits: 100,
          giftType: "bits",
          giftCount: 1,
          amount: 100,
          currency: "bits",
          displayMessage: "test-twitch-user sent 100 bits",
          platform: "twitch",
        },
        platform: "twitch",
        priority: 3,
      };

      displayQueue.addItem(twitchBits);
      await displayQueue.processQueue();

      expect(goalTotals.twitch).toBe(100);
    });
  });

  describe("Edge cases", () => {
    it("should handle gifts with zero or missing values gracefully", async () => {
      configFixture.goals.enabled = true;

      const edgeCases = [
        {
          type: "platform:gift",
          data: {
            username: "test-user-1",
            giftType: "Rose",
            giftCount: 10,
            amount: 0,
            currency: "coins",
            displayMessage: "test-user-1 sent 10 Rose",
            platform: "tiktok",
          },
          platform: "tiktok",
        },
        {
          type: "platform:gift",
          data: {
            username: "test-user-2",
            giftType: "Rose",
            giftCount: 0,
            amount: 10,
            currency: "coins",
            displayMessage: "test-user-2 sent 0 Rose",
            platform: "tiktok",
          },
          platform: "tiktok",
        },
        {
          type: "platform:gift",
          data: {
            username: "test-user-3",
            displayMessage: "test-user-3 sent a gift",
            platform: "youtube",
          },
          platform: "youtube",
        },
      ];

      for (const gift of edgeCases) {
        displayQueue.addItem(gift);
        await displayQueue.processQueue();
      }

      expect(Object.keys(goalTotals)).toHaveLength(0);
    });

    it("should skip goal tracking for error gifts", async () => {
      configFixture.goals.enabled = true;

      const errorGift = {
        type: "platform:gift",
        data: {
          username: "test-unknown-user",
          giftType: "Unknown gift",
          giftCount: 0,
          amount: 100,
          currency: "bits",
          displayMessage: "Error processing gift",
          isError: true,
          platform: "twitch",
        },
        platform: "twitch",
        priority: 3,
      };

      displayQueue.addItem(errorGift);
      await displayQueue.processQueue();

      expect(Object.keys(goalTotals)).toHaveLength(0);
    });
  });
});
