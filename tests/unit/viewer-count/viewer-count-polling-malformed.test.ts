import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createRequire } from "node:module";

import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";

const load = createRequire(import.meta.url);

type ViewerCountUpdatePayload = {
  platform: string;
  count: number;
  previousCount: number;
  isStreamLive: boolean;
  timestamp: Date;
};

describe("ViewerCountSystem polling with malformed payloads", () => {
  let ViewerCountSystem;

  beforeEach(() => {
    ({ ViewerCountSystem } = load("../../../src/utils/viewer-count.ts"));
  });

  afterEach(() => {
    restoreAllMocks();
  });

  function createSystemWithPlatformReturning(value) {
    const platform = {
      getViewerCount: createMockFn().mockResolvedValue(value),
    };

    const system = new ViewerCountSystem({
      platforms: { youtube: platform },
      logger: noOpLogger,
      config: createConfigFixture(),
    });

    system.streamStatus.youtube = true;

    return { system };
  }

  test("preserves previous count when platform returns non-numeric value", async () => {
    const { system } = createSystemWithPlatformReturning("not-a-number");
    const observerUpdates: ViewerCountUpdatePayload[] = [];
    const observer = {
      getObserverId: () => "testObserver1",
      onViewerCountUpdate: (payload: ViewerCountUpdatePayload) =>
        observerUpdates.push(payload),
    };
    system.addObserver(observer);

    await system.pollPlatform("youtube");

    expect(system.counts.youtube).toBe(0);
    expect(observerUpdates).toHaveLength(0);
  });

  test("skips update when platform returns object payload without numeric count", async () => {
    const { system } = createSystemWithPlatformReturning({ count: "unknown" });
    const observerUpdates: ViewerCountUpdatePayload[] = [];
    const observer = {
      getObserverId: () => "testObserver2",
      onViewerCountUpdate: (payload: ViewerCountUpdatePayload) =>
        observerUpdates.push(payload),
    };
    system.addObserver(observer);

    await system.pollPlatform("youtube");

    expect(system.counts.youtube).toBe(0);
    expect(observerUpdates).toHaveLength(0);
  });
});
