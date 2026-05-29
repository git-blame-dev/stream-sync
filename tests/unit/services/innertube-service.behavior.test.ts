import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { InnertubeService } from "../../../src/services/innertube-service";

type VideoInfo = { video: string };
type InnertubeInfoClient = {
  getInfo: (videoId: string, options?: Record<string, unknown>) => Promise<VideoInfo>;
};
type InnertubeFactory = {
  createWithTimeout: ReturnType<typeof createMockFn<[timeoutMs?: number], Promise<InnertubeInfoClient>>>;
};
type TimeoutCall = [Promise<unknown>, number, string];

const expectFirstTimeoutCall = (calls: unknown[][]): TimeoutCall => {
  const firstCall = calls[0];
  if (!firstCall) {
    throw new Error("Expected timeout call to be recorded");
  }
  expect(firstCall).toBeDefined();
  expect(firstCall).toHaveLength(3);

  const [promise, timeoutMs, operationName] = firstCall;
  expect(promise).toBeInstanceOf(Promise);
  expect(typeof timeoutMs).toBe("number");
  expect(typeof operationName).toBe("string");
  if (!(promise instanceof Promise) || typeof timeoutMs !== "number" || typeof operationName !== "string") {
    throw new Error("Expected timeout call arguments to match the timeout contract");
  }

  return [promise, timeoutMs, operationName];
};

describe("InnertubeService behavior", () => {
  let factory: InnertubeFactory;

  beforeEach(() => {
    factory = {
      createWithTimeout: createMockFn<
        [timeoutMs?: number],
        Promise<InnertubeInfoClient>
      >(async () => ({
        getInfo: createMockFn(async (_videoId: string) => ({ video: "info" })),
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
    const timeoutCalls: TimeoutCall[] = [];
    const withTimeout = async <T>(
      promise: Promise<T>,
      timeoutMs: number,
      operationName: string,
    ): Promise<T> => {
      timeoutCalls.push([promise, timeoutMs, operationName]);
      return promise;
    };
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
    const [getInfoPromise, timeoutMs, operationName] = expectFirstTimeoutCall(timeoutCalls);
    expect(timeoutMs).toBe(5000);
    expect(operationName).toBe("YouTube getInfo call");
    await expect(getInfoPromise).resolves.toEqual({ video: "info" });
    expect(cached).toBeDefined();
    if (!cached) {
      throw new Error("Expected custom cached Innertube instance");
    }
    expect(cached.lastUsed).toBeGreaterThanOrEqual(cached.created);
  });

  test("cleans up stale instances", async () => {
    const service = new InnertubeService(factory, { logger: noOpLogger });
    await service.getSharedInstance("old");
    service.instanceCache.set("old", {
      instance: { getInfo: async () => ({ video: "stale" }) },
      created: 0,
      lastUsed: 0,
    });

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
