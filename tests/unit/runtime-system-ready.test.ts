import { vi, describe, expect, it, afterEach } from 'bun:test';

import {
  useFakeTimers,
  useRealTimers,
  getTimerCount,
} from "../helpers/bun-timers";
import { noOpLogger } from "../helpers/mock-factories";
import { AppRuntime } from "../../src/runtime/AppRuntime";

describe("AppRuntime system readiness payload", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useRealTimers();
  });

  const createAppRuntimeDouble = () => {
    const bot = Object.create(AppRuntime.prototype);
    bot.eventBus = null;
    bot.getReadyServices = vi.fn<(...args: unknown[]) => string[]>().mockReturnValue([
      "notificationManager",
      "platformLifecycleService",
    ]);
    bot.logger = noOpLogger;
    return bot;
  };

  it("omits monitoring metrics when building system readiness payload", () => {
    const runtime = createAppRuntimeDouble();
    runtime.platformLifecycleService = {
      getStatus: vi.fn<(...args: unknown[]) => { initializedPlatforms: string[]; }>().mockReturnValue({
        initializedPlatforms: ["twitch"],
      }),
    };
    runtime.commandCooldownService = {
      getStatus: vi.fn<(...args: unknown[]) => { activeUsers: number; }>().mockReturnValue({ activeUsers: 3 }),
    };

    const payload = runtime.emitSystemReady({
      correlationId: "test-startup-1",
    });

    expect(payload).toEqual(
      expect.objectContaining({
        services: ["notificationManager", "platformLifecycleService"],
        platforms: { initializedPlatforms: ["twitch"] },
        cooldowns: { activeUsers: 3 },
        correlationId: "test-startup-1",
      }),
    );
    expect(payload.monitoring).toBeUndefined();
  });

  it("builds readiness payload without EventBus", () => {
    const runtime = createAppRuntimeDouble();
    runtime.eventBus = null;

    const payload = runtime.emitSystemReady({ correlationId: "test-noop" });
    expect(payload).toEqual(
      expect.objectContaining({
        services: ["notificationManager", "platformLifecycleService"],
        correlationId: "test-noop",
      }),
    );
  });

  it("marks readiness as degraded when platform lifecycle status reports failures", () => {
    const runtime = createAppRuntimeDouble();
    const emitCalls: unknown[][] = [];
    runtime.eventBus = {
      emit: (...args: unknown[]) => emitCalls.push(args),
    };
    runtime.platformLifecycleService = {
      getStatus: vi.fn<(...args: unknown[]) => { failedPlatforms: { name: string; lastError: string; }[]; platformHealth: { twitch: { state: string; lastError: string; }; }; }>().mockReturnValue({
        failedPlatforms: [{ name: "twitch", lastError: "auth failed" }],
        platformHealth: {
          twitch: { state: "failed", lastError: "auth failed" },
        },
      }),
    };

    const payload = runtime.emitSystemReady({
      correlationId: "test-degraded-ready",
    });

    expect(payload).toEqual(
      expect.objectContaining({
        correlationId: "test-degraded-ready",
        degraded: true,
        degradationReasons: expect.arrayContaining([
          "platform-initialization-failed",
        ]),
      }),
    );
    expect(emitCalls).toEqual([["system:ready", payload]]);
  });
});

describe("AppRuntime shutdown lifecycle", () => {
  const createAppRuntimeDouble = () => {
    const bot = Object.create(AppRuntime.prototype);
    bot.eventBus = { emit: vi.fn<(...args: unknown[]) => unknown>() };
    bot.logger = noOpLogger;
    bot.dependencies = { onShutdownComplete: vi.fn<(...args: unknown[]) => unknown>() };
    return bot;
  };

  for (const restartRequested of [false, true]) {
    it(`emits shutdown before notifying composition with restart ${restartRequested}`, async () => {
      useFakeTimers();
      const runtime = createAppRuntimeDouble();
      const events: unknown[][] = [];
      runtime.eventBus.emit = (...args: unknown[]) => events.push(args);
      runtime.dependencies.onShutdownComplete = () => events.push(["complete"]);
      const exitCode = process.exitCode;
      try {
        await runtime.emitSystemShutdown({ reason: "synthetic-shutdown", restartRequested });
        expect(events).toEqual([
          ["system:shutdown", { reason: "synthetic-shutdown", mode: restartRequested ? "restart" : "exit" }],
          ["complete"],
        ]);
        expect(getTimerCount()).toBe(0);
        expect(process.exitCode).toBe(exitCode);
      } finally {
        process.exitCode = exitCode;
        useRealTimers();
      }
    });
  }

  it("notifies composition only after the log flush settles", async () => {
    const runtime = createAppRuntimeDouble();
    const flush = Promise.withResolvers<void>();
    runtime.logger = { ...noOpLogger, flush: () => flush.promise };
    const pending = runtime.emitSystemShutdown({ reason: "synthetic-flush" });
    expect(runtime.dependencies.onShutdownComplete).not.toHaveBeenCalled();
    flush.resolve();
    await pending;
    expect(runtime.dependencies.onShutdownComplete).toHaveBeenCalledTimes(1);
  });

  it("invokes viewer count status cleanup during shutdown", async () => {
    const runtime = createAppRuntimeDouble();
    const cleanupCalls: string[] = [];
    runtime.platformLifecycleService = { disconnectAll: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined) };
    runtime.obsEventService = { disconnect: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined) };
    runtime.platformEventRouter = { dispose: vi.fn<(...args: unknown[]) => unknown>() };
    runtime.viewerCountSystem = { stopPolling: vi.fn<(...args: unknown[]) => unknown>() };
    runtime.notificationManager = { stopSuppressionCleanup: vi.fn<(...args: unknown[]) => unknown>() };
    runtime.viewerCountStatusCleanup = () => cleanupCalls.push("cleanup");
    await runtime.shutdown();
    expect(cleanupCalls).toEqual(["cleanup"]);
    expect(runtime.dependencies.onShutdownComplete).toHaveBeenCalledTimes(1);
  });
});
