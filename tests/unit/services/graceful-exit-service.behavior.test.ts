import { describe, test, beforeEach, afterEach, expect } from "bun:test";
import {
  createMockFn,
  clearAllMocks,
  restoreAllMocks,
  type TestMockFn,
} from "../../helpers/bun-mock-utils";

import { GracefulExitService } from "../../../src/services/GracefulExitService.ts";

type TestRuntime = {
  shutdown: TestMockFn<[], Promise<void>>;
  getPlatforms: TestMockFn<[], Record<string, unknown>>;
};

describe("GracefulExitService additional behavior", () => {
  let runtime: TestRuntime;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    clearAllMocks();
    originalExit = process.exit;

    runtime = {
      shutdown: createMockFn<[], Promise<void>>().mockResolvedValue(undefined),
      getPlatforms: createMockFn<[], Record<string, unknown>>().mockReturnValue({}),
    };

    process.exit = (_code?: string | number | null): never => {
      throw new Error("process.exit should not be called in this test");
    };
  });

  afterEach(() => {
    process.exit = originalExit;
    restoreAllMocks();
    clearAllMocks();
  });

  test("disables tracking when target is non-positive", () => {
    const service = new GracefulExitService(runtime, 0);

    expect(service.isEnabled()).toBe(false);
    expect(service.incrementMessageCount()).toBe(false);
    expect(service.getStats().enabled).toBe(false);
  });

  test("guards against duplicate shutdown attempts", async () => {
    const service = new GracefulExitService(runtime, 1);
    service.isShuttingDown = true;

    await service.triggerExit();

    expect(runtime.shutdown).not.toHaveBeenCalled();
  });

  test("handles shutdown errors gracefully", async () => {
    runtime.shutdown.mockRejectedValue(new Error("shutdown failed"));

    const service = new GracefulExitService(runtime, 1);
    service.incrementMessageCount();

    await service.triggerExit();

    expect(service.isShuttingDown).toBe(true);
  });

  test("builds exit summary without memory stats", () => {
    const service = new GracefulExitService(runtime, 1);

    const summary = service._buildExitSummary();

    expect(summary).not.toHaveProperty("memoryStats");
  });
});
