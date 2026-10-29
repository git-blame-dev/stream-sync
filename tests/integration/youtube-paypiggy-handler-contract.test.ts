import { describe, test, expect, afterEach } from "bun:test";

import { createEventBus } from "../../src/core/EventBus";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import { YouTubePlatform } from "../../src/platforms/youtube";
import { InnertubeService } from "../../src/services/innertube-service";
import { YouTubeStreamDetectionService } from "../../src/services/youtube-stream-detection-service";
import { ViewerCountExtractionService } from "../../src/services/viewer-count-extraction-service";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";

import { noOpLogger } from "../helpers/mock-factories";
import { restoreAllMocks } from "../helpers/bun-mock-utils";
import { createYouTubeConfigFixture } from "../helpers/config-fixture";

type PlatformEventPayload = {
  platform: string;
  type: string;
  data?: Record<string, unknown>;
};

const createYouTubePlatform = () => {
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
  const platform = new YouTubePlatform(
    createYouTubeConfigFixture({
      enabled: true,
      username: "test-youtube-channel",
      dataLoggingPath: "",
      dataLoggingEnabled: false,
      envFileReadEnabled: false,
      envFileWriteEnabled: false,
    }),
    {
      logger: noOpLogger,
      innertubeService: metadata,
      streamDetectionService: detector,
      viewerExtractionService,
    },
  );

  return {
    platform,
    cleanup: async () => {
      try {
        await platform.cleanup();
      } finally {
        try {
          await detector.cleanup();
        } finally {
          await metadata.dispose();
        }
      }
    },
  };
};

describe("YouTube paypiggy handler contract (integration)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("forwards membership chat events through lifecycle default handlers to event bus", async () => {
    const eventBus = createEventBus({ debugEnabled: false });
    const lifecycle = new PlatformLifecycleService({
      config: {
        youtube: {
          enabled: true,
          username: "test-youtube-channel",
        },
      },
      eventBus,
      logger: noOpLogger,
    });
    const { platform, cleanup } = createYouTubePlatform();

    try {
      platform.handlers = lifecycle.createDefaultEventHandlers("youtube");

      const received: PlatformEventPayload[] = [];
      eventBus.subscribe("platform:event", (event: unknown) => {
        received.push(event as PlatformEventPayload);
      });

      const membershipItem = {
        item: {
          type: "LiveChatMembershipItem",
          id: "LCC.test-membership-event-bus-001",
          timestamp_usec: "1704067200000000",
          author: {
            id: "UC_TEST_CHANNEL_001234",
            name: "test-member-user",
          },
          headerPrimaryText: { text: "Member" },
          headerSubtext: { text: "Welcome to membership" },
          memberMilestoneDurationInMonths: 2,
        },
      };

      await platform.handleChatMessage(membershipItem);
      await new Promise((resolve) => setImmediate(resolve));

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        platform: "youtube",
        type: PlatformEvents.PAYPIGGY,
        data: {
          username: "test-member-user",
          userId: "UC_TEST_CHANNEL_001234",
          membershipLevel: "Member",
          months: 2,
          message: "Welcome to membership",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });
    } finally {
      try {
        await cleanup();
      } finally {
        try {
          lifecycle.dispose();
        } finally {
          eventBus.reset();
        }
      }
    }
  });
});
