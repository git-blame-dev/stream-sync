import { describe, expect, beforeEach, it, afterEach } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createHandcamConfigFixture } from "../../helpers/config-fixture";
import { waitForDelay } from "../../helpers/time-utils";

import {
  triggerHandcamGlow,
  initializeHandcamGlow,
  setTestingDependencies,
  resetTestingDependencies,
} from "../../../src/obs/handcam-glow.ts";
import * as handcamGlowCompatModule from "../../../src/obs/handcam-glow.ts";

type GlowDependencies = Parameters<typeof setTestingDependencies>[0];
type GlowLogger = NonNullable<GlowDependencies["logger"]>;
type EnsureConnected = NonNullable<GlowDependencies["ensureConnected"]>;
type GlowDelay = NonNullable<GlowDependencies["delay"]>;
type ObsLike = Parameters<typeof initializeHandcamGlow>[0];
type ObsCallPayload = Record<string, unknown>;
type ObsCall = (
  requestType: string,
  payload: ObsCallPayload,
) => Promise<unknown>;

function createObsLike<TCall extends ObsCall>(call: TCall): ObsLike & { call: TCall } {
  return { call };
}

function isFilterSettingsPayload(
  payload: unknown,
): payload is { filterSettings: Record<string, unknown> } {
  return (
    payload !== null &&
    typeof payload === "object" &&
    "filterSettings" in payload &&
    typeof payload.filterSettings === "object" &&
    payload.filterSettings !== null
  );
}

async function flushGlowTasks(): Promise<void> {
  await waitForDelay(1);
}

describe("handcam-glow", () => {
  let mockLogger: GlowLogger;
  let mockEnsureConnected: EnsureConnected;
  let mockDelay: GlowDelay;

  beforeEach(() => {
    mockLogger = noOpLogger;
    mockEnsureConnected = createMockFn<[], Promise<void>>(async () => {});
    mockDelay = createMockFn<
      [ms: number, minMs: number, context: string],
      Promise<void>
    >(async () => {});

    setTestingDependencies({
      logger: mockLogger,
      ensureConnected: mockEnsureConnected,
      delay: mockDelay,
    });
  });

  afterEach(() => {
    resetTestingDependencies();
  });

  it("skips initialization when disabled in config", async () => {
    const obs = createObsLike(
      createMockFn<[string, ObsCallPayload], Promise<unknown>>(async () => ({})),
    );

    await initializeHandcamGlow(
      obs,
      createHandcamConfigFixture({ enabled: false }),
    );

    expect(obs.call).not.toHaveBeenCalled();
  });

  it("initializes glow filter to zero when enabled", async () => {
    const obs = createObsLike(
      createMockFn<[string, ObsCallPayload], Promise<unknown>>(async (action) => {
        if (action === "GetSourceFilter") {
          return { filterSettings: { brightness: 10 } };
        }
        return {};
      }),
    );

    await initializeHandcamGlow(
      obs,
      createHandcamConfigFixture({
        sourceName: "testCam",
        glowFilterName: "testGlow",
      }),
    );

    const setFilterCall = obs.call.mock.calls.find(
      ([requestType]) => requestType === "SetSourceFilterSettings",
    );
    expect(setFilterCall).toBeDefined();
    expect(setFilterCall?.[1]).toEqual({
      sourceName: "testCam",
      filterName: "testGlow",
      filterSettings: { brightness: 10, Size: 0, glow_size: 0 },
    });
  });

  it("handles initialization failure gracefully without throwing", async () => {
    const obs = createObsLike(
      createMockFn<[string, ObsCallPayload], Promise<unknown>>(async () => {
        throw new Error("OBS filter not found");
      }),
    );

    await expect(
      initializeHandcamGlow(
        obs,
        createHandcamConfigFixture({
          sourceName: "testCam",
          glowFilterName: "testGlow",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("applies dual size fields during glow animation", async () => {
    const settingsCalls: Record<string, unknown>[] = [];
    const obs = createObsLike(
      createMockFn<[string, ObsCallPayload], Promise<unknown>>(async (action, payload) => {
        if (action === "GetSourceFilter") {
          return { filterSettings: { brightness: 10 } };
        }
        if (action === "SetSourceFilterSettings") {
          if (isFilterSettingsPayload(payload)) {
            settingsCalls.push(payload.filterSettings);
          }
          return {};
        }
        return {};
      }),
    );

    triggerHandcamGlow(obs, createHandcamConfigFixture({ totalSteps: 1 }));
    await flushGlowTasks();
    await flushGlowTasks();
    await flushGlowTasks();

    const hasDualSizeFields = settingsCalls.some(
      (settings) =>
        Number.isFinite(settings.Size) &&
        Number.isFinite(settings.glow_size) &&
        settings.Size === settings.glow_size,
    );

    expect(hasDualSizeFields).toBe(true);
  });

  it("resets glow properties after animation error without throwing", async () => {
    let setCallCount = 0;
    const obs = createObsLike(
      createMockFn<[string, ObsCallPayload], Promise<unknown>>(async (action) => {
        if (action === "GetSourceFilter") {
          return { filterSettings: { brightness: 10 } };
        }
        if (action === "SetSourceFilterSettings") {
          setCallCount += 1;
          if (setCallCount === 1) {
            throw new Error("First call fails");
          }
          return {};
        }
        return {};
      }),
    );

    triggerHandcamGlow(obs, createHandcamConfigFixture({ totalSteps: 1 }));
    await flushGlowTasks();
    await flushGlowTasks();
    await flushGlowTasks();
    await flushGlowTasks();

    expect(setCallCount).toBeGreaterThanOrEqual(2);
  });

  it("triggers fire-and-forget glow without throwing", async () => {
    const obs = createObsLike(
      createMockFn<[string, ObsCallPayload], Promise<unknown>>(async () => ({})),
    );
    expect(() =>
      triggerHandcamGlow(obs, createHandcamConfigFixture()),
    ).not.toThrow();
    await flushGlowTasks();
  });

  it("supersedes an in-flight glow run when triggered again rapidly", async () => {
    const firstHoldRelease: { current?: () => void } = {};
    let delayCallCount = 0;
    const settingsCalls: Record<string, unknown>[] = [];

    mockDelay = createMockFn<
      [ms: number, minMs: number, context: string],
      Promise<void>
    >(() => {
      delayCallCount += 1;
      if (delayCallCount === 1) {
        return new Promise((resolve) => {
          firstHoldRelease.current = resolve;
        });
      }
      return Promise.resolve();
    });
    setTestingDependencies({
      logger: mockLogger,
      ensureConnected: mockEnsureConnected,
      delay: mockDelay,
    });

    const obs = createObsLike(
      createMockFn<[string, ObsCallPayload], Promise<unknown>>(async (action, payload) => {
        if (action === "GetSourceFilter") {
          return { filterSettings: { brightness: 10 } };
        }
        if (action === "SetSourceFilterSettings") {
          if (isFilterSettingsPayload(payload)) {
            settingsCalls.push(payload.filterSettings);
          }
        }
        return {};
      }),
    );

    const config = createHandcamConfigFixture({
      totalSteps: 0,
      holdDuration: 1,
      rampUpDuration: 0,
      rampDownDuration: 0,
    });
    triggerHandcamGlow(obs, config);
    await flushGlowTasks();
    await flushGlowTasks();

    triggerHandcamGlow(obs, config);
    await flushGlowTasks();
    await flushGlowTasks();
    await flushGlowTasks();

    const callCountBeforeRelease = settingsCalls.length;
    expect(firstHoldRelease.current).toBeDefined();
    if (!firstHoldRelease.current) {
      throw new Error("Expected first glow hold delay to be pending");
    }
    firstHoldRelease.current();
    await flushGlowTasks();
    await flushGlowTasks();

    expect(settingsCalls.length).toBe(callCountBeforeRelease);
  });

  it("ignores trigger when disabled", () => {
    const obs = createObsLike(
      createMockFn<[string, ObsCallPayload], Promise<unknown>>(async () => ({})),
    );
    triggerHandcamGlow(obs, createHandcamConfigFixture({ enabled: false }));
    expect(obs.call).not.toHaveBeenCalled();
  });

  it("preserves named exports through the module namespace", () => {
    expect(handcamGlowCompatModule.triggerHandcamGlow).toBe(triggerHandcamGlow);
    expect(handcamGlowCompatModule.initializeHandcamGlow).toBe(
      initializeHandcamGlow,
    );
    expect(handcamGlowCompatModule.setTestingDependencies).toBe(
      setTestingDependencies,
    );
    expect(handcamGlowCompatModule.resetTestingDependencies).toBe(
      resetTestingDependencies,
    );
  });
});
