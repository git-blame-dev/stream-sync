import { describe, test, afterEach, expect, spyOn } from "bun:test";
import { join } from "node:path";

import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import { TwitchPlatform } from "../../src/platforms/twitch.ts";
import { YouTubePlatform } from "../../src/platforms/youtube.ts";
import { TikTokPlatform } from "../../src/platforms/tiktok.ts";
import { TwitchAuth } from "../../src/auth/TwitchAuth.ts";
import { InnertubeService } from "../../src/services/innertube-service.ts";
import { YouTubeStreamDetectionService } from "../../src/services/youtube-stream-detection-service.ts";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture.ts";
import { createTikTokLifetimeFixture } from "../helpers/tiktok-connector-fixture.ts";
import { noOpLogger } from "../helpers/mock-factories";
import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";
import { restoreAllMocks } from "../helpers/bun-mock-utils";
import {
  createTikTokConfigFixture,
  createTwitchConfigFixture,
  createYouTubeConfigFixture,
} from "../helpers/config-fixture";
import { waitFor } from "../helpers/event-driven-testing";

type PlatformKey = "twitch" | "youtube" | "tiktok";
type HandlerName = "onPaypiggy";
type PlatformConstructor = Parameters<
  PlatformLifecycleService["initializeAllPlatforms"]
>[0][string];
type PlatformConfigOverride = {
  enabled: boolean;
  username?: string;
  dataLoggingEnabled?: boolean;
};
type PaypiggyPayload = {
  username: string;
  userId: string;
  tier?: string;
  membershipLevel?: string;
  months?: number;
  message?: string;
  timestamp: string;
};
type QueueItem = {
  type: string;
  platform: PlatformKey;
  data: Record<string, unknown>;
};
type CopyExpectations = {
  username?: string;
  keyword?: string;
  logKeyword?: string;
  count?: number;
};
type PaypiggySmokeCase = {
  platformKey: PlatformKey;
  handlerName: HandlerName;
  payload: PaypiggyPayload;
  assertFn: (queued: QueueItem) => void;
  copyExpectations: CopyExpectations;
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
  return {
    type: value.type,
    platform: value.platform as PlatformKey,
    data: value.data,
  };
};

describe("Paypiggy platform flows (smoke)", () => {
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
    { username, keyword, logKeyword, count }: CopyExpectations,
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
      const normalizedLogKeyword = (logKeyword || keyword).toLowerCase();
      expect(data.logMessage.toLowerCase()).toContain(normalizedLogKeyword);
    }
    if (count !== undefined) {
      const countText = String(count);
      expect(data.displayMessage).toContain(countText);
      expect(data.ttsMessage).toContain(countText);
      expect(data.logMessage).toContain(countText);
    }
  };

  const createHarness = async (platformKey: PlatformKey) => {
    const presentation = await createMainPresentationFixture();
    presentation.config.general.debugEnabled = false;
    presentation.config.general.envFileReadEnabled = false;
    presentation.config.general.envFileWriteEnabled = false;
    presentation.config.general.giftsEnabled = true;
    presentation.config.general.paypiggiesEnabled = true;
    presentation.config.logging.file.enabled = false;

    presentation.config.twitch.enabled = false;
    presentation.config.twitch.dataLoggingEnabled = false;
    presentation.config.twitch.giftsEnabled = true;
    presentation.config.twitch.paypiggiesEnabled = true;

    presentation.config.youtube.enabled = false;
    presentation.config.youtube.username = "test-channel";
    presentation.config.youtube.dataLoggingEnabled = false;
    presentation.config.youtube.giftsEnabled = true;
    presentation.config.youtube.paypiggiesEnabled = true;

    presentation.config.tiktok.enabled = false;
    presentation.config.tiktok.dataLoggingEnabled = false;
    presentation.config.tiktok.giftsEnabled = true;
    presentation.config.tiktok.paypiggiesEnabled = true;

    await presentation.start();
    const addItemSpy = spyOn(presentation.queue, "addItem");

    const lifecyclePlatformConfig: PlatformConfigOverride = {
      enabled: true,
      dataLoggingEnabled: false,
    };
    if (platformKey === "youtube") {
      lifecyclePlatformConfig.username = "test-channel";
    }

    const platformLifecycleService = new PlatformLifecycleService({
      config: { [platformKey]: lifecyclePlatformConfig },
      eventBus: presentation.bus,
      logger: noOpLogger,
    });

    const cleanup = registerCleanup(async () => {
      await platformLifecycleService.disconnectAll();
      platformLifecycleService.dispose();
      restoreAllMocks();
      await presentation.dispose();
    });

    return {
      presentation,
      addItemSpy,
      platformLifecycleService,
      cleanup,
    };
  };

  const createPlatformConstructor = (
    platformKey: PlatformKey,
    payload: PaypiggyPayload,
    tokenDir: string,
  ): PlatformConstructor => {
    if (platformKey === "twitch") {
      const auth = new TwitchAuth({
        tokenStorePath: join(tokenDir, "twitch-tokens.json"),
        clientId: "synthetic-client",
        expectedUsername: "synthetic-user",
        logger: noOpLogger,
      });
      registerCleanup(() => {
        auth.dispose();
      });

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
          await this.handlePaypiggyEvent(payload);
          return undefined;
        }
      }

      return ConfiguredTwitchPlatform as unknown as PlatformConstructor;
    }

    if (platformKey === "youtube") {
      const innertubeService = new InnertubeService(
        {
          createWithTimeout: async () => ({
            getChannel: async () => ({
              videos: [],
              getLiveStreams: async () => ({ videos: [] }),
            }),
            search: async () => ({ videos: [] }),
            getInfo: async (id: string) => ({
              basic_info: {
                id,
                is_live: false,
                is_live_content: false,
                view_count: 0,
              },
            }),
          }),
        },
        { logger: noOpLogger },
      );
      const streamDetectionService = new YouTubeStreamDetectionService(
        innertubeService,
        { logger: noOpLogger },
      );
      registerCleanup(async () => {
        await innertubeService.dispose();
      });

      class ConfiguredYouTubePlatform extends YouTubePlatform {
        constructor() {
          super(
            createYouTubeConfigFixture({
              enabled: false,
              username: "test-channel",
              dataLoggingEnabled: false,
              envFileReadEnabled: false,
              envFileWriteEnabled: false,
            }),
            {
              logger: noOpLogger,
              USER_AGENTS: ["test-agent"],
              innertubeService,
              streamDetectionService,
            },
          );
        }

        override async initialize(
          handlers: Parameters<YouTubePlatform["initialize"]>[0] = {},
        ) {
          await super.initialize(handlers);
          this._emitPlatformEvent(
            "platform:paypiggy",
            this.eventFactory.createPaypiggyEvent(payload),
          );
        }
      }

      return ConfiguredYouTubePlatform as unknown as PlatformConstructor;
    }

    const tiktokFixture = createTikTokLifetimeFixture({
      enabled: false,
      username: "synthetic-streamer",
      dataLoggingEnabled: false,
    });
    registerCleanup(async () => {
      await tiktokFixture.cleanup();
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
        this._emitPlatformEvent("platform:paypiggy", payload);
        return outcome;
      }
    }

    return ConfiguredTikTokPlatform as unknown as PlatformConstructor;
  };

  const runPaypiggySmoke = async ({
    platformKey,
    handlerName,
    payload,
    assertFn,
    copyExpectations,
  }: PaypiggySmokeCase) => {
    expect(handlerName).toBe("onPaypiggy");
    const harness = await createHarness(platformKey);
    const PlatformConstructor = createPlatformConstructor(
      platformKey,
      payload,
      harness.presentation.dir,
    );

    try {
      await harness.platformLifecycleService.initializeAllPlatforms({
        [platformKey]: PlatformConstructor,
      });
      await harness.platformLifecycleService.waitForBackgroundInits();
      await waitFor(() => harness.addItemSpy.mock.calls.length === 1, {
        timeout: 500,
        interval: 1,
      });
      await harness.presentation.drain();

      expect(harness.addItemSpy).toHaveBeenCalledTimes(1);
      const queued = requireQueueItem(harness.addItemSpy.mock.calls[0]?.[0]);
      expect(queued.type).toBe("platform:paypiggy");
      expect(queued.platform).toBe(platformKey);
      assertUserFacingOutput(queued.data, copyExpectations);
      assertFn(queued);
    } finally {
      await runCleanups();
    }
  };

  test("routes Twitch paypiggy through lifecycle, router, and runtime", async () => {
    await runPaypiggySmoke({
      platformKey: "twitch",
      handlerName: "onPaypiggy",
      payload: {
        username: "SubUser",
        userId: "tw-sub-1",
        tier: "1000",
        months: 1,
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      copyExpectations: {
        username: "SubUser",
        keyword: "subscribed",
        logKeyword: "subscriber",
      },
      assertFn: (queued) => {
        expect(queued.data.username).toBe("SubUser");
        expect(queued.data.tier).toBe("1000");
        expect(queued.data.months).toBe(1);
      },
    });
  });

  test("routes YouTube memberships through lifecycle, router, and runtime", async () => {
    await runPaypiggySmoke({
      platformKey: "youtube",
      handlerName: "onPaypiggy",
      payload: {
        username: "MemberUser",
        userId: "yt-member-1",
        membershipLevel: "Member",
        months: 2,
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      copyExpectations: {
        username: "MemberUser",
        keyword: "member",
      },
      assertFn: (queued) => {
        expect(queued.data.username).toBe("MemberUser");
        expect(queued.data.membershipLevel).toBe("Member");
        expect(queued.data.months).toBe(2);
      },
    });
  });

  test("routes YouTube membership renewals with renewal copy", async () => {
    await runPaypiggySmoke({
      platformKey: "youtube",
      handlerName: "onPaypiggy",
      payload: {
        username: "MilestoneUser",
        userId: "yt-member-10",
        membershipLevel: "Member",
        months: 10,
        message: "Thanks for the membership!",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      copyExpectations: {
        username: "MilestoneUser",
        keyword: "renewed membership",
        logKeyword: "member renewal",
        count: 10,
      },
      assertFn: (queued) => {
        expect(queued.data.displayMessage).toContain("renewed membership");
        expect(queued.data.ttsMessage).toContain("renewed membership");
        expect(queued.data.months).toBe(10);
        expect(queued.data.message).toBe("Thanks for the membership!");
      },
    });
  });

  test("routes TikTok subscriptions through lifecycle, router, and runtime", async () => {
    await runPaypiggySmoke({
      platformKey: "tiktok",
      handlerName: "onPaypiggy",
      payload: {
        username: "TikFan",
        userId: "tt-sub-1",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      copyExpectations: {
        username: "TikFan",
        keyword: "subscribed",
        logKeyword: "subscriber",
      },
      assertFn: (queued) => {
        expect(queued.data.username).toBe("TikFan");
        expect(queued.data.tier).toBeUndefined();
      },
    });
  });
});
