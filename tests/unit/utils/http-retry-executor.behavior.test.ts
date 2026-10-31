import { vi, afterEach, describe, expect, test } from 'bun:test';
import { HttpRetryExecutor } from "../../../src/utils/http-retry-executor";

import { noOpLogger } from "../../helpers/mock-factories";
import testClock from "../../helpers/test-clock";

const transportError = (message: string, code = "ECONNRESET") =>
  Object.assign(new Error(message), { code });

describe("HttpRetryExecutor", () => {
  afterEach(() => {
    testClock.useRealTime();
  });

  test("sanitizes retry warning text and scope without changing attempts or rejection identity", async () => {
    const messages: string[] = [];
    const logger = { ...noOpLogger, warn: (message: string, scope?: string) => { messages.push(message, scope ?? ""); }, info: (message: string, scope?: string) => { messages.push(message, scope ?? ""); } };
    const delay = vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined);
    const executor = new HttpRetryExecutor({ logger, safeDelay: delay });
    const failure = transportError("Failed https://synthetic.example.invalid/path?client_secret=synthetic-error-secret Authorization: Bearer synthetic-bearer");
    const call = vi.fn<(...args: []) => Promise<unknown>>().mockRejectedValue(failure);
    await expect(executor.executeWithRetry("https://synthetic.example.invalid/scope?access_token=synthetic-scope-secret", call, 2)).rejects.toBe(failure);
    expect(call).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(messages.join("\n")).toContain("attempt 1");
    for (const secret of ["synthetic-error-secret", "synthetic-bearer", "synthetic-scope-secret"]) expect(messages.join("\n")).not.toContain(secret);
  });

  test("retries known transport failures but not unknown statusless errors", async () => {
    const delay = vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined);
    const executor = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: delay });
    const transportFailure = vi.fn<(...args: []) => Promise<string>>()
      .mockRejectedValueOnce(transportError("connection reset"))
      .mockResolvedValueOnce("recovered");
    const unknownFailure = vi.fn<(...args: []) => Promise<string>>()
      .mockRejectedValue(new TypeError("invalid response mapping"));

    await expect(executor.executeWithRetry("transport", transportFailure, 3)).resolves.toBe("recovered");
    await expect(executor.executeWithRetry("programming", unknownFailure, 3)).rejects.toThrow("invalid response mapping");

    expect(transportFailure).toHaveBeenCalledTimes(2);
    expect(unknownFailure).toHaveBeenCalledTimes(1);
  });

  test("uses invocation-local total-attempt budgets", async () => {
    const delay = vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined);
    const executor = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: delay });
    const first = vi.fn<(...args: []) => Promise<unknown>>().mockRejectedValue(transportError("first"));
    const second = vi.fn<(...args: []) => Promise<unknown>>().mockRejectedValue(transportError("second"));

    await expect(executor.executeWithRetry("first", first, 2)).rejects.toThrow("first");
    await expect(executor.executeWithRetry("second", second, 2)).rejects.toThrow("second");

    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
  });

  test("uses a bounded three-attempt default", async () => {
    const executor = new HttpRetryExecutor({
      logger: noOpLogger,
      safeDelay: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
    });
    const call = vi.fn<(...args: []) => Promise<unknown>>().mockRejectedValue(transportError("offline"));

    await expect(executor.executeWithRetry("default", call)).rejects.toThrow("offline");

    expect(call).toHaveBeenCalledTimes(3);
  });

  test("retries transient HTTP statuses but not terminal statuses", async () => {
    const executor = new HttpRetryExecutor({
      logger: noOpLogger,
      safeDelay: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
    });

    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      const call = vi.fn<(...args: []) => Promise<unknown>>()
        .mockRejectedValueOnce({ response: { status } })
        .mockResolvedValueOnce("recovered");
      await expect(executor.executeWithRetry("transient", call, 2)).resolves.toBe("recovered");
      expect(call).toHaveBeenCalledTimes(2);
    }

    for (const status of [400, 401, 403, 404, 422]) {
      const error = { response: { status } };
      const call = vi.fn<(...args: []) => Promise<unknown>>().mockRejectedValue(error);
      await expect(executor.executeWithRetry("terminal", call, 3)).rejects.toBe(error);
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  test("does not retry cancellation errors", async () => {
    const delay = vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined);
    const executor = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: delay });
    const call = vi.fn<(...args: []) => Promise<unknown>>()
      .mockRejectedValue(Object.assign(new Error("cancelled"), { code: "ERR_CANCELED" }));

    await expect(executor.executeWithRetry("cancelled", call, 3)).rejects.toThrow("cancelled");

    expect(call).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  test("honors rate-limit minimum delay headers", async () => {
    const delay = vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined);
    const executor = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: delay });
    const retryAfter = vi.fn<(...args: []) => Promise<unknown>>()
      .mockRejectedValueOnce({ response: { status: 429, headers: { "retry-after": "2" } } })
      .mockResolvedValueOnce("retry-after");
    const capped = vi.fn<(...args: []) => Promise<unknown>>()
      .mockRejectedValueOnce({ response: { status: 429, headers: { "retry-after": "120" } } })
      .mockResolvedValueOnce("capped");

    await expect(executor.executeWithRetry("retry-after", retryAfter, 2)).resolves.toBe("retry-after");
    await expect(executor.executeWithRetry("capped", capped, 2)).resolves.toBe("capped");

    expect(delay.mock.calls.some(([milliseconds]) => milliseconds === 2000)).toBe(true);
    expect(delay.mock.calls.some(([milliseconds]) => milliseconds === 120000)).toBe(true);
  });

  test("honors Retry-After dates, reset epochs, and immediate retry", async () => {
    const now = testClock.now();
    const delay = vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined);
    const executor = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: delay });
    const cases = [
      { headers: { "retry-after": new Date(now + 3000).toUTCString() }, minimum: 2800 },
      { headers: { "ratelimit-reset": String(Math.ceil((now + 4000) / 1000)) }, minimum: 3800 },
      { headers: { get: () => "0" }, expected: 0 },
    ];

    for (const { headers, expected, minimum } of cases) {
      delay.mockClear();
      const call = vi.fn<(...args: []) => Promise<unknown>>()
        .mockRejectedValueOnce({ response: { status: 429, headers } })
        .mockResolvedValueOnce("ok");
      await expect(executor.executeWithRetry("rate-limit", call, 2)).resolves.toBe("ok");
      const observedDelay = delay.mock.calls.at(-1)?.[0] as number | undefined;
      if (minimum !== undefined) expect(observedDelay).toBeGreaterThanOrEqual(minimum);
      else expect(observedDelay ?? 0).toBe(expected);
    }
  });
});
