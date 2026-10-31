import type { DisplayQueueItem } from "../../../src/interfaces/DisplayQueue";
import { vi, type Mock, beforeEach, describe, expect, it } from "bun:test";
import { createConfigFixture } from "../../helpers/config-fixture";
import { PRIORITY_LEVELS } from "../../../src/core/constants";
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
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  console: ReturnType<typeof vi.fn>;
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
  addItem: ReturnType<typeof vi.fn<(...args: [DisplayQueueItem]) => readonly DisplayQueueItem[]>>;
  processQueue: ReturnType<typeof vi.fn>;
  getQueueLength: Mock<() => number>;
};

describe("NotificationManager logger argument order", () => {
  let spyLogger: LoggerSpy;
  let mockConstants: NotificationConstants;
  let mockDisplayQueue: DisplayQueueMock;
  let config: ReturnType<typeof createConfigFixture>;

  beforeEach(() => {
    spyLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      console: vi.fn(),
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
      addItem: vi.fn<(...args: [DisplayQueueItem]) => readonly DisplayQueueItem[]>((item) => [item]),
      processQueue: vi.fn(),
      getQueueLength: vi.fn<() => number>(() => 0),
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
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    return new NotificationManager({
      displayQueue: mockDisplayQueue,
      logger: spyLogger,
      eventBus: mockEventBus,
      config,
      constants: mockConstants,
      vfxCommandService: {
        getVFXConfig: vi.fn().mockResolvedValue(null),
      },
      ...overrides,
    });
  }

  describe("spam detection logging", () => {
    it("suppresses spam without logging donor identity", async () => {
      const mockSpamDetector = {
        handleDonationSpam: vi.fn().mockReturnValue({
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
        handleDonationSpam: vi.fn().mockImplementation(() => {
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
