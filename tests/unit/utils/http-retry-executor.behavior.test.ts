import { afterEach, describe, expect, test } from "bun:test";
import { HttpRetryExecutor } from "../../../src/utils/http-retry-executor";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import testClock from "../../helpers/test-clock";

const transportError = (message: string, code = "ECONNRESET") =>
  Object.assign(new Error(message), { code });

describe("HttpRetryExecutor", () => {
  afterEach(() => {
    testClock.useRealTime();
  });

  test("retries known transport failures but not unknown statusless errors", async () => {
    const delay = createMockFn().mockResolvedValue(undefined);
    const executor = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: delay });
    const transportFailure = createMockFn<[], Promise<string>>()
      .mockRejectedValueOnce(transportError("connection reset"))
      .mockResolvedValueOnce("recovered");
    const unknownFailure = createMockFn<[], Promise<string>>()
      .mockRejectedValue(new TypeError("invalid response mapping"));

    await expect(executor.executeWithRetry("transport", transportFailure, 3)).resolves.toBe("recovered");
    await expect(executor.executeWithRetry("programming", unknownFailure, 3)).rejects.toThrow("invalid response mapping");

    expect(transportFailure).toHaveBeenCalledTimes(2);
    expect(unknownFailure).toHaveBeenCalledTimes(1);
  });

  test("uses invocation-local total-attempt budgets", async () => {
    const delay = createMockFn().mockResolvedValue(undefined);
    const executor = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: delay });
    const first = createMockFn<[], Promise<unknown>>().mockRejectedValue(transportError("first"));
    const second = createMockFn<[], Promise<unknown>>().mockRejectedValue(transportError("second"));

    await expect(executor.executeWithRetry("first", first, 2)).rejects.toThrow("first");
    await expect(executor.executeWithRetry("second", second, 2)).rejects.toThrow("second");

    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
  });

  test("uses a bounded three-attempt default", async () => {
    const executor = new HttpRetryExecutor({
      logger: noOpLogger,
      safeDelay: createMockFn().mockResolvedValue(undefined),
    });
    const call = createMockFn<[], Promise<unknown>>().mockRejectedValue(transportError("offline"));

    await expect(executor.executeWithRetry("default", call)).rejects.toThrow("offline");

    expect(call).toHaveBeenCalledTimes(3);
  });

  test("retries transient HTTP statuses but not terminal statuses", async () => {
    const executor = new HttpRetryExecutor({
      logger: noOpLogger,
      safeDelay: createMockFn().mockResolvedValue(undefined),
    });

    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      const call = createMockFn<[], Promise<unknown>>()
        .mockRejectedValueOnce({ response: { status } })
        .mockResolvedValueOnce("recovered");
      await expect(executor.executeWithRetry("transient", call, 2)).resolves.toBe("recovered");
      expect(call).toHaveBeenCalledTimes(2);
    }

    for (const status of [400, 401, 403, 404, 422]) {
      const error = { response: { status } };
      const call = createMockFn<[], Promise<unknown>>().mockRejectedValue(error);
      await expect(executor.executeWithRetry("terminal", call, 3)).rejects.toBe(error);
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  test("does not retry cancellation errors", async () => {
    const delay = createMockFn().mockResolvedValue(undefined);
    const executor = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: delay });
    const call = createMockFn<[], Promise<unknown>>()
      .mockRejectedValue(Object.assign(new Error("cancelled"), { code: "ERR_CANCELED" }));

    await expect(executor.executeWithRetry("cancelled", call, 3)).rejects.toThrow("cancelled");

    expect(call).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  test("honors and caps rate-limit delay headers", async () => {
    const delay = createMockFn().mockResolvedValue(undefined);
    const executor = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: delay });
    const retryAfter = createMockFn<[], Promise<unknown>>()
      .mockRejectedValueOnce({ response: { status: 429, headers: { "retry-after": "2" } } })
      .mockResolvedValueOnce("retry-after");
    const capped = createMockFn<[], Promise<unknown>>()
      .mockRejectedValueOnce({ response: { status: 429, headers: { "retry-after": "120" } } })
      .mockResolvedValueOnce("capped");

    await expect(executor.executeWithRetry("retry-after", retryAfter, 2)).resolves.toBe("retry-after");
    await expect(executor.executeWithRetry("capped", capped, 2)).resolves.toBe("capped");

    expect(delay.mock.calls.some(([milliseconds]) => milliseconds === 2000)).toBe(true);
    expect(delay.mock.calls.some(([milliseconds]) => milliseconds === 60000)).toBe(true);
  });

  test("honors Retry-After dates, reset epochs, and immediate retry", async () => {
    const now = testClock.now();
    const delay = createMockFn().mockResolvedValue(undefined);
    const executor = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: delay });
    const cases = [
      { headers: { "retry-after": new Date(now + 3000).toUTCString() }, minimum: 2800 },
      { headers: { "ratelimit-reset": String(Math.ceil((now + 4000) / 1000)) }, minimum: 3800 },
      { headers: { get: () => "0" }, expected: 0 },
    ];

    for (const { headers, expected, minimum } of cases) {
      delay.mockClear();
      const call = createMockFn<[], Promise<unknown>>()
        .mockRejectedValueOnce({ response: { status: 429, headers } })
        .mockResolvedValueOnce("ok");
      await expect(executor.executeWithRetry("rate-limit", call, 2)).resolves.toBe("ok");
      const observedDelay = delay.mock.calls.at(-1)?.[0] as number | undefined;
      if (minimum !== undefined) expect(observedDelay).toBeGreaterThanOrEqual(minimum);
      else expect(observedDelay ?? 0).toBe(expected);
    }
  });
});
