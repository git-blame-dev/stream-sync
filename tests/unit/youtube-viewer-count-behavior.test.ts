import { describe, expect, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import {
  noOpLogger,
  createMockNotificationManager,
} from "../helpers/mock-factories";
import { YouTubePlatform } from "../../src/platforms/youtube";

type ViewerCountProvider = {
  getViewerCountForVideo?: (videoId: string) => Promise<number>;
};

const createPlatform = (provider: ViewerCountProvider | null = null) => {
  const notificationManager = createMockNotificationManager();
  const platform = new YouTubePlatform(
    {
      youtube: { viewerCountMethod: "youtubei" },
      enabled: true,
      channel: "test-channel",
    },
    {
      logger: noOpLogger,
      notificationManager,
      streamDetectionService: {
        detectLiveStreams: createMockFn().mockResolvedValue({
          success: true,
          videoIds: [],
        }),
      },
    },
  );
  platform.viewerCountProvider = provider;
  return platform;
};

describe("YouTubePlatform viewer count behavior", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  it("returns provider value for the requested video id", async () => {
    const provider = {
      getViewerCountForVideo: createMockFn((videoId: string) =>
        Promise.resolve(videoId === "video-123" ? 321 : 0),
      ),
    };
    const platform = createPlatform(provider);

    const result = await platform.getViewerCountForVideo("video-123");

    expect(result).toBe(321);
  });

  it("returns 0 when no provider is configured", async () => {
    const platform = createPlatform(null);

    const result = await platform.getViewerCountForVideo("video-123");

    expect(result).toBe(0);
  });

  it("returns 0 when provider does not support per-video lookup", async () => {
    const provider = {};
    const platform = createPlatform(provider);

    const result = await platform.getViewerCountForVideo("video-123");

    expect(result).toBe(0);
  });

  it("returns 0 when provider throws", async () => {
    const provider = {
      getViewerCountForVideo: createMockFn().mockRejectedValue(
        new Error("network"),
      ),
    };
    const platform = createPlatform(provider);

    const result = await platform.getViewerCountForVideo("video-123");

    expect(result).toBe(0);
  });
});
