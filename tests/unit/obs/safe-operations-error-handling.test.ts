import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";

import { safeOBSOperation } from "../../../src/obs/safe-operations.ts";

describe("safeOBSOperation error handling", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    restoreAllMocks();
  });

  it("rethrows operation errors", async () => {
    const obsManager = {
      isReady: createMockFn().mockResolvedValue(true),
    };

    await expect(
      safeOBSOperation(
        obsManager,
        () => {
          throw new Error("testOperationFailed");
        },
        "Test Operation",
      ),
    ).rejects.toThrow("testOperationFailed");
  });

  it("rethrows non-Error operation failures without hiding the original value", async () => {
    const obsManager = {
      isReady: createMockFn().mockResolvedValue(true),
    };

    await expect(
      safeOBSOperation(
        obsManager,
        () => {
          throw "stringOperationFailed";
        },
        "String failure operation",
      ),
    ).rejects.toBe("stringOperationFailed");
  });

  it("returns null when OBS is not ready", async () => {
    const obsManager = {
      isReady: createMockFn().mockResolvedValue(false),
    };

    const operation = createMockFn<[], Promise<unknown>>(async () => undefined);
    const result = await safeOBSOperation(
      obsManager,
      operation,
      "Not ready test",
    );

    expect(result).toBeNull();
    expect(operation).not.toHaveBeenCalled();
  });

  it("propagates readiness-check failures without running the operation", async () => {
    const obsManager = {
      isReady: createMockFn().mockRejectedValue(new Error("readiness check failed")),
    };

    const operation = createMockFn<[], Promise<unknown>>(async () => undefined);

    await expect(
      safeOBSOperation(obsManager, operation, "Readiness failure test"),
    ).rejects.toThrow("readiness check failed");
    expect(operation).not.toHaveBeenCalled();
  });

  it("rethrows non-Error readiness failures without hiding the original value", async () => {
    const obsManager = {
      isReady: createMockFn().mockRejectedValue("readinessStringFailure"),
    };

    const operation = createMockFn<[], Promise<unknown>>(async () => undefined);

    await expect(
      safeOBSOperation(obsManager, operation, "String readiness failure"),
    ).rejects.toBe("readinessStringFailure");
    expect(operation).not.toHaveBeenCalled();
  });

  it("returns operation result when successful", async () => {
    const obsManager = {
      isReady: createMockFn().mockResolvedValue(true),
    };

    const operation = createMockFn().mockResolvedValue({
      success: true,
      data: "testData",
    });
    const result = await safeOBSOperation(
      obsManager,
      operation,
      "Success test",
    );

    expect(result).toEqual({ success: true, data: "testData" });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("executes operation when OBS is ready", async () => {
    const obsManager = {
      isReady: createMockFn().mockResolvedValue(true),
    };

    const operation = createMockFn().mockResolvedValue("completed");
    await safeOBSOperation(obsManager, operation, "Execute test");

    expect(obsManager.isReady).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
