import { vi, afterEach, describe, expect, test } from 'bun:test';
import type { DisplayQueueItem } from "../../../src/interfaces/DisplayQueue";

import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";

import { EventEmitter } from "node:events";
import NotificationManager from "../../../src/notifications/NotificationManager";

describe("NotificationManager raid viewer count fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createManager = () => {
    const displayQueue = {
      addItem: vi.fn<(...args: [DisplayQueueItem]) => readonly DisplayQueueItem[]>((item) => [item]),
      addToQueue: vi.fn<(...args: unknown[]) => unknown>(),
      processQueue: vi.fn<(...args: unknown[]) => unknown>(),
      isQueueEmpty: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
      clearQueue: vi.fn<(...args: unknown[]) => unknown>(),
      getQueueLength: vi.fn(() => 0),
    };

    const config = createConfigFixture({
      general: {
        raidsEnabled: true,
      },
    });

    return new NotificationManager({
      logger: noOpLogger,
      displayQueue,
      eventBus: new EventEmitter(),
      config,
      constants: require("../../../src/core/constants"),
      vfxCommandService: {
        executeCommand: vi.fn<(...args: unknown[]) => Promise<{ success: true; }>>().mockResolvedValue({ success: true }),
      },
      userTrackingService: {
        isFirstMessage: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(false),
      },
    });
  };

  test("keeps raid logs without inventing an unknown viewer count", () => {
    const manager = createManager();
    for (const viewerCount of [undefined, null, true, [], {}, "", " ", -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(manager.generateLogMessage("platform:raid", { username: "SyntheticRaider", viewerCount })).toBe("Incoming raid from SyntheticRaider!");
    }
  });

  test("normalizes valid raid fallback counts including zero and singular", () => {
    const manager = createManager();
    for (const viewerCount of [0, "0", 1, "1", 12, " 12 "]) {
      const count = Number(viewerCount);
      expect(manager.generateLogMessage("platform:raid", { username: "SyntheticRaider", viewerCount })).toBe(`Incoming raid from SyntheticRaider with ${count} ${count === 1 ? "viewer" : "viewers"}!`);
    }
  });

  test("prepares a raid with unknown count instead of rejecting the notification", async () => {
    const manager = createManager();
    const result = await manager.prepareNotification("platform:raid", "twitch", {
      username: "SyntheticRaider", userId: "synthetic-raider", viewerCount: -1,
    });
    expect(result.success).toBe(true);
    expect(result.item?.data).toMatchObject({
      displayMessage: "Incoming raid from SyntheticRaider!",
      logMessage: "Incoming raid from SyntheticRaider!",
      ttsMessage: "Incoming raid from SyntheticRaider",
    });
  });
});
