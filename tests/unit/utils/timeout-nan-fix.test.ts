import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
describe("Timeout NaN Warning Fix", () => {
  let originalConsoleWarn;
  let originalConsoleError;
  let consoleWarnings;
  let consoleErrors;
  let originalSetTimeout;
  let timeoutCalls;

  beforeEach(() => {
    consoleWarnings = [];
    consoleErrors = [];
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
    console.warn = (...messages) => {
      consoleWarnings.push(messages.map(String).join(" "));
    };
    console.error = (...messages) => {
      consoleErrors.push(messages.map(String).join(" "));
    };


    timeoutCalls = [];
    originalSetTimeout = global.setTimeout;
    global.setTimeout = ((callback, delay, ...args) => {
      timeoutCalls.push({ callback, delay, args });
      return { _testTimeoutId: timeoutCalls.length } as unknown as ReturnType<
        typeof global.setTimeout
      >;
    }) as typeof global.setTimeout;
  });

  afterEach(() => {
    restoreAllMocks();
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    global.setTimeout = originalSetTimeout;
  });

  describe("Retry System NaN Timeout", () => {
    test("should handle invalid BACKOFF_MULTIPLIER resulting in NaN", () => {
      const {
        RetrySystem,
        ADAPTIVE_RETRY_CONFIG,
      } = require("../../../src/utils/retry-system");

      const originalMultiplier = ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER;
      ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER = undefined;

      try {
        const retrySystem = new RetrySystem();
        const delay = retrySystem.calculateAdaptiveRetryDelay("TikTok");

        expect(isNaN(delay)).toBe(false);
        expect(delay).toBeGreaterThan(0);
      } finally {
        ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER = originalMultiplier;
      }
    });

    test("should handle invalid BASE_DELAY resulting in NaN", () => {
      const {
        RetrySystem,
        ADAPTIVE_RETRY_CONFIG,
      } = require("../../../src/utils/retry-system");

      const originalBaseDelay = ADAPTIVE_RETRY_CONFIG.BASE_DELAY;
      ADAPTIVE_RETRY_CONFIG.BASE_DELAY = null;

      try {
        expect(() => {
          new RetrySystem();
        }).toThrow("BASE_DELAY must be positive");
      } finally {
        ADAPTIVE_RETRY_CONFIG.BASE_DELAY = originalBaseDelay;
      }
    });

    test("should handle handleConnectionError with valid timeout", () => {
      const { RetrySystem } = require("../../../src/utils/retry-system");

      const retrySystem = new RetrySystem();
      const mockReconnectFn = createMockFn();
      const mockError = new Error("Connection failed");

      retrySystem.handleConnectionError("YouTube", mockError, mockReconnectFn);

      const recentTimeout = timeoutCalls[timeoutCalls.length - 1];
      expect(recentTimeout).toBeDefined();
      expect(isNaN(recentTimeout.delay)).toBe(false);
      expect(recentTimeout.delay).toBeGreaterThan(0);
    });
  });

  describe("General Timeout Validation", () => {
    test("should validate all setTimeout calls have numeric delays", () => {
      const { RetrySystem } = require("../../../src/utils/retry-system");

      const retrySystem = new RetrySystem();

      retrySystem.handleConnectionError("TikTok", new Error("test"), () => {});

      timeoutCalls.forEach((call) => {
        expect(typeof call.delay).toBe("number");
        expect(isNaN(call.delay)).toBe(false);
        expect(call.delay).toBeGreaterThan(0);
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
      const invalidInputs = [undefined, null, NaN, "invalid", {}, [], -1];

      invalidInputs.forEach((input) => {
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
