import { describe, test, expect, afterEach } from "bun:test";

import { restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { ViewerCountSystem } from "../../../src/utils/viewer-count";

describe("ViewerCountSystem polling interval validation", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("does not start polling when interval is zero or negative", () => {
    const config = createConfigFixture({
      general: { viewerCountPollingIntervalMs: -5000 },
    });

    const system = new ViewerCountSystem({
      platforms: { twitch: {}, youtube: {} },
      logger: noOpLogger,
      config,
    });

    system.startPolling();

    expect(system.isPolling).toBe(false);
    expect(Object.keys(system.pollingHandles)).toHaveLength(0);
  });
});
