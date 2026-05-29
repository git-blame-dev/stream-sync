import { describe, expect, it } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import {
  ViewerCountProvider,
  TwitchViewerCountProvider,
  YouTubeViewerCountProvider,
  TikTokViewerCountProvider,
} from "../../../src/utils/viewer-count-providers";

type AggregatedViewerCount = {
  success: boolean;
  totalCount: number;
  successfulStreams: number;
  failedStreams?: number;
};

const createViewerExtractionService = (
  getAggregatedViewerCount = createMockFn<
    [string[]],
    Promise<AggregatedViewerCount>
  >(),
) => ({
  getAggregatedViewerCount,
  extractViewerCount: createMockFn<
    [string],
    Promise<{ success: boolean; count: number }>
  >(),
});

const createTwitchApiClient = (
  getStreamInfo = createMockFn<
    [string],
    Promise<{ isLive: boolean; viewerCount: number }>
  >(),
) => ({ getStreamInfo });

describe("ViewerCountProvider error handling", () => {
  it("categorizes unknown errors when message is missing", () => {
    const provider = new ViewerCountProvider("testPlatform", noOpLogger);

    const result = provider._handleProviderError(
      new Error(""),
      "testOperation",
    );

    expect(result).toBe(0);
    expect(provider.getErrorStats().errorTypes.unknown).toBe(1);
  });
});

describe("YouTubeViewerCountProvider readiness and error routes", () => {
  it("returns 0 when active video ids missing", async () => {
    const viewerExtractionService = createViewerExtractionService();
    const provider = new YouTubeViewerCountProvider({}, {}, () => [], null, {
      viewerExtractionService,
      logger: noOpLogger,
    });

    const count = await provider.getViewerCount();

    expect(count).toBe(0);
  });

  it("returns unavailable and categorizes errors from extraction service", async () => {
    const viewerExtractionService = createViewerExtractionService(
      createMockFn<[string[]], Promise<AggregatedViewerCount>>().mockRejectedValue(
        new Error("network down"),
      ),
    );
    const provider = new YouTubeViewerCountProvider(
      {},
      {},
      () => ["testVideoId1"],
      null,
      { viewerExtractionService, logger: noOpLogger },
    );

    const count = await provider.getViewerCount();

    expect(count).toBeNull();
    expect(provider.getErrorStats().errorTypes.network).toBe(1);
  });
});

describe("TikTokViewerCountProvider error recovery", () => {
  it("handles missing getViewerCount gracefully", async () => {
    const platform = {
      connection: { isConnected: true },
    };
    const provider = new TikTokViewerCountProvider(platform, {
      logger: noOpLogger,
    });

    const count = await provider.getViewerCount();

    expect(count).toBe(0);
    expect(provider.getErrorStats().totalErrors).toBe(1);
  });
});

describe("TwitchViewerCountProvider readiness", () => {
  it("returns 0 when provider not ready (missing channel)", async () => {
    const apiClient = createTwitchApiClient();
    const provider = new TwitchViewerCountProvider(
      apiClient,
      {},
      {},
      null,
      noOpLogger,
    );

    const count = await provider.getViewerCount();

    expect(count).toBe(0);
  });

  it("resets consecutive errors after successful fetch", async () => {
    const apiClient = createTwitchApiClient(
      createMockFn<
        [string],
        Promise<{ isLive: boolean; viewerCount: number }>
      >()
        .mockRejectedValueOnce(new Error("network fail"))
        .mockResolvedValueOnce({ isLive: true, viewerCount: 15 }),
    );
    const provider = new TwitchViewerCountProvider(
      apiClient,
      {},
      { channel: "testChannel" },
      null,
      noOpLogger,
    );

    await provider.getViewerCount();
    expect(provider.getErrorStats().consecutiveErrors).toBe(1);

    const count = await provider.getViewerCount();
    expect(count).toBe(15);
    expect(provider.getErrorStats().consecutiveErrors).toBe(0);
  });
});
