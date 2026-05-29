import { describe, expect, beforeEach, afterEach, it } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { DisplayQueue } from "../../../src/obs/display-queue.ts";

type DisplayQueueConfig = ConstructorParameters<typeof DisplayQueue>[1];
type DisplayQueueDependencies = NonNullable<
  ConstructorParameters<typeof DisplayQueue>[4]
>;
type DisplayQueueObsManager = ConstructorParameters<typeof DisplayQueue>[0];
type RecordedGoal = { platform: string; amount: number };
type TestDisplayQueueConfig = NonNullable<DisplayQueueConfig> & {
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

describe("DisplayQueue - Twitch Bits Goal Calculation", () => {
  let displayQueue: DisplayQueue;
  let mockOBSManager: DisplayQueueObsManager;
  let configFixture: TestDisplayQueueConfig;
  let mockGoalsManager: NonNullable<DisplayQueueDependencies["goalsManager"]>;
  let recordedGoals: RecordedGoal[];

  beforeEach(() => {
    mockOBSManager = createObsManager();

    recordedGoals = [];
    mockGoalsManager = {
      processDonationGoal: createMockFn<
        [platform: unknown, amount: number],
        Promise<{ success: boolean }>
      >(async (platform, amount) => {
        if (typeof platform === "string") {
          recordedGoals.push({ platform, amount });
        }
        return { success: true };
      }),
      processPaypiggyGoal: createMockFn<
        [platform: string],
        Promise<{ success: boolean }>
      >(async () => ({ success: true })),
      initializeGoalDisplay: createMockFn<[], Promise<void>>(async () => {}),
      updateAllGoalDisplays: createMockFn<[], Promise<void>>(async () => {}),
      updateGoalDisplay: createMockFn<[string], Promise<void>>(async () => {}),
      getCurrentGoalStatus: () => null,
      getAllCurrentGoalStatuses: () => ({}),
    };

    configFixture = {
      autoProcess: false,
      maxQueueSize: 100,
      goals: { enabled: true, targetAmount: 1000 },
      timing: {
        transitionDelay: 200,
        notificationClearDelay: 500,
        chatMessageDuration: 4500,
      },
      notification: {
        sourceName: "TestNotificationText",
        sceneName: "TestMainScene",
        groupName: "TestNotificationGroup",
        platformLogos: { twitch: "TestTwitchLogo" },
      },
      chat: {
        sourceName: "TestChatText",
        sceneName: "TestMainScene",
        groupName: "TestChatGroup",
        platformLogos: { twitch: "TestTwitchLogo" },
      },
      handcam: { enabled: false },
      gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
      obs: { ttsTxt: "tts-text" },
      youtube: {},
      twitch: {},
      tiktok: {},
      ttsEnabled: false,
    };

    displayQueue = new DisplayQueue(mockOBSManager, configFixture, {}, null, {
      goalsManager: mockGoalsManager,
      sourcesManager: createSourcesManager(),
      delay: async () => {},
    });
  });

  afterEach(() => {
    if (displayQueue) {
      displayQueue.stop();
    }
  });

  describe("Twitch bits contribution to goals", () => {
    it("adds exact bits amount to goal without multiplication", async () => {
      const bitsEvent = {
        type: "platform:gift",
        data: {
          username: "test-user",
          displayName: "test-user",
          message: "Corgo100 Corgo100",
          bits: 200,
          giftType: "bits",
          giftCount: 1,
          amount: 200,
          currency: "bits",
          displayMessage: "test-user sent 200 bits",
          platform: "twitch",
        },
        platform: "twitch",
        priority: 3,
      };

      displayQueue.addItem(bitsEvent);
      await displayQueue.processQueue();

      expect(recordedGoals).toEqual([{ platform: "twitch", amount: 200 }]);
    });

    it("handles multiple bit cheers without multiplication", async () => {
      const cheers = [
        { username: "test-user-1", bits: 100 },
        { username: "test-user-2", bits: 500 },
        { username: "test-user-3", bits: 50 },
      ];

      for (const cheer of cheers) {
        const event = {
          type: "platform:gift",
          data: {
            username: cheer.username,
            displayName: cheer.username,
            message: `Cheer${cheer.bits}`,
            bits: cheer.bits,
            giftType: "bits",
            giftCount: 1,
            amount: cheer.bits,
            currency: "bits",
            displayMessage: `${cheer.username} sent ${cheer.bits} bits`,
            platform: "twitch",
          },
          platform: "twitch",
          priority: 3,
        };
        displayQueue.addItem(event);
      }

      await displayQueue.processQueue();

      expect(recordedGoals).toEqual([
        { platform: "twitch", amount: 100 },
        { platform: "twitch", amount: 500 },
        { platform: "twitch", amount: 50 },
      ]);
    });

    it("handles single bit cheer correctly", async () => {
      const singleBitEvent = {
        type: "platform:gift",
        data: {
          username: "test-small-cheerer",
          displayName: "test-small-cheerer",
          message: "Cheer1",
          bits: 1,
          giftType: "bits",
          giftCount: 1,
          amount: 1,
          currency: "bits",
          displayMessage: "test-small-cheerer sent 1 bits",
          platform: "twitch",
        },
        platform: "twitch",
        priority: 3,
      };

      displayQueue.addItem(singleBitEvent);
      await displayQueue.processQueue();

      expect(recordedGoals).toEqual([{ platform: "twitch", amount: 1 }]);
    });
  });

  describe("User experience validation", () => {
    it("displays correct goal progress after bits donation", async () => {
      const bitsEvent = {
        type: "platform:gift",
        data: {
          username: "test-generous-viewer",
          displayName: "test-generous-viewer",
          message: "Corgo100 Corgo100",
          bits: 200,
          giftType: "bits",
          giftCount: 1,
          amount: 200,
          currency: "bits",
          displayMessage: "test-generous-viewer sent 200 bits",
          platform: "twitch",
        },
        platform: "twitch",
        priority: 3,
      };

      displayQueue.addItem(bitsEvent);
      await displayQueue.processQueue();

      expect(recordedGoals).toEqual([{ platform: "twitch", amount: 200 }]);
    });

    it("handles multi-cheermote scenarios without goal inflation", async () => {
      const realWorldScenario = {
        type: "platform:gift",
        data: {
          username: "test-real-user",
          displayName: "test-real-user",
          message: "Corgo100 Corgo100",
          bits: 200,
          giftType: "bits",
          giftCount: 1,
          amount: 200,
          currency: "bits",
          cheermoteInfo: { type: "Corgo", count: 2, cleanPrefix: "Corgo" },
          displayMessage: "test-real-user sent 200 bits",
          platform: "twitch",
        },
        platform: "twitch",
        priority: 3,
      };

      displayQueue.addItem(realWorldScenario);
      await displayQueue.processQueue();

      expect(recordedGoals).toEqual([{ platform: "twitch", amount: 200 }]);
    });
  });
});
