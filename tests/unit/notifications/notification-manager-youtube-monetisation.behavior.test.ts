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
  addItem: TestMockFn<[DisplayQueueItem], readonly DisplayQueueItem[]>;
  getQueueLength: TestMockFn<[], number>;
};

describe("NotificationManager YouTube monetisation behavior", () => {
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
    config,
    vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
    userTrackingService: {
      isFirstMessage: createMockFn().mockResolvedValue(false),
    },
  });

  beforeEach(() => {
    displayQueue = {
      addItem: createMockFn<[DisplayQueueItem], readonly DisplayQueueItem[]>((item) => [item]),
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
    const item = getQueuedItem();
    expect(item.type).toBe("platform:paypiggy");
    expect(item.platform).toBe("youtube");
    expect(item.priority).toBe(PRIORITY_LEVELS.PAYPIGGY);
    expect(item.data).toEqual(
      expect.objectContaining({ username: "MemberHero", userId: "yt-user-1" }),
    );
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
    const item = getQueuedItem();
    expect(item.type).toBe("platform:gift");
    expect(item.platform).toBe("youtube");
    expect(item.priority).toBe(PRIORITY_LEVELS.GIFT);
  });

  it("queues an amountless YouTube jewels gift exactly once with sender and gift wording", async () => {
    await notificationManager.handleNotification("platform:gift", "youtube", {
      username: "test-youtube-gifter",
      giftType: "Let em cook",
      giftCount: 1,
      currency: "jewels",
      id: "gift-yt-amountless-1",
      metadata: { missingFields: ["amount", "userId"] },
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const item = getQueuedItem();
    for (const message of [item.data.displayMessage, item.data.ttsMessage, item.data.logMessage]) {
      expect(message).toContain("test-youtube-gifter");
      expect(message).toContain("Let em cook");
      expect(message).not.toMatch(/undefined|NaN|0 jewels/i);
    }
  });

  it("skips amount-based spam detection without dropping an amountless gift", async () => {
    const handleDonationSpam = createMockFn().mockReturnValue({ shouldShow: false });
    notificationManager = new NotificationManager({
      ...baseDependencies(),
      donationSpamDetector: { handleDonationSpam },
    });

    await notificationManager.handleNotification("platform:gift", "youtube", {
      username: "test-youtube-gifter",
      userId: "UC_TEST_YOUTUBE_GIFTER",
      giftType: "Let em cook",
      giftCount: 1,
      currency: "jewels",
      id: "gift-yt-amountless-stable-user-1",
      metadata: { missingFields: ["amount"] },
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(handleDonationSpam).not.toHaveBeenCalled();
    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
  });

  it("still checks priced gifts when stale metadata marks amount missing", async () => {
    const handleDonationSpam = createMockFn().mockReturnValue({ shouldShow: true });
    notificationManager = new NotificationManager({
      ...baseDependencies(),
      donationSpamDetector: { handleDonationSpam },
    });

    await notificationManager.handleNotification("platform:gift", "youtube", {
      username: "test-youtube-gifter",
      userId: "UC_TEST_YOUTUBE_GIFTER",
      giftType: "Girl power",
      giftCount: 1,
      amount: 300,
      currency: "jewels",
      id: "gift-yt-priced-stale-metadata-1",
      metadata: { missingFields: ["amount"] },
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(handleDonationSpam).toHaveBeenCalledTimes(1);
    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
  });

  it("formats amountless gift debug logs without a synthetic count or value", () => {
    expect(notificationManager.generateLogMessage("platform:gift", {
      platform: "youtube",
      username: "test-youtube-gifter",
      giftType: "Let em cook",
      giftCount: 1,
      currency: "jewels",
      metadata: { missingFields: ["amount", "userId"] },
    })).toBe("Gift from test-youtube-gifter: Let em cook");
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
    const item = getQueuedItem();
    expect(item.type).toBe("platform:gift");
    expect(item.platform).toBe("youtube");
    expect(item.priority).toBe(PRIORITY_LEVELS.GIFT);
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
    const item = getQueuedItem();
    expect(item.type).toBe("platform:giftpaypiggy");
    expect(item.platform).toBe("youtube");
    expect(item.priority).toBe(
      PRIORITY_LEVELS.GIFTPAYPIGGY,
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
