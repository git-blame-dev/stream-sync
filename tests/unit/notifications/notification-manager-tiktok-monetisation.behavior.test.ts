import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
  type TestMockFn,
} from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";

import { EventEmitter } from "node:events";
import NotificationManager from "../../../src/notifications/NotificationManager";
import { PRIORITY_LEVELS } from "../../../src/core/constants";
import type { DisplayQueueDependency, DisplayQueueItem } from "../../../src/interfaces/DisplayQueue";

type DisplayQueueMock = DisplayQueueDependency & {
  addItem: TestMockFn<[DisplayQueueItem], void>;
  getQueueLength: TestMockFn<[], number>;
};

describe("NotificationManager TikTok monetisation behavior", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let displayQueue: DisplayQueueMock;
  let notificationManager: NotificationManager;
  let config: ReturnType<typeof createConfigFixture>;

  const baseDependencies = () => ({
    logger: noOpLogger,
    displayQueue,
    eventBus: new EventEmitter(),
    constants: require("../../../src/core/constants"),
    obsGoals: { processDonationGoal: createMockFn() },
    config,
    vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
    userTrackingService: {
      isFirstMessage: createMockFn().mockResolvedValue(false),
    },
  });

  beforeEach(() => {
    displayQueue = {
      addItem: createMockFn<[DisplayQueueItem], void>(),
      getQueueLength: createMockFn<[], number>().mockReturnValue(0),
    };
    config = createConfigFixture({
      general: {
        giftsEnabled: true,
        paypiggiesEnabled: true,
      },
    });
    notificationManager = new NotificationManager(baseDependencies());
  });

  const getQueuedItem = () => {
    const call = displayQueue.addItem.mock.calls[0];
    if (call === undefined) {
      throw new Error("Expected display queue addItem to be called");
    }
    return call[0];
  };

  it("enqueues SUPER_FAN paypiggy with paypiggy priority", async () => {
    await notificationManager.handleNotification(
      "platform:paypiggy",
      "tiktok",
      {
        username: "SuperFan",
        userId: "tk-user-1",
        tier: "superfan",
        level: "S2",
        months: 2,
      },
    );

    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const item = getQueuedItem();
    expect(item.type).toBe("platform:paypiggy");
    expect(item.platform).toBe("tiktok");
    expect(item.priority).toBe(PRIORITY_LEVELS.PAYPIGGY);
    expect(item.data).toEqual(expect.objectContaining({ username: "SuperFan" }));
  });

  it("enqueues coin gifts with gift priority", async () => {
    await notificationManager.handleNotification("platform:gift", "tiktok", {
      id: "tt-gift-coinhero-1",
      username: "CoinHero",
      userId: "tk-user-2",
      giftType: "Rose",
      giftCount: 3,
      amount: 150,
      currency: "coins",
    });

    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const item = getQueuedItem();
    expect(item.type).toBe("platform:gift");
    expect(item.platform).toBe("tiktok");
    expect(item.priority).toBe(PRIORITY_LEVELS.GIFT);
    expect(item.data).toEqual(expect.objectContaining({ username: "CoinHero" }));
  });

  it("respects config gating and skips when notifications are disabled", async () => {
    const disabledConfig = createConfigFixture({
      general: { paypiggiesEnabled: false },
    });
    const disabledManager = new NotificationManager({
      logger: noOpLogger,
      displayQueue,
      eventBus: new EventEmitter(),
      constants: require("../../../src/core/constants"),
      obsGoals: { processDonationGoal: createMockFn() },
      config: disabledConfig,
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue(null),
      },
      userTrackingService: {
        isFirstMessage: createMockFn().mockResolvedValue(false),
      },
    });

    await disabledManager.handleNotification("platform:paypiggy", "tiktok", {
      username: "GatedUser",
    });

    expect(displayQueue.addItem).not.toHaveBeenCalled();
  });
});
