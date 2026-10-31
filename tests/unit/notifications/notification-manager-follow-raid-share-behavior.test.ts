import { vi, type Mock, afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createConfigFixture } from "../../helpers/config-fixture";

import NotificationManager from "../../../src/notifications/NotificationManager";
import * as constants from "../../../src/core/constants";
import type { DisplayQueueItem } from "../../../src/interfaces/DisplayQueue";
import { noOpLogger } from "../../helpers/mock-factories";

type QueuedItem = DisplayQueueItem;

type DisplayQueueMock = {
  addItem: Mock<(...args: [QueuedItem]) => readonly QueuedItem[]>;
  getQueueLength: Mock<(...args: []) => number>;
};

type EventBusMock = {
  emit: Mock<(...args: unknown[]) => unknown>;
  on: Mock<(...args: unknown[]) => unknown>;
  off: Mock<(...args: unknown[]) => unknown>;
};

type VfxCommandServiceMock = {
  getVFXConfig: Mock<(...args: [string]) => Promise<{ commandKey: string; filename: string }>>;
  executeCommand: Mock<(...args: unknown[]) => Promise<{ success: boolean }>>;
  executeCommandForKey: Mock<(...args: unknown[]) => Promise<{ success: boolean }>>;
};

const requireQueuedItem = (item: QueuedItem | undefined): QueuedItem => {
  expect(item).toBeDefined();
  if (!item) {
    throw new Error("Expected queued notification item");
  }
  return item;
};

describe("NotificationManager follow/raid/share behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  let queuedItems: QueuedItem[];
  let displayQueue: DisplayQueueMock;
  let config: ReturnType<typeof createConfigFixture>;
  let eventBus: EventBusMock;
  let vfxCommandService: VfxCommandServiceMock;
  let manager: NotificationManager;

  beforeEach(() => {
    queuedItems = [];
    displayQueue = {
      addItem: vi.fn<(...args: [QueuedItem]) => readonly QueuedItem[]>((item) => {
        queuedItems.push(item);
        return [item];
      }),
      getQueueLength: vi.fn(() => queuedItems.length),
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
      getVFXConfig: vi.fn<(...args: [string]) => Promise<{ commandKey: string; filename: string }>
      >(async (commandKey) => ({
        commandKey,
        filename: `${commandKey}.mp4`,
      })),
      executeCommand: vi.fn<(...args: unknown[]) => Promise<{ success: boolean }>>().mockResolvedValue({ success: true }),
      executeCommandForKey: vi.fn<(...args: unknown[]) => Promise<{ success: boolean }>>().mockResolvedValue({ success: true }),
    };

    eventBus = {
      emit: vi.fn<(...args: unknown[]) => unknown>(),
      on: vi.fn<(...args: unknown[]) => unknown>(),
      off: vi.fn<(...args: unknown[]) => unknown>(),
    };

    manager = new NotificationManager({
      logger: noOpLogger,
      displayQueue,
      config,
      eventBus,
      constants,
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

    const queued = requireQueuedItem(queuedItems[0]);
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

    expect(requireQueuedItem(queuedItems[0]).vfxConfig).toEqual(
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

  test("raid notifications without viewer counts queue once with count-free text and raid VFX", async () => {
    const result = await manager.handleNotification("platform:raid", "twitch", {
      username: "SyntheticRaider",
      userId: "synthetic-raid-unknown",
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        priority: constants.PRIORITY_LEVELS.RAID,
      }),
    );
    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    expect(queuedItems).toHaveLength(1);
    const raidItem = requireQueuedItem(queuedItems[0]);
    expect(raidItem.data).toMatchObject({
      displayMessage: "Incoming raid from SyntheticRaider!",
      ttsMessage: "Incoming raid from SyntheticRaider",
      logMessage: "Incoming raid from SyntheticRaider!",
    });
    expect(raidItem.priority).toBe(constants.PRIORITY_LEVELS.RAID);
    expect(raidItem.vfxConfig).toEqual({ commandKey: "raids", filename: "raids.mp4" });
  });

  test("raid notifications with zero viewers still route and surface zero count", async () => {
    const result = await manager.handleNotification("platform:raid", "twitch", {
      username: "ZeroRaider",
      viewerCount: 0,
      userId: "raid-0",
    });

    expect(result.success).toBe(true);
    expect(queuedItems).toHaveLength(1);
    const raidItem = requireQueuedItem(queuedItems[0]);
    expect(raidItem.data?.displayMessage).toBe(
      "Incoming raid from ZeroRaider with 0 viewers!",
    );
    expect(raidItem.data?.ttsMessage).toBe(
      "Incoming raid from ZeroRaider with 0 viewers",
    );
    expect(raidItem.data?.logMessage).toBe("Incoming raid from ZeroRaider with 0 viewers!");
  });

  test("raid notifications retain singular wording for one viewer", async () => {
    const result = await manager.handleNotification("platform:raid", "twitch", {
      username: "SyntheticRaider", viewerCount: "1", userId: "synthetic-raid-one",
    });
    expect(result.success).toBe(true);
    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    expect(queuedItems).toHaveLength(1);
    expect(requireQueuedItem(queuedItems[0]).data).toMatchObject({
      displayMessage: "Incoming raid from SyntheticRaider with 1 viewer!",
      ttsMessage: "Incoming raid from SyntheticRaider with 1 viewer",
      logMessage: "Incoming raid from SyntheticRaider with 1 viewer!",
    });
  });

  test("raid notifications carry raid VFX command mapping", async () => {
    await manager.handleNotification("platform:raid", "youtube", {
      username: "VfxRaider",
      viewerCount: 25,
      userId: "raid-vfx",
    });

    expect(requireQueuedItem(queuedItems[0]).vfxConfig).toEqual(
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
