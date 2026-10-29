import { describe, test, afterEach, expect, spyOn } from "bun:test";

import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import { YouTubePlatform } from "../../src/platforms/youtube.ts";
import { InnertubeService } from "../../src/services/innertube-service.ts";
import { YouTubeStreamDetectionService } from "../../src/services/youtube-stream-detection-service.ts";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture.ts";
import { noOpLogger } from "../helpers/mock-factories";
import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";
import { restoreAllMocks } from "../helpers/bun-mock-utils";
import { createYouTubeConfigFixture } from "../helpers/config-fixture";
import { waitFor } from "../helpers/event-driven-testing";

type PlatformConstructor = Parameters<
  PlatformLifecycleService["initializeAllPlatforms"]
>[0][string];
type GiftPaypiggyPayload = {
  username: string;
  userId: string;
  giftCount: number;
  timestamp: string;
};
type UserFacingGiftPaypiggyData = GiftPaypiggyPayload & {
  displayMessage: string;
  ttsMessage: string;
  logMessage: string;
};
type QueuedGiftPaypiggy = {
  type: "platform:giftpaypiggy";
  platform: "youtube";
  data: UserFacingGiftPaypiggyData;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

function assertQueuedGiftPaypiggy(
  value: unknown,
): asserts value is QueuedGiftPaypiggy {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) throw new Error("Queued item must be an object");
  expect(value.type).toBe("platform:giftpaypiggy");
  expect(value.platform).toBe("youtube");
  expect(isRecord(value.data)).toBe(true);
  if (!isRecord(value.data)) throw new Error("Queued data must be an object");
  expect(value.data.username).toBe("GiftMember");
  expect(value.data.userId).toBe("yt-gifter-1");
  expect(value.data.giftCount).toBe(5);
  expect(typeof value.data.timestamp).toBe("string");
  expect(typeof value.data.displayMessage).toBe("string");
  expect(typeof value.data.ttsMessage).toBe("string");
  expect(typeof value.data.logMessage).toBe("string");
}

describe("YouTube giftpaypiggy platform flow (smoke)", () => {
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

  const assertNonEmptyString = (value: string) => {
    expect(typeof value).toBe("string");
    expect(value.trim()).not.toBe("");
  };

  const assertUserFacingOutput = (
    data: UserFacingGiftPaypiggyData,
    {
      username,
      keyword,
      count,
    }: { username?: string; keyword?: string; count?: number },
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
    presentation.config.youtube.enabled = false;
    presentation.config.youtube.username = "test-channel";
    presentation.config.youtube.dataLoggingEnabled = false;
    presentation.config.youtube.giftsEnabled = true;
    presentation.config.youtube.paypiggiesEnabled = true;

    await presentation.start();
    const addItemSpy = spyOn(presentation.queue, "addItem");

    const platformLifecycleService = new PlatformLifecycleService({
      config: {
        youtube: {
          enabled: true,
          username: "test-channel",
          dataLoggingEnabled: false,
        },
      },
      eventBus: presentation.bus,
      logger: noOpLogger,
    });

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
      await platformLifecycleService.disconnectAll();
      platformLifecycleService.dispose();
      await innertubeService.dispose();
      restoreAllMocks();
      await presentation.dispose();
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
          "platform:giftpaypiggy",
          this.eventFactory.createGiftPaypiggyEvent({
            username: "GiftMember",
            userId: "yt-gifter-1",
            giftCount: 5,
            timestamp: "2024-01-01T00:00:00.000Z",
          }),
        );
      }
    }

    try {
      await platformLifecycleService.initializeAllPlatforms({
        youtube: ConfiguredYouTubePlatform as unknown as PlatformConstructor,
      });
      await waitFor(() => addItemSpy.mock.calls.length === 1, {
        timeout: 500,
        interval: 1,
      });
      await presentation.drain();

      expect(addItemSpy).toHaveBeenCalledTimes(1);
      const firstAddItemCall = addItemSpy.mock.calls[0];
      expect(firstAddItemCall).toBeDefined();
      if (!firstAddItemCall) throw new Error("Expected display queue item");
      const [queued] = firstAddItemCall;
      assertQueuedGiftPaypiggy(queued);
      assertUserFacingOutput(queued.data, {
        username: "GiftMember",
        keyword: "membership",
        count: 5,
      });
    } finally {
      await runCleanups();
    }
  });
});
