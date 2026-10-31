import { vi, describe, test, afterEach, expect, spyOn } from 'bun:test';

import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture.ts";
import { createTikTokLifetimeFixture } from "../helpers/tiktok-connector-fixture.ts";
import { noOpLogger } from "../helpers/mock-factories";

import { createTikTokShareEvent } from "../helpers/tiktok-test-data";
import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";
import { waitFor } from "../helpers/event-driven-testing";

type UserFacingNotificationData = {
  displayMessage: string;
  ttsMessage: string;
  logMessage: string;
  username: string;
};

type DisplayQueueItem = {
  type: string;
  platform: string;
  data: UserFacingNotificationData;
};

const isDisplayQueueItem = (value: unknown): value is DisplayQueueItem => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  const data = item.data;
  if (!data || typeof data !== "object") {
    return false;
  }
  const notificationData = data as Record<string, unknown>;
  return (
    typeof item.type === "string" &&
    typeof item.platform === "string" &&
    typeof notificationData.username === "string" &&
    typeof notificationData.displayMessage === "string" &&
    typeof notificationData.ttsMessage === "string" &&
    typeof notificationData.logMessage === "string"
  );
};

const assertDisplayQueueItem = (value: unknown): DisplayQueueItem => {
  expect(isDisplayQueueItem(value)).toBe(true);
  if (!isDisplayQueueItem(value)) {
    throw new Error("Expected a typed display queue item");
  }
  return value;
};

const assertUserFacingOutput = (
  data: UserFacingNotificationData,
  { username }: { username: string },
) => {
  const fields = ["displayMessage", "ttsMessage", "logMessage"] as const;
  fields.forEach((field) => {
    expect(data[field].trim()).not.toBe("");
    expectNoTechnicalArtifacts(data[field]);
  });
  fields.forEach((field) => {
    expect(data[field]).toContain(username);
  });
};

describe("TikTok share platform flow (smoke)", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  const registerCleanup = (fn: () => Promise<void> | void) => {
    let executed = false;
    const idempotentFn = async () => {
      if (executed) return;
      executed = true;
      await fn();
    };
    cleanups.push(idempotentFn);
    return idempotentFn;
  };

  const runCleanups = async () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      if (cleanup) {
        await cleanup();
      }
    }
  };

  afterEach(async () => {
    try {
      await runCleanups();
    } finally {
      vi.restoreAllMocks();
    }
  });

  test("routes share through lifecycle, router, and display queue", async () => {
    const presentation = await createMainPresentationFixture();
    presentation.config.general.debugEnabled = false;
    presentation.config.general.envFileReadEnabled = false;
    presentation.config.general.envFileWriteEnabled = false;
    presentation.config.general.sharesEnabled = true;
    presentation.config.logging.file.enabled = false;
    presentation.config.tiktok.enabled = false;
    presentation.config.tiktok.dataLoggingEnabled = false;
    presentation.config.tiktok.sharesEnabled = true;

    await presentation.start();
    const addItemSpy = spyOn(presentation.queue, "addItem");

    const platformLifecycleService = new PlatformLifecycleService({
      config: { tiktok: { enabled: true, dataLoggingEnabled: false } },
      eventBus: presentation.bus,
      logger: noOpLogger,
    });

    const tiktokFixture = createTikTokLifetimeFixture({
      enabled: true,
      sharesEnabled: true,
      dataLoggingEnabled: false,
    });

    registerCleanup(async () => {
      await tiktokFixture.cleanup();
      await platformLifecycleService.disconnectAll();
      platformLifecycleService.dispose();
      vi.restoreAllMocks();
      await presentation.dispose();
    });

    const platform = tiktokFixture.platform;
    platform.handlers =
      platformLifecycleService.createDefaultEventHandlers("tiktok");

    const eventTimestampMs = Date.parse("2025-01-20T12:00:00.000Z");
    const shareEvent = createTikTokShareEvent({
      user: { uniqueId: "test-user-share", nickname: "test-user-share" },
      common: { createTime: eventTimestampMs },
    });

    try {
      await platform.handleTikTokSocial(shareEvent);

      await waitFor(() => addItemSpy.mock.calls.length === 1, {
        timeout: 500,
        interval: 1,
      });
      await presentation.drain();

      expect(addItemSpy).toHaveBeenCalledTimes(1);
      const firstCall = addItemSpy.mock.calls[0];
      expect(firstCall).toBeDefined();
      if (!firstCall) {
        throw new Error("Expected display queue addItem to be called");
      }
      const queued = assertDisplayQueueItem(firstCall[0]);
      expect(queued.type).toBe("platform:share");
      expect(queued.platform).toBe("tiktok");
      expect(queued.data.username).toBe("test-user-share");
      assertUserFacingOutput(queued.data, { username: "test-user-share" });
    } finally {
      await runCleanups();
    }
  });
});
