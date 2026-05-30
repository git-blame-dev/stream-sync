import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  type TestMockFn,
  createMockFn,
  restoreAllMocks,
} from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { PRIORITY_LEVELS } from "../../../src/core/constants";
import { config as appConfig } from "../../../src/core/config";
import NotificationManager from "../../../src/notifications/NotificationManager";

import { setupAutomatedCleanup } from "../../helpers/mock-lifecycle";

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
  addItem: TestMockFn<[Record<string, unknown>], void>;
  processQueue: TestMockFn<[], void>;
  getQueueLength: TestMockFn<[], number>;
};

type SpamDetectorMock = {
  handleDonationSpam: TestMockFn<
    [unknown, unknown, number, unknown, number, string],
    { shouldShow: boolean }
  >;
};

type SpamConfig = {
  enabled: boolean;
  detectionWindow: number;
  maxIndividualNotifications: number;
  lowValueThreshold: number;
};

const isSpamConfig = (value: unknown): value is SpamConfig => {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    "enabled" in value &&
    typeof value.enabled === "boolean" &&
    "detectionWindow" in value &&
    typeof value.detectionWindow === "number" &&
    "maxIndividualNotifications" in value &&
    typeof value.maxIndividualNotifications === "number" &&
    "lowValueThreshold" in value &&
    typeof value.lowValueThreshold === "number"
  );
};

const getSpamConfig = (): SpamConfig => {
  const spamConfig = appConfig.spam;
  if (!isSpamConfig(spamConfig)) {
    throw new Error("Expected app config spam section to expose numeric spam settings");
  }
  return spamConfig;
};

setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  logPerformanceMetrics: true,
});

describe("NotificationManager Spam Protection Behavior - Modernized", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let mockLogger: typeof noOpLogger;
  let mockConstants: NotificationConstants;
  let mockDisplayQueue: DisplayQueueMock;
  let mockSpamDetector: SpamDetectorMock;
  let config: ReturnType<typeof createConfigFixture>;

  beforeEach(() => {
    mockLogger = noOpLogger;

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
      addItem: createMockFn<[Record<string, unknown>], void>(),
      processQueue: createMockFn<[], void>(),
      getQueueLength: createMockFn<[], number>().mockReturnValue(0),
    };

    mockSpamDetector = {
      handleDonationSpam: createMockFn<
        [unknown, unknown, number, unknown, number, string],
        { shouldShow: boolean }
      >().mockReturnValue({ shouldShow: true }),
    };

    config = createConfigFixture({
      general: {
        giftsEnabled: true,
      },
    });

  });

  const createManagerWithSpamDetector = () => new NotificationManager({
    displayQueue: mockDisplayQueue,
    logger: mockLogger,
    eventBus: {
      emit: createMockFn(),
      on: createMockFn(),
      off: createMockFn(),
    },
    config,
    constants: mockConstants,
    obsGoals: { processDonationGoal: createMockFn() },
    donationSpamDetector: mockSpamDetector,
    vfxCommandService: {
      getVFXConfig: createMockFn().mockResolvedValue(null),
    },
  });

  describe("when spam protection is properly configured", () => {
    it("should enable spam protection when spam detector is provided", () => {
      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: mockLogger,
        eventBus: mockEventBus,
        config,
        constants: mockConstants,
        obsGoals: { processDonationGoal: createMockFn() },
        donationSpamDetector: mockSpamDetector,
        vfxCommandService: {
          getVFXConfig: createMockFn().mockResolvedValue(null),
        },
      });

      expect(notificationManager.donationSpamDetector).toBe(mockSpamDetector);
    });

    it("should access spam configuration for effective spam protection", () => {
      const config = appConfig;

      expect(config).toBeDefined();
      expect(config.spam).toBeDefined();

      const hasSpamConfig = config && config.spam;
      expect(hasSpamConfig).toBeTruthy();
    });

    it("should use spam detector when provided via constructor", async () => {
      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: mockLogger,
        eventBus: mockEventBus,
        config,
        constants: mockConstants,
        obsGoals: { processDonationGoal: createMockFn() },
        donationSpamDetector: mockSpamDetector,
        vfxCommandService: {
          getVFXConfig: createMockFn().mockResolvedValue(null),
        },
      });

      expect(notificationManager.donationSpamDetector).toBe(mockSpamDetector);

      const giftData = {
        userId: "user123",
        username: "TestUser",
        giftType: "Rose",
        giftCount: 1,
        amount: 10,
        currency: "coins",
      };

      await notificationManager.handleNotification(
        "platform:gift",
        "tiktok",
        giftData,
      );

      expect(mockSpamDetector.handleDonationSpam).toHaveBeenCalled();
    });
  });

  describe("when spam detector is not provided", () => {
    it("should operate without spam protection gracefully", async () => {
      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: mockLogger,
        eventBus: mockEventBus,
        config,
        constants: mockConstants,
        obsGoals: { processDonationGoal: createMockFn() },
        vfxCommandService: {
          getVFXConfig: createMockFn().mockResolvedValue(null),
        },
      });

      expect(notificationManager.donationSpamDetector).toBeUndefined();

      const giftData = {
        userId: "user123",
        username: "TestUser",
        giftType: "Rose",
        giftCount: 1,
        amount: 10,
        currency: "coins",
      };

      await expect(
        notificationManager.handleNotification(
          "platform:gift",
          "tiktok",
          giftData,
        ),
      ).resolves.toBeDefined();

      expect(mockDisplayQueue.addItem).toHaveBeenCalled();
    });

    it("should initialize successfully without spam detector (optional dependency)", () => {
      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: mockLogger,
        eventBus: mockEventBus,
        config,
        constants: mockConstants,
        obsGoals: { processDonationGoal: createMockFn() },
        vfxCommandService: {
          getVFXConfig: createMockFn().mockResolvedValue(null),
        },
      });

      expect(notificationManager.donationSpamDetector).toBeUndefined();
      expect(notificationManager).toBeDefined();
    });
  });

  describe("when checking configuration availability", () => {
    describe("and verifying spam configuration structure", () => {
      it("should provide spam config compatible with SpamDetectionConfig constructor", () => {
        const spamConfig = getSpamConfig();

        expect(spamConfig.enabled).toBeDefined();
        expect(spamConfig.detectionWindow).toBeDefined();
        expect(spamConfig.maxIndividualNotifications).toBeDefined();
        expect(spamConfig.lowValueThreshold).toBeDefined();

        expect(typeof spamConfig.enabled).toBe("boolean");
        expect(typeof spamConfig.detectionWindow).toBe("number");
        expect(typeof spamConfig.maxIndividualNotifications).toBe("number");
        expect(typeof spamConfig.lowValueThreshold).toBe("number");
      });

      it("should have valid spam configuration values", () => {
        const spamConfig = getSpamConfig();

        expect(spamConfig).toBeTruthy();
        expect(spamConfig.enabled).toBeDefined();
        expect(spamConfig.detectionWindow).toBeGreaterThan(0);
        expect(spamConfig.maxIndividualNotifications).toBeGreaterThan(0);
        expect(spamConfig.lowValueThreshold).toBeGreaterThan(0);
      });
    });
  });

  describe("when spam detector filters notifications", () => {
    it("should allow gifts that pass spam detection", async () => {
      mockSpamDetector.handleDonationSpam.mockReturnValue({ shouldShow: true });

      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: mockLogger,
        eventBus: mockEventBus,
        config,
        constants: mockConstants,
        obsGoals: { processDonationGoal: createMockFn() },
        donationSpamDetector: mockSpamDetector,
        vfxCommandService: {
          getVFXConfig: createMockFn().mockResolvedValue(null),
        },
      });

      const giftData = {
        userId: "user123",
        username: "TestUser",
        giftType: "Rose",
        giftCount: 1,
        amount: 10,
        currency: "coins",
      };

      await notificationManager.handleNotification(
        "platform:gift",
        "tiktok",
        giftData,
      );

      expect(mockDisplayQueue.addItem).toHaveBeenCalled();
    });

    it("should block gifts that fail spam detection", async () => {
      mockSpamDetector.handleDonationSpam.mockReturnValue({
        shouldShow: false,
      });

      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: mockLogger,
        eventBus: mockEventBus,
        config,
        constants: mockConstants,
        obsGoals: { processDonationGoal: createMockFn() },
        donationSpamDetector: mockSpamDetector,
        vfxCommandService: {
          getVFXConfig: createMockFn().mockResolvedValue(null),
        },
      });

      const giftData = {
        userId: "spammer",
        username: "SpamUser",
        giftType: "Rose",
        giftCount: 1,
        amount: 1,
        currency: "coins",
      };

      const result = await notificationManager.handleNotificationInternal(
        "platform:gift",
        "tiktok",
        giftData,
        false,
      );

      expect(result.success).toBe(false);
      expect(result.suppressed).toBe(true);
      expect(result.reason).toBe("spam_detection");
      expect(result.notificationType).toBe("platform:gift");
      expect(result.platform).toBe("tiktok");
      expect(mockDisplayQueue.addItem).not.toHaveBeenCalled();
    });

    it("should skip spam detection for aggregated donations", async () => {
      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: mockLogger,
        eventBus: mockEventBus,
        config,
        constants: mockConstants,
        obsGoals: { processDonationGoal: createMockFn() },
        donationSpamDetector: mockSpamDetector,
        vfxCommandService: {
          getVFXConfig: createMockFn().mockResolvedValue(null),
        },
      });

      const aggregatedGift = {
        userId: "user123",
        username: "TestUser",
        giftType: "Multiple Gifts",
        giftCount: 5,
        amount: 50,
        currency: "coins",
        isAggregated: true,
      };

      await notificationManager.handleNotification(
        "platform:gift",
        "tiktok",
        aggregatedGift,
      );

      expect(mockSpamDetector.handleDonationSpam).not.toHaveBeenCalled();
    });

    it("should skip spam detection and show username-only gifts", async () => {
      const notificationManager = createManagerWithSpamDetector();

      const result = await notificationManager.handleNotification(
        "platform:gift",
        "youtube",
        {
          username: "JewelsUser",
          giftType: "Super Sticker",
          giftCount: 1,
          amount: 10,
          currency: "jewels",
        },
      );

      expect(result.success).toBe(true);
      expect(mockSpamDetector.handleDonationSpam).not.toHaveBeenCalled();
      expect(mockDisplayQueue.addItem).toHaveBeenCalled();
    });

    it("should skip spam detection and show gifts with whitespace user id", async () => {
      const notificationManager = createManagerWithSpamDetector();

      const result = await notificationManager.handleNotification(
        "platform:gift",
        "youtube",
        {
          userId: "   ",
          username: "JewelsUser",
          giftType: "Super Sticker",
          giftCount: 1,
          amount: 10,
          currency: "jewels",
        },
      );

      expect(result.success).toBe(true);
      expect(mockSpamDetector.handleDonationSpam).not.toHaveBeenCalled();
      expect(mockDisplayQueue.addItem).toHaveBeenCalled();
    });

    it("should skip spam detection and show explicit anonymous gifts", async () => {
      const notificationManager = createManagerWithSpamDetector();

      const result = await notificationManager.handleNotification(
        "platform:gift",
        "twitch",
        {
          isAnonymous: true,
          giftType: "Bits",
          giftCount: 1,
          amount: 10,
          currency: "bits",
        },
      );

      expect(result.success).toBe(true);
      expect(mockSpamDetector.handleDonationSpam).not.toHaveBeenCalled();
      expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(1);
      const queuedItem = mockDisplayQueue.addItem.mock.calls[0]?.[0];
      expect(queuedItem?.data).toEqual(
        expect.objectContaining({ username: "Anonymous User" }),
      );
    });

    it("should skip spam detection for anonymous gifts even when masked identity is present", async () => {
      const notificationManager = createManagerWithSpamDetector();

      const result = await notificationManager.handleNotification(
        "platform:gift",
        "twitch",
        {
          isAnonymous: true,
          userId: "masked-user-id",
          username: "Anonymous User",
          giftType: "Bits",
          giftCount: 1,
          amount: 10,
          currency: "bits",
        },
      );

      expect(result.success).toBe(true);
      expect(mockSpamDetector.handleDonationSpam).not.toHaveBeenCalled();
      expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(1);
    });

    it("should reject normal gifts missing username without calling spam detection", async () => {
      const notificationManager = createManagerWithSpamDetector();

      const result = await notificationManager.handleNotification(
        "platform:gift",
        "tiktok",
        {
          userId: "user123",
          giftType: "Rose",
          giftCount: 1,
          amount: 10,
          currency: "coins",
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing username");
      expect(mockSpamDetector.handleDonationSpam).not.toHaveBeenCalled();
      expect(mockDisplayQueue.addItem).not.toHaveBeenCalled();
    });

    it("should reject normal gifts missing all donor identity without calling spam detection", async () => {
      const notificationManager = createManagerWithSpamDetector();

      const result = await notificationManager.handleNotification(
        "platform:gift",
        "tiktok",
        {
          giftType: "Rose",
          giftCount: 1,
          amount: 10,
          currency: "coins",
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing username");
      expect(mockSpamDetector.handleDonationSpam).not.toHaveBeenCalled();
      expect(mockDisplayQueue.addItem).not.toHaveBeenCalled();
    });

    it("should queue gifts when spam detection throws", async () => {
      mockSpamDetector.handleDonationSpam.mockImplementation(() => {
        throw new Error("spam unavailable");
      });
      const notificationManager = createManagerWithSpamDetector();

      const result = await notificationManager.handleNotification(
        "platform:gift",
        "tiktok",
        {
          userId: "user123",
          username: "TestUser",
          giftType: "Rose",
          giftCount: 1,
          amount: 10,
          currency: "coins",
        },
      );

      expect(result.success).toBe(true);
      expect(mockSpamDetector.handleDonationSpam).toHaveBeenCalled();
      expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(1);
    });
  });
});
