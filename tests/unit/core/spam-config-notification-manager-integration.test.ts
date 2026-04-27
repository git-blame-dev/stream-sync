import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { createConfigFixture } from "../../helpers/config-fixture";
import { noOpLogger } from "../../helpers/mock-factories";
import { config } from "../../../src/core/config";
import { PRIORITY_LEVELS } from "../../../src/core/constants";
import NotificationManager from "../../../src/notifications/NotificationManager";
import { createTextProcessingManager } from "../../../src/utils/text-processing";

type MockFn = ReturnType<typeof createMockFn>;

type NotificationManagerInstance = {
  handleNotification: (
    type: string,
    platform: string,
    data: Record<string, unknown>,
  ) => Promise<unknown>;
  handleNotificationInternal: (
    type: string,
    platform: string,
    data: Record<string, unknown>,
    suppressQueue: boolean,
  ) => Promise<{ suppressed?: boolean; reason?: string }>;
};

const mockConstants = {
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

describe("Spam Detection Service Integration Tests - Modernized", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let notificationManager: NotificationManagerInstance;
  let mockDisplayQueue: {
    addItem: MockFn;
    processQueue: MockFn;
  };
  let mockSpamDetector: {
    handleDonationSpam: MockFn;
  };
  let testConfig: ReturnType<typeof createConfigFixture>;

  beforeEach(() => {
    mockDisplayQueue = {
      addItem: createMockFn(),
      processQueue: createMockFn(),
    };

    mockSpamDetector = {
      handleDonationSpam: createMockFn().mockReturnValue({ shouldShow: true }),
    };

    testConfig = createConfigFixture({
      general: {
        giftsEnabled: true,
        greetingsEnabled: true,
      },
    });
  });

  describe("when spam detection service is provided", () => {
    beforeEach(() => {
      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const textProcessing = createTextProcessingManager({
        logger: noOpLogger,
      });
      notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: noOpLogger,
        eventBus: mockEventBus,
        constants: mockConstants,
        config: testConfig,
        donationSpamDetector: mockSpamDetector,
        textProcessing,
        obsGoals: { processDonationGoal: createMockFn() },
        vfxCommandService: { getVFXConfig: createMockFn(async () => null) },
      });
    });

    it("should apply spam filtering when a detector dependency is provided", async () => {
      mockSpamDetector.handleDonationSpam.mockReturnValue({ shouldShow: false });

      const giftData = {
        userId: "user123",
        username: "TestUser",
        giftType: "Rose",
        giftCount: 1,
        amount: 10,
        currency: "coins",
      };

      const result = await notificationManager.handleNotification(
        "platform:gift",
        "tiktok",
        giftData,
      );

      expect(result).toMatchObject({
        success: false,
        suppressed: true,
        reason: "spam_detection",
      });
      expect(mockDisplayQueue.addItem).not.toHaveBeenCalled();
    });

    it("should use spam detector to filter gift notifications", async () => {
      mockSpamDetector.handleDonationSpam.mockImplementation(
        (
          userId: unknown,
          username: unknown,
          amount: unknown,
          giftType: unknown,
          giftCount: unknown,
          platform: unknown,
        ) => ({
          shouldShow:
            userId === "user123" &&
            username === "TestUser" &&
            amount === 10 &&
            giftType === "Rose" &&
            giftCount === 1 &&
            platform === "tiktok",
        }),
      );

      const giftData = {
        userId: "user123",
        username: "TestUser",
        giftType: "Rose",
        giftCount: 1,
        amount: 10,
        currency: "coins",
      };

      const result = await notificationManager.handleNotification(
        "platform:gift",
        "tiktok",
        giftData,
      );

      expect(result).toMatchObject({ success: true });
      expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(1);
    });

    it("should display gift when spam detector approves", async () => {
      mockSpamDetector.handleDonationSpam.mockReturnValue({ shouldShow: true });

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

    it("should suppress gift when spam detector rejects", async () => {
      mockSpamDetector.handleDonationSpam.mockReturnValue({
        shouldShow: false,
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

      expect(result.suppressed).toBe(true);
      expect(result.reason).toBe("spam_detection");
      expect(mockDisplayQueue.addItem).not.toHaveBeenCalled();
    });
  });

  describe("when spam detection service is not provided", () => {
    beforeEach(() => {
      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: noOpLogger,
        eventBus: mockEventBus,
        constants: mockConstants,
        config: testConfig,
        textProcessing: createTextProcessingManager({ logger: noOpLogger }),
        obsGoals: { processDonationGoal: createMockFn() },
        vfxCommandService: { getVFXConfig: createMockFn(async () => null) },
      });
    });

    it("should not suppress gifts when spam detector is not provided", async () => {
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

      expect(result).toMatchObject({ success: true });
      expect(result).not.toMatchObject({ suppressed: true });
      expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(1);
    });

    it("should process gifts without spam detection", async () => {
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

    it("should handle rapid gifts without spam protection", async () => {
      const rapidGifts = [
        {
          userId: "user1",
          username: "User1",
          giftType: "Rose",
          giftCount: 1,
          amount: 1,
          currency: "coins",
        },
        {
          userId: "user1",
          username: "User1",
          giftType: "Rose",
          giftCount: 1,
          amount: 1,
          currency: "coins",
        },
        {
          userId: "user1",
          username: "User1",
          giftType: "Rose",
          giftCount: 1,
          amount: 1,
          currency: "coins",
        },
      ];

      for (const gift of rapidGifts) {
        await notificationManager.handleNotification(
          "platform:gift",
          "tiktok",
          gift,
        );
      }

      expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(3);
    });
  });

  describe("when verifying spam configuration availability", () => {
    it("should have spam configuration accessible from config module", () => {
      expect(config.spam).toBeDefined();
      expect(config.spam.enabled).toBeDefined();
      expect(config.spam.lowValueThreshold).toBeDefined();
      expect(config.spam.detectionWindow).toBeDefined();
      expect(config.spam.maxIndividualNotifications).toBeDefined();
    });
  });

  describe("when handling edge cases", () => {
    beforeEach(() => {
      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: noOpLogger,
        eventBus: mockEventBus,
        constants: mockConstants,
        config: testConfig,
        donationSpamDetector: mockSpamDetector,
        textProcessing: createTextProcessingManager({ logger: noOpLogger }),
        obsGoals: { processDonationGoal: createMockFn() },
        vfxCommandService: { getVFXConfig: createMockFn(async () => null) },
      });
    });

    it("should skip spam detection for aggregated donations", async () => {
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
      expect(mockDisplayQueue.addItem).toHaveBeenCalled();
    });

    it("should handle spam detector errors gracefully", async () => {
      mockSpamDetector.handleDonationSpam.mockImplementation(() => {
        throw new Error("Spam detector error");
      });

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
  });

  describe("when verifying service injection pattern", () => {
    it("should route gift notifications through provided spam detector dependency", async () => {
      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const nm = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: noOpLogger,
        eventBus: mockEventBus,
        constants: mockConstants,
        config: testConfig,
        donationSpamDetector: mockSpamDetector,
        textProcessing: createTextProcessingManager({ logger: noOpLogger }),
        obsGoals: { processDonationGoal: createMockFn() },
        vfxCommandService: { getVFXConfig: createMockFn(async () => null) },
      });

      mockSpamDetector.handleDonationSpam.mockReturnValue({ shouldShow: false });

      const result = await nm.handleNotification(
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

      expect(result).toMatchObject({
        success: false,
        suppressed: true,
        reason: "spam_detection",
      });
      expect(mockDisplayQueue.addItem).not.toHaveBeenCalled();
    });

    it("should handle missing spam detector gracefully", async () => {
      const localLogger = {
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn(),
      };

      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const nm = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: localLogger,
        eventBus: mockEventBus,
        constants: mockConstants,
        config: testConfig,
        textProcessing: createTextProcessingManager({ logger: noOpLogger }),
        obsGoals: { processDonationGoal: createMockFn() },
        vfxCommandService: { getVFXConfig: createMockFn(async () => null) },
      });

      const result = await nm.handleNotification("platform:gift", "tiktok", {
        userId: "spammer",
        username: "SpamUser",
        giftType: "Rose",
        giftCount: 1,
        amount: 1,
        currency: "coins",
      });

      expect(result).toMatchObject({ success: true });
      expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(1);

      const spamWarnings = localLogger.warn.mock.calls.filter(
        (call) =>
          typeof call[0] === "string" && call[0].toLowerCase().includes("spam"),
      );
      expect(spamWarnings).toHaveLength(0);
    });
  });
});
