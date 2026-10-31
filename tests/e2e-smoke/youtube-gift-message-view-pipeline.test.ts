import { vi, describe, test, afterEach, expect, spyOn } from 'bun:test';

import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture";
import { noOpLogger } from "../helpers/mock-factories";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";
import { YouTubePlatform } from "../../src/platforms/youtube";
import { InnertubeService } from "../../src/services/innertube-service";
import { YouTubeStreamDetectionService } from "../../src/services/youtube-stream-detection-service";
import { ViewerCountExtractionService } from "../../src/services/viewer-count-extraction-service";

type MainPresentationFixture = Awaited<
  ReturnType<typeof createMainPresentationFixture>
>;

type QueuedGiftNotification = {
  type: string;
  platform: string;
  data: {
    id?: string;
    username?: string;
    userId?: string;
    giftType?: string;
    giftCount?: number;
    amount?: number;
    currency?: string;
    giftImageUrl?: string;
    avatarUrl?: string;
    timestamp?: string;
    isError?: boolean;
    displayMessage: string;
    ttsMessage: string;
    logMessage: string;
    parts?: unknown[];
    metadata: {
      missingFields?: string[];
      timestampSource?: string;
    };
  };
};

const isQueuedGiftNotification = (
  value: unknown,
): value is QueuedGiftNotification =>
  !!value &&
  typeof value === "object" &&
  "type" in value &&
  "platform" in value &&
  "data" in value &&
  typeof value.data === "object" &&
  value.data !== null;

const firstQueuedGiftNotification = (addItemSpy: {
  mock: { calls: unknown[][] };
}): QueuedGiftNotification => {
  const queued = addItemSpy.mock.calls[0]?.[0];
  if (!isQueuedGiftNotification(queued)) {
    throw new Error("Expected a queued YouTube gift notification");
  }
  return queued;
};

const assertNonEmptyString = (value: unknown) => {
  expect(typeof value).toBe("string");
  expect((value as string).trim()).not.toBe("");
};

describe("YouTube GiftMessageView pipeline (smoke E2E)", () => {
  let activePresentation: MainPresentationFixture | null = null;
  let activePlatform: YouTubePlatform | null = null;
  let activeDetector: YouTubeStreamDetectionService | null = null;
  let activeMetadata: InnertubeService | null = null;

  afterEach(async () => {
    const platform = activePlatform;
    const detector = activeDetector;
    const metadata = activeMetadata;
    const presentation = activePresentation;
    activePlatform = null;
    activeDetector = null;
    activeMetadata = null;
    activePresentation = null;

    try {
      if (platform) {
        await platform.cleanup();
      }
    } finally {
      try {
        if (detector) {
          await detector.cleanup();
        }
      } finally {
        try {
          if (metadata) {
            await metadata.dispose();
          }
        } finally {
          vi.restoreAllMocks();
          if (presentation) {
            await presentation.dispose();
          }
        }
      }
    }
  });

  const startYouTubeGiftSmokeFixture = async () => {
    const presentation = await createMainPresentationFixture();
    activePresentation = presentation;

    presentation.config.general.envFileReadEnabled = false;
    presentation.config.general.envFileWriteEnabled = false;
    presentation.config.logging.file.enabled = false;
    presentation.config.general.giftsEnabled = true;
    presentation.config.general.greetingsEnabled = false;
    presentation.config.general.logChatMessages = false;
    presentation.config.youtube.giftsEnabled = true;
    presentation.config.youtube.greetingsEnabled = false;
    presentation.config.youtube.username = "test-youtube-channel";
    presentation.config.youtube.dataLoggingEnabled = false;

    await presentation.start();

    const displayQueue = {
      addItem: spyOn(presentation.queue, "addItem"),
    };

    const metadata = new InnertubeService(
      {
        createWithTimeout: async () => ({
          getInfo: async () => ({}),
          getChannel: async () => ({
            videos: [],
            getLiveStreams: async () => ({ videos: [] }),
          }),
        }),
      },
      { logger: noOpLogger },
    );
    activeMetadata = metadata;
    const detector = new YouTubeStreamDetectionService(metadata, {
      logger: noOpLogger,
    });
    activeDetector = detector;

    const platform = new YouTubePlatform(
      {
        ...presentation.config.youtube,
        enabled: true,
        giftsEnabled: true,
        username: "test-youtube-channel",
        dataLoggingEnabled: false,
      },
      {
        logger: noOpLogger,
        innertubeService: metadata,
        streamDetectionService: detector,
        viewerExtractionService: new ViewerCountExtractionService(metadata, {
          logger: noOpLogger,
        }),
        USER_AGENTS: ["test-agent"],
      },
    );
    activePlatform = platform;

    platform.handlers = {
      onGift: (payload: unknown) => {
        presentation.bus.emit("platform:event", {
          platform: "youtube",
          type: PlatformEvents.GIFT,
          data: payload,
        });
      },
    };

    return { platform, displayQueue };
  };

  test("routes raw GiftMessageView jewels input into a queued gift notification without fabricating identity", async () => {
    const { platform, displayQueue } = await startYouTubeGiftSmokeFixture();

    await platform.handleChatMessage({
      item: {
        type: "GiftMessageView",
        id: "ChwKGkNNRHAzZmpKNVpNREZkM0N3Z1FkQUpZWmNn",
        timestamp_usec: "1704067200000000",
        text: {
          content: "sent Girl power for 300 Jewels",
        },
        authorName: {
          content: "@test-smoke-jewels-user ",
        },
      },
    });

    await new Promise(setImmediate);

    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const queued = firstQueuedGiftNotification(displayQueue.addItem);
    expect(queued.type).toBe("platform:gift");
    expect(queued.platform).toBe("youtube");
    expect(queued.data.username).toBe("test-smoke-jewels-user");
    expect(queued.data.userId).toBeUndefined();
    expect(queued.data.giftType).toBe("Girl power");
    expect(queued.data.giftCount).toBe(1);
    expect(queued.data.amount).toBe(300);
    expect(queued.data.currency).toBe("jewels");
    expect(queued.data.giftImageUrl).toBe(
      "https://www.gstatic.com/youtube/img/pdg/gift/assets/girl_power.png=w480-h480",
    );

    assertNonEmptyString(queued.data.displayMessage);
    assertNonEmptyString(queued.data.ttsMessage);
    assertNonEmptyString(queued.data.logMessage);
    expectNoTechnicalArtifacts(queued.data.displayMessage);
    expectNoTechnicalArtifacts(queued.data.ttsMessage);
    expectNoTechnicalArtifacts(queued.data.logMessage);
    expect(queued.data.displayMessage.toLowerCase()).toContain("jewels");
    expect(queued.data.ttsMessage.toLowerCase()).toContain("jewels");
    expect(queued.data.logMessage.toLowerCase()).toContain("jewels");
  });

  test("routes observed amountless Let em cook GiftMessageView payload with author_name and gift_image URLs", async () => {
    const { platform, displayQueue } = await startYouTubeGiftSmokeFixture();

    await platform.handleChatMessage({
      item: {
        type: "GiftMessageView",
        id: "yt-let-em-cook-1",
        timestamp_usec: "1704067200000000",
        text: { content: "sent Let em cook" },
        author_name: { content: "@test-youtube-gifter" },
        gift_image: {
          sources: [
            {
              url: "https://www.gstatic.com/youtube/img/pdg/gift/assets/let_em_cook.png",
              width: 640,
              height: 640,
            },
          ],
        },
        gift_image_a11y_label:
          "@test-youtube-gifter sent a gift, Let em cook",
      },
    });
    await new Promise(setImmediate);
    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const queued = firstQueuedGiftNotification(displayQueue.addItem);
    expect(queued.data.username).toBe("test-youtube-gifter");
    expect(queued.data.giftType).toBe("Let em cook");
    expect(queued.data.amount).toBeUndefined();
    expect(queued.data.currency).toBe("jewels");
    expect(queued.data.giftImageUrl).toBe(
      "https://www.gstatic.com/youtube/img/pdg/gift/assets/let_em_cook.png",
    );
    expect(queued.data.metadata.missingFields).toHaveLength(2);
    expect(queued.data.metadata.missingFields).toEqual(
      expect.arrayContaining(["amount", "userId"]),
    );
    for (const message of [
      queued.data.displayMessage,
      queued.data.ttsMessage,
      queued.data.logMessage,
    ]) {
      expect(message).toContain("test-youtube-gifter");
      expect(message).toContain("Let em cook");
      expect(message).not.toMatch(/undefined|NaN|0 jewels/i);
    }
  });

  test("routes the newest amountless Laughing disco GiftMessageView shape using receipt time and largest direct images", async () => {
    const { platform, displayQueue } = await startYouTubeGiftSmokeFixture();

    await platform.handleChatMessage({
      item: {
        type: "GiftMessageView",
        id: "test-laughing-disco-gift",
        text: { content: "sent Laughing disco" },
        author_name: { content: "@test-laughing-disco-user" },
        author_avatar: {
          image: [
            {
              url: "https://example.invalid/test-avatar-32.png",
              width: 32,
              height: 32,
            },
            {
              url: "https://example.invalid/test-avatar-64.png",
              width: 64,
              height: 64,
            },
          ],
        },
        gift_image: {
          sources: [
            {
              url: "https://example.invalid/test-gift-480.png",
              width: 480,
              height: 480,
            },
            {
              url: "https://example.invalid/test-gift-640.png",
              width: 640,
              height: 640,
            },
          ],
        },
      },
    });
    await new Promise(setImmediate);
    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    const queued = firstQueuedGiftNotification(displayQueue.addItem);
    expect(queued.data.isError).not.toBe(true);
    assertNonEmptyString(queued.data.id);
    expect(queued.data.giftType).toBe("Laughing disco");
    expect(typeof queued.data.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(queued.data.timestamp!))).toBe(false);
    expect(queued.data.metadata.timestampSource).toBe("received");
    expect(queued.data.avatarUrl).toBe(
      "https://example.invalid/test-avatar-64.png",
    );
    expect(queued.data.giftImageUrl).toBe(
      "https://example.invalid/test-gift-640.png",
    );
    expect(queued.data.parts).toEqual([
      { type: "text", text: "sent " },
      {
        type: "emote",
        platform: "youtube",
        emoteId: "Laughing disco",
        imageUrl: "https://example.invalid/test-gift-640.png",
      },
      { type: "text", text: "Laughing disco" },
    ]);
    expect(queued.data.amount).toBeUndefined();
    expect(queued.data.userId).toBeUndefined();
    expect(queued.data.metadata.missingFields).toEqual(
      expect.arrayContaining(["amount", "userId"]),
    );
    for (const message of [
      queued.data.displayMessage,
      queued.data.ttsMessage,
      queued.data.logMessage,
    ]) {
      expect(message).not.toMatch(/undefined|NaN|0 jewels|technical|error/i);
    }
  });
});
