import { vi, describe, test, expect, afterEach } from 'bun:test';


import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { ViewerCountSystem } from "../../../src/utils/viewer-count";

describe("ViewerCountSystem polling resilience", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createSystem({ streamLive = true } = {}) {
    const platform = {
      getViewerCount: vi.fn<(...args: unknown[]) => Promise<never>>().mockRejectedValue(new Error("fetch failed")),
    };

    const system = new ViewerCountSystem({
      platforms: { twitch: platform },
      logger: noOpLogger,
      config: createConfigFixture(),
    });

    system.streamStatus.twitch = streamLive;

    return { system, platform };
  }

  test("skips polling when stream is offline", async () => {
    const { system } = createSystem({ streamLive: false });

    await system.pollPlatform("twitch");

    expect(system.getViewerCount("twitch")).toBe(0);
  });

  test("continues polling cycle when provider throws", async () => {
    const { system } = createSystem({ streamLive: true });

    await system.pollPlatform("twitch");

    expect(system.getViewerCount("twitch")).toBe(0);
  });
});
