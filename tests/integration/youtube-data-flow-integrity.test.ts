import { describe, test, afterEach, expect } from "bun:test";

import { YouTubePlatform } from "../../src/platforms/youtube";
import { InnertubeService } from "../../src/services/innertube-service";
import { YouTubeStreamDetectionService } from "../../src/services/youtube-stream-detection-service";
import { ViewerCountExtractionService } from "../../src/services/viewer-count-extraction-service";
import { initializeTestLogging } from "../helpers/test-setup";
import { getSyntheticFixture } from "../helpers/platform-test-data";
import { noOpLogger } from "../helpers/mock-factories";
import { restoreAllMocks } from "../helpers/bun-mock-utils";
import { createYouTubeConfigFixture } from "../helpers/config-fixture";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture";

initializeTestLogging();

const realSuperChat = getSyntheticFixture("youtube", "superchat");

type YouTubeGiftPayload = {
  type: "platform:gift";
  platform: "youtube";
  id: string;
  username: string;
  timestamp: string;
  displayMessage?: never;
  ttsMessage?: never;
  logMessage?: never;
  [key: string]: unknown;
};
type NotificationOutput = {
  displayMessage: string;
  ttsMessage: string;
  logMessage: string;
};
type NotificationResult = {
  success: boolean;
  notificationData?: NotificationOutput;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

function assertYouTubeGiftPayload(
  value: unknown,
): asserts value is YouTubeGiftPayload {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) {
    throw new Error("YouTube gift payload must be an object");
  }
  expect(value.type).toBe("platform:gift");
  expect(value.platform).toBe("youtube");
  expect(typeof value.id).toBe("string");
  expect(typeof value.username).toBe("string");
  expect(typeof value.timestamp).toBe("string");
}

function assertNotificationResult(
  value: unknown,
): asserts value is NotificationResult & {
  notificationData: NotificationOutput;
} {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) throw new Error("Notification result must be an object");
  expect(value.success).toBe(true);
  expect(isRecord(value.notificationData)).toBe(true);
  if (!isRecord(value.notificationData)) {
    throw new Error("Notification data must be an object");
  }
  expect(typeof value.notificationData.displayMessage).toBe("string");
  expect(typeof value.notificationData.ttsMessage).toBe("string");
  expect(typeof value.notificationData.logMessage).toBe("string");
}

type PlatformHarness = {
  platform: YouTubePlatform;
  getCapturedPayload: () => unknown;
  cleanup: () => Promise<void>;
};

const createPlatformHarness = (): PlatformHarness => {
  const logger = noOpLogger;
  const platformConfig = createYouTubeConfigFixture({
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
    { logger },
  );
  const detector = new YouTubeStreamDetectionService(metadata, { logger });
  const viewerExtractionService = new ViewerCountExtractionService(metadata, {
    logger,
  });
  const platform = new YouTubePlatform(platformConfig, {
    logger,
    innertubeService: metadata,
    streamDetectionService: detector,
    viewerExtractionService,
  });
  let capturedPayload: unknown;

  platform.handlers = {
    ...(platform.handlers || {}),
    onGift: (payload: unknown) => {
      capturedPayload = payload;
    },
  };

  return {
    platform,
    getCapturedPayload: () => capturedPayload,
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

describe("YouTube data flow integrity", () => {
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

  test("builds user-facing output from platform event payloads", async () => {
    const { platform, getCapturedPayload, cleanup } = createPlatformHarness();
    cleanups.push(cleanup);

    await platform.handleChatMessage(realSuperChat);
    const capturedPayload = getCapturedPayload();

    assertYouTubeGiftPayload(capturedPayload);
    expect(capturedPayload.displayMessage).toBeUndefined();
    expect(capturedPayload.ttsMessage).toBeUndefined();
    expect(capturedPayload.logMessage).toBeUndefined();
    expect(capturedPayload.id).toBe(realSuperChat.item.id);
    expect(typeof capturedPayload.timestamp).toBe("string");
    expect(capturedPayload.timestamp.trim().length).toBeGreaterThan(0);

    const presentation = await createMainPresentationFixture();
    cleanups.push(() => presentation.dispose());
    presentation.config.logging.file.enabled = false;
    presentation.config.logging.chat.enabled = false;
    presentation.config.general.debugEnabled = false;
    presentation.config.general.giftsEnabled = true;
    presentation.config.vfx.filePath = "/synthetic-only";
    await presentation.start();
    presentation.config.youtube.enabled = true;
    presentation.config.youtube.giftsEnabled = true;

    const notificationManager = presentation.runtime.notificationManager;
    if (!notificationManager) {
      throw new Error("Expected runtime notificationManager to be initialized");
    }

    const result = await notificationManager.handleNotification(
      "platform:gift",
      capturedPayload.platform,
      capturedPayload,
    );

    assertNotificationResult(result);
    expect(result.notificationData.displayMessage).toContain("Super Chat");
    expect(result.notificationData.displayMessage).toContain(
      capturedPayload.username,
    );
    expect(result.notificationData.ttsMessage).toEqual(expect.any(String));
    expect(result.notificationData.ttsMessage.trim().length).toBeGreaterThan(0);
    expect(result.notificationData.logMessage).toEqual(expect.any(String));
    expect(result.notificationData.logMessage.trim().length).toBeGreaterThan(0);
    expect(presentation.queue.getQueueLength()).toBe(1);
  });
});
