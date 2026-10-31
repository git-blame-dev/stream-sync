import { vi, spyOn, describe, expect, beforeEach, afterEach, it } from 'bun:test';

import { noOpLogger } from "../../helpers/mock-factories";
import { IntervalManager } from "../../../src/utils/interval-manager.ts";
import testClock from "../../helpers/test-clock";
type IntervalManagerDependencies = NonNullable<ConstructorParameters<typeof IntervalManager>[2]>;
type SafeSetInterval = NonNullable<IntervalManagerDependencies["safeSetInterval"]>;
type MockInterval = ReturnType<SafeSetInterval>;

describe("IntervalManager behavior", () => {
  let intervalIdCounter: number;
  let mockSafeSetInterval: SafeSetInterval;
  let clearIntervalSpy: { mockRestore: () => void };

  beforeEach(() => {
    clearIntervalSpy = ((spyOn as unknown as (object: typeof global, method: "clearInterval") => { mockImplementation: (implementation: (timeout?: MockInterval) => void) => { mockRestore: () => void } })(global, "clearInterval")).mockImplementation(
      () => {},
    );
    intervalIdCounter = 0;
    mockSafeSetInterval = vi.fn((callback: () => void) => {
      intervalIdCounter += 1;
      return { id: `interval-${intervalIdCounter}`, callback } as unknown as MockInterval;
    }) as unknown as SafeSetInterval;
  });

  afterEach(() => {
    clearIntervalSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("creates intervals with tracking for out-of-range durations", () => {
    const manager = new IntervalManager("platform", noOpLogger, {
      safeSetInterval: mockSafeSetInterval,
    });
    const callback = vi.fn<(...args: unknown[]) => unknown>();

    expect(() => manager.createInterval("poll", callback, 50)).not.toThrow();
    expect(manager.hasInterval("poll")).toBe(true);
    expect(manager.getActiveIntervals().length).toBe(1);
  });

  it("records the effective scheduled interval in active, creation and cleanup metadata", () => {
    const manager = new IntervalManager("platform", noOpLogger, { safeSetInterval: mockSafeSetInterval });
    for (const [index, input] of [NaN, Infinity, 0, -1, 2147483648, 2147483647, 50].entries()) {
      const expected = index < 4 ? 1000 : index < 6 ? 2147483647 : 50;
      const name = `test-${index}`;
      manager.createInterval(name, () => {}, input);
      expect(mockSafeSetInterval).toHaveBeenLastCalledWith(expect.any(Function), expected);
      expect(manager.getIntervalInfo(name)?.intervalMs).toBe(expected);
      expect(manager.intervalHistory.at(-1)?.intervalMs).toBe(expected);
      testClock.advance(10);
      manager.clearInterval(name);
      expect(manager.getCleanupHistory().at(-1)?.intervalMs).toBe(expected);
      expect(manager.getCleanupHistory().at(-1)?.duration).toBe(10);
    }
  });

  it("clears intervals individually and in bulk with stats updates", () => {
    const manager = new IntervalManager("platform", noOpLogger, {
      safeSetInterval: mockSafeSetInterval,
    });
    manager.createPollingInterval("p1", () => {}, 2000);
    manager.createMonitoringInterval("m1", () => {}, 2000);

    const cleared = manager.clearAllIntervals("polling");
    expect(cleared).toBe(1);
    expect(manager.getActiveIntervals().length).toBe(1);

    manager.cleanup();
    expect(manager.getStatistics().activeCount).toBe(0);
  });

  it("reports health including long-running intervals", () => {
    const manager = new IntervalManager("platform", noOpLogger, {
      safeSetInterval: mockSafeSetInterval,
    });
    manager.createInterval("old", () => {}, 1000, "monitoring");
    const info = manager.getIntervalInfo("old");
    expect(info).not.toBeNull();
    if (!info) {
      throw new Error("Expected interval info");
    }
    info.startTime = new Date(testClock.now() - 7200000).toISOString();

    const health = manager.getHealthCheck();

    expect(health.healthy).toBe(false);
    expect(health.longRunningCount).toBe(1);
    expect(health.longRunningIntervals[0]?.name).toBe("old");
  });
});
