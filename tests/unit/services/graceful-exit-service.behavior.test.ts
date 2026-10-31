import { vi, type Mock, describe, test, beforeEach, afterEach, expect } from 'bun:test';


import { useFakeTimers, useRealTimers, getTimerCount } from "../../helpers/bun-timers";
import { GracefulExitService } from "../../../src/services/GracefulExitService.ts";

type TestRuntime = {
  shutdown: Mock<(...args: []) => Promise<void>>;
  getPlatforms: Mock<(...args: []) => Record<string, unknown>>;
};

describe("GracefulExitService additional behavior", () => {
  let runtime: TestRuntime;
  let service: GracefulExitService | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    useFakeTimers();

    runtime = {
      shutdown: vi.fn<(...args: []) => Promise<void>>().mockResolvedValue(undefined),
      getPlatforms: vi.fn<(...args: []) => Record<string, unknown>>().mockReturnValue({}),
    };


  });

  afterEach(() => {
    service?.stop();
    expect(getTimerCount()).toBe(0);
    useRealTimers();
    service = undefined;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test("disables tracking when target is non-positive", () => {
    service = new GracefulExitService(runtime, 0);

    expect(service.isEnabled()).toBe(false);
    expect(service.incrementMessageCount()).toBe(false);
    expect(service.getStats().enabled).toBe(false);
  });

  test("guards against duplicate shutdown attempts", async () => {
    service = new GracefulExitService(runtime, 1);
    service.isShuttingDown = true;

    await service.triggerExit();

    expect(runtime.shutdown).not.toHaveBeenCalled();
  });

  test("handles shutdown errors gracefully", async () => {
    runtime.shutdown.mockRejectedValue(new Error("shutdown failed"));

    service = new GracefulExitService(runtime, 1);
    service.incrementMessageCount();

    await service.triggerExit();

    expect(service.isShuttingDown).toBe(true);
  });

  test("builds exit summary without memory stats", () => {
    service = new GracefulExitService(runtime, 1);

    const summary = service._buildExitSummary();

    expect(summary).not.toHaveProperty("memoryStats");
  });
});
