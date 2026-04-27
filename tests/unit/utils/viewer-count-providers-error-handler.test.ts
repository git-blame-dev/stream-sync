import { describe, it, expect } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import {
  TwitchViewerCountProvider,
  TikTokViewerCountProvider,
} from "../../../src/utils/viewer-count-providers";
describe("ViewerCountProvider error handler integration", () => {
  const createMockLogger = () => ({
    debug: createMockFn(),
    info: createMockFn(),
    warn: createMockFn(),
    error: createMockFn(),
  });

  it("logs provider errors at error level and returns 0", async () => {
    const mockLogger = createMockLogger();
    const apiClient = {
      getStreamInfo: createMockFn().mockRejectedValue(
        new Error("test network timeout"),
      ),
    };
    const provider = new TwitchViewerCountProvider(
      apiClient,
      {},
      { channel: "test-channel" },
      null,
      mockLogger,
    );

    const result = await provider.getViewerCount();

    expect(result).toBe(0);
    expect(mockLogger.error).toHaveBeenCalled();
    const errorCall = mockLogger.error.mock.calls[0];
    expect(errorCall[0]).toContain("test network timeout");
  });

  it("logs errors at error level across consecutive failures", async () => {
    const mockLogger = createMockLogger();
    const platform = {
      connection: { isConnected: true },
      getViewerCount: createMockFn()
        .mockRejectedValueOnce(new Error("network fail"))
        .mockRejectedValueOnce(new Error("timeout")),
    };
    const provider = new TikTokViewerCountProvider(platform, {
      logger: mockLogger,
    });

    await provider.getViewerCount();
    await provider.getViewerCount();

    expect(provider.getErrorStats().totalErrors).toBe(2);
    expect(provider.getErrorStats().consecutiveErrors).toBe(2);
    expect(mockLogger.error).toHaveBeenCalledTimes(2);
  });
});
