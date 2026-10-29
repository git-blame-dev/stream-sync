import { describe, test, afterEach, expect, spyOn } from "bun:test";
import { join } from "node:path";

import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import { TwitchPlatform } from "../../src/platforms/twitch.ts";
import { TwitchAuth } from "../../src/auth/TwitchAuth.ts";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture.ts";
import { noOpLogger } from "../helpers/mock-factories";
import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";
import { restoreAllMocks } from "../helpers/bun-mock-utils";
import { createTwitchConfigFixture } from "../helpers/config-fixture";
import { waitFor } from "../helpers/event-driven-testing";

type PlatformConstructor = Parameters<
  PlatformLifecycleService["initializeAllPlatforms"]
>[0][string];
type GiftPaypiggyPayload = {
  username: string;
  userId: string;
  giftCount: number;
  tier: string;
  timestamp: string;
};
type QueueItem = {
  type: string;
  platform: string;
  data: Record<string, unknown>;
};
type CopyExpectations = {
  username?: string;
  keyword?: string;
  count?: number;
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

describe("Twitch giftpaypiggy platform flow (smoke)", () => {
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

  const assertNonEmptyString = (value: unknown) => {
    expect(typeof value).toBe("string");
    if (typeof value !== "string") {
      throw new Error("Expected non-empty string");
    }
    expect(value.trim()).not.toBe("");
  };

  const assertUserFacingOutput = (
    data: Record<string, unknown>,
    { username, keyword, count }: CopyExpectations,
  ) => {
    expect(typeof data.displayMessage).toBe("string");
    expect(typeof data.ttsMessage).toBe("string");
    expect(typeof data.logMessage).toBe("string");
    if (
      typeof data.displayMessage !== "string" ||
      typeof data.ttsMessage !== "string" ||
      typeof data.logMessage !== "string"
    ) {
      throw new Error("Expected user-facing notification copy");
    }
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
    if (count !== undefined) {
      const countText = String(count);
      expect(data.displayMessage).toContain(countText);
      expect(data.ttsMessage).toContain(countText);
      expect(data.logMessage).toContain(countText);
    }
  };

  test("routes giftpaypiggy through lifecycle, router, and runtime", async () => {
    const presentation = await createMainPresentationFixture();
    presentation.config.general.debugEnabled = false;
    presentation.config.general.envFileReadEnabled = false;
    presentation.config.general.envFileWriteEnabled = false;
    presentation.config.general.giftsEnabled = true;
    presentation.config.general.paypiggiesEnabled = true;
    presentation.config.logging.file.enabled = false;
    presentation.config.logging.chat.enabled = false;
    presentation.config.twitch.enabled = false;
    presentation.config.twitch.dataLoggingEnabled = false;
    presentation.config.twitch.giftsEnabled = true;
    presentation.config.twitch.paypiggiesEnabled = true;

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

    registerCleanup(async () => {
      auth.dispose();
      await platformLifecycleService.disconnectAll();
      platformLifecycleService.dispose();
      restoreAllMocks();
      await presentation.dispose();
    });

    const payload: GiftPaypiggyPayload = {
      username: "TestGifter",
      userId: "tw-test-gifter-1",
      giftCount: 5,
      tier: "1000",
      timestamp: "2024-01-01T00:00:00.000Z",
    };

    class ConfiguredTwitchPlatform extends TwitchPlatform {
      constructor() {
        super(
          createTwitchConfigFixture({
            enabled: false,
            clientId: "synthetic-client",
            dataLoggingEnabled: false,
          }),
          {
            logger: noOpLogger,
            twitchAuth: auth,
          },
        );
      }

      override async initialize(
        handlers: Parameters<TwitchPlatform["initialize"]>[0] = {},
      ) {
        this.handlers = handlers;
        await super.initialize(handlers);
        await this.handlePaypiggyGiftEvent(payload);
        return undefined;
      }
    }

    try {
      await platformLifecycleService.initializeAllPlatforms({
        twitch: ConfiguredTwitchPlatform as unknown as PlatformConstructor,
      });
      await waitFor(() => addItemSpy.mock.calls.length === 1, {
        timeout: 500,
        interval: 1,
      });
      await presentation.drain();

      expect(addItemSpy).toHaveBeenCalledTimes(1);
      const queued = requireQueueItem(addItemSpy.mock.calls[0]?.[0]);
      expect(queued.type).toBe("platform:giftpaypiggy");
      expect(queued.platform).toBe("twitch");
      expect(queued.data.username).toBe("TestGifter");
      expect(queued.data.giftCount).toBe(5);
      expect(queued.data.tier).toBe("1000");
      assertUserFacingOutput(queued.data, {
        username: "TestGifter",
        keyword: "subscription",
        count: 5,
      });
    } finally {
      await runCleanups();
    }
  });
});
