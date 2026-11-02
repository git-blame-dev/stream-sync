import { vi, describe, expect, it } from 'bun:test';

import { noOpLogger } from "../../helpers/mock-factories";
import {
  ViewerCountProvider,
  TwitchViewerCountProvider,
  YouTubeViewerCountProvider,
} from "../../../src/utils/viewer-count-providers";

type AggregatedViewerCount = {
  success: boolean;
  totalCount: number;
  successfulStreams: number;
  failedStreams?: number;
};

const createViewerExtractionService = (
  getAggregatedViewerCount = vi.fn<(...args: [string[]]) => Promise<AggregatedViewerCount>
  >(),
) => ({
  getAggregatedViewerCount,

});

const createTwitchApiClient = (
  getStreamInfo = vi.fn<(...args: [string]) => Promise<{ isLive: boolean; viewerCount: number }>
  >(),
) => ({ getStreamInfo });

describe("ViewerCountProvider error handling", () => {
  it("categorizes unknown errors when message is missing", () => {
    const provider = new ViewerCountProvider("testPlatform", noOpLogger);

    provider._handleProviderError(
      new Error(""),
      "testOperation",
    );

    expect(provider.getErrorStats().errorTypes.unknown).toBe(1);
  });
});

describe("YouTubeViewerCountProvider readiness and error routes", () => {
  it("returns unavailable when membership capability is missing", async () => {
    const viewerExtractionService = createViewerExtractionService();
    const provider = new YouTubeViewerCountProvider({}, null, {
      viewerExtractionService,
      logger: noOpLogger,
    });

    const count = await provider.getViewerCount();

    expect(count).toBeNull();
  });

  it("returns unavailable and categorizes errors from extraction service", async () => {
    const viewerExtractionService = createViewerExtractionService(
      vi.fn<(...args: [string[]]) => Promise<AggregatedViewerCount>>().mockRejectedValue(
        new Error("network down"),
      ),
    );
    const provider = new YouTubeViewerCountProvider(
      {},
      () => ({ generation: 1, videoIds: ["testVideoId1"], availability: "live", discoveryComplete: true }),
      { viewerExtractionService, logger: noOpLogger },
    );

    const count = await provider.getViewerCount();

    expect(count).toBeNull();
    expect(provider.getErrorStats().errorTypes.network).toBe(1);
  });
});

describe("TwitchViewerCountProvider readiness", () => {
  it("returns unavailable without an API call when channel is missing", async () => {
    const apiClient = createTwitchApiClient();
    const provider = new TwitchViewerCountProvider(
      apiClient, {}, noOpLogger
    );

    const count = await provider.getViewerCount();

    expect(count).toBeNull();
    expect(apiClient.getStreamInfo).not.toHaveBeenCalled();
  });

  it("resets consecutive errors after successful fetch", async () => {
    const apiClient = createTwitchApiClient(
      vi.fn<(...args: [string]) => Promise<{ isLive: boolean; viewerCount: number }>
      >()
        .mockRejectedValueOnce(new Error("network fail"))
        .mockResolvedValueOnce({ isLive: true, viewerCount: 15 }),
    );
    const provider = new TwitchViewerCountProvider(
      apiClient, { channel: "testChannel" }, noOpLogger
    );

    await provider.getViewerCount();
    expect(provider.getErrorStats().consecutiveErrors).toBe(1);

    const count = await provider.getViewerCount();
    expect(count).toBe(15);
    expect(provider.getErrorStats().consecutiveErrors).toBe(0);
  });
});
