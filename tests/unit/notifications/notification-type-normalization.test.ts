import { vi, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { DisplayQueueItem } from "../../../src/interfaces/DisplayQueue";

import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";

import NotificationManager from "../../../src/notifications/NotificationManager";

type QueueItem = {
  type?: string;
  [key: string]: unknown;
};

describe("Notification type normalization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  let items: QueueItem[];
  let notificationManager: NotificationManager;

  beforeEach(() => {
    items = [];

    const displayQueue = {
      addItem: (item: DisplayQueueItem) => {
        items.push(item);
        return [item];
      },
      getQueueLength: () => items.length,
    };

    const eventBus = {
      emit: vi.fn<(...args: unknown[]) => unknown>(),
      subscribe: vi.fn(() => () => {}),
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
      config,
      vfxCommandService: {
        getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
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
    const item = items[0];
    if (item === undefined) {
      throw new Error("Expected follow notification to be queued");
    }
    expect(item.type).toBe("platform:follow");
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
