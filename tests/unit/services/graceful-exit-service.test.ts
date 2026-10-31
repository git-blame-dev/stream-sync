import { type Mock, vi, describe, it, beforeEach, afterEach, expect } from 'bun:test';

import {
  useFakeTimers,
  useRealTimers,
  advanceTimersByTime,
  getTimerCount,
} from "../../helpers/bun-timers";

import { dirname } from "node:path";
import { withNativeChildEnvironment } from "../../helpers/native-child-environment";

import { GracefulExitService } from "../../../src/services/GracefulExitService.ts";

type MockGracefulRuntime = {
  shutdown: Mock<(...args: []) => Promise<void>>;
  getPlatforms: Mock<(...args: []) => Record<string, unknown>>;
};

describe("GracefulExitService", () => {
  let gracefulExitService: GracefulExitService | null;
  let mockAppRuntime: MockGracefulRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    useFakeTimers();

    mockAppRuntime = {
      shutdown: vi.fn<(...args: []) => Promise<void>>().mockResolvedValue(undefined),
      getPlatforms: vi.fn<(...args: []) => Record<string, unknown>>().mockReturnValue({
        tiktok: {},
        twitch: {},
        youtube: {},
      }),
    };

  });

  afterEach(() => {
    if (gracefulExitService && typeof gracefulExitService.stop === "function") {
      gracefulExitService.stop();
    }
    expect(getTimerCount()).toBe(0);
    useRealTimers();
    vi.restoreAllMocks();
    gracefulExitService = null;
  });

  describe("Service Initialization", () => {
    it("should initialize with target message count", () => {
      gracefulExitService = new GracefulExitService(mockAppRuntime, 10);

      expect(gracefulExitService.isEnabled()).toBe(true);
      expect(gracefulExitService.getTargetMessageCount()).toBe(10);
      expect(gracefulExitService.getProcessedMessageCount()).toBe(0);
    });

    it("should be disabled when target message count is null", () => {
      gracefulExitService = new GracefulExitService(mockAppRuntime, null);

      expect(gracefulExitService.isEnabled()).toBe(false);
    });
  });

  describe("Message Counting", () => {
    it("should increment message count when message is processed", () => {
      gracefulExitService = new GracefulExitService(mockAppRuntime, 10);

      gracefulExitService.incrementMessageCount();
      expect(gracefulExitService.getProcessedMessageCount()).toBe(1);

      gracefulExitService.incrementMessageCount();
      expect(gracefulExitService.getProcessedMessageCount()).toBe(2);
    });

    it("should not count messages when service is disabled", () => {
      gracefulExitService = new GracefulExitService(mockAppRuntime, null);

      gracefulExitService.incrementMessageCount();
      expect(gracefulExitService.getProcessedMessageCount()).toBe(0);
    });
  });

  describe("Graceful Exit Trigger", () => {
    it("should trigger graceful exit when target count is reached", async () => {
      gracefulExitService = new GracefulExitService(mockAppRuntime, 3);

      gracefulExitService.incrementMessageCount();
      gracefulExitService.incrementMessageCount();

      const shouldExit = gracefulExitService.incrementMessageCount();

      expect(shouldExit).toBe(true);
      expect(gracefulExitService.getProcessedMessageCount()).toBe(3);
    });

    it("should enter shutdown state when target is reached", async () => {
      gracefulExitService = new GracefulExitService(mockAppRuntime, 2);

      gracefulExitService.incrementMessageCount();
      gracefulExitService.incrementMessageCount();

      const exitPromise = gracefulExitService.triggerExit();

      expect(gracefulExitService.isShuttingDown).toBe(true);

      await exitPromise;
    });

    it("should complete shutdown sequence when exit is triggered", async () => {
      gracefulExitService = new GracefulExitService(mockAppRuntime, 5);

      for (let i = 0; i < 5; i++) {
        gracefulExitService.incrementMessageCount();
      }

      const exitPromise = gracefulExitService.triggerExit();

      expect(gracefulExitService.isShuttingDown).toBe(true);

      await exitPromise;
    });

    it("should not trigger exit before target is reached", () => {
      gracefulExitService = new GracefulExitService(mockAppRuntime, 10);

      let shouldExit = false;
      for (let i = 0; i < 5; i++) {
        shouldExit = gracefulExitService.incrementMessageCount();
      }

      expect(shouldExit).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("clears the force-exit deadline after a successful shutdown retry", async () => {
      const retry = Promise.withResolvers<void>();
      mockAppRuntime.shutdown
        .mockRejectedValueOnce(new Error("Synthetic first shutdown failure"))
        .mockImplementationOnce(() => retry.promise);
      gracefulExitService = new GracefulExitService(mockAppRuntime, 1);
      const exitPromise = gracefulExitService.triggerExit();
      await Promise.resolve();
      expect(mockAppRuntime.shutdown).toHaveBeenCalledTimes(2);

      retry.resolve();
      await exitPromise;

      expect(getTimerCount()).toBe(0);
      advanceTimersByTime(20000);
      expect(getTimerCount()).toBe(0);
    });

    it("stop retires a failed shutdown deadline before resetting timers", async () => {
      mockAppRuntime.shutdown.mockRejectedValue(new Error("Synthetic shutdown failure"));
      gracefulExitService = new GracefulExitService(mockAppRuntime, 1);
      await gracefulExitService.triggerExit();
      expect(getTimerCount()).toBe(1);
      gracefulExitService.stop();
      expect(getTimerCount()).toBe(0);
    });

    it("stop retires the deadline while shutdown is still pending", async () => {
      const pending = Promise.withResolvers<void>();
      mockAppRuntime.shutdown.mockImplementation(() => pending.promise);
      gracefulExitService = new GracefulExitService(mockAppRuntime, 1);
      const shutdown = gracefulExitService.triggerExit();
      expect(getTimerCount()).toBe(1);
      gracefulExitService.stop();
      expect(getTimerCount()).toBe(0);
      pending.resolve();
      await shutdown;
      expect(getTimerCount()).toBe(0);
    });

    it("retains only the original force-exit deadline after both shutdown attempts fail", async () => {
      const firstAttempt = Promise.withResolvers<void>();
      mockAppRuntime.shutdown
        .mockImplementationOnce(() => firstAttempt.promise)
        .mockRejectedValueOnce(new Error("Synthetic retry failure"));
      gracefulExitService = new GracefulExitService(mockAppRuntime, 1);
      const exitPromise = gracefulExitService.triggerExit();
      advanceTimersByTime(4000);
      firstAttempt.reject(new Error("Synthetic first shutdown failure"));
      await exitPromise;

      expect(mockAppRuntime.shutdown).toHaveBeenCalledTimes(2);
      expect(getTimerCount()).toBe(1);
      await gracefulExitService.triggerExit();
      expect(mockAppRuntime.shutdown).toHaveBeenCalledTimes(2);
      advanceTimersByTime(5999);
      expect(getTimerCount()).toBe(1);
      gracefulExitService.stop();
      expect(getTimerCount()).toBe(0);
    });

    it("should handle shutdown errors gracefully", async () => {
      mockAppRuntime.shutdown.mockRejectedValue(new Error("Shutdown failed"));

      gracefulExitService = new GracefulExitService(mockAppRuntime, 1);
      gracefulExitService.incrementMessageCount();

      await gracefulExitService.triggerExit();

      expect(gracefulExitService.isShuttingDown).toBe(true);
    });

    for (const outcome of ["hang", "reject"] as const) {
      it(`uses native process exit when shutdown attempts ${outcome}`, async () => {
        await withNativeChildEnvironment(async (env) => {
          const script = `
            import { GracefulExitService } from ${JSON.stringify(import.meta.resolve("../../../src/services/GracefulExitService.ts"))};
            let attempts = 0;
            const runtime = { shutdown() {
              attempts++;
              process.stdout.write('ATTEMPT:' + attempts + ';');
              return ${outcome === "hang" ? "new Promise(() => {})" : "Promise.reject(new Error('Synthetic shutdown failure'))"};
            } };
            const service = new GracefulExitService(runtime, 1, { forceExitTimeoutMs: 20 });
            void service.triggerExit();
            process.on('exit', code => process.stdout.write('NATIVE_EXIT:' + code));
          `;
          const child = Bun.spawnSync([process.execPath, "--no-env-file", "--eval", script], {
            cwd: dirname(env.CHAT_BOT_CONFIG_PATH!), env, stdout: "pipe", stderr: "pipe", timeout: 5000,
          });
          expect(child.exitCode).toBe(1);
          expect(child.stdout.toString()).toContain("ATTEMPT:1");
          expect(child.stdout.toString().includes("ATTEMPT:2")).toBe(outcome === "reject");
          expect(child.stdout.toString()).toContain("NATIVE_EXIT:1");
        });
      });
    }
  });

  describe("Statistics and Reporting", () => {
    it("should provide current statistics", () => {
      gracefulExitService = new GracefulExitService(mockAppRuntime, 10);

      gracefulExitService.incrementMessageCount();
      gracefulExitService.incrementMessageCount();

      const stats = gracefulExitService.getStats();

      expect(stats).toMatchObject({
        enabled: true,
        processed: 2,
        target: 10,
        remaining: 8,
        percentage: 20,
      });
    });

    it("should indicate when target is close to being reached", () => {
      gracefulExitService = new GracefulExitService(mockAppRuntime, 10);

      for (let i = 0; i < 9; i++) {
        gracefulExitService.incrementMessageCount();
      }

      const stats = gracefulExitService.getStats();

      expect(stats.percentage).toBeGreaterThanOrEqual(90);
      expect(stats.remaining).toBe(1);
    });
  });

  describe("Service Lifecycle", () => {
    it("should clean up resources when stopped", () => {
      const service = new GracefulExitService(mockAppRuntime, 10);
      gracefulExitService = service;

      service.stop();

      expect(() => service.incrementMessageCount()).not.toThrow();
    });
  });
});
