import { describe, test, afterEach, expect } from "bun:test";
import { YouTubePlatform } from "../../src/platforms/youtube";
import { InnertubeService } from "../../src/services/innertube-service";
import { YouTubeStreamDetectionService } from "../../src/services/youtube-stream-detection-service";
import { ViewerCountExtractionService } from "../../src/services/viewer-count-extraction-service";
import { getSyntheticFixture } from "../helpers/platform-test-data";
import { restoreAllMocks } from "../helpers/bun-mock-utils";
import { noOpLogger } from "../helpers/mock-factories";
import { createYouTubeConfigFixture } from "../helpers/config-fixture";

const giftPurchaseHeaderOnly = getSyntheticFixture(
  "youtube",
  "gift-purchase-header",
);
const giftPurchaseTimestamp = new Date(
  Math.floor(Number(giftPurchaseHeaderOnly.item.timestamp_usec) / 1000),
).toISOString();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

describe("YouTube Gift Purchase Smoke (Canonical Author)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    try {
      while (cleanups.length > 0) {
        const fn = cleanups.pop();
        if (fn) {
          await fn();
        }
      }
    } finally {
      restoreAllMocks();
    }
  });

  test("routes gift purchase through event pipeline to handler", async () => {
    const config = createYouTubeConfigFixture({
      enabled: true,
      username: "test-channel",
      dataLoggingPath: "",
      dataLoggingEnabled: false,
      envFileReadEnabled: false,
      envFileWriteEnabled: false,
    });
    const metadata = new InnertubeService(
      {
        createWithTimeout: async () => ({
          getInfo: async (_videoId: string) => ({}),
          getChannel: async () => ({
            videos: [],
            getLiveStreams: async () => ({ videos: [] }),
          }),
        }),
      },
      { logger: noOpLogger },
    );
    const detector = new YouTubeStreamDetectionService(metadata, {
      logger: noOpLogger,
    });
    const viewerExtractionService = new ViewerCountExtractionService(metadata, {
      logger: noOpLogger,
    });
    const platform = new YouTubePlatform(config, {
      logger: noOpLogger,
      innertubeService: metadata,
      streamDetectionService: detector,
      viewerExtractionService,
    });
    cleanups.push(async () => {
      try {
        await platform.cleanup();
      } finally {
        try {
          await detector.cleanup();
        } finally {
          await metadata.dispose();
        }
      }
    });

    const giftEvents: Array<Record<string, unknown>> = [];
    platform.handlers = {
      ...platform.handlers,
      onGiftPaypiggy: (event: unknown) => {
        if (!isRecord(event)) {
          throw new Error("Expected gift paypiggy event payload object");
        }
        giftEvents.push(event);
      },
    };

    await platform.handleChatMessage(giftPurchaseHeaderOnly);

    expect(giftEvents).toHaveLength(1);
    const notification = giftEvents[0];
    if (!notification) {
      throw new Error("Expected gift purchase event to be routed");
    }
    expect(notification.type).toBe("platform:giftpaypiggy");
    expect(notification.username).toBe("GiftGiver");
    expect(notification.userId).toBe(giftPurchaseHeaderOnly.item.author.id);
    expect(notification.giftCount).toBe(5);
    expect(notification.id).toBe(giftPurchaseHeaderOnly.item.id);
    expect(notification.timestamp).toBe(giftPurchaseTimestamp);
  });
});
