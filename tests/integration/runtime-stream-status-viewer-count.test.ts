import { describe, test, afterEach, expect } from "bun:test";

import { restoreAllMocks } from "../helpers/bun-mock-utils";
import { AppRuntime } from "../../src/main";
import { createAppRuntimeTestDependencies } from "../helpers/runtime-test-harness";

const configOverrides = {
  general: {},
  youtube: {
    enabled: true,
    viewerCountEnabled: true,
  },
  twitch: { enabled: false },
  tiktok: { enabled: false },
  obs: { enabled: false },
};

const buildAppRuntimeDependencies = (options = {}) =>
  createAppRuntimeTestDependencies({
    configOverrides,
    ...options,
  });

describe("AppRuntime stream-status viewer count routing", () => {
  afterEach(async () => {
    restoreAllMocks();
    if (runtime && typeof runtime.stop === "function") {
      await runtime.stop();
    }
    runtime = null;
  });

  let runtime;

  test("updates viewer count system when stream-status platform:event arrives", async () => {
    const harness = buildAppRuntimeDependencies();
    const { dependencies, eventBus, configFixture } = harness;
    const updates = [];

    runtime = new AppRuntime(configFixture, dependencies);
    runtime.viewerCountSystem.updateStreamStatus = async (platform, isLive) => {
      updates.push({ platform, isLive });
    };

    eventBus.emit("platform:event", {
      platform: "youtube",
      type: "platform:stream-status",
      data: { isLive: true, timestamp: new Date().toISOString() },
    });

    await Promise.resolve();

    expect(updates).toEqual([{ platform: "youtube", isLive: true }]);
  });

  test("ignores stream-status events without boolean isLive", async () => {
    const harness = buildAppRuntimeDependencies();
    const { dependencies, eventBus, configFixture } = harness;
    const updates = [];

    runtime = new AppRuntime(configFixture, dependencies);
    runtime.viewerCountSystem.updateStreamStatus = async (platform, isLive) => {
      updates.push({ platform, isLive });
    };

    eventBus.emit("platform:event", {
      platform: "youtube",
      type: "platform:stream-status",
      data: { isLive: "not-boolean", timestamp: new Date().toISOString() },
    });

    await Promise.resolve();

    expect(updates).toEqual([]);
  });
});
