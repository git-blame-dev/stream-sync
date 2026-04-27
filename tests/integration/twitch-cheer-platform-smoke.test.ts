import { describe, test, afterEach, expect } from "bun:test";

import EventEmitter from "events";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import NotificationManager from "../../src/notifications/NotificationManager";
import { createTestAppRuntime } from "../helpers/runtime-test-harness";
import { createMockDisplayQueue, noOpLogger } from "../helpers/mock-factories";
import { createTextProcessingManager } from "../../src/utils/text-processing";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { createConfigFixture } from "../helpers/config-fixture";

describe("Twitch bits gift platform flow (smoke)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const createEventBus = () => {
    const emitter = new EventEmitter();
    return {
      emit: emitter.emit.bind(emitter),
      on: emitter.on.bind(emitter),
      subscribe: (event, handler) => {
        emitter.on(event, handler);
        return () => emitter.off(event, handler);
      },
    };
  };

  test("routes bits gift through lifecycle, router, and runtime as gift", async () => {
    const eventBus = createEventBus();
    const logger = noOpLogger;
    const displayQueue = createMockDisplayQueue();
    const textProcessing = createTextProcessingManager({ logger });
    const configOverrides = {
      general: {
        debugEnabled: false,
        giftsEnabled: true,
        paypiggiesEnabled: true,
      },
      twitch: { enabled: true },
      obs: { enabled: false },
    };
    const config = createConfigFixture(configOverrides);
    const notificationManager = new NotificationManager({
      displayQueue,
      logger,
      eventBus,
      config,
      constants: require("../../src/core/constants"),
      textProcessing,
      obsGoals: { processDonationGoal: createMockFn() },
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue(null),
      },
      userTrackingService: {
        isFirstMessage: createMockFn().mockResolvedValue(false),
      },
    });

    const platformLifecycleService = new PlatformLifecycleService({
      config: { twitch: { enabled: true } },
      eventBus,
      logger,
    });

    const { runtime } = createTestAppRuntime(configOverrides, {
      eventBus,
      notificationManager,
      displayQueue,
      logger,
      platformLifecycleService,
    });

    class MockTwitchPlatform {
      async initialize(handlers) {
        handlers.onGift({
          username: "test_user",
          userId: "tw-cheer-1",
          giftType: "mixed bits",
          giftCount: 1,
          amount: 234,
          currency: "bits",
          message: "",
          id: "cheer-event-234",
          repeatCount: 1,
          timestamp: "2024-01-01T00:00:00.000Z",
          cheermoteInfo: {
            count: 2,
            totalBits: 234,
            cleanPrefix: "Cheer",
            types: [
              { prefix: "Cheer", count: 1 },
              { prefix: "Uni", count: 1 },
            ],
            isMixed: true,
          },
        });
      }

      on() {}

      cleanup() {
        return Promise.resolve();
      }
    }

    try {
      await platformLifecycleService.initializeAllPlatforms({
        twitch: MockTwitchPlatform,
      });
      await new Promise(setImmediate);

      expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
      const queued = displayQueue.addItem.mock.calls[0][0];
      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("twitch");
      expect(queued.data.username).toBe("test_user");
      expect(queued.data.amount).toBe(234);
      expect(queued.data.currency).toBe("bits");
      expect(queued.data.displayMessage).toBe("test_user sent 234 mixed bits");
      expect(queued.data.parts).toBeUndefined();
    } finally {
      runtime.platformEventRouter?.dispose();
      platformLifecycleService.dispose();
    }
  });

  test("routes single-type bits gift with inline image parts", async () => {
    const eventBus = createEventBus();
    const logger = noOpLogger;
    const displayQueue = createMockDisplayQueue();
    const textProcessing = createTextProcessingManager({ logger });
    const configOverrides = {
      general: {
        debugEnabled: false,
        giftsEnabled: true,
        paypiggiesEnabled: true,
      },
      twitch: { enabled: true },
      obs: { enabled: false },
    };
    const config = createConfigFixture(configOverrides);
    const notificationManager = new NotificationManager({
      displayQueue,
      logger,
      eventBus,
      config,
      constants: require("../../src/core/constants"),
      textProcessing,
      obsGoals: { processDonationGoal: createMockFn() },
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue(null),
      },
      userTrackingService: {
        isFirstMessage: createMockFn().mockResolvedValue(false),
      },
    });

    const platformLifecycleService = new PlatformLifecycleService({
      config: { twitch: { enabled: true } },
      eventBus,
      logger,
    });

    const { runtime } = createTestAppRuntime(configOverrides, {
      eventBus,
      notificationManager,
      displayQueue,
      logger,
      platformLifecycleService,
    });

    class MockTwitchPlatform {
      async initialize(handlers) {
        handlers.onGift({
          username: "test_user",
          userId: "tw-cheer-2",
          giftType: "bits",
          giftCount: 1,
          amount: 100,
          currency: "bits",
          message: "go team",
          id: "cheer-event-100",
          repeatCount: 1,
          timestamp: "2024-01-01T00:00:00.000Z",
          giftImageUrl:
            "https://example.invalid/twitch/cheer-100-dark-animated-3.gif",
          cheermoteInfo: {
            cleanPrefix: "Cheer",
            tier: 100,
            isMixed: false,
          },
        });
      }

      on() {}

      cleanup() {
        return Promise.resolve();
      }
    }

    try {
      await platformLifecycleService.initializeAllPlatforms({
        twitch: MockTwitchPlatform,
      });
      await new Promise(setImmediate);

      expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
      const queued = displayQueue.addItem.mock.calls[0][0];
      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("twitch");
      expect(queued.data.parts).toEqual([
        { type: "text", text: "sent 100 " },
        {
          type: "emote",
          platform: "twitch",
          emoteId: "Cheer-100",
          imageUrl:
            "https://example.invalid/twitch/cheer-100-dark-animated-3.gif",
        },
        { type: "text", text: ": go team" },
      ]);
    } finally {
      runtime.platformEventRouter?.dispose();
      platformLifecycleService.dispose();
    }
  });
});
