import { vi, describe, test, expect, afterEach } from 'bun:test';


import { YouTubePlatform } from "../../../../../src/platforms/youtube";
import { InnertubeService } from "../../../../../src/services/innertube-service";
import { YouTubeStreamDetectionService } from "../../../../../src/services/youtube-stream-detection-service";
import { ViewerCountExtractionService } from "../../../../../src/services/viewer-count-extraction-service";
import { getSyntheticFixture } from "../../../../helpers/platform-test-data";
import { waitForDelay } from "../../../../helpers/time-utils";
import { initializeTestLogging } from "../../../../helpers/test-setup";
import { noOpLogger } from "../../../../helpers/mock-factories";
import { createYouTubeConfigFixture } from "../../../../helpers/config-fixture";

initializeTestLogging();

type GiftPaypiggyEvent = {
  type: string;
  platform: string;
  giftCount: number;
  username: string;
  id: string;
  timestamp: string;
};

type DebugCall = {
  message: string;
  metadata: unknown;
};

type DebugLogger = {
  debug: { mock: { calls: Array<[string, unknown?, unknown?]> } };
};

const isGiftPaypiggyEvent = (value: unknown): value is GiftPaypiggyEvent =>
  !!value &&
  typeof value === "object" &&
  "type" in value &&
  "platform" in value &&
  "giftCount" in value &&
  "username" in value &&
  "id" in value &&
  "timestamp" in value;

const hasDebugCalls = (logger: unknown): logger is DebugLogger =>
  !!logger &&
  typeof logger === "object" &&
  "debug" in logger &&
  !!logger.debug &&
  (typeof logger.debug === "object" || typeof logger.debug === "function") &&
  "mock" in logger.debug;

const flushPromises = () => waitForDelay(1);
const getDebugCalls = (logger: unknown): DebugCall[] => {
  if (!hasDebugCalls(logger)) {
    return [];
  }
  return logger.debug.mock.calls.map(([message, _scope, metadata]) => ({
    message,
    metadata: metadata || null,
  }));
};

const createRecordingLogger = () => {
  const calls: Array<[string, unknown?, unknown?]> = [];
  const debug = Object.assign(
    (message: string, scope?: unknown, metadata?: unknown) => {
      calls.push([message, scope, metadata]);
    },
    { mock: { calls } },
  );
  return {
    ...noOpLogger,
    debug,
  };
};

describe("YouTubePlatform event routing behavior", () => {
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
      vi.restoreAllMocks();
    }
  });

  const baseConfig = createYouTubeConfigFixture({
    enabled: true,
    username: "test-channel",
    dataLoggingPath: "",
    dataLoggingEnabled: false,
    envFileReadEnabled: false,
    envFileWriteEnabled: false,
  });

  const createPlatform = () => {
    const logger = createRecordingLogger();
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
      { logger },
    );
    const detector = new YouTubeStreamDetectionService(metadata, { logger });
    const viewerExtractionService = new ViewerCountExtractionService(metadata, {
      logger,
    });
    const platform = new YouTubePlatform(baseConfig, {
      logger,
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
    return platform;
  };

  test("routes gift membership purchase announcements to giftpaypiggy notifications", async () => {
    const platform = createPlatform();
    const giftEvents: GiftPaypiggyEvent[] = [];
    platform.handlers = {
      ...(platform.handlers || {}),
      onGiftPaypiggy: (event) => {
        if (isGiftPaypiggyEvent(event)) {
          giftEvents.push(event);
        }
      },
    };

    const giftPurchase = getSyntheticFixture("youtube", "gift-purchase-header");
    await platform.handleChatMessage(giftPurchase);
    await flushPromises();

    expect(giftEvents).toHaveLength(1);
    const [event] = giftEvents;
    if (!event) {
      throw new Error("expected gift event");
    }
    expect(event.type).toBe("platform:giftpaypiggy");
    expect(event.platform).toBe("youtube");
    expect(event.giftCount).toBe(5);
    expect(event.username).toBe("GiftGiver");
    expect(event.id).toBe(giftPurchase.item.id);
    expect(typeof event.timestamp).toBe("string");
    expect(event.timestamp.trim()).not.toBe("");
  });

  test("ignores gift membership redemption announcements", async () => {
    const platform = createPlatform();
    const giftEvents: GiftPaypiggyEvent[] = [];
    const initialDebugCount = getDebugCalls(platform.logger).length;
    platform.handlers = {
      ...(platform.handlers || {}),
      onGiftPaypiggy: (event) => {
        if (isGiftPaypiggyEvent(event)) {
          giftEvents.push(event);
        }
      },
    };

    await platform.handleChatMessage({
      type: "AddChatItemAction",
      item: {
        type: "LiveChatSponsorshipsGiftRedemptionAnnouncement",
        id: "LCC.test-gift-redemption-001",
        timestamp_usec: "1704067200000000",
        author: {
          id: "UC_TEST_CHANNEL_000001",
          name: "@GiftedViewer",
        },
      },
    });
    await flushPromises();

    expect(giftEvents).toHaveLength(0);
    expect(getDebugCalls(platform.logger).slice(initialDebugCount)).toEqual([]);
  });

  test("silently ignores gift redemptions with missing recipients", async () => {
    const platform = createPlatform();
    const initialDebugCount = getDebugCalls(platform.logger).length;

    await platform.handleChatMessage({
      type: "AddChatItemAction",
      item: {
        type: "LiveChatSponsorshipsGiftRedemptionAnnouncement",
        id: "LCC.test-gift-redemption-002",
        timestamp_usec: "1704067201000000",
        author: {
          id: "UC_TEST_CHANNEL_000002",
          name: "N/A",
        },
      },
    });
    await flushPromises();

    expect(getDebugCalls(platform.logger).slice(initialDebugCount)).toEqual([]);
  });

  test("silently ignores duplicate renderer variants", async () => {
    const platform = createPlatform();
    const initialDebugCount = getDebugCalls(platform.logger).length;

    await platform.handleChatMessage({
      type: "AddChatItemAction",
      item: {
        type: "LiveChatPaidMessageRenderer",
        id: "LCC.test-renderer-001",
        timestamp_usec: "1704067202000000",
        author: {
          id: "UC_TEST_CHANNEL_000003",
          name: "@RendererUser",
        },
      },
    });
    await flushPromises();

    expect(getDebugCalls(platform.logger).slice(initialDebugCount)).toEqual([]);
  });
});
