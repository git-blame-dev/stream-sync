import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { InnertubeService } from "../../../src/services/innertube-service";

describe("InnertubeService behavior", () => {
  let factory;

  beforeEach(() => {
    factory = {
      createWithTimeout: createMockFn(async () => ({
        getInfo: createMockFn(async () => ({ video: "info" })),
      })),
    };
  });

  afterEach(() => {
    restoreAllMocks();
  });

  test("reuses cached instances and tracks stats", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger });

    const first = await service.getSharedInstance("shared");
    const second = await service.getSharedInstance("shared");

    expect(first).toBe(second);
    expect(service.stats.cacheMisses).toBe(1);
    expect(service.stats.cacheHits).toBe(1);
    expect(service.stats.instancesCreated).toBe(1);
  });

test("passes timeout metadata when fetching video info", async () => {
    const withTimeout = createMockFn(async (promise) => promise);
    const service = new InnertubeService(factory, {
      logger: noOpLogger,
      withTimeout,
    });

    const result = await service.getVideoInfo("abc123", {
      timeout: 5000,
      instanceKey: "custom",
    });
  const cached = service.instanceCache.get("custom");

  expect(result).toEqual({ video: "info" });
  const [getInfoPromise, timeoutMs, operationName] = withTimeout.mock.calls[0] || [];
  expect(timeoutMs).toBe(5000);
  expect(operationName).toBe("YouTube getInfo call");
  await expect(getInfoPromise).resolves.toEqual({ video: "info" });
  expect(cached.lastUsed).toBeGreaterThanOrEqual(cached.created);
});

  test("cleans up stale instances", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger });
    await service.getSharedInstance("old");
    service.instanceCache.set("old", { instance: {}, created: 0, lastUsed: 0 });

    service.cleanup(1);

    expect(service.instanceCache.has("old")).toBe(false);
  });

  test("tracks error stats and throws on factory failure", async () => {
    const error = new Error("boom");
    factory.createWithTimeout.mockRejectedValue(error);
    const service = new InnertubeService(factory, { logger: noOpLogger });

    await expect(service.getSharedInstance("fail")).rejects.toThrow(
      "InnertubeService instance creation failed",
    );
    expect(service.stats.errors).toBe(1);
  });
});
