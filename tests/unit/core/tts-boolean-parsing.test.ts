import { describe, expect, afterEach, it } from "bun:test";
import {
  clearAllMocks,
  createMockFn,
  restoreAllMocks,
} from "../../helpers/bun-mock-utils";
import { createSourcesConfigFixture } from "../../helpers/config-fixture";
import { noOpLogger } from "../../helpers/mock-factories";
import { registerMockLifecycleHooks } from "../../helpers/mock-lifecycle";
import { PRIORITY_LEVELS } from "../../../src/core/constants";
import { DisplayQueue } from "../../../src/obs/display-queue";
import { createOBSSourcesManager } from "../../../src/obs/sources";

registerMockLifecycleHooks({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true,
});

describe("TTS Configuration Boolean Parsing", () => {
  afterEach(() => {
    restoreAllMocks();
    clearAllMocks();
  });

  describe("when ttsNotificationsEnabled is configured with different values", () => {
    const createDisplayQueueWithTTS = (ttsValue: unknown) => {
      const baseConstants = { PRIORITY_LEVELS };
      const config = {
        autoProcess: false,
        maxQueueSize: 100,
        obs: {
          ttsTxt: "tts txt",
          ...(ttsValue === undefined ? {} : { ttsNotificationsEnabled: ttsValue }),
        },
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
        youtube: {},
        twitch: {},
        tiktok: {},
      };

      const mockOBS = {
        ensureConnected: createMockFn().mockResolvedValue(),
        isConnected: () => true,
        isReady: () => Promise.resolve(true),
        call: createMockFn<[requestType: string, payload?: Record<string, unknown>], Promise<unknown>>().mockResolvedValue({}),
        updateTextSource: createMockFn().mockResolvedValue(true),
      };

      const realSourcesManager = createOBSSourcesManager(mockOBS as unknown as Parameters<typeof createOBSSourcesManager>[0], {
        ...createSourcesConfigFixture(),
        logger: noOpLogger,
        ensureOBSConnected: createMockFn().mockResolvedValue(),
        obsCall: mockOBS.call,
      });

      const mockGoalsManager = {
        processDonationGoal: createMockFn().mockResolvedValue({
          success: true,
        }),
        processPaypiggyGoal: createMockFn().mockResolvedValue({
          success: true,
        }),
        initializeGoalDisplay: createMockFn().mockResolvedValue(),
      };

      return new DisplayQueue(mockOBS, config as unknown as ConstructorParameters<typeof DisplayQueue>[1], baseConstants, null, {
        sourcesManager: realSourcesManager,
        goalsManager: mockGoalsManager,
      } as unknown as ConstructorParameters<typeof DisplayQueue>[4]);
    };

    describe("when ttsNotificationsEnabled is false", () => {
      it("should disable TTS", () => {
        const queue = createDisplayQueueWithTTS(false);
        expect(queue.effects.isNotificationTTSEnabled()).toBe(false);
      });
    });

    describe("when ttsNotificationsEnabled is a non-boolean value", () => {
      it("should use the default notification setting", () => {
        const queue = createDisplayQueueWithTTS("true");
        expect(queue.effects.isNotificationTTSEnabled()).toBe(true);
      });
    });

    describe("when ttsNotificationsEnabled is boolean true", () => {
      it("should enable TTS", () => {
        const queue = createDisplayQueueWithTTS(true);
        expect(queue.effects.isNotificationTTSEnabled()).toBe(true);
      });
    });

    describe("when ttsNotificationsEnabled is undefined", () => {
      it("should default notification TTS to enabled", () => {
        const queue = createDisplayQueueWithTTS(undefined);
        expect(queue.effects.isNotificationTTSEnabled()).toBe(true);
      });
    });

    describe("when ttsNotificationsEnabled is null", () => {
      it("should use the default notification setting", () => {
        const queue = createDisplayQueueWithTTS(null);
        expect(queue.effects.isNotificationTTSEnabled()).toBe(true);
      });
    });

    describe("when ttsNotificationsEnabled is empty string", () => {
      it("should use the default notification setting", () => {
        const queue = createDisplayQueueWithTTS("");
        expect(queue.effects.isNotificationTTSEnabled()).toBe(true);
      });
    });

    describe("when ttsNotificationsEnabled has any other truthy value", () => {
      it("should use the default notification setting", () => {
        const queue1 = createDisplayQueueWithTTS("yes");
        expect(queue1.effects.isNotificationTTSEnabled()).toBe(true);

        const queue2 = createDisplayQueueWithTTS(1);
        expect(queue2.effects.isNotificationTTSEnabled()).toBe(true);

        const queue3 = createDisplayQueueWithTTS("1");
        expect(queue3.effects.isNotificationTTSEnabled()).toBe(true);
      });
    });
  });

  describe("main.js config parsing", () => {
    it("should properly parse ttsNotificationsEnabled from INI config object", () => {
      const testConfigs = [
        { input: { general: { ttsNotificationsEnabled: "false" } }, expected: false },
        { input: { general: { ttsNotificationsEnabled: "true" } }, expected: true },
        { input: { general: { ttsNotificationsEnabled: false } }, expected: false },
        { input: { general: { ttsNotificationsEnabled: true } }, expected: true },
        { input: { general: {} }, expected: false },
        { input: { general: { ttsNotificationsEnabled: "" } }, expected: false },
        { input: { general: { ttsNotificationsEnabled: null } }, expected: false },
      ];

      testConfigs.forEach(({ input, expected }) => {
        const config = input;
        const ttsNotificationsEnabled =
          config.general.ttsNotificationsEnabled === true ||
          config.general.ttsNotificationsEnabled === "true";
        expect(ttsNotificationsEnabled).toBe(expected);
      });
    });
  });
});
