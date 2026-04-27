import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { expectNoTechnicalArtifacts } from "../../helpers/assertion-helpers";
import { createConfigFixture } from "../../helpers/config-fixture";
import { noOpLogger } from "../../helpers/mock-factories";
import { setupAutomatedCleanup } from "../../helpers/mock-lifecycle";
import { initializeTestLogging } from "../../helpers/test-setup";
import { config as mainConfig } from "../../../src/core/config";
import { PRIORITY_LEVELS } from "../../../src/core/constants";
import NotificationManager from "../../../src/notifications/NotificationManager";
import { createTextProcessingManager } from "../../../src/utils/text-processing";

type LoggerLike = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type SpamConfig = {
  enabled: boolean;
  detectionWindow: number;
  maxIndividualNotifications: number;
  lowValueThreshold: number;
};

const getMainConfig = () => {
  return mainConfig as { spam: SpamConfig };
};

type MockFn = ReturnType<typeof createMockFn>;

initializeTestLogging();

setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  logPerformanceMetrics: true,
});

describe("Spam Detection Service Integration Tests", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let mockLogger: LoggerLike;
  let mockConstants: {
    PRIORITY_LEVELS: typeof PRIORITY_LEVELS;
    NOTIFICATION_CONFIGS: {
      "platform:gift": {
        priority: number;
        duration: number;
        settingKey: string;
        commandKey: string;
      };
    };
  };
  let mockDisplayQueue: {
    addItem: MockFn;
    processQueue: MockFn;
  };
  let mockSpamDetector: {
    handleDonationSpam: MockFn;
  };
  let mockConfig: ReturnType<typeof createConfigFixture>;
  let mockTextProcessing: ReturnType<typeof createTextProcessingManager>;
  let mockObsGoals: {
    processDonationGoal: MockFn;
  };
  let mockVfxCommandService: {
    getVFXConfig: MockFn;
  };
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
      addItem: createMockFn(),
      processQueue: createMockFn(),
    };

    mockSpamDetector = {
      handleDonationSpam: createMockFn().mockReturnValue({ shouldShow: true }),
    };

    mockConfig = createConfigFixture();

    mockTextProcessing = createTextProcessingManager({ logger: mockLogger });
    mockObsGoals = { processDonationGoal: createMockFn() };
    mockVfxCommandService = { getVFXConfig: createMockFn(async () => null) };
  });

  describe("when spam detection configuration is available", () => {
    it("should use spam detector service when provided", async () => {
      const config = getMainConfig();

      expect(config.spam).toBeDefined();
      expect(config.spam.enabled).toBe(true);
    });

    it("should contain all required spam detection properties in config", () => {
      const config = getMainConfig();
      const spamConfig = config.spam;

      expect(spamConfig).toHaveProperty("enabled");
      expect(spamConfig).toHaveProperty("detectionWindow");
      expect(spamConfig).toHaveProperty("maxIndividualNotifications");
      expect(spamConfig).toHaveProperty("lowValueThreshold");

      expect(typeof spamConfig.enabled).toBe("boolean");
      expect(typeof spamConfig.detectionWindow).toBe("number");
      expect(typeof spamConfig.maxIndividualNotifications).toBe("number");
      expect(typeof spamConfig.lowValueThreshold).toBe("number");
    });
  });

  describe("when NotificationManager is initialized with spam detector", () => {
    it("should process gifts through spam detector when provided", async () => {
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

      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: mockLogger,
        eventBus: mockEventBus,
        constants: mockConstants,
        donationSpamDetector: mockSpamDetector,
        config: mockConfig,
        textProcessing: mockTextProcessing,
        obsGoals: mockObsGoals,
        vfxCommandService: mockVfxCommandService,
      });

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

    it("should apply spam suppression when spam detector dependency is injected", async () => {
      mockSpamDetector.handleDonationSpam.mockReturnValue({ shouldShow: false });

      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: mockLogger,
        eventBus: mockEventBus,
        constants: mockConstants,
        donationSpamDetector: mockSpamDetector,
        config: mockConfig,
        textProcessing: mockTextProcessing,
        obsGoals: mockObsGoals,
        vfxCommandService: mockVfxCommandService,
      });

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

      expect(result).toMatchObject({
        success: false,
        suppressed: true,
        reason: "spam_detection",
      });
      expect(mockDisplayQueue.addItem).not.toHaveBeenCalled();
    });

    it("should suppress gifts when spam detector indicates spam", async () => {
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
        constants: mockConstants,
        donationSpamDetector: mockSpamDetector,
        config: mockConfig,
        textProcessing: mockTextProcessing,
        obsGoals: mockObsGoals,
        vfxCommandService: mockVfxCommandService,
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

  describe("when NotificationManager is initialized without spam detector", () => {
    it("should gracefully handle missing spam detector dependency", async () => {
      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: mockLogger,
        eventBus: mockEventBus,
        constants: mockConstants,
        config: mockConfig,
        textProcessing: mockTextProcessing,
        obsGoals: mockObsGoals,
        vfxCommandService: mockVfxCommandService,
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

    it("should continue showing gifts when spam detector dependency is omitted", async () => {
      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: mockLogger,
        eventBus: mockEventBus,
        constants: mockConstants,
        config: mockConfig,
        textProcessing: mockTextProcessing,
        obsGoals: mockObsGoals,
        vfxCommandService: mockVfxCommandService,
      });

      const result = await notificationManager.handleNotificationInternal(
        "platform:gift",
        "tiktok",
        {
          userId: "spammer",
          username: "SpamUser",
          giftType: "Rose",
          giftCount: 1,
          amount: 1,
          currency: "coins",
        },
        false,
      );

      expect(result).toMatchObject({ success: true });
      expect(result).not.toMatchObject({ suppressed: true });
      expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(1);
    });
  });

  describe("when handling edge cases", () => {
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
        constants: mockConstants,
        donationSpamDetector: mockSpamDetector,
        config: mockConfig,
        textProcessing: mockTextProcessing,
        obsGoals: mockObsGoals,
        vfxCommandService: mockVfxCommandService,
      });

      const aggregatedGift = {
        userId: "user123",
        username: "TestUser",
        giftType: "Rose",
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

    it("should validate spam config property types from configuration", () => {
      const config = getMainConfig();
      const spamConfig = config.spam;

      expect(typeof spamConfig.enabled).toBe("boolean");
      expect(typeof spamConfig.detectionWindow).toBe("number");
      expect(typeof spamConfig.maxIndividualNotifications).toBe("number");
      expect(typeof spamConfig.lowValueThreshold).toBe("number");

      expect(spamConfig.detectionWindow).toBeGreaterThan(0);
      expect(spamConfig.maxIndividualNotifications).toBeGreaterThan(0);
      expect(spamConfig.lowValueThreshold).toBeGreaterThanOrEqual(0);
    });
  });

  describe("when validating integration with spam detection system", () => {
    it("should provide config structure compatible with SpamDetectionConfig constructor", () => {
      const config = getMainConfig();
      const spamConfig = config.spam;

      expect(spamConfig).toBeTruthy();
      expect(spamConfig.enabled).toBeDefined();
      expect(spamConfig.detectionWindow).toBeDefined();
      expect(spamConfig.maxIndividualNotifications).toBeDefined();
      expect(spamConfig.lowValueThreshold).toBeDefined();

      expect(spamConfig.detectionWindow).toBeGreaterThan(0);
      expect(spamConfig.maxIndividualNotifications).toBeGreaterThan(0);
      expect(spamConfig.lowValueThreshold).toBeGreaterThan(0);
    });

    it("should route gift handling through injected spam detector behavior", async () => {
      mockSpamDetector.handleDonationSpam.mockReturnValue({ shouldShow: false });

      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: mockLogger,
        eventBus: mockEventBus,
        constants: mockConstants,
        donationSpamDetector: mockSpamDetector,
        config: mockConfig,
        textProcessing: mockTextProcessing,
        obsGoals: mockObsGoals,
        vfxCommandService: mockVfxCommandService,
      });

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

      expect(result).toMatchObject({
        success: false,
        suppressed: true,
        reason: "spam_detection",
      });
      expect(mockDisplayQueue.addItem).not.toHaveBeenCalled();
    });
  });

  describe("when ensuring no technical artifacts in user-facing content", () => {
    it("should not expose internal configuration details to users", async () => {
      const mockEventBus = {
        emit: createMockFn(),
        on: createMockFn(),
        off: createMockFn(),
      };
      const notificationManager = new NotificationManager({
        displayQueue: mockDisplayQueue,
        logger: mockLogger,
        eventBus: mockEventBus,
        constants: mockConstants,
        donationSpamDetector: mockSpamDetector,
        config: mockConfig,
        textProcessing: mockTextProcessing,
        obsGoals: mockObsGoals,
        vfxCommandService: mockVfxCommandService,
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

      const queueCall = mockDisplayQueue.addItem.mock.calls[0];
      if (queueCall) {
        const queueItem = queueCall[0] as {
          data: {
            displayMessage?: string;
            [key: string]: unknown;
          };
        };
        const notificationData = queueItem.data;
        if (typeof notificationData.displayMessage === "string") {
          expectNoTechnicalArtifacts(notificationData.displayMessage);
        }
        expect(notificationData).not.toHaveProperty("spamDetectionConfig");
        expect(notificationData).not.toHaveProperty("configService");
      }
    });

    it("should provide meaningful property names for spam detection settings", () => {
      const config = getMainConfig();
      const spamConfig = config.spam;

      expect(spamConfig).toHaveProperty("enabled");
      expect(spamConfig).toHaveProperty("detectionWindow");
      expect(spamConfig).toHaveProperty("maxIndividualNotifications");
      expect(spamConfig).toHaveProperty("lowValueThreshold");
    });
  });
});
