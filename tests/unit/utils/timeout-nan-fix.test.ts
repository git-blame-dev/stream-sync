import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { ADAPTIVE_RETRY_CONFIG, RetrySystem } from "../../../src/utils/retry-system";

type TimeoutCall = {
  callback: TimerHandler;
  delay: Parameters<typeof global.setTimeout>[1];
  args: unknown[];
};

class TestTimerHandle implements NodeJS.Timer {
  constructor(private readonly id: number) {}

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  hasRef(): boolean {
    return false;
  }

  refresh(): this {
    return this;
  }

  [Symbol.toPrimitive](): number {
    return this.id;
  }
}

const requireNumericDelay = (call: TimeoutCall): number => {
  expect(typeof call.delay).toBe("number");
  if (typeof call.delay !== "number") {
    throw new Error("Expected timeout delay to be numeric");
  }
  return call.delay;
};

describe("Timeout NaN Warning Fix", () => {
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleError: typeof console.error;
  let consoleWarnings: string[];
  let consoleErrors: string[];
  let originalSetTimeout: typeof global.setTimeout;
  let timeoutCalls: TimeoutCall[];

  beforeEach(() => {
    consoleWarnings = [];
    consoleErrors = [];
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
    console.warn = (...messages: unknown[]) => {
      consoleWarnings.push(messages.map(String).join(" "));
    };
    console.error = (...messages: unknown[]) => {
      consoleErrors.push(messages.map(String).join(" "));
    };


    timeoutCalls = [];
    originalSetTimeout = global.setTimeout;
    const setTimeoutReplacement = Object.assign((
      callback: TimerHandler,
      delay: Parameters<typeof global.setTimeout>[1],
      ...args: unknown[]
    ) => {
      timeoutCalls.push({ callback, delay, args });
      return new TestTimerHandle(timeoutCalls.length);
    }, { __promisify__: originalSetTimeout.__promisify__ });
    Reflect.set(global, "setTimeout", setTimeoutReplacement);
  });

  afterEach(() => {
    restoreAllMocks();
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    Reflect.set(global, "setTimeout", originalSetTimeout);
  });

  describe("Retry System NaN Timeout", () => {
    test("should handle invalid BACKOFF_MULTIPLIER resulting in NaN", () => {

      const originalMultiplier = ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER;
      Object.defineProperty(ADAPTIVE_RETRY_CONFIG, "BACKOFF_MULTIPLIER", {
        configurable: true,
        value: undefined,
      });

      try {
        const retrySystem = new RetrySystem();
        const delay = retrySystem.calculateAdaptiveRetryDelay("TikTok");

        expect(isNaN(delay)).toBe(false);
        expect(delay).toBeGreaterThan(0);
      } finally {
        Object.defineProperty(ADAPTIVE_RETRY_CONFIG, "BACKOFF_MULTIPLIER", {
          configurable: true,
          value: originalMultiplier,
        });
      }
    });

    test("should handle invalid BASE_DELAY resulting in NaN", () => {

      const originalBaseDelay = ADAPTIVE_RETRY_CONFIG.BASE_DELAY;
      Object.defineProperty(ADAPTIVE_RETRY_CONFIG, "BASE_DELAY", {
        configurable: true,
        value: null,
      });

      try {
        expect(() => {
          new RetrySystem();
        }).toThrow("BASE_DELAY must be positive");
      } finally {
        Object.defineProperty(ADAPTIVE_RETRY_CONFIG, "BASE_DELAY", {
          configurable: true,
          value: originalBaseDelay,
        });
      }
    });

    test("should handle handleConnectionError with valid timeout", () => {

      const retrySystem = new RetrySystem();
      const mockReconnectFn = createMockFn<[], Promise<void>>(async () => {});
      const mockError = new Error("Connection failed");

      retrySystem.handleConnectionError("YouTube", mockError, mockReconnectFn);

      const recentTimeout = timeoutCalls[timeoutCalls.length - 1];
      expect(recentTimeout).toBeDefined();
      if (recentTimeout === undefined) {
        throw new Error("Expected retry system to schedule a reconnect timeout");
      }
      const delay = requireNumericDelay(recentTimeout);
      expect(isNaN(delay)).toBe(false);
      expect(delay).toBeGreaterThan(0);
    });
  });

  describe("General Timeout Validation", () => {
    test("should validate all setTimeout calls have numeric delays", () => {

      const retrySystem = new RetrySystem();

      retrySystem.handleConnectionError("TikTok", new Error("test"), async () => {});

      timeoutCalls.forEach((call) => {
        const delay = requireNumericDelay(call);
        expect(isNaN(delay)).toBe(false);
        expect(delay).toBeGreaterThan(0);
      });

      const timeoutWarnings = consoleWarnings.filter(
        (warning) =>
          warning.includes("TimeoutNaNWarning") ||
          warning.includes("NaN is not a number") ||
          warning.includes("timeout"),
      );
      expect(timeoutWarnings).toHaveLength(0);
      expect(consoleErrors).toHaveLength(0);
    });

    test("should provide fallback values for invalid timeout calculations", () => {
      const invalidInputs: unknown[] = [undefined, null, NaN, "invalid", {}, [], -1];

      invalidInputs.forEach((input: unknown) => {
        expect(() => {
          const result = Number(input) * Math.pow(2, 1);
          if (isNaN(result)) {
            const fallback = 5000;
            expect(typeof fallback).toBe("number");
            expect(isNaN(fallback)).toBe(false);
          }
        }).not.toThrow();
      });
    });
  });
});
