import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createRequire } from "node:module";

import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";

const load = createRequire(import.meta.url);

describe("ViewerCountSystem stream status observer notifications", () => {
  let ViewerCountSystem;

  beforeEach(() => {
    ({ ViewerCountSystem } = load("../../../src/utils/viewer-count.ts"));
  });

  afterEach(() => {
    restoreAllMocks();
  });

  function createSystem() {
    return new ViewerCountSystem({
      platforms: { youtube: {} },
      logger: noOpLogger,
      config: createConfigFixture(),
    });
  }

  test("notifies observers on stream status change for known platform", async () => {
    const system = createSystem();
    const statusEvents: Array<{
      platform: string;
      isLive: boolean;
      wasLive: boolean;
    }> = [];
    const observer = {
      getObserverId: () => "testObserver1",
      onStreamStatusChange: createMockFn(
        (payload: { platform: string; isLive: boolean; wasLive: boolean }) =>
          statusEvents.push(payload),
      ),
    };

    system.addObserver(observer);

    await system.updateStreamStatus("youtube", true);

    expect(observer.onStreamStatusChange).toHaveBeenCalledTimes(1);
    expect(statusEvents[0]).toEqual(
      expect.objectContaining({
        platform: "youtube",
        isLive: true,
        wasLive: false,
      }),
    );
  });

  test("skips observer notification for unknown platform", async () => {
    const system = createSystem();
    const observer = {
      getObserverId: () => "testObserver2",
      onStreamStatusChange: createMockFn(),
    };

    system.addObserver(observer);

    await system.updateStreamStatus("unknownPlatform", true);

    expect(observer.onStreamStatusChange).not.toHaveBeenCalled();
  });

  test("resets counts and notifies observers when stream goes offline", async () => {
    const system = createSystem();
    const statusEvents: Array<{
      platform: string;
      isLive: boolean;
      wasLive: boolean;
    }> = [];
    const countEvents: Array<{ platform: string; count: number }> = [];
    const observer = {
      getObserverId: () => "testObserver3",
      onStreamStatusChange: createMockFn(
        (payload: { platform: string; isLive: boolean; wasLive: boolean }) =>
          statusEvents.push(payload),
      ),
      onViewerCountUpdate: createMockFn(
        (payload: { platform: string; count: number }) =>
          countEvents.push(payload),
      ),
    };

    system.addObserver(observer);

    await system.updateStreamStatus("youtube", true);
    await system.updateStreamStatus("youtube", false);

    expect(statusEvents).toEqual([
      expect.objectContaining({
        platform: "youtube",
        isLive: true,
        wasLive: false,
      }),
      expect.objectContaining({
        platform: "youtube",
        isLive: false,
        wasLive: true,
      }),
    ]);

    expect(
      countEvents.some((evt) => evt.platform === "youtube" && evt.count === 0),
    ).toBe(true);
    expect(system.counts.youtube).toBe(0);
  });

  test("ignores updates for unknown platform without mutating counts", async () => {
    const system = createSystem();
    const observer = {
      getObserverId: () => "testObserver4",
      onStreamStatusChange: createMockFn(),
      onViewerCountUpdate: createMockFn(),
    };

    system.addObserver(observer);

    await system.updateStreamStatus("unknownPlatform", false);

    expect(observer.onStreamStatusChange).not.toHaveBeenCalled();
    expect(observer.onViewerCountUpdate).not.toHaveBeenCalled();
    expect(system.counts).toEqual(
      expect.objectContaining({ youtube: 0, twitch: 0, tiktok: 0 }),
    );
  });
});
