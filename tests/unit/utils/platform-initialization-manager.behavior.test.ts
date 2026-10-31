import { vi, describe, expect, beforeEach, afterEach, it, spyOn } from 'bun:test';

import { noOpLogger } from "../../helpers/mock-factories";
import { PlatformInitializationManager } from "../../../src/utils/platform-initialization-manager.ts";
import { createPlatformErrorHandler } from "../../../src/utils/platform-error-handler.ts";
type InitializationManagerDeps = NonNullable<ConstructorParameters<typeof PlatformInitializationManager>[2]>;
type CreatePlatformErrorHandler = NonNullable<InitializationManagerDeps["createPlatformErrorHandler"]>;
const observations: Array<{ mockRestore(): void }> = [];
function createObservedErrorHandler(...args: Parameters<CreatePlatformErrorHandler>) {
  const handler = createPlatformErrorHandler(...args);
  const processing = spyOn(handler, 'handleEventProcessingError');
  const operational = spyOn(handler, 'logOperationalError');
  observations.push(processing, operational);
  return Object.assign(handler, { handleEventProcessingError: processing, logOperationalError: operational });
}
type ObservedPlatformErrorHandler = ReturnType<typeof createObservedErrorHandler>;
function observedFactory(onCreated: (owner: ObservedPlatformErrorHandler) => void) {
  return vi.fn((...args: Parameters<CreatePlatformErrorHandler>) => {
    const owner = createObservedErrorHandler(...args);
    onCreated(owner);
    return owner;
  });
}
afterEach(() => { for (const observation of observations.splice(0)) observation.mockRestore(); });

describe("PlatformInitializationManager behavior edges", () => {
  let suppliedHandler: ObservedPlatformErrorHandler;
  let observedCreateErrorHandler: ReturnType<typeof observedFactory>;

  beforeEach(() => {
    observedCreateErrorHandler = observedFactory(owner => { suppliedHandler = owner; });
  });

  function createManager(platformName: string, deps: Partial<InitializationManagerDeps> = {}) {
    return new PlatformInitializationManager(platformName, noOpLogger, {
      createPlatformErrorHandler: observedCreateErrorHandler,
      ...deps,
    });
  }

  it("prevents reinitialization unless forced", () => {
    const manager = createManager("twitch");

    expect(manager.beginInitialization()).toBe(true);
    manager.markInitializationSuccess();

    expect(manager.beginInitialization()).toBe(false);
    expect(manager.getStatistics().initializationAttempts).toBe(1);
    manager.configure({ allowReinitialization: true });
    expect(manager.beginInitialization()).toBe(true);
  });

  it("routes initialization errors through platform error handler when max attempts exceeded", () => {
    const manager = createManager("youtube");
    manager.configure({ maxAttempts: 1 });

    expect(manager.beginInitialization()).toBe(true);
    expect(manager.beginInitialization()).toBe(false);
    expect(suppliedHandler.logOperationalError).toHaveBeenCalled();
    expect(manager.getInitializationState()).toMatchObject({
      totalAttempts: 1,
      attempt: 1,
      success: false,
      error: "Maximum initialization attempts (1) exceeded",
    });
  });

  it("routes failures with errors through handleEventProcessingError and records state", () => {
    const manager = createManager("tiktok");

    manager.beginInitialization();
    manager.markInitializationFailure(new Error("boom"), { stage: "connect" });

    const state = manager.getInitializationState();
    expect(state.success).toBe(false);
    expect(state.preventedAttempts).toBe(0);
    expect(suppliedHandler.handleEventProcessingError).toHaveBeenCalled();
  });

  it("allows forced reinitialization even after successes while respecting max attempts", () => {
    const manager = createManager("twitch");
    manager.configure({ allowReinitialization: true, maxAttempts: 2 });

    expect(manager.beginInitialization(true)).toBe(true);
    manager.markInitializationSuccess();

    expect(manager.beginInitialization(true)).toBe(true);
    manager.markInitializationSuccess();

    expect(manager.beginInitialization(true)).toBe(false);
    expect(suppliedHandler.logOperationalError).toHaveBeenCalled();
  });

  it("retains a string failure message without inventing Unknown error", () => {
    const manager = createManager("youtube");

    manager.beginInitialization();
    manager.markInitializationFailure("string failure", { stage: "config" });

    const state = manager.getInitializationState();
    expect(state.success).toBe(false);
    expect(state.stage).toBe("config");
    expect(state.error).toBe("string failure");
    expect(suppliedHandler.logOperationalError).toHaveBeenCalled();
  });

  it("heals corrupted counters and state before beginning initialization", () => {
    const manager = createManager("tiktok");
    manager.initializationAttempts = undefined as unknown as number;
    manager.initializationCount = undefined as unknown as number;
    manager.preventedReinitializations = undefined as unknown as number;
    manager.initializationState = null as unknown as typeof manager.initializationState;

    const shouldProceed = manager.beginInitialization();

    expect(shouldProceed).toBe(true);
    const state = manager.getInitializationState();
    expect(state.totalAttempts).toBe(1);
    expect(state.preventedAttempts).toBe(0);
    expect(state.isInitialized).toBe(false);
  });

  it("tracks failure state and can reset cleanly", () => {
    const manager = createManager("tiktok");

    manager.beginInitialization();
    manager.markInitializationFailure(new Error("fail"), { stage: "config" });

    const stats = manager.getStatistics();
    expect(stats.initializationAttempts).toBe(1);
    expect(stats.isInitialized).toBe(false);
    expect(suppliedHandler.handleEventProcessingError).toHaveBeenCalled();

    manager.reset();
    expect(manager.getStatistics().initializationAttempts).toBe(0);
  });

  it("recreates a missing platform error handler on failure", () => {
    let lazyHandler: ObservedPlatformErrorHandler;
    const observedCreate = observedFactory(owner => { lazyHandler = owner; });
    const manager = new PlatformInitializationManager("twitch", noOpLogger, {
      createPlatformErrorHandler: observedCreate,
    });
    const initialCreateCount = observedCreate.mock.calls.length;
    const firstHandler = manager.errorHandler;
    manager.errorHandler = null;

    manager.beginInitialization();
    manager.markInitializationFailure(new Error("lazy failure"), {
      stage: "lazy",
    });

    expect(observedCreate.mock.calls.length).toBe(initialCreateCount + 1);
    expect(manager.errorHandler).not.toBe(firstHandler);
    expect(manager.errorHandler as unknown).toBe(lazyHandler!);
    expect(lazyHandler!.handleEventProcessingError).toHaveBeenCalled();
  });

  it("records failure and statistics even when already prevented by max attempts", () => {
    const manager = createManager("twitch");
    manager.configure({ maxAttempts: 1 });

    manager.beginInitialization();
    manager.markInitializationFailure(new Error("first fail"), {
      stage: "first",
    });

    expect(manager.beginInitialization()).toBe(false);
    const stats = manager.getStatistics();
    expect(stats.initializationAttempts).toBe(1);
    expect(stats.initializationCount).toBe(0);
    expect(stats.isInitialized).toBe(false);
    expect(suppliedHandler.logOperationalError).toHaveBeenCalled();
  });

  it("allows forced reinitialization even when allowReinitialization is false", () => {
    const manager = createManager("youtube");

    expect(manager.beginInitialization()).toBe(true);
    manager.markInitializationSuccess();

    expect(manager.beginInitialization(true)).toBe(true);
    expect(manager.getStatistics().preventedReinitializations).toBe(0);
  });

  it("ignores invalid maxAttempts configuration", () => {
    const manager = createManager("tiktok");
    manager.configure({ maxAttempts: 0 });

    expect(manager.maxAttempts).toBe(5);
    expect(manager.beginInitialization()).toBe(true);
  });

  it("allows configured reinitialization without forcing after success", () => {
    const manager = createManager("tiktok");
    manager.configure({ allowReinitialization: true, maxAttempts: 2 });

    expect(manager.beginInitialization()).toBe(true);
    manager.markInitializationSuccess();

    expect(manager.beginInitialization()).toBe(true);
    expect(manager.getStatistics().initializationAttempts).toBe(2);
    expect(manager.getStatistics().preventedReinitializations).toBe(0);
  });

  it("tracks prevented attempts in initialization state when skipping reinit", () => {
    const manager = createManager("youtube");

    manager.beginInitialization();
    manager.markInitializationSuccess();

    expect(manager.beginInitialization()).toBe(false);
    const state = manager.getInitializationState();
    expect(state.isInitialized).toBe(true);
    expect(state.preventedAttempts).toBe(1);
    expect(manager.getStatistics().preventedReinitializations).toBe(1);
  });

  it("requires a logger", () => {
    expect(() => new PlatformInitializationManager("tiktok", undefined)).toThrow(
      "PlatformInitializationManager requires a logger",
    );
  });

  it("validates all four logger methods before constructing its error handler", () => {
    let constructed = false;
    expect(() => new PlatformInitializationManager("tiktok", { debug: () => {}, warn: () => {}, error: () => {} }, {
      createPlatformErrorHandler: () => { constructed = true; return suppliedHandler; },
    })).toThrow(/info/);
    expect(constructed).toBe(false);
  });

  it("bounds and sanitizes string failure metadata without serializing provider objects", () => {
    const manager = createManager("tiktok");
    manager.beginInitialization();
    manager.markInitializationFailure(`Authorization: Bearer synthetic-init-secret ${"x".repeat(5000)}`);
    const summary = manager.getInitializationState().error!;
    expect(summary).not.toContain("synthetic-init-secret");
    expect(summary.length).toBeLessThanOrEqual(4096);
    const payload = { toString: () => { throw new Error("Do not stringify provider objects"); } };
    expect(() => manager.markInitializationFailure(payload)).not.toThrow();
    expect(manager.getInitializationState().error).toBe("Unknown error");
    manager.markInitializationFailure({ ...payload, message: "synthetic structured message" });
    expect(manager.getInitializationState().error).toBe("synthetic structured message");
  });

  it("prevents reinitialization after success carrying a disabled-platform marker", () => {
    const manager = createManager("youtube");
    manager.configure({ allowReinitialization: false, maxAttempts: 3 });

    manager.beginInitialization();
    manager.markInitializationSuccess({ enabled: false });

    const proceed = manager.beginInitialization();
    expect(proceed).toBe(false);
    const stats = manager.getStatistics();
    expect(stats.preventedReinitializations).toBe(1);
    expect(stats.isInitialized).toBe(true);
  });

  it("reset clears prevented attempts and state after failures", () => {
    const manager = createManager("twitch");

    manager.beginInitialization();
    manager.markInitializationFailure(new Error("init failed"));
    manager.beginInitialization();
    manager.markInitializationSuccess();

    manager.reset();

    const stats = manager.getStatistics();
    expect(stats.preventedReinitializations).toBe(0);
    expect(stats.initializationAttempts).toBe(0);
    expect(stats.isInitialized).toBe(false);
  });

  it("ignores non-boolean reinit configuration and keeps prevention in place", () => {
    const manager = createManager("youtube");

    manager.configure({ allowReinitialization: "yes" as unknown as boolean, maxAttempts: "ten" as unknown as number });

    expect(manager.allowReinitialization).toBe(false);
    expect(manager.maxAttempts).toBe(5);

    expect(manager.beginInitialization()).toBe(true);
    manager.markInitializationSuccess();

    expect(manager.beginInitialization()).toBe(false);
    expect(manager.getStatistics().preventedReinitializations).toBe(1);
  });

  it("records operational failure when payload is not an Error", () => {
    const manager = createManager("youtube");

    manager.beginInitialization();
    manager.markInitializationFailure(null, { stage: "config" });

    expect(manager.getInitializationState().error).toBe("Unknown error");
    expect(suppliedHandler.logOperationalError).toHaveBeenCalled();
  });

  it("routes failures through a lazily created handler", () => {
    let lazyHandler: ObservedPlatformErrorHandler;
    const observedCreate = observedFactory(owner => { lazyHandler = owner; });
    const manager = new PlatformInitializationManager("twitch", noOpLogger, {
      createPlatformErrorHandler: observedCreate,
    });
    const initialCreateCount = observedCreate.mock.calls.length;
    const firstHandler = manager.errorHandler;
    manager.errorHandler = null;

    manager.beginInitialization();
    manager.markInitializationFailure(new Error("boom"), { stage: "connect" });

    expect(observedCreate.mock.calls.length).toBe(initialCreateCount + 1);
    expect(manager.errorHandler).not.toBe(firstHandler);
    expect(manager.errorHandler as unknown).toBe(lazyHandler!);
    expect(lazyHandler!.handleEventProcessingError).toHaveBeenCalledTimes(1);
    const [errorArg, eventTypeArg, payloadArg, messageArg, platformArg] =
      lazyHandler!.handleEventProcessingError.mock.calls[0] ?? [];
    expect(errorArg).toBeInstanceOf(Error);
    expect(eventTypeArg).toBe("initialization");
    expect(payloadArg).toEqual({ stage: "connect" });
    expect(String(messageArg)).toContain("Initialization failed");
    expect(platformArg).toBe("twitch");
  });

  it("logs operational failures through lazily created handler for non-Error payloads", () => {
    let lazyHandler: ObservedPlatformErrorHandler;
    const observedCreate = observedFactory(owner => { lazyHandler = owner; });
    const manager = new PlatformInitializationManager("youtube", noOpLogger, {
      createPlatformErrorHandler: observedCreate,
    });
    const initialCreateCount = observedCreate.mock.calls.length;
    const firstHandler = manager.errorHandler;
    manager.errorHandler = null;

    manager.beginInitialization();
    manager.markInitializationFailure("string failure", { stage: "nonerror" });

    expect(observedCreate.mock.calls.length).toBe(initialCreateCount + 1);
    expect(manager.errorHandler).not.toBe(firstHandler);
    expect(manager.errorHandler as unknown).toBe(lazyHandler!);
    expect(lazyHandler!.logOperationalError).toHaveBeenCalledTimes(1);
    const [messageArg, platformArg, payloadArg] =
      lazyHandler!.logOperationalError.mock.calls[0] ?? [];
    expect(String(messageArg)).toContain("Initialization failed");
    expect(platformArg).toBe("youtube");
    expect(payloadArg).toEqual({ stage: "nonerror" });
    expect(manager.getInitializationState().error).toBe("string failure");
  });

  it("uses default error-handler context when platform name is missing", () => {
    let lazyHandler: ObservedPlatformErrorHandler;
    const observedCreate = observedFactory(owner => { lazyHandler = owner; });
    const manager = new PlatformInitializationManager(undefined, noOpLogger, {
      createPlatformErrorHandler: observedCreate,
    });
    const initialCreateCount = observedCreate.mock.calls.length;
    const firstHandler = manager.errorHandler;
    manager.errorHandler = null;

    manager.beginInitialization();
    manager.markInitializationFailure(new Error("missing name"), {
      stage: "no-name",
    });

    expect(observedCreate.mock.calls.length).toBe(initialCreateCount + 1);
    expect(manager.errorHandler).not.toBe(firstHandler);
    expect(manager.errorHandler as unknown).toBe(lazyHandler!);
    expect(lazyHandler!.handleEventProcessingError).toHaveBeenCalled();
  });

  it("halts forced reinitialization when max attempts exceeded", () => {
    const manager = createManager("tiktok");
    manager.configure({ allowReinitialization: true, maxAttempts: 2 });

    expect(manager.beginInitialization(true)).toBe(true);
    manager.markInitializationSuccess();
    expect(manager.beginInitialization(true)).toBe(true);
    manager.markInitializationSuccess();

    expect(manager.beginInitialization(true)).toBe(false);
    expect(suppliedHandler.logOperationalError).toHaveBeenCalled();
  });

  it("computes success rate in statistics", () => {
    const manager = createManager("youtube");
    manager.configure({ allowReinitialization: true });

    manager.beginInitialization();
    manager.markInitializationSuccess();
    manager.beginInitialization();
    manager.markInitializationFailure(new Error("fail"));

    const stats = manager.getStatistics();
    expect(stats.initializationAttempts).toBe(2);
    expect(stats.initializationCount).toBe(1);
    expect(stats.successRate).toBeCloseTo(50);
  });
});
