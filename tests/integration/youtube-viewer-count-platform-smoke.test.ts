import { vi, describe, test, afterEach, expect } from 'bun:test';

import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import { YouTubePlatform } from "../../src/platforms/youtube";
import { InnertubeService } from "../../src/services/innertube-service.ts";
import { YouTubeStreamDetectionService } from "../../src/services/youtube-stream-detection-service.ts";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture.ts";
import { noOpLogger } from "../helpers/mock-factories";

import { createYouTubeConfigFixture } from "../helpers/config-fixture";
import { waitFor } from "../helpers/event-driven-testing";

type ViewerCountUpdate = {
  platform: string;
  count: number;
  previousCount: number;
};

describe("YouTube viewer count platform flow (smoke)", () => {
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
      vi.restoreAllMocks();
    }
  });

  test("routes viewer count updates from platform to runtime", async () => {
    const presentation = await createMainPresentationFixture();
    presentation.config.general.debugEnabled = false;
    presentation.config.general.envFileReadEnabled = false;
    presentation.config.general.envFileWriteEnabled = false;
    presentation.config.logging.file.enabled = false;
    presentation.config.youtube.enabled = false;
    presentation.config.youtube.viewerCountEnabled = true;
    presentation.config.youtube.username = "test-channel";
    presentation.config.youtube.dataLoggingEnabled = false;

    await presentation.start();

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

    const platform = new YouTubePlatform(
      createYouTubeConfigFixture({
        enabled: true,
        viewerCountEnabled: true,
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
    platform.handlers =
      platformLifecycleService.createDefaultEventHandlers("youtube");

    const updates: ViewerCountUpdate[] = [];
    presentation.runtime.viewerCountSystem.addObserver({
      getObserverId: () => "test-viewer-count-observer",
      onViewerCountUpdate: (update) => {
        updates.push(update);
      },
    });

    registerCleanup(async () => {
      presentation.runtime.viewerCountSystem.removeObserver(
        "test-viewer-count-observer",
      );
      await platform.cleanup();
      await platformLifecycleService.disconnectAll();
      platformLifecycleService.dispose();
      await innertubeService.dispose();
      vi.restoreAllMocks();
      await presentation.dispose();
    });

    try {
      platform.updateViewerCountForStream("test-stream-1", 321);

      await waitFor(() => updates.length === 1, {
        timeout: 500,
        interval: 1,
      });

      expect(updates).toHaveLength(1);
      const [update] = updates;
      if (!update) {
        throw new Error("expected viewer count update");
      }
      expect(update.platform).toBe("youtube");
      expect(update.count).toBe(321);
      expect(update.previousCount).toBe(0);
    } finally {
      await runCleanups();
    }
  });
});
