import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { createConfigFixture } from "../../helpers/config-fixture";

import NotificationManager from "../../../src/notifications/NotificationManager";
import * as constants from "../../../src/core/constants";
import { noOpLogger } from "../../helpers/mock-factories";

type QueuedItem = {
  priority?: number;
  vfxConfig?: { commandKey?: string; filename?: string };
  data?: { displayMessage?: string; ttsMessage?: string };
  type?: string;
  [key: string]: unknown;
};

type DisplayQueueMock = {
  addItem: ReturnType<typeof createMockFn>;
  getQueueLength: ReturnType<typeof createMockFn>;
};

type EventBusMock = {
  emit: ReturnType<typeof createMockFn>;
  on: ReturnType<typeof createMockFn>;
  off: ReturnType<typeof createMockFn>;
};

type VfxCommandServiceMock = {
  getVFXConfig: ReturnType<typeof createMockFn>;
  executeCommand: ReturnType<typeof createMockFn>;
  executeCommandForKey: ReturnType<typeof createMockFn>;
};

type NotificationResult = {
  success?: boolean;
  disabled?: boolean;
  notificationType?: string;
  platform?: string;
  priority?: number;
  error?: string;
};

type NotificationManagerLike = {
  handleNotification: (
    type: string,
    platform: string,
    data: Record<string, unknown>,
  ) => Promise<NotificationResult>;
};

describe("NotificationManager follow/raid/share behavior", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let queuedItems: QueuedItem[];
  let displayQueue: DisplayQueueMock;
  let config: ReturnType<typeof createConfigFixture>;
  let eventBus: EventBusMock;
  let vfxCommandService: VfxCommandServiceMock;
  let manager: NotificationManagerLike;

  beforeEach(() => {
    queuedItems = [];
    displayQueue = {
      addItem: createMockFn((item: QueuedItem) => queuedItems.push(item)),
      getQueueLength: createMockFn(() => queuedItems.length),
    };

    config = createConfigFixture({
      general: {
        followsEnabled: true,
        giftsEnabled: true,
        raidsEnabled: true,
        sharesEnabled: true,
      },
    });

    vfxCommandService = {
      getVFXConfig: createMockFn().mockImplementation(async (commandKey) => ({
        commandKey,
        filename: `${commandKey}.mp4`,
      })),
      executeCommand: createMockFn().mockResolvedValue({ success: true }),
      executeCommandForKey: createMockFn().mockResolvedValue({ success: true }),
    };

    eventBus = {
      emit: createMockFn(),
      on: createMockFn(),
      off: createMockFn(),
    };

    manager = new NotificationManager({
      logger: noOpLogger,
      displayQueue,
      config,
      eventBus,
      constants,
      textProcessing: { formatChatMessage: createMockFn() },
      obsGoals: { processDonationGoal: createMockFn() },
      vfxCommandService,
    });
  });

  test("share notifications queue at share priority and keep share VFX mapping", async () => {
    const result = await manager.handleNotification(
      "platform:share",
      "tiktok",
      {
        username: "StreamSharer",
        userId: "share-1",
      },
    );

    expect(result.success).toBe(true);
    expect(queuedItems).toHaveLength(1);

    const queued = queuedItems[0];
    expect(queued.priority).toBe(constants.PRIORITY_LEVELS.SHARE);
    expect(result.priority).toBe(constants.PRIORITY_LEVELS.SHARE);
    expect(queued.vfxConfig).toEqual(
      expect.objectContaining({
        commandKey: "shares",
        filename: "shares.mp4",
      }),
    );
    expect(queued.data?.displayMessage).toBe("StreamSharer shared the stream");
    expect(queued.type).toBe("platform:share");
  });

  test("share notifications respect per-platform disabled toggles", async () => {
    const disabledConfig = createConfigFixture({
      general: { sharesEnabled: false },
    });
    const disabledManager = new NotificationManager({
      logger: noOpLogger,
      displayQueue,
      config: disabledConfig,
      eventBus,
      constants,
      textProcessing: { formatChatMessage: createMockFn() },
      obsGoals: { processDonationGoal: createMockFn() },
      vfxCommandService,
    });

    const result = await disabledManager.handleNotification(
      "platform:share",
      "tiktok",
      {
        username: "MutedSharer",
        userId: "share-2",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        disabled: true,
        notificationType: "platform:share",
        platform: "tiktok",
      }),
    );
    expect(queuedItems).toHaveLength(0);
  });

  test("follow notifications respect per-platform disabled toggles", async () => {
    const disabledConfig = createConfigFixture({
      general: { followsEnabled: false },
    });
    const disabledManager = new NotificationManager({
      logger: noOpLogger,
      displayQueue,
      config: disabledConfig,
      eventBus,
      constants,
      textProcessing: { formatChatMessage: createMockFn() },
      obsGoals: { processDonationGoal: createMockFn() },
      vfxCommandService,
    });

    const result = await disabledManager.handleNotification(
      "platform:follow",
      "twitch",
      {
        username: "MutedFollower",
        userId: "follow-1",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        disabled: true,
        notificationType: "platform:follow",
        platform: "twitch",
      }),
    );
    expect(queuedItems).toHaveLength(0);
  });

  test("share notifications reject missing usernames", async () => {
    const result = await manager.handleNotification(
      "platform:share",
      "tiktok",
      {
        userId: "share-3",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: "Missing username",
      }),
    );
    expect(queuedItems).toHaveLength(0);
  });

  test("follow notifications carry follow VFX command mapping", async () => {
    await manager.handleNotification("platform:follow", "youtube", {
      username: "Follower",
      userId: "follow-2",
    });

    expect(queuedItems[0].vfxConfig).toEqual(
      expect.objectContaining({
        commandKey: "follows",
      }),
    );
  });

  test("follow notifications reject missing usernames", async () => {
    const result = await manager.handleNotification(
      "platform:follow",
      "twitch",
      {
        userId: "only-id",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: "Missing username",
      }),
    );
    expect(queuedItems).toHaveLength(0);
  });

  test("raid notifications without viewer counts are rejected", async () => {
    const result = await manager.handleNotification("platform:raid", "twitch", {
      username: "MysteryRaider",
      userId: "raid-1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: "Notification build failed",
      }),
    );
    expect(queuedItems).toHaveLength(0);
  });

  test("raid notifications with zero viewers still route and surface zero count", async () => {
    const result = await manager.handleNotification("platform:raid", "twitch", {
      username: "ZeroRaider",
      viewerCount: 0,
      userId: "raid-0",
    });

    expect(result.success).toBe(true);
    const raidItem = queuedItems[0];
    expect(raidItem.data?.displayMessage).toBe(
      "Incoming raid from ZeroRaider with 0 viewers!",
    );
    expect(raidItem.data?.ttsMessage).toBe(
      "Incoming raid from ZeroRaider with 0 viewers",
    );
  });

  test("raid notifications carry raid VFX command mapping", async () => {
    await manager.handleNotification("platform:raid", "youtube", {
      username: "VfxRaider",
      viewerCount: 25,
      userId: "raid-vfx",
    });

    expect(queuedItems[0].vfxConfig).toEqual(
      expect.objectContaining({
        commandKey: "raids",
      }),
    );
  });

  test("returns disabled when notifications are globally disabled", async () => {
    const disabledConfig = createConfigFixture({
      general: { followsEnabled: false },
    });
    const disabledManager = new NotificationManager({
      logger: noOpLogger,
      displayQueue,
      config: disabledConfig,
      eventBus,
      constants,
      textProcessing: { formatChatMessage: createMockFn() },
      obsGoals: { processDonationGoal: createMockFn() },
      vfxCommandService,
    });

    const result = await disabledManager.handleNotification(
      "platform:follow",
      "tiktok",
      {
        username: "ResilientUser",
        userId: "follow-err",
      },
    );

    expect(result.success).toBe(false);
    expect(result.disabled).toBe(true);
    expect(queuedItems).toHaveLength(0);
  });
});
