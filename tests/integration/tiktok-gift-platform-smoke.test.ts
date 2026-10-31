import { vi, describe, test, afterEach, expect, spyOn } from 'bun:test';

import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import { TikTokPlatform } from "../../src/platforms/tiktok.ts";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture.ts";
import { createTikTokLifetimeFixture } from "../helpers/tiktok-connector-fixture.ts";
import { noOpLogger } from "../helpers/mock-factories";
import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";

import { createTikTokConfigFixture } from "../helpers/config-fixture";
import { waitFor } from "../helpers/event-driven-testing";

type UserFacingData = {
  displayMessage: string;
  ttsMessage: string;
  logMessage: string;
  username?: string;
  giftCount?: number;
  repeatCount?: number;
  currency?: string;
};
type QueueItem = { type: string; platform: string; data: UserFacingData };
type PlatformConstructor = Parameters<
  PlatformLifecycleService["initializeAllPlatforms"]
>[0][string];

const requireQueueItem = (value: unknown): QueueItem => {
  if (!value || typeof value !== "object") {
    throw new Error("Expected display queue item");
  }
  const record = value as Record<string, unknown>;
  if (!record.data || typeof record.data !== "object") {
    throw new Error("Expected queued item data");
  }
  return record as QueueItem;
};

describe("TikTok gift platform flow (smoke)", () => {
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

  const assertNonEmptyString = (value: string) => {
    expect(typeof value).toBe("string");
    expect(value.trim()).not.toBe("");
  };

  const assertUserFacingOutput = (
    data: UserFacingData,
    { username, keyword }: { username: string; keyword: string },
  ) => {
    assertNonEmptyString(data.displayMessage);
    assertNonEmptyString(data.ttsMessage);
    assertNonEmptyString(data.logMessage);

    expectNoTechnicalArtifacts(data.displayMessage);
    expectNoTechnicalArtifacts(data.ttsMessage);
    expectNoTechnicalArtifacts(data.logMessage);

    if (username) {
      expect(data.displayMessage).toContain(username);
      expect(data.ttsMessage).toContain(username);
      expect(data.logMessage).toContain(username);
    }
    if (keyword) {
      const normalizedKeyword = keyword.toLowerCase();
      expect(data.displayMessage.toLowerCase()).toContain(normalizedKeyword);
      expect(data.ttsMessage.toLowerCase()).toContain(normalizedKeyword);
      expect(data.logMessage.toLowerCase()).toContain(normalizedKeyword);
    }
  };

  test("routes gift through lifecycle, router, and runtime", async () => {
    const presentation = await createMainPresentationFixture();
    presentation.config.general.debugEnabled = false;
    presentation.config.general.envFileReadEnabled = false;
    presentation.config.general.envFileWriteEnabled = false;
    presentation.config.general.giftsEnabled = true;
    presentation.config.general.paypiggiesEnabled = true;
    presentation.config.logging.file.enabled = false;
    presentation.config.tiktok.enabled = false;
    presentation.config.tiktok.dataLoggingEnabled = false;
    presentation.config.tiktok.giftsEnabled = true;
    presentation.config.tiktok.paypiggiesEnabled = true;

    await presentation.start();
    const addItemSpy = spyOn(presentation.queue, "addItem");

    const platformLifecycleService = new PlatformLifecycleService({
      config: { tiktok: { enabled: true, dataLoggingEnabled: false } },
      eventBus: presentation.bus,
      logger: noOpLogger,
    });

    const tiktokFixture = createTikTokLifetimeFixture({
      enabled: false,
      username: "synthetic-streamer",
      dataLoggingEnabled: false,
    });

    registerCleanup(async () => {
      await tiktokFixture.cleanup();
      await platformLifecycleService.disconnectAll();
      platformLifecycleService.dispose();
      vi.restoreAllMocks();
      await presentation.dispose();
    });

    class ConfiguredTikTokPlatform extends TikTokPlatform {
      constructor() {
        super(
          createTikTokConfigFixture({
            enabled: false,
            username: "synthetic-streamer",
            dataLoggingEnabled: false,
          }),
          {
            logger: noOpLogger,
            retrySystem: tiktokFixture.retry,
          },
        );
      }

      override async initialize(
        handlers: Parameters<TikTokPlatform["initialize"]>[0] = {},
      ) {
        const outcome = await super.initialize(handlers);
        await this.handleOfficialGift({
          username: "TikFan",
          userId: "tt-gift-1",
          giftType: "Rose",
          giftCount: 3,
          repeatCount: 3,
          amount: 3,
          unitAmount: 1,
          currency: "coins",
          id: "tt-gift-event-1",
          timestamp: "2024-01-01T00:00:00.000Z",
        });
        return outcome;
      }
    }

    try {
      const platformModules: Parameters<
        PlatformLifecycleService["initializeAllPlatforms"]
      >[0] = {
        tiktok: ConfiguredTikTokPlatform as unknown as PlatformConstructor,
      };
      await platformLifecycleService.initializeAllPlatforms(platformModules);
      await platformLifecycleService.waitForBackgroundInits();
      await waitFor(() => addItemSpy.mock.calls.length === 1, {
        timeout: 500,
        interval: 1,
      });
      await presentation.drain();

      expect(addItemSpy).toHaveBeenCalledTimes(1);
      const queued = requireQueueItem(addItemSpy.mock.calls[0]?.[0]);
      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("tiktok");
      expect(queued.data.username).toBe("TikFan");
      expect(queued.data.giftCount).toBe(3);
      expect(queued.data.repeatCount).toBe(3);
      expect(queued.data.currency).toBe("coins");
      assertUserFacingOutput(queued.data, {
        username: "TikFan",
        keyword: "Rose",
      });
    } finally {
      await runCleanups();
    }
  });
});
