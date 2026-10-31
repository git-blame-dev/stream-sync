import type { DisplayQueueItem } from "../../../src/interfaces/DisplayQueue";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
  type TestMockFn,
} from "../../helpers/bun-mock-utils";
import { createConfigFixture } from "../../helpers/config-fixture";
import { PRIORITY_LEVELS } from "../../../src/core/constants";
import { registerMockLifecycleHooks } from "../../helpers/mock-lifecycle";
import NotificationManager from "../../../src/notifications/NotificationManager";

type NotificationManagerLike = {
  handleNotificationInternal: (
    notificationType: string,
    platform: string,
    data: Record<string, unknown>,
    skipSpamDetection: boolean,
  ) => Promise<unknown>;
};

type LoggerSpy = {
  debug: ReturnType<typeof createMockFn>;
  info: ReturnType<typeof createMockFn>;
  warn: ReturnType<typeof createMockFn>;
  error: ReturnType<typeof createMockFn>;
  console: ReturnType<typeof createMockFn>;
};

type NotificationConstants = {
  PRIORITY_LEVELS: typeof PRIORITY_LEVELS;
  NOTIFICATION_CONFIGS: Record<
    string,
    {
      priority: number;
      duration: number;
      settingKey: string;
      commandKey: string;
    }
  >;
};

type DisplayQueueMock = {
  addItem: ReturnType<typeof createMockFn<[DisplayQueueItem], readonly DisplayQueueItem[]>>;
  processQueue: ReturnType<typeof createMockFn>;
  getQueueLength: TestMockFn<[], number>;
};

registerMockLifecycleHooks({
  clearCallsBeforeEach: true,
  logPerformanceMetrics: true,
});

describe("NotificationManager logger argument order", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let spyLogger: LoggerSpy;
  let mockConstants: NotificationConstants;
  let mockDisplayQueue: DisplayQueueMock;
  let config: ReturnType<typeof createConfigFixture>;

  beforeEach(() => {
    spyLogger = {
      debug: createMockFn(),
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
      console: createMockFn(),
    };

    mockConstants = {
      PRIORITY_LEVELS,
      NOTIFICATION_CONFIGS: {
        "platform:gift": {
          priority: PRIORITY_LEVELS.GIFT,
          duration: 5000,
          settingKey: "giftsEnabled",
          commandKey: "gifts",
        },
      },
    };

    mockDisplayQueue = {
      addItem: createMockFn<[DisplayQueueItem], readonly DisplayQueueItem[]>((item) => [item]),
      processQueue: createMockFn(),
      getQueueLength: createMockFn<[], number>(() => 0),
    };

    config = createConfigFixture({
      general: {
        giftsEnabled: true,
        debugEnabled: true,
      },
    });

  });

  function createManager(
    overrides: Record<string, unknown> = {},
  ): NotificationManagerLike {
    const mockEventBus = {
      emit: createMockFn(),
      on: createMockFn(),
      off: createMockFn(),
    };
    return new NotificationManager({
      displayQueue: mockDisplayQueue,
      logger: spyLogger,
      eventBus: mockEventBus,
      config,
      constants: mockConstants,
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue(null),
      },
      ...overrides,
    });
  }

  describe("spam detection logging", () => {
    it("suppresses spam without logging donor identity", async () => {
      const mockSpamDetector = {
        handleDonationSpam: createMockFn().mockReturnValue({
          shouldShow: false,
        }),
      };
      const manager = createManager({ donationSpamDetector: mockSpamDetector });

      await manager.handleNotificationInternal(
        "platform:gift",
        "tiktok",
        {
          userId: "test-user-1",
          username: "TestUser",
          giftType: "Rose",
          giftCount: 1,
          amount: 10,
          currency: "coins",
        },
        false,
      );

      expect(mockSpamDetector.handleDonationSpam).toHaveBeenCalledTimes(1);
      expect(spyLogger.debug).not.toHaveBeenCalled();
      expect(spyLogger.info).not.toHaveBeenCalled();
    });

    it("logs error with platform as source when spam detection throws", async () => {
      const mockSpamDetector = {
        handleDonationSpam: createMockFn().mockImplementation(() => {
          throw new Error("spam detector failure");
        }),
      };
      const manager = createManager({ donationSpamDetector: mockSpamDetector });

      await manager.handleNotificationInternal(
        "platform:gift",
        "youtube",
        {
          userId: "test-user-2",
          username: "TestUser",
          giftType: "Super Chat",
          giftCount: 1,
          amount: 5,
          currency: "USD",
        },
        false,
      );

      const warnCall = spyLogger.warn.mock.calls.find(
        ([msg]) =>
          typeof msg === "string" && msg.includes("Error in spam detection"),
      );
      expect(warnCall).toBeDefined();
      if (warnCall === undefined) {
        throw new Error("Expected spam detection warning log");
      }
      const [message, source] = warnCall;
      expect(message).toContain("spam detector failure");
      expect(source).toBe("youtube");
    });
  });

  describe("debug notification logging", () => {
    it("prepares the display item without a duplicate presentation log when debug enabled", async () => {
      const manager = createManager();

      const result = await manager.handleNotificationInternal(
        "platform:gift",
        "twitch",
        {
          userId: "test-user-3",
          username: "TestUser",
          giftType: "Sub Gift",
          giftCount: 1,
          amount: 5,
          currency: "USD",
        },
        false,
      );

      expect(result).toMatchObject({ success: true, platform: "twitch" });
      expect(spyLogger.info).not.toHaveBeenCalled();
      expect(spyLogger.debug).not.toHaveBeenCalled();
    });
  });
});
