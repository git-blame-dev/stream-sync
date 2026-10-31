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
type GiftQueueData = {
  giftType: string;
  currency: string;
  displayMessage: string;
  ttsMessage: string;
  logMessage: string;
  message?: string;
  parts?: unknown;
  userId?: string;
};
type QueuedGiftItem = {
  type: "platform:gift";
  platform: "youtube";
  data: GiftQueueData;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const isGiftQueueData = (value: unknown): value is GiftQueueData =>
  isRecord(value) &&
  typeof value.giftType === "string" &&
  typeof value.currency === "string" &&
  typeof value.displayMessage === "string" &&
  typeof value.ttsMessage === "string" &&
  typeof value.logMessage === "string";

const isQueuedGiftItem = (value: unknown): value is QueuedGiftItem =>
  isRecord(value) &&
  value.type === "platform:gift" &&
  value.platform === "youtube" &&
  isGiftQueueData(value.data);

describe("YouTube gift platform flow (smoke)", () => {
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
    data: GiftQueueData,
    { username, keyword }: { username?: string; keyword?: string },
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

  const createRuntimeDeps = async (payload: Record<string, unknown>) => {
    const presentation = await createMainPresentationFixture();
    presentation.config.general.debugEnabled = false;
    presentation.config.general.envFileReadEnabled = false;
    presentation.config.general.envFileWriteEnabled = false;
    presentation.config.general.giftsEnabled = true;
    presentation.config.general.paypiggiesEnabled = true;
    presentation.config.logging.file.enabled = false;
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
          "platform:gift",
          this.eventFactory.createGiftEvent(payload),
        );
      }
    }

    return {
      presentation,
      addItemSpy,
      platformLifecycleService,
      ConfiguredYouTubePlatform:
        ConfiguredYouTubePlatform as unknown as PlatformConstructor,
    };
  };

  test("routes Super Chat gifts through lifecycle, router, and runtime", async () => {
    const {
      presentation,
      addItemSpy,
      platformLifecycleService,
      ConfiguredYouTubePlatform,
    } = await createRuntimeDeps({
      username: "ChatHero",
      userId: "yt-chat-1",
      giftType: "Super Chat",
      giftCount: 1,
      amount: 5,
      currency: "USD",
      id: "yt-superchat-1",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    try {
      await platformLifecycleService.initializeAllPlatforms({
        youtube: ConfiguredYouTubePlatform,
      });
      await waitFor(() => addItemSpy.mock.calls.length === 1, {
        timeout: 500,
        interval: 1,
      });
      await presentation.drain();

      expect(addItemSpy).toHaveBeenCalledTimes(1);
      const [queued] = addItemSpy.mock.calls[0] ?? [];
      expect(isQueuedGiftItem(queued)).toBe(true);
      if (!isQueuedGiftItem(queued)) {
        throw new Error("Expected a YouTube gift queue item");
      }
      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("youtube");
      expect(queued.data.giftType).toBe("Super Chat");
      expect(queued.data.currency).toBe("USD");
      expect(queued.data.displayMessage).toContain("Super Chat");
      assertUserFacingOutput(queued.data, {
        username: "ChatHero",
        keyword: "Super Chat",
      });
    } finally {
      await runCleanups();
    }
  });

  test("routes Super Sticker gifts through lifecycle, router, and runtime", async () => {
    const {
      presentation,
      addItemSpy,
      platformLifecycleService,
      ConfiguredYouTubePlatform,
    } = await createRuntimeDeps({
      username: "test-sticker-hero",
      userId: "yt-sticker-1",
      giftType: "Super Sticker",
      giftCount: 1,
      amount: 3,
      currency: "USD",
      message: "Nice sticker",
      giftImageUrl:
        "https://lh3.googleusercontent.com/test-supersticker=s176-rwa",
      id: "yt-supersticker-1",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    try {
      await platformLifecycleService.initializeAllPlatforms({
        youtube: ConfiguredYouTubePlatform,
      });
      await waitFor(() => addItemSpy.mock.calls.length === 1, {
        timeout: 500,
        interval: 1,
      });
      await presentation.drain();

      expect(addItemSpy).toHaveBeenCalledTimes(1);
      const [queued] = addItemSpy.mock.calls[0] ?? [];
      expect(isQueuedGiftItem(queued)).toBe(true);
      if (!isQueuedGiftItem(queued)) {
        throw new Error("Expected a YouTube gift queue item");
      }
      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("youtube");
      expect(queued.data.giftType).toBe("Super Sticker");
      expect(queued.data.message).toBe("Nice sticker");
      expect(queued.data.displayMessage).toContain("Super Sticker");
      expect(queued.data.parts).toEqual([
        {
          type: "emote",
          platform: "youtube",
          emoteId: "supersticker",
          imageUrl:
            "https://lh3.googleusercontent.com/test-supersticker=s176-rwa",
        },
        { type: "text", text: " Nice sticker" },
      ]);
      assertUserFacingOutput(queued.data, {
        username: "test-sticker-hero",
        keyword: "Super Sticker",
      });
    } finally {
      await runCleanups();
    }
  });

  test("routes YouTube jewels gifts without userId through lifecycle, router, and runtime", async () => {
    const {
      presentation,
      addItemSpy,
      platformLifecycleService,
      ConfiguredYouTubePlatform,
    } = await createRuntimeDeps({
      username: "test-jewels-user",
      giftType: "Girl power",
      giftCount: 1,
      amount: 300,
      currency: "jewels",
      id: "yt-jewels-1",
      timestamp: "2024-01-01T00:00:00.000Z",
      metadata: {
        missingFields: ["userId"],
      },
    });

    try {
      await platformLifecycleService.initializeAllPlatforms({
        youtube: ConfiguredYouTubePlatform,
      });
      await waitFor(() => addItemSpy.mock.calls.length === 1, {
        timeout: 500,
        interval: 1,
      });
      await presentation.drain();

      expect(addItemSpy).toHaveBeenCalledTimes(1);
      const [queued] = addItemSpy.mock.calls[0] ?? [];
      expect(isQueuedGiftItem(queued)).toBe(true);
      if (!isQueuedGiftItem(queued)) {
        throw new Error("Expected a YouTube gift queue item");
      }
      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("youtube");
      expect(queued.data.giftType).toBe("Girl power");
      expect(queued.data.currency).toBe("jewels");
      expect(queued.data.userId).toBeUndefined();
      expect(queued.data.displayMessage.toLowerCase()).toContain("jewels");
      assertUserFacingOutput(queued.data, {
        username: "test-jewels-user",
        keyword: "jewels",
      });
    } finally {
      await runCleanups();
    }
  });
});
