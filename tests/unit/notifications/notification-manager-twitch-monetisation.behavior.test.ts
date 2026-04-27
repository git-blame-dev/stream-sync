import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";

import { EventEmitter } from "node:events";
import NotificationManager from "../../../src/notifications/NotificationManager";

type DisplayQueueMock = {
  addItem: ReturnType<typeof createMockFn>;
};

type NotificationManagerLike = {
  handleNotification: (
    type: string,
    platform: string,
    data: Record<string, unknown>,
  ) => Promise<unknown>;
  PRIORITY_LEVELS: {
    PAYPIGGY: number;
    GIFTPAYPIGGY: number;
    GIFT: number;
  };
};

describe("NotificationManager Twitch monetisation behavior", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let displayQueue: DisplayQueueMock;
  let notificationManager: NotificationManagerLike;
  let config: ReturnType<typeof createConfigFixture>;

  const baseDependencies = () => ({
    logger: noOpLogger,
    displayQueue,
    eventBus: new EventEmitter(),
    constants: require("../../../src/core/constants"),
    textProcessing: { formatChatMessage: createMockFn() },
    obsGoals: { processDonationGoal: createMockFn() },
    config,
    vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
    userTrackingService: {
      isFirstMessage: createMockFn().mockResolvedValue(false),
    },
  });

  beforeEach(() => {
    displayQueue = { addItem: createMockFn() };
    config = createConfigFixture({
      general: {
        giftsEnabled: true,
        paypiggiesEnabled: true,
      },
    });
    notificationManager = new NotificationManager(baseDependencies());
  });

  it("enqueues paypiggy with paypiggy priority and sanitized payload", async () => {
    await notificationManager.handleNotification(
      "platform:paypiggy",
      "twitch",
      {
        username: "SubHero",
        userId: "user-1",
        tier: "1000",
        months: 3,
      },
    );

    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const item = displayQueue.addItem.mock.calls[0][0];
    expect(item.type).toBe("platform:paypiggy");
    expect(item.platform).toBe("twitch");
    expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.PAYPIGGY);
    expect(item.data.username).toBe("SubHero");
    expect(item.data.userId).toBe("user-1");
  });

  it("enqueues gift subs with giftpaypiggy priority", async () => {
    await notificationManager.handleNotification(
      "platform:giftpaypiggy",
      "twitch",
      {
        username: "GiftHero",
        userId: "user-2",
        tier: "1000",
        giftCount: 5,
      },
    );

    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const item = displayQueue.addItem.mock.calls[0][0];
    expect(item.type).toBe("platform:giftpaypiggy");
    expect(item.platform).toBe("twitch");
    expect(item.priority).toBe(
      notificationManager.PRIORITY_LEVELS.GIFTPAYPIGGY,
    );
    expect(item.data.username).toBe("GiftHero");
  });

  it("enqueues bits as gifts with gift priority", async () => {
    await notificationManager.handleNotification("platform:gift", "twitch", {
      username: "BitsHero",
      userId: "user-3",
      bits: 500,
      giftType: "bits",
      giftCount: 1,
      amount: 500,
      currency: "bits",
      repeatCount: 1,
    });

    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const item = displayQueue.addItem.mock.calls[0][0];
    expect(item.type).toBe("platform:gift");
    expect(item.platform).toBe("twitch");
    expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.GIFT);
    expect(item.data.username).toBe("BitsHero");
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
      textProcessing: { formatChatMessage: createMockFn() },
      obsGoals: { processDonationGoal: createMockFn() },
      config: disabledConfig,
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue(null),
      },
      userTrackingService: {
        isFirstMessage: createMockFn().mockResolvedValue(false),
      },
    });

    await disabledManager.handleNotification("platform:paypiggy", "twitch", {
      username: "GatedUser",
    });

    expect(displayQueue.addItem).not.toHaveBeenCalled();
  });
});
