import { vi, describe, test, expect, afterEach } from 'bun:test';


import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { ViewerCountSystem } from "../../../src/utils/viewer-count";

type ViewerCountUpdatePayload = {
  platform: string;
  count: number;
  previousCount: number;
  isStreamLive: boolean;
  timestamp: Date;
};

describe("ViewerCountSystem polling with malformed payloads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createSystemWithPlatformReturning(value: unknown) {
    const platform = {
      getViewerCount: vi.fn<(...args: unknown[]) => Promise<typeof value>>().mockResolvedValue(value),
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

    expect(system.getViewerCount("youtube")).toBe(0);
    expect(observerUpdates).toHaveLength(0);
  });

  test("retains a real previous measurement and freshness after negative or fractional polls", async () => {
    for (const invalid of [-1, 1.5]) {
      const { system } = createSystemWithPlatformReturning(invalid);
      await system.updateViewerCount("youtube", 12);
      const before = system.getViewerCountSnapshot("youtube");
      const observerUpdates: ViewerCountUpdatePayload[] = [];
      system.addObserver({ getObserverId: () => "synthetic-observer", onViewerCountUpdate: (payload: ViewerCountUpdatePayload) => observerUpdates.push(payload) });
      await system.pollPlatform("youtube");
      expect(system.getViewerCount("youtube")).toBe(12);
      expect(system.getViewerCountSnapshot("youtube")).toEqual({ ...before, latestOutcome: "unavailable" });
      expect(observerUpdates).toHaveLength(0);
    }
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

    expect(system.getViewerCount("youtube")).toBe(0);
    expect(observerUpdates).toHaveLength(0);
  });
});
