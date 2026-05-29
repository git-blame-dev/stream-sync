import { describe, expect, afterEach, it } from "bun:test";

import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { ViewerCountSystem } from "../../../src/utils/viewer-count";

describe("ViewerCountSystem cleanup resilience", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  it("completes cleanup even when observer cleanup throws", async () => {
    const platform = { getViewerCount: createMockFn().mockResolvedValue(100) };
    const system = new ViewerCountSystem({
      logger: noOpLogger,
      platforms: { youtube: platform },
      config: { general: { viewerCountPollingIntervalMs: 15000 } },
    });

    system.addObserver({
      getObserverId: () => "testFailingObserver",
      cleanup: () => {
        throw new Error("cleanup fail");
      },
    });

    await expect(system.cleanup()).resolves.toBeUndefined();
    expect(system.observers.size).toBe(0);
  });

  it("completes cleanup even when observer cleanup rejects", async () => {
    const platform = { getViewerCount: createMockFn().mockResolvedValue(100) };
    const system = new ViewerCountSystem({
      logger: noOpLogger,
      platforms: { youtube: platform },
      config: { general: { viewerCountPollingIntervalMs: 15000 } },
    });

    system.addObserver({
      getObserverId: () => "testRejectingObserver",
      cleanup: () => Promise.reject(new Error("async cleanup fail")),
    });

    await expect(system.cleanup()).resolves.toBeUndefined();
    expect(system.observers.size).toBe(0);
  });
});
