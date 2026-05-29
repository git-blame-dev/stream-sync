import { describe, test, afterEach, expect } from "bun:test";

import { restoreAllMocks } from "../helpers/bun-mock-utils";
import { AppRuntime } from "../../src/main";
import { createAppRuntimeTestDependencies } from "../helpers/runtime-test-harness";

type RuntimeUnderTest = InstanceType<typeof AppRuntime>;
type RuntimeConfig = ConstructorParameters<typeof AppRuntime>[0];
type RuntimeDependencies = ConstructorParameters<typeof AppRuntime>[1];
type StreamStatusUpdate = { platform: string; isLive: boolean };
type StoppableRuntime = RuntimeUnderTest & {
  stop?: () => Promise<unknown> | unknown;
};

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

const createRuntime = (
  configFixture: unknown,
  dependencies: RuntimeDependencies,
) => new AppRuntime(configFixture as RuntimeConfig, dependencies);

describe("AppRuntime stream-status viewer count routing", () => {
  afterEach(async () => {
    restoreAllMocks();
    const stoppableRuntime = runtime as StoppableRuntime | null;
    if (stoppableRuntime && typeof stoppableRuntime.stop === "function") {
      await stoppableRuntime.stop();
    }
    runtime = null;
  });

  let runtime: RuntimeUnderTest | null;

  test("updates viewer count system when stream-status platform:event arrives", async () => {
    const harness = buildAppRuntimeDependencies();
    const { dependencies, eventBus, configFixture } = harness;
    const updates: StreamStatusUpdate[] = [];

    runtime = createRuntime(configFixture, dependencies);
    if (!runtime.viewerCountSystem.updateStreamStatus) {
      throw new Error("Expected viewer count system stream-status updater");
    }
    runtime.viewerCountSystem.updateStreamStatus = async (platform, isLive) => {
      updates.push({ platform, isLive });
    };
    if (!eventBus.emit) {
      throw new Error("Expected test event bus emit method");
    }

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
    const updates: StreamStatusUpdate[] = [];

    runtime = createRuntime(configFixture, dependencies);
    if (!runtime.viewerCountSystem.updateStreamStatus) {
      throw new Error("Expected viewer count system stream-status updater");
    }
    runtime.viewerCountSystem.updateStreamStatus = async (platform, isLive) => {
      updates.push({ platform, isLive });
    };
    if (!eventBus.emit) {
      throw new Error("Expected test event bus emit method");
    }

    eventBus.emit("platform:event", {
      platform: "youtube",
      type: "platform:stream-status",
      data: { isLive: "not-boolean", timestamp: new Date().toISOString() },
    });

    await Promise.resolve();

    expect(updates).toEqual([]);
  });
});
