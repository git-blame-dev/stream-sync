import { describe, expect, afterEach, it } from "bun:test";

import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { ViewerCountSystem } from "../../../src/utils/viewer-count";

describe("ViewerCountSystem observer error handling", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  it("continues polling when observer throws error", async () => {
    const platform = { getViewerCount: createMockFn().mockResolvedValue(100) };
    const system = new ViewerCountSystem({
      logger: noOpLogger,
      platforms: { youtube: platform },
      config: { general: { viewerCountPollingIntervalMs: 15000 } },
    });

    system.streamStatus.youtube = true;

    system.addObserver({
      getObserverId: () => "testFailingObserver",
      onViewerCountUpdate: () => {
        throw new Error("observer boom");
      },
    });

    await expect(system.pollPlatform("youtube")).resolves.toBeUndefined();

    expect(system.counts.youtube).toBe(100);
  });
});
