import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { ADAPTIVE_RETRY_CONFIG, RetrySystem } from "../../../src/utils/retry-system";

describe("Timeout NaN Warning Fix", () => {
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleError: typeof console.error;
  let consoleWarnings: string[];
  let consoleErrors: string[];
  let retrySystem: RetrySystem | undefined;

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

  });

  afterEach(() => {
    retrySystem?.dispose();
    retrySystem = undefined;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  describe("Retry System NaN Timeout", () => {
    test("should handle invalid BACKOFF_MULTIPLIER resulting in NaN", () => {

      const originalMultiplier = ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER;
      Object.defineProperty(ADAPTIVE_RETRY_CONFIG, "BACKOFF_MULTIPLIER", {
        configurable: true,
        value: undefined,
      });

      try {
        retrySystem = new RetrySystem();
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

    test.each(["YouTube", "TikTok"])("schedules a finite positive %s retry delay and disposes the timer", (platform) => {
      const schedule = spyOn(globalThis, "setTimeout");
      const clear = spyOn(globalThis, "clearTimeout");
      try {
        retrySystem = new RetrySystem();
        retrySystem.handleConnectionError(platform, new Error("Connection failed"), async () => {});
        expect(schedule).toHaveBeenCalled();
        const delay = schedule.mock.calls.at(-1)?.[1];
        expect(typeof delay).toBe("number");
        expect(Number.isFinite(delay)).toBe(true);
        expect(delay).toBeGreaterThan(0);
        retrySystem.dispose();
        expect(clear).toHaveBeenCalled();
      } finally {
        retrySystem?.dispose();
        schedule.mockRestore();
        clear.mockRestore();
      }
    });

  });

});
