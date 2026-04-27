import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import {
  createMockFn,
  clearAllMocks,
  restoreAllMocks,
} from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { YouTubeStreamDetectionService } from "../../../src/services/youtube-stream-detection-service.ts";
import * as testClock from "../../helpers/test-clock";

describe("YouTubeStreamDetectionService behavior", () => {
  beforeEach(() => {
    clearAllMocks();
  });

  afterEach(() => {
    restoreAllMocks();
  });

  it("returns error response for invalid channel handle", async () => {
    const service = new YouTubeStreamDetectionService(
      {},
      { logger: noOpLogger },
    );
    const result = await service.detectLiveStreams(null);

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.message).toContain("Unable to detect streams");
  });

  it("short-circuits when circuit breaker is open", async () => {
    const service = new YouTubeStreamDetectionService(
      {},
      { logger: noOpLogger },
    );
    service._circuitBreaker.isOpen = true;
    service._circuitBreaker.lastFailureTime = testClock.now();
    service._circuitBreaker.cooldownPeriod = 10_000;

    const result = await service.detectLiveStreams("testChannel");

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(service._metrics.totalRequests).toBe(1);
  });

  it("formats successful detection with validated video IDs", async () => {
    const service = new YouTubeStreamDetectionService(
      {},
      { logger: noOpLogger },
    );
    service._performDetection = createMockFn().mockResolvedValue({
      streams: [{ videoId: "ABCDEFGHIJK" }, { videoId: "invalid" }],
      hasContent: true,
      detectionMethod: "youtubei",
    });

    const result = await service.detectLiveStreams("@testChannel");

    expect(result.success).toBe(true);
    expect(result.videoIds).toEqual(["ABCDEFGHIJK", "invalid"]);
    expect(result.message).toContain("Found 2 live streams");
    expect(result.detectionMethod).toBe("youtubei");
  });

  it("opens circuit breaker after repeated failures", async () => {
    const service = new YouTubeStreamDetectionService(
      {},
      { logger: noOpLogger },
    );
    service._performDetection = createMockFn().mockRejectedValue(
      new Error("timeout error"),
    );

    await service.detectLiveStreams("testChannel");
    await service.detectLiveStreams("testChannel");
    await service.detectLiveStreams("testChannel");

    expect(service._circuitBreaker.isOpen).toBe(true);
    expect(service._metrics.failedRequests).toBe(3);
  });

  it("returns debug payload for unknown errors and marks retryable by default", async () => {
    const service = new YouTubeStreamDetectionService(
      {},
      { logger: noOpLogger },
    );
    service._performDetection = createMockFn().mockRejectedValue(
      new Error("unexpected downstream issue"),
    );

    const result = await service.detectLiveStreams("testChannel", {
      debug: true,
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.debug).toBeDefined();
    expect(result.debug.errorMessage).toContain("unexpected downstream issue");
  });

  it("reports zero average response time when all requests fail", async () => {
    const service = new YouTubeStreamDetectionService(
      {},
      { logger: noOpLogger },
    );
    service._performDetection = createMockFn().mockRejectedValue(
      new Error("hard failure"),
    );

    await service.detectLiveStreams("testChannel");
    await service.detectLiveStreams("testChannel");

    const metrics = service.getUsageMetrics();
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.successfulRequests).toBe(0);
    expect(metrics.failedRequests).toBe(2);
    expect(metrics.averageResponseTime).toBe(0);
  });

  it("updates timeout configuration and stays active while configured", () => {
    const service = new YouTubeStreamDetectionService(
      {},
      { logger: noOpLogger },
    );

    const updated = service.updateConfiguration({
      timeout: 4500,
      username: "test-user",
    });

    expect(updated).toBe(true);
    expect(service.timeout).toBe(4500);
    expect(service.isConfigured()).toBe(true);
    expect(service.isActive()).toBe(true);
  });

  it("returns false when configuration update throws", () => {
    const service = new YouTubeStreamDetectionService(
      {},
      { logger: noOpLogger },
    );
    const unstableConfig = {
      get timeout() {
        throw new Error("bad config");
      },
    };

    const updated = service.updateConfiguration(unstableConfig);

    expect(updated).toBe(false);
  });

  it("cleans up service state and reports inactive afterward", async () => {
    const service = new YouTubeStreamDetectionService(
      {},
      { logger: noOpLogger },
    );

    await service.cleanup();

    expect(service.client).toBeNull();
    expect(service.isActive()).toBe(false);
    expect(service.getUsageMetrics().totalRequests).toBe(0);
  });
});
