import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";

import NotificationManager from "../../../src/notifications/NotificationManager";

type QueueItem = {
  type?: string;
  [key: string]: unknown;
};

type NotificationResult = {
  success?: boolean;
  error?: string;
  notificationType?: string;
  platform?: string;
};

type NotificationManagerLike = {
  handleNotification: (
    type: string,
    platform: string,
    data: Record<string, unknown>,
  ) => Promise<NotificationResult>;
};

describe("Notification type normalization", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let items: QueueItem[];
  let notificationManager: NotificationManagerLike;

  beforeEach(() => {
    items = [];

    const displayQueue = {
      addItem: async (item: QueueItem) => {
        items.push(item);
        return true;
      },
    };

    const eventBus = {
      emit: createMockFn(),
      subscribe: createMockFn(() => () => {}),
    };

    const config = createConfigFixture({
      general: {
        followsEnabled: true,
        giftsEnabled: true,
      },
    });

    notificationManager = new NotificationManager({
      logger: noOpLogger,
      displayQueue,
      eventBus,
      constants: require("../../../src/core/constants"),
      textProcessing: { formatChatMessage: createMockFn() },
      obsGoals: { processDonationGoal: createMockFn() },
      config,
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue(null),
      },
    });
  });

  it("accepts matching payload types for follow notifications", async () => {
    const result = await notificationManager.handleNotification(
      "platform:follow",
      "tiktok",
      {
        username: "alice",
        userId: "tiktok-1",
        type: "platform:follow",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        notificationType: "platform:follow",
        platform: "tiktok",
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("platform:follow");
  });

  it("rejects short notification types without normalization", async () => {
    const result = await notificationManager.handleNotification(
      "gift",
      "tiktok",
      {
        username: "bob",
        userId: "tiktok-2",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: "Unknown notification type",
        notificationType: "gift",
      }),
    );
    expect(items).toHaveLength(0);
  });
});
