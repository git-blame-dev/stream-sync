import { describe, test, afterEach, expect, spyOn } from "bun:test";
import { join } from "node:path";

import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import { TwitchPlatform } from "../../src/platforms/twitch";
import { TwitchAuth } from "../../src/auth/TwitchAuth.ts";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture.ts";
import { noOpLogger } from "../helpers/mock-factories";
import { restoreAllMocks } from "../helpers/bun-mock-utils";
import { createTwitchConfigFixture } from "../helpers/config-fixture";
import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";
import { waitFor } from "../helpers/event-driven-testing";

type QueueItem = {
  type: string;
  platform: string;
  data: Record<string, unknown>;
};
type RaidCopyExpectations = {
  username?: string;
  viewerCount?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const requireQueueItem = (value: unknown): QueueItem => {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) {
    throw new Error("Expected queued display item");
  }
  expect(typeof value.type).toBe("string");
  expect(typeof value.platform).toBe("string");
  expect(isRecord(value.data)).toBe(true);
  if (
    typeof value.type !== "string" ||
    typeof value.platform !== "string" ||
    !isRecord(value.data)
  ) {
    throw new Error("Queued display item has invalid shape");
  }
  return { type: value.type, platform: value.platform, data: value.data };
};

const assertUserFacingOutput = (
  data: Record<string, unknown>,
  { username, viewerCount }: RaidCopyExpectations,
) => {
  const fields = ["displayMessage", "ttsMessage", "logMessage"];
  fields.forEach((field) => {
    expect(typeof data[field]).toBe("string");
    if (typeof data[field] !== "string") {
      throw new Error(`Expected ${field} to be notification copy`);
    }
    expect(typeof data[field]).toBe("string");
    expect(data[field].trim()).not.toBe("");
    expectNoTechnicalArtifacts(data[field]);
  });
  if (username) {
    fields.forEach((field) => {
      expect(data[field]).toContain(username);
    });
  }
  if (viewerCount !== undefined) {
    const countText = String(viewerCount);
    fields.forEach((field) => {
      expect(data[field]).toContain(countText);
    });
  }
};

describe("Twitch raid platform flow (smoke)", () => {
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
      restoreAllMocks();
    }
  });

  test("routes raid through lifecycle, router, and display queue", async () => {
    const presentation = await createMainPresentationFixture();
    presentation.config.general.debugEnabled = false;
    presentation.config.general.envFileReadEnabled = false;
    presentation.config.general.envFileWriteEnabled = false;
    presentation.config.general.raidsEnabled = true;
    presentation.config.logging.file.enabled = false;
    presentation.config.logging.chat.enabled = false;
    presentation.config.twitch.enabled = false;
    presentation.config.twitch.dataLoggingEnabled = false;
    presentation.config.twitch.raidsEnabled = true;

    await presentation.start();
    const addItemSpy = spyOn(presentation.queue, "addItem");

    const platformLifecycleService = new PlatformLifecycleService({
      config: { twitch: { enabled: true, dataLoggingEnabled: false } },
      eventBus: presentation.bus,
      logger: noOpLogger,
    });

    const auth = new TwitchAuth({
      tokenStorePath: join(presentation.dir, "twitch-tokens.json"),
      clientId: "synthetic-client",
      expectedUsername: "synthetic-user",
      logger: noOpLogger,
    });

    const platform = new TwitchPlatform(
      createTwitchConfigFixture({
        enabled: true,
        clientId: "synthetic-client",
        dataLoggingEnabled: false,
      }),
      {
        logger: noOpLogger,
        twitchAuth: auth,
      },
    );
    platform.handlers =
      platformLifecycleService.createDefaultEventHandlers("twitch");

    registerCleanup(async () => {
      await platform.cleanup();
      auth.dispose();
      await platformLifecycleService.disconnectAll();
      platformLifecycleService.dispose();
      restoreAllMocks();
      await presentation.dispose();
    });

    try {
      await platform.handleRaidEvent({
        username: "test-user-raider",
        userId: "test-user-id-raider",
        viewerCount: 42,
        timestamp: "2024-01-01T00:00:00.000Z",
      });

      await waitFor(() => addItemSpy.mock.calls.length === 1, {
        timeout: 500,
        interval: 1,
      });
      await presentation.drain();

      expect(addItemSpy).toHaveBeenCalledTimes(1);
      const queued = requireQueueItem(addItemSpy.mock.calls[0]?.[0]);
      expect(queued.type).toBe("platform:raid");
      expect(queued.platform).toBe("twitch");
      expect(queued.data.username).toBe("test-user-raider");
      expect(queued.data.viewerCount).toBe(42);
      assertUserFacingOutput(queued.data, {
        username: "test-user-raider",
        viewerCount: 42,
      });
    } finally {
      await runCleanups();
    }
  });
});
