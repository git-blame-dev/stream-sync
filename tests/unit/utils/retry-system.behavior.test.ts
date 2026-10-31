import { vi, describe, expect, beforeEach, it, afterEach } from 'bun:test';

import { noOpLogger } from "../../helpers/mock-factories";
import {
  RetrySystem,
  ADAPTIVE_RETRY_CONFIG,
} from "../../../src/utils/retry-system";
import { PlatformErrorHandler } from "../../../src/utils/platform-error-handler";
import testClock from "../../helpers/test-clock";
type RetryDependencies = NonNullable<ConstructorParameters<typeof RetrySystem>[0]>;
type MockPlatformErrorHandler = PlatformErrorHandler & {
  handleEventProcessingError: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
  logOperationalError: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
};
type MutableAdaptiveRetryConfig = {
  -readonly [Key in keyof typeof ADAPTIVE_RETRY_CONFIG]: number;
};

let mockSafeSetTimeout: NonNullable<RetryDependencies["safeSetTimeout"]> & ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
let mockValidateTimeout: NonNullable<RetryDependencies["validateTimeout"]> & ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
let mockValidateExponentialBackoff: NonNullable<RetryDependencies["validateExponentialBackoff"]> & ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;

const createTimeoutMocks = () => {
  mockSafeSetTimeout = vi.fn((fn: () => void) => {
    fn();
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as NonNullable<RetryDependencies["safeSetTimeout"]> & ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
  mockValidateTimeout = vi.fn((delay: number) => delay) as unknown as NonNullable<RetryDependencies["validateTimeout"]> & ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
  mockValidateExponentialBackoff = vi.fn(
    (base: number, multiplier: number, retry: number, max: number) => {
      const calculated = base * Math.pow(multiplier, retry);
      return calculated > max ? max : calculated;
    },
  ) as unknown as NonNullable<RetryDependencies["validateExponentialBackoff"]> & ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;

  return {
    safeSetTimeout: mockSafeSetTimeout,
    validateTimeout: mockValidateTimeout,
    validateExponentialBackoff: mockValidateExponentialBackoff,
  };
};

describe("RetrySystem", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    testClock.useRealTime();
  });

  beforeEach(() => {
    testClock.reset();
    createTimeoutMocks();
  });

  function createMockErrorHandler(): MockPlatformErrorHandler {
    return {
      handleEventProcessingError: vi.fn<(...args: unknown[]) => unknown>(),
      logOperationalError: vi.fn<(...args: unknown[]) => unknown>(),
    } as unknown as MockPlatformErrorHandler;
  }

  it("stops retries on authorization errors and cleans up state", () => {
    const timeoutMocks = createTimeoutMocks();
    const retrySystem = new RetrySystem({
      logger: noOpLogger,
      ...timeoutMocks,
    });
    retrySystem.errorHandler = createMockErrorHandler();
    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);
    const cleanup = vi.fn<(...args: unknown[]) => unknown>();
    let observedConnectionState:
      | {
          platformName: string;
          connected: boolean;
          metadata: unknown;
          ready: boolean;
        }
      | null = null;
    const setState = (
      platformName: string,
      connected: boolean,
      metadata: unknown,
      ready: boolean,
    ) => {
      observedConnectionState = {
        platformName,
        connected,
        metadata,
        ready,
      };
    };

    retrySystem.handleConnectionError(
      "Twitch",
      new Error("401 Unauthorized"),
      reconnect,
      cleanup,
      setState,
    );

    expect(cleanup).toHaveBeenCalled();
    expect(observedConnectionState as unknown).toEqual({
      platformName: "Twitch",
      connected: false,
      metadata: null,
      ready: false,
    });
    expect(reconnect).not.toHaveBeenCalled();
    expect(mockSafeSetTimeout).not.toHaveBeenCalled();
  });

  it("continues gracefully when connection state reset throws during auth failure", () => {
    const timeoutMocks = createTimeoutMocks();
    const retrySystem = new RetrySystem({
      logger: noOpLogger,
      ...timeoutMocks,
    });
    retrySystem.errorHandler = createMockErrorHandler();
    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);
    const cleanup = vi.fn<(...args: unknown[]) => unknown>();
    const setState = vi.fn(() => {
      throw new Error("state reset failed");
    });

    expect(() =>
      retrySystem.handleConnectionError(
        "Twitch",
        new Error("401 Unauthorized"),
        reconnect,
        cleanup,
        setState,
      ),
    ).not.toThrow();
    expect(cleanup).toHaveBeenCalled();
    expect(setState).toHaveBeenCalled();
    expect(mockSafeSetTimeout).not.toHaveBeenCalled();
  });

  it("schedules reconnect with adaptive delay and executes reconnect when not connected", async () => {
    const timeoutMocks = createTimeoutMocks();
    const retrySystem = new RetrySystem({
      logger: noOpLogger,
      ...timeoutMocks,
    });
    retrySystem.errorHandler = createMockErrorHandler();
    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);

    retrySystem.handleConnectionError(
      "TikTok",
      new Error("temporary failure"),
      reconnect,
    );
    await Promise.resolve();

    expect(mockValidateTimeout).toHaveBeenCalled();
    expect(mockSafeSetTimeout).toHaveBeenCalled();
    expect(reconnect).toHaveBeenCalled();
  });

  it("continues scheduled reconnect when state reset throws inside scheduler", async () => {
    const timeoutMocks = createTimeoutMocks();
    const retrySystem = new RetrySystem({
      logger: noOpLogger,
      ...timeoutMocks,
    });
    retrySystem.errorHandler = createMockErrorHandler();
    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);
    retrySystem.isConnected = vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(false);

    retrySystem.handleConnectionError(
      "TikTok",
      new Error("temporary failure"),
      reconnect,
      null,
      () => {
        throw new Error("state error");
      },
    );
    await Promise.resolve();

    expect(reconnect).toHaveBeenCalled();
  });

  it("halts scheduled reconnects after exceeding max retries", async () => {
    const retrySystem = new RetrySystem({
      logger: noOpLogger,
      constants: { RETRY_MAX_ATTEMPTS: 10 },
    });
    const errorHandler = createMockErrorHandler();
    retrySystem.errorHandler = errorHandler;
    retrySystem.platformRetryCount.TikTok = 10;

    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);
    retrySystem.handleConnectionError("TikTok", new Error("fail"), reconnect);
    await Promise.resolve();

    expect(reconnect).not.toHaveBeenCalled();
    expect(retrySystem.platformRetryCount.TikTok).toBeGreaterThanOrEqual(10);
    expect(errorHandler.logOperationalError).toHaveBeenCalled();
  });

  it("halts scheduled reconnects when already over max before increment", async () => {
    const retrySystem = new RetrySystem({
      logger: noOpLogger,
      constants: { RETRY_MAX_ATTEMPTS: 10 },
    });
    const errorHandler = createMockErrorHandler();
    retrySystem.errorHandler = errorHandler;
    retrySystem.platformRetryCount.YouTube = 50;

    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);
    retrySystem.handleConnectionError("YouTube", new Error("fail"), reconnect);
    await Promise.resolve();

    expect(reconnect).not.toHaveBeenCalled();
    expect(errorHandler.logOperationalError).toHaveBeenCalled();
  });

  it("does not cap retries when max attempts is set to zero", async () => {
    const timeoutMocks = createTimeoutMocks();
    const retrySystem = new RetrySystem({
      logger: noOpLogger,
      constants: { RETRY_MAX_ATTEMPTS: 0 },
      ...timeoutMocks,
    });
    retrySystem.errorHandler = createMockErrorHandler();
    retrySystem.platformRetryCount.TikTok = 50;

    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);
    retrySystem.handleConnectionError(
      "TikTok",
      new Error("keep trying"),
      reconnect,
    );
    await Promise.resolve();

    expect(reconnect).toHaveBeenCalled();
    expect(retrySystem.hasExceededMaxRetries("TikTok", 0)).toBe(false);
  });

  it("treats Infinity as unlimited retries", () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger });
    retrySystem.platformRetryCount.YouTube = 999;

    expect(retrySystem.hasExceededMaxRetries("YouTube", Infinity)).toBe(false);
  });

  it("uses configured backoff multiplier for delays", () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger });
    retrySystem.platformRetryCount.TikTok = 0;

    const firstDelay = retrySystem.calculateAdaptiveRetryDelay("TikTok");
    retrySystem.incrementRetryCount("TikTok");
    const secondDelay = retrySystem.calculateAdaptiveRetryDelay("TikTok");

    expect(secondDelay).toBeGreaterThan(firstDelay);
    expect(secondDelay / firstDelay).toBeCloseTo(
      ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER,
      1,
    );
    expect(secondDelay).toBeLessThanOrEqual(ADAPTIVE_RETRY_CONFIG.MAX_DELAY);
  });

  it("waits for async cleanup before scheduling reconnect", async () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger });
    retrySystem.errorHandler = createMockErrorHandler();
    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);
    const cleanup = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);

    retrySystem.handleConnectionError(
      "TikTok",
      new Error("temporary failure"),
      reconnect,
      cleanup,
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(cleanup).toHaveBeenCalled();
  });

  it("does not schedule reconnect after cancellation during async cleanup", async () => {
    let resolveCleanup!: () => void;
    const cleanup = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveCleanup = resolve;
      }),
    );
    const safeSetTimeout = vi.fn(
      () => 1 as unknown as ReturnType<typeof setTimeout>,
    ) as unknown as NonNullable<RetryDependencies["safeSetTimeout"]> & ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
    const retrySystem = new RetrySystem({
      logger: noOpLogger,
      ...createTimeoutMocks(),
      safeSetTimeout,
    });
    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);

    retrySystem.handleConnectionError(
      "TikTok",
      new Error("temporary failure"),
      reconnect,
      cleanup,
    );
    await Promise.resolve();
    retrySystem.cancelConnectionRetry("TikTok");
    resolveCleanup();
    await Promise.resolve();
    await Promise.resolve();

    expect(safeSetTimeout).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it("invalidates a scheduled reconnect callback when cancelled", async () => {
    let scheduledReconnect!: () => Promise<void>;
    const safeSetTimeout = vi.fn((callback: () => Promise<void>) => {
      scheduledReconnect = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as NonNullable<RetryDependencies["safeSetTimeout"]> & ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
    const retrySystem = new RetrySystem({
      logger: noOpLogger,
      ...createTimeoutMocks(),
      safeSetTimeout,
    });
    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);

    retrySystem.handleConnectionError("TikTok", new Error("temporary failure"), reconnect);
    retrySystem.cancelConnectionRetry("TikTok");
    await scheduledReconnect();

    expect(reconnect).not.toHaveBeenCalled();
    expect(retrySystem.getRetryCount("TikTok")).toBe(0);
  });

  it("serializes cleanup before a newer retry generation reconnects", async () => {
    let resolveCleanup!: () => void;
    const cleanup = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveCleanup = resolve;
      }),
    );
    const callbacks: Array<() => Promise<void>> = [];
    const safeSetTimeout = vi.fn((callback: () => Promise<void>) => {
      callbacks.push(callback);
      return callbacks.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as NonNullable<RetryDependencies["safeSetTimeout"]> & ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
    const retrySystem = new RetrySystem({ logger: noOpLogger, ...createTimeoutMocks(), safeSetTimeout });
    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);

    retrySystem.handleConnectionError("TikTok", new Error("first"), reconnect, cleanup);
    retrySystem.handleConnectionError("TikTok", new Error("second"), reconnect, cleanup);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(0);

    resolveCleanup();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(setImmediate);

    expect(callbacks).toHaveLength(1);
    await callbacks[0]!();
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer timer registered when a stale callback runs", async () => {
    const callbacks: Array<() => Promise<void>> = [];
    const safeSetTimeout = vi.fn((callback: () => Promise<void>) => {
      callbacks.push(callback);
      return callbacks.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as NonNullable<RetryDependencies["safeSetTimeout"]> & ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
    const retrySystem = new RetrySystem({ logger: noOpLogger, ...createTimeoutMocks(), safeSetTimeout });
    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);

    retrySystem.handleConnectionError("TikTok", new Error("first"), reconnect);
    retrySystem.handleConnectionError("TikTok", new Error("second"), reconnect);
    await callbacks[0]!();

    expect(retrySystem.retryTimers.TikTok).toBe(2 as unknown as ReturnType<typeof setTimeout>);

    retrySystem.cancelConnectionRetry("TikTok");
    expect(retrySystem.retryTimers.TikTok).toBeUndefined();
  });

  it("observes rejected async cleanup for terminal authorization failures", async () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger, ...createTimeoutMocks() });
    const errorHandler = createMockErrorHandler();
    retrySystem.errorHandler = errorHandler;
    const cleanupError = new Error("async cleanup failed");
    const cleanup = vi.fn<(...args: []) => Promise<unknown>>().mockRejectedValue(cleanupError);

    retrySystem.handleConnectionError(
      "Twitch",
      new Error("401 Unauthorized"),
      vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined),
      cleanup,
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(errorHandler.handleEventProcessingError).toHaveBeenCalledTimes(1);
    expect(errorHandler.handleEventProcessingError.mock.calls[0]?.[0]).toBe(cleanupError);
  });

  it("disposes every scheduled connection retry", async () => {
    const callbacks: Array<() => Promise<void>> = [];
    const safeSetTimeout = vi.fn((callback: () => Promise<void>) => {
      callbacks.push(callback);
      return callbacks.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as NonNullable<RetryDependencies["safeSetTimeout"]> & ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
    const retrySystem = new RetrySystem({
      logger: noOpLogger,
      ...createTimeoutMocks(),
      safeSetTimeout,
    });
    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);
    retrySystem.handleConnectionError("TikTok", new Error("temporary failure"), reconnect);
    retrySystem.handleConnectionError("YouTube", new Error("temporary failure"), reconnect);

    retrySystem.dispose();
    await Promise.all(callbacks.map((callback) => callback()));

    expect(reconnect).not.toHaveBeenCalled();
    expect(retrySystem.retryTimers).toEqual({});
  });

  it("routes cleanup failures through platform error handler helper", async () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger });
    const errorHandler = createMockErrorHandler();
    retrySystem.errorHandler = errorHandler;
    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);
    const cleanupError = new Error("cleanup boom");
    const cleanup = vi.fn(() => {
      throw cleanupError;
    });

    retrySystem.handleConnectionError(
      "TikTok",
      new Error("temporary failure"),
      reconnect,
      cleanup,
    );
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(setImmediate);

    expect(cleanup).toHaveBeenCalled();
    expect(errorHandler.handleEventProcessingError).toHaveBeenCalledTimes(1);
    const [errorArg, eventTypeArg, payloadArg, messageArg, platformArg] =
      errorHandler.handleEventProcessingError.mock.calls[0] ?? [];
    expect(errorArg).toBe(cleanupError);
    expect(eventTypeArg).toBe("cleanup");
    expect(payloadArg).toEqual({ platform: "TikTok" });
    expect(String(messageArg)).toContain("cleanup failed");
    expect(platformArg).toBe("TikTok");
  });

  it("skips scheduled reconnect when already connected", async () => {
    const timeoutMocks = createTimeoutMocks();
    const retrySystem = new RetrySystem({
      logger: noOpLogger,
      ...timeoutMocks,
    });
    retrySystem.errorHandler = createMockErrorHandler();
    const reconnect = vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined);
    retrySystem.isConnected = vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true);

    retrySystem.handleConnectionError(
      "YouTube",
      new Error("random failure"),
      reconnect,
    );
    await Promise.resolve();

    expect(reconnect).not.toHaveBeenCalled();
    expect(retrySystem.isConnected).toHaveBeenCalled();
  });

  it("extracts readable error messages from nested structures", () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger });
    expect(retrySystem.extractErrorMessage("simple")).toBe("simple");
    expect(retrySystem.extractErrorMessage({ message: "oops" })).toBe("oops");
    expect(
      retrySystem.extractErrorMessage({ error: { message: "nested" } }),
    ).toBe("nested");
    expect(
      retrySystem.extractErrorMessage({ errors: [{ message: "array" }] }),
    ).toBe("array");
    expect(retrySystem.extractErrorMessage({ code: 500 })).toContain("500");
  });

  it("clears timers and resets counts on success", () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger });
    retrySystem.retryTimers.Twitch = 123 as unknown as ReturnType<typeof setTimeout>;
    retrySystem.platformRetryCount.Twitch = 3;

    retrySystem.handleConnectionSuccess("Twitch", {}, "reconnect");

    expect(retrySystem.getRetryCount("Twitch")).toBe(0);
    expect(retrySystem.retryTimers.Twitch).toBeUndefined();
  });

  it("routes retry errors through platform error handler helper", () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger });
    const errorHandler = createMockErrorHandler();
    retrySystem.errorHandler = errorHandler;

    retrySystem._handleRetryError(
      "boom",
      new Error("boom"),
      "cleanup",
      "TikTok",
    );

    expect(errorHandler.handleEventProcessingError).toHaveBeenCalled();
  });

  it("logs operational errors when non-Error values are provided", () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger });
    const errorHandler = createMockErrorHandler();
    retrySystem.errorHandler = errorHandler;

    retrySystem._handleRetryError("message-only", null, "retry", "TikTok");

    expect(errorHandler.logOperationalError).toHaveBeenCalledTimes(1);
    const [messageArg, platformArg, payloadArg] =
      errorHandler.logOperationalError.mock.calls[0] ?? [];
    expect(messageArg).toBe("message-only");
    expect(platformArg).toBe("TikTok");
    expect(payloadArg).toEqual({
      eventType: "retry",
      platform: "TikTok",
    });
  });

  it("computes connection retry statistics and honors cap", () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger });
    retrySystem.platformRetryCount.TikTok = 3;

    const stats = retrySystem.getConnectionRetryStatistics();

    expect(stats.TikTok?.count).toBe(3);
    expect(stats.TikTok?.nextDelay).toBeGreaterThan(0);
    expect(stats.TikTok?.totalTime).toBeGreaterThan(0);
    expect(typeof stats.TikTok?.hasExceededMax).toBe("boolean");
  });

  it("calculates total retry time with backoff for monitoring", () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger });
    retrySystem.platformRetryCount.YouTube = 2;

    const totalTime = retrySystem.calculateTotalRetryTime("YouTube");

    expect(totalTime).toBeGreaterThan(0);
    const expected =
      ADAPTIVE_RETRY_CONFIG.BASE_DELAY +
      ADAPTIVE_RETRY_CONFIG.BASE_DELAY *
        ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER;
    expect(totalTime).toBeCloseTo(expected);
  });

  it("calculates zero total retry time when no retries have occurred", () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger });

    expect(retrySystem.calculateTotalRetryTime("TikTok")).toBe(0);
  });

  it("caps total retry time calculation using max delay", () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger });
    retrySystem.platformRetryCount.Twitch = 10;

    const totalTime = retrySystem.calculateTotalRetryTime("Twitch");

    expect(totalTime).toBeGreaterThan(0);
    expect(totalTime).toBeLessThanOrEqual(
      ADAPTIVE_RETRY_CONFIG.MAX_DELAY * retrySystem.platformRetryCount.Twitch,
    );
  });

  it("caps adaptive retry delay at max when count is high", () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger });
    retrySystem.platformRetryCount.YouTube = 50;

    const delay = retrySystem.calculateAdaptiveRetryDelay("YouTube");

    expect(delay).toBeLessThanOrEqual(ADAPTIVE_RETRY_CONFIG.MAX_DELAY);
  });

  it("increments retry count for unknown platform and returns base delay", () => {
    const retrySystem = new RetrySystem({ logger: noOpLogger });

    const delay = retrySystem.incrementRetryCount("Mixer");

    expect(delay).toBeGreaterThan(0);
    expect(retrySystem.getRetryCount("Mixer")).toBe(1);
  });

  it("validates config values with fallback", () => {
    const warnCalled = { value: false };
    const trackingLogger = {
      debug: () => {},
      info: () => {},
      warn: () => {
        warnCalled.value = true;
      },
      error: () => {},
    };
    const retrySystem = new RetrySystem({ logger: trackingLogger });
    const value = retrySystem._validateConfigValue("bad", 5000, "test");

    expect(value).toBe(5000);
    expect(warnCalled.value).toBe(true);
  });

  it("throws when retry configuration is invalid", () => {
    const originalConfig = { ...ADAPTIVE_RETRY_CONFIG };
    (ADAPTIVE_RETRY_CONFIG as MutableAdaptiveRetryConfig).BASE_DELAY = 0;

    try {
      expect(() => new RetrySystem({ logger: noOpLogger })).toThrow(
        "BASE_DELAY must be positive",
      );
    } finally {
      Object.assign(ADAPTIVE_RETRY_CONFIG, originalConfig);
    }
  });

  it("preserves class-based logger prototype methods", () => {
    let debugCalls = 0;

    class PrototypeLogger {
      debug() {
        debugCalls += 1;
      }

      info() {}

      warn() {}

      error() {}
    }

    const logger = new PrototypeLogger();
    const retrySystem = new RetrySystem({ logger });

    expect(retrySystem.calculateAdaptiveRetryDelay("TikTok")).toBeGreaterThan(0);
    expect(Object.getPrototypeOf(retrySystem.logger)).toBe(PrototypeLogger.prototype);
    expect(debugCalls).toBe(0);
  });
});
