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
    GIFT: number;
    GIFTPAYPIGGY: number;
  };
};

describe("NotificationManager YouTube monetisation behavior", () => {
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

  it("enqueues paypiggy with paypiggy priority and renewal copy fields", async () => {
    await notificationManager.handleNotification(
      "platform:paypiggy",
      "youtube",
      {
        username: "MemberHero",
        userId: "yt-user-1",
        membershipLevel: "Member",
        months: 6,
        id: "paypiggy-yt-1",
        timestamp: "2025-01-01T00:00:00.000Z",
      },
    );

    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const item = displayQueue.addItem.mock.calls[0][0];
    expect(item.type).toBe("platform:paypiggy");
    expect(item.platform).toBe("youtube");
    expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.PAYPIGGY);
    expect(item.data.username).toBe("MemberHero");
    expect(item.data.userId).toBe("yt-user-1");
  });

  it("enqueues YouTube paid messages as gift with gift priority", async () => {
    await notificationManager.handleNotification("platform:gift", "youtube", {
      username: "ChatHero",
      userId: "yt-user-2",
      giftType: "Super Chat",
      giftCount: 1,
      amount: 10,
      currency: "USD",
      id: "gift-yt-1",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const item = displayQueue.addItem.mock.calls[0][0];
    expect(item.type).toBe("platform:gift");
    expect(item.platform).toBe("youtube");
    expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.GIFT);
  });

  it("enqueues Super Sticker as gift with gift priority", async () => {
    await notificationManager.handleNotification("platform:gift", "youtube", {
      username: "StickerHero",
      userId: "yt-user-3",
      giftType: "Super Sticker",
      giftCount: 1,
      amount: 4.99,
      currency: "USD",
      message: "CoolSticker",
      id: "gift-yt-2",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const item = displayQueue.addItem.mock.calls[0][0];
    expect(item.type).toBe("platform:gift");
    expect(item.platform).toBe("youtube");
    expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.GIFT);
  });

  it("enqueues gift memberships with giftpaypiggy priority", async () => {
    await notificationManager.handleNotification(
      "platform:giftpaypiggy",
      "youtube",
      {
        username: "Gifter",
        userId: "yt-user-4",
        giftCount: 3,
        id: "giftpaypiggy-yt-1",
        timestamp: "2025-01-01T00:00:00.000Z",
      },
    );

    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const item = displayQueue.addItem.mock.calls[0][0];
    expect(item.type).toBe("platform:giftpaypiggy");
    expect(item.platform).toBe("youtube");
    expect(item.priority).toBe(
      notificationManager.PRIORITY_LEVELS.GIFTPAYPIGGY,
    );
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

    await disabledManager.handleNotification("platform:paypiggy", "youtube", {
      username: "GatedUser",
    });

    expect(displayQueue.addItem).not.toHaveBeenCalled();
  });
});
