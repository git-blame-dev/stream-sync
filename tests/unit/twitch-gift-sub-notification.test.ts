import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";
import { createConfigFixture } from "../helpers/config-fixture";
import { createMockDisplayQueue, noOpLogger } from "../helpers/mock-factories";
import { setupAutomatedCleanup } from "../helpers/mock-lifecycle";
import * as constants from "../../src/core/constants";
import NotificationManager from "../../src/notifications/NotificationManager";
import { getDefaultGoalsManager } from "../../src/obs/goals";

type LoggerLike = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type FlexibleMock = ReturnType<typeof createMockFn> & {
  mockResolvedValue: (value: unknown) => FlexibleMock;
};

type QueueItem = {
  type: string;
  data: {
    platform: string;
    displayMessage: string;
    ttsMessage: string;
  };
};

const isQueueItem = (value: unknown): value is QueueItem =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  "data" in value &&
  typeof value.type === "string" &&
  typeof value.data === "object" &&
  value.data !== null &&
  "platform" in value.data &&
  "displayMessage" in value.data &&
  "ttsMessage" in value.data &&
  typeof value.data.platform === "string" &&
  typeof value.data.displayMessage === "string" &&
  typeof value.data.ttsMessage === "string";

const getQueuedItem = (
  displayQueue: ReturnType<typeof createMockDisplayQueue>,
): QueueItem => {
  const call = displayQueue.addItem.mock.calls[0];
  if (!call) {
    throw new Error("Expected one display queue item");
  }
  const [queueItem] = call;
  if (!isQueueItem(queueItem)) {
    throw new Error("Expected a notification queue item");
  }
  return queueItem;
};

type NotificationManagerInstance = {
  handleNotification: (
    type: string,
    platform: string,
    data: Record<string, unknown>,
  ) => Promise<unknown>;
};

setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true,
});

describe("Twitch gift subscriptions", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let mockLogger: LoggerLike;
  let mockDisplayQueue: ReturnType<typeof createMockDisplayQueue>;
  let notificationManager: NotificationManagerInstance;

  const createManager = () => {
    const mockEventBus = {
      emit: createMockFn(),
      on: createMockFn(),
      off: createMockFn(),
    };
    const config = createConfigFixture({
      general: {
        giftsEnabled: true,
        debugEnabled: true,
      },
    });
    const constantsConfig = {
      PRIORITY_LEVELS: constants.PRIORITY_LEVELS,
      NOTIFICATION_CONFIGS: constants.NOTIFICATION_CONFIGS,
    };
    const obsGoals = getDefaultGoalsManager();
    const obsGoalsDependency = {
      processDonationGoal: (...args: unknown[]) =>
        obsGoals.processDonationGoal(String(args[0] ?? ""), typeof args[1] === "number" ? args[1] : 0),
    };
    const vfxCommandService = {
      getVFXConfig: (createMockFn() as FlexibleMock).mockResolvedValue(null),
    };
    return new NotificationManager({
      displayQueue: mockDisplayQueue,
      logger: mockLogger,
      eventBus: mockEventBus,
      config,
      constants: constantsConfig,
      obsGoals: obsGoalsDependency,
      vfxCommandService,
    });
  };

  beforeEach(() => {
    mockLogger = noOpLogger;
    mockDisplayQueue = createMockDisplayQueue({ length: 0 });
    notificationManager = createManager();
  });

  it("renders gifter and count in display and TTS output", async () => {
    const twitchGiftPaypiggyData = {
      userId: "123456789",
      username: "GiftUser",
      displayName: "GiftUser",
      tier: "1000",
      giftCount: 5,
      cumulativeTotal: 7,
      isAnonymous: false,
    };

    const result = await notificationManager.handleNotification(
      "platform:giftpaypiggy",
      "twitch",
      twitchGiftPaypiggyData,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(1);

    const queueItem = getQueuedItem(mockDisplayQueue);
    const notificationData = queueItem.data;

    expect(queueItem.type).toBe("platform:giftpaypiggy");
    expect(notificationData.platform).toBe("twitch");
    expect(notificationData.displayMessage).toContain("GiftUser");
    expect(notificationData.displayMessage).toMatch(/gift|sub/i);
    expect(notificationData.displayMessage).toMatch(/5|five/i);
    expect(notificationData.displayMessage).not.toContain("unknown");

    expect(notificationData.ttsMessage).toContain("GiftUser");
    expect(notificationData.ttsMessage).toMatch(/5|five/i);
    expect(notificationData.ttsMessage).toMatch(/gift|sub/i);
    expect(notificationData.ttsMessage).not.toContain("unknown");

    expectNoTechnicalArtifacts(notificationData.displayMessage);
    expectNoTechnicalArtifacts(notificationData.ttsMessage);
  });

  it("avoids placeholders when gift fields are incomplete", async () => {
    const minimalGiftPaypiggyData = {
      userId: "123456789",
      username: "GiftUser",
      giftCount: 2,
    };

    const result = await notificationManager.handleNotification(
      "platform:giftpaypiggy",
      "twitch",
      minimalGiftPaypiggyData,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(1);

    const queueItem = getQueuedItem(mockDisplayQueue);
    const notificationData = queueItem.data;

    expect(notificationData.displayMessage).toContain("GiftUser");
    expect(notificationData.displayMessage).toMatch(/2|two/i);
    expect(notificationData.displayMessage).not.toMatch(/\{.*\}/);
    expect(notificationData.displayMessage).not.toContain("undefined");
    expect(notificationData.displayMessage).not.toContain("null");

    expectNoTechnicalArtifacts(notificationData.displayMessage);
  });
});
