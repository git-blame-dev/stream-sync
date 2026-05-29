import { describe, test, expect, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../../../helpers/bun-mock-utils";

import { YouTubePlatform } from "../../../../../src/platforms/youtube";
import { getSyntheticFixture } from "../../../../helpers/platform-test-data";
import { waitForDelay } from "../../../../helpers/time-utils";
const {
  initializeTestLogging,
  createMockPlatformDependencies,
} = require("../../../../helpers/test-setup");
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

describe("YouTubePlatform event routing behavior", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const baseConfig = createYouTubeConfigFixture({
    enabled: true,
    username: "test-channel",
  });

  const createPlatform = () =>
    new YouTubePlatform(baseConfig, {
      ...createMockPlatformDependencies("youtube"),
      streamDetectionService: {
        detectLiveStreams: createMockFn().mockResolvedValue({
          success: true,
          videoIds: [],
        }),
      },
    });

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
    const debugCalls = getDebugCalls(platform.logger);
    const giftLog = debugCalls.find(({ message }) =>
      message.includes(
        "ignored gifted membership announcement for GiftedViewer",
      ),
    );
    expect(giftLog).toBeTruthy();
    if (!giftLog) {
      throw new Error("expected ignored gifted membership log");
    }
    expect(giftLog.metadata).toMatchObject({
      action: "ignored_gifted_membership_announcement",
      recipient: "GiftedViewer",
      eventType: "LiveChatSponsorshipsGiftRedemptionAnnouncement",
    });
  });

  test("uses fallback username when gift redemption recipient is missing", async () => {
    const platform = createPlatform();

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

    const debugCalls = getDebugCalls(platform.logger);
    const giftLog = debugCalls.find(({ message }) =>
      message.includes(
        "ignored gifted membership announcement for Unknown User",
      ),
    );
    expect(giftLog).toBeTruthy();
    if (!giftLog) {
      throw new Error("expected ignored gifted membership fallback log");
    }
    expect(giftLog.metadata).toMatchObject({
      action: "ignored_gifted_membership_announcement",
      recipient: "Unknown User",
      eventType: "LiveChatSponsorshipsGiftRedemptionAnnouncement",
    });
  });

  test("logs ignored duplicates for renderer variants without unknown-event logging", async () => {
    const platform = createPlatform();
    platform.logRawPlatformData = createMockFn().mockResolvedValue();

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

    const debugCalls = getDebugCalls(platform.logger);
    const duplicateLog = debugCalls.find(({ message }) =>
      message.includes("ignored duplicate LiveChatPaidMessageRenderer"),
    );
    expect(duplicateLog).toBeTruthy();
    if (!duplicateLog) {
      throw new Error("expected duplicate renderer log");
    }
    expect(duplicateLog.metadata).toMatchObject({
      action: "ignored_duplicate",
      eventType: "LiveChatPaidMessageRenderer",
      author: "RendererUser",
    });
  });
});
