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

  it('returns joinable work and fences all later writes after cancellation during an OBS response', async () => {
    let requested!: () => void;
    const entered = new Promise<void>((resolve) => { requested = resolve; });
    let release!: () => void;
    const response = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    const controller = new AbortController();
    const obs = createObsLike(async (request) => {
      calls.push(request);
      requested();
      await response;
      return { filterSettings: {} };
    });
    let retired = false;
    const run = triggerHandcamGlow(obs, createHandcamConfigFixture({ enabled: true }), controller.signal);
    void run?.then(() => { retired = true; });
    await entered;
    controller.abort();
    expect(retired).toBe(false);
    release();
    await run;
    expect(calls).toEqual(['GetSourceFilter']);
    expect(retired).toBe(true);
  });

  it('wakes an owned glow delay on cancellation without another OBS write', async () => {
    let delayed!: () => void;
    const entered = new Promise<void>((resolve) => { delayed = resolve; });
    setTestingDependencies({ delay: () => { delayed(); return new Promise<void>(() => {}); } });
    const calls: string[] = [];
    const obs = createObsLike(async (request) => { calls.push(request); return { filterSettings: {} }; });
    const controller = new AbortController();
    const run = triggerHandcamGlow(obs, createHandcamConfigFixture({ enabled: true }), controller.signal);
    await entered;
    controller.abort();
    await run;
    expect(calls).toEqual(['GetSourceFilter', 'SetSourceFilterSettings', 'SetSourceFilterSettings']);
  });

  for (const value of [NaN, Infinity, -Infinity, -1, false, true, null, undefined, [], {}, "", "bad"]) {
    it(`falls back to schema numeric defaults for malformed input ${JSON.stringify(value)}`, async () => {
      const sizes: number[] = [];
      const delays: number[] = [];
      const writes: ObsCallPayload[] = [];
      setTestingDependencies({ delay: async (ms) => { delays.push(ms); } });
      const obs = createObsLike(async (action, payload) => {
        if (action === "GetSourceFilter") return { filterSettings: { brightness: 10 } };
        if (isFilterSettingsPayload(payload)) {
          writes.push(payload);
          sizes.push(Number(payload.filterSettings.Size));
          // Keep the pre-fix Infinity regression bounded at the fake OBS boundary.
          if (sizes.length > 2100) throw new Error("synthetic excessive OBS work");
        }
        return {};
      });
      triggerHandcamGlow(obs, createHandcamConfigFixture({
        enabled: true, sourceName: "synthetic-camera", glowFilterName: "synthetic-glow",
        maxSize: value, rampUpDuration: value, holdDuration: value,
        rampDownDuration: value, totalSteps: value,
      }));
      await flushGlowTasks();
      expect(sizes).toHaveLength(63);
      expect(sizes.every((size) => Number.isFinite(size) && size >= 0)).toBe(true);
      expect(Math.max(...sizes)).toBe(50);
      expect(sizes.at(-1)).toBe(0);
      expect(delays).toHaveLength(61);
      expect(delays.every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true);
      expect(delays[0]).toBeCloseTo(500 / 30);
      expect(delays[30]).toBe(8000);
      for (const payload of writes) {
        expect(payload).toMatchObject({
          sourceName: "synthetic-camera", filterName: "synthetic-glow",
          filterSettings: { brightness: 10 },
        });
        if (isFilterSettingsPayload(payload)) {
          expect(payload.filterSettings.glow_size).toBe(payload.filterSettings.Size);
        }
      }
    });
  }

  for (const steps of [0, -1, 1.5, 1_000_000_000]) {
    it(`bounds animation work for step count ${steps}`, async () => {
      const sizes: number[] = [];
      const obs = createObsLike(async (action, payload) => {
        if (action === "GetSourceFilter") return { filterSettings: {} };
        if (isFilterSettingsPayload(payload)) {
          sizes.push(Number(payload.filterSettings.Size));
          if (sizes.length > 2100) throw new Error("synthetic excessive OBS work");
        }
        return {};
      });
      triggerHandcamGlow(obs, createHandcamConfigFixture({ totalSteps: steps }));
      await flushGlowTasks();
      expect(sizes).toHaveLength(steps > 1000 ? 2003 : 63);
      expect(sizes.every(Number.isFinite)).toBe(true);
      expect(sizes.at(-1)).toBe(0);
    });
  }

  it("preserves valid numeric strings and zero hold duration", async () => {
    const sizes: number[] = [];
    const delays: number[] = [];
    const delayStages: string[] = [];
    setTestingDependencies({ delay: async (ms, _minMs, context) => {
      delays.push(ms);
      delayStages.push(context);
    } });
    const obs = createObsLike(async (action, payload) => {
      if (action === "GetSourceFilter") return { filterSettings: {} };
      if (isFilterSettingsPayload(payload)) sizes.push(Number(payload.filterSettings.Size));
      return {};
    });
    triggerHandcamGlow(obs, createHandcamConfigFixture({
      maxSize: "24", totalSteps: "2", rampUpDuration: "0.2",
      holdDuration: "0", rampDownDuration: "0.4", easingEnabled: false,
    }));
    await flushGlowTasks();
    expect(sizes).toEqual([0, 0, 12, 24, 24, 12, 0]);
    expect(delays).toEqual([100, 100, 200, 200]);
    expect(delayStages).not.toContain("Handcam glow hold duration");
  });

  it("leaves null or absent configuration disabled", async () => {
    let accesses = 0;
    const obs = createObsLike(async () => { accesses += 1; return {}; });
    await expect(initializeHandcamGlow(obs, null)).resolves.toBeUndefined();
    await expect(initializeHandcamGlow(obs, undefined)).resolves.toBeUndefined();
    expect(() => triggerHandcamGlow(obs, null)).not.toThrow();
    expect(() => triggerHandcamGlow(obs, undefined)).not.toThrow();
    await flushGlowTasks();
    expect(accesses).toBe(0);
  });

  for (const invalid of [0, 101]) {
    it(`applies schema size and ramp bounds for ${invalid}`, async () => {
      const sizes: number[] = [];
      const delays: number[] = [];
      setTestingDependencies({ delay: async (ms) => { delays.push(ms); } });
      const obs = createObsLike(async (action, payload) => {
        if (action === "GetSourceFilter") return { filterSettings: {} };
        if (isFilterSettingsPayload(payload)) sizes.push(Number(payload.filterSettings.Size));
        return {};
      });
      triggerHandcamGlow(obs, createHandcamConfigFixture({
        maxSize: invalid, rampUpDuration: invalid, rampDownDuration: invalid, totalSteps: 1,
      }));
      await flushGlowTasks();
      expect(sizes).toEqual([0, 0, 50, 50, 0]);
      expect(delays).toEqual([500, 8000, 500]);
    });
  }

  it("keeps a huge finite hold within the existing timer ceiling", async () => {
    const delays: number[] = [];
    setTestingDependencies({ delay: async (ms) => { delays.push(ms); } });
    const obs = createObsLike(async () => ({ filterSettings: {} }));
    triggerHandcamGlow(obs, createHandcamConfigFixture({ totalSteps: 1, holdDuration: 1e308 }));
    await flushGlowTasks();
    expect(delays).toEqual([500, 2147483647, 500]);
  });

  it("uses schema source and filter defaults when names are absent", async () => {
    const requests: ObsCallPayload[] = [];
    const obs = createObsLike(async (_action, payload) => {
      requests.push(payload);
      return { filterSettings: {} };
    });
    await initializeHandcamGlow(obs, createHandcamConfigFixture({ sourceName: undefined, glowFilterName: undefined }));
    expect(requests).toHaveLength(2);
    requests.forEach((payload) => expect(payload).toMatchObject({ sourceName: "handcam-source", filterName: "Glow" }));
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

  it("waits for the supplied OBS owner before reading or changing the filter", async () => {
    resetTestingDependencies();
    setTestingDependencies({ logger: mockLogger, delay: mockDelay });
    const readiness: { release?: () => void } = {};
    const ready = new Promise<void>(resolve => { readiness.release = resolve; });
    const calls: string[] = [];
    const obs = {
      connected: false,
      async ensureConnected() {
        await ready;
        this.connected = true;
      },
      async call(request: string) {
        expect(this.connected).toBe(true);
        calls.push(request);
        return { filterSettings: { syntheticSetting: 7 } };
      },
    };
    const run = initializeHandcamGlow(obs, createHandcamConfigFixture({ enabled: true }));
    expect(calls).toEqual([]);
    readiness.release?.();
    await run;
    expect(calls).toEqual(["GetSourceFilter", "SetSourceFilterSettings"]);
  });

  it("makes no OBS calls when owner readiness fails or is absent", async () => {
    resetTestingDependencies();
    setTestingDependencies({ logger: mockLogger, delay: mockDelay });
    const calls: string[] = [];
    const obs = {
      async call(request: string) { calls.push(request); return {}; },
      async ensureConnected() { throw new Error("Synthetic OBS disconnected"); },
    };
    const config = createHandcamConfigFixture({ enabled: true, totalSteps: 1 });
    await initializeHandcamGlow(obs, config);
    await triggerHandcamGlow(obs, config);
    await initializeHandcamGlow({ call: obs.call }, config);
    await triggerHandcamGlow({ call: obs.call }, config);
    expect(calls).toEqual([]);
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
