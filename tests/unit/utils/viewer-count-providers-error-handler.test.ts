import { vi, describe, it, expect } from 'bun:test';

import {
  TwitchViewerCountProvider,
  ViewerCountProvider,
} from "../../../src/utils/viewer-count-providers";
describe("ViewerCountProvider error handler integration", () => {
  it("sanitizes complete stored messages without mutating the error", () => {
    const provider = new ViewerCountProvider("synthetic", createMockLogger());
    const error = new Error(`access_token=synthetic-stored-credential ${"x".repeat(4200)} password=synthetic-tail-credential`);
    provider._handleProviderError(error);
    const stored = provider.getErrorStats().lastError;
    expect(stored).toContain("[REDACTED]");
    expect(stored).not.toContain("synthetic-stored-credential");
    expect(stored).not.toContain("synthetic-tail-credential");
    expect(error.message).toContain("synthetic-stored-credential");
  });

  it("requires explicit missing-resource evidence rather than stream/video wording", () => {
    const provider = new ViewerCountProvider("synthetic", createMockLogger());
    for (const error of [new Error("not found"), new Error("not_found"), new Error("not-found"), new Error("HTTP 404"), { status: 404 }, { response: { status: 404 } }]) {
      expect(provider._categorizeError(error)).toBe("resource_not_found");
    }
    for (const message of ["stream processing failed", "video processing failed", "stream 14040 failure"]) {
      expect(provider._categorizeError(new Error(message))).toBe("unknown");
    }
  });
  const createMockLogger = () => ({
    debug: vi.fn<(...args: unknown[]) => unknown>(),
    info: vi.fn<(...args: unknown[]) => unknown>(),
    warn: vi.fn<(...args: unknown[]) => unknown>(),
    error: vi.fn<(...args: unknown[]) => unknown>(),
  });

  it("logs provider errors at error level and returns unavailable", async () => {
    const mockLogger = createMockLogger();
    const apiClient = {
      getStreamInfo: vi.fn<(...args: unknown[]) => Promise<never>>().mockRejectedValue(new Error("test network timeout")),
    };
    const provider = new TwitchViewerCountProvider(
      apiClient, { channel: "test-channel" }, mockLogger
    );

    const result = await provider.getViewerCount();

    expect(result).toBeNull();
    expect(mockLogger.error).toHaveBeenCalled();
    const errorCall = mockLogger.error.mock.calls[0];
    expect(errorCall).toBeDefined();
    if (!errorCall) {
      throw new Error("Expected provider error to be logged");
    }
    expect(errorCall[0]).toContain("test network timeout");
  });

  it("logs errors at error level across consecutive failures", async () => {
    const mockLogger = createMockLogger();
    const apiClient = {
      getStreamInfo: vi.fn<(...args: [string]) => Promise<{ isLive: boolean; viewerCount: number }>>()
        .mockRejectedValueOnce(new Error("network fail"))
        .mockRejectedValueOnce(new Error("timeout")),
    };
    const provider = new TwitchViewerCountProvider(apiClient, { channel: "synthetic-channel" }, mockLogger);

    await provider.getViewerCount();
    await provider.getViewerCount();

    expect(provider.getErrorStats().totalErrors).toBe(2);
    expect(provider.getErrorStats().consecutiveErrors).toBe(2);
    expect(mockLogger.error).toHaveBeenCalledTimes(2);
  });
});
