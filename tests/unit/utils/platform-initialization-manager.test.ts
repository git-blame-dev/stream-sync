import { describe, expect, beforeEach, it } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { PlatformInitializationManager } from "../../../src/utils/platform-initialization-manager";
describe("PlatformInitializationManager", () => {
  let mockHandler: {
    handleEventProcessingError: ReturnType<typeof createMockFn>;
    logOperationalError: ReturnType<typeof createMockFn>;
  };

  beforeEach(() => {
    mockHandler = {
      handleEventProcessingError: createMockFn(),
      logOperationalError: createMockFn(),
    };
  });

  it("prevents reinitialization by default and tracks prevented attempts", () => {
    const manager = new PlatformInitializationManager("twitch", noOpLogger);
    manager.errorHandler = mockHandler;

    expect(manager.beginInitialization()).toBe(true);
    manager.markInitializationSuccess();

    const shouldProceed = manager.beginInitialization();
    expect(shouldProceed).toBe(false);
    expect(manager.preventedReinitializations).toBe(1);
  });

  it("allows forced reinitialization when configured or forced", () => {
    const manager = new PlatformInitializationManager("twitch", noOpLogger);
    manager.errorHandler = mockHandler;

    manager.beginInitialization();
    manager.markInitializationSuccess();

    manager.configure({ allowReinitialization: true });
    expect(manager.beginInitialization()).toBe(true);

    manager.configure({ allowReinitialization: false });
    expect(manager.beginInitialization(true)).toBe(true);
  });

  it("enforces maxAttempts and routes operational error when exceeded", () => {
    const manager = new PlatformInitializationManager("twitch", noOpLogger);
    manager.errorHandler = mockHandler;

    manager.configure({ maxAttempts: 1 });

    expect(manager.beginInitialization()).toBe(true);
    manager.markInitializationFailure(new Error("boom"));

    const proceed = manager.beginInitialization();
    expect(proceed).toBe(false);
    expect(manager.getInitializationState().totalAttempts).toBe(2);
    expect(mockHandler.logOperationalError).toHaveBeenCalled();
  });

  it("records initialization failure state for Error payloads", () => {
    const manager = new PlatformInitializationManager("twitch", noOpLogger);
    manager.errorHandler = mockHandler;
    const err = new Error("init failed");

    manager.beginInitialization();
    manager.markInitializationFailure(err, { context: "startup" });

    expect(manager.getInitializationState()).toEqual(expect.objectContaining({
      success: false,
      error: "init failed",
      context: "startup",
    }));
    expect(mockHandler.handleEventProcessingError).toHaveBeenCalled();
  });

  it("records unknown-error state for non-Error failure payloads", () => {
    const manager = new PlatformInitializationManager("twitch", noOpLogger);
    manager.errorHandler = mockHandler;

    manager.beginInitialization();
    manager.markInitializationFailure(null, { context: "disabled" });

    expect(manager.getInitializationState()).toEqual(expect.objectContaining({
      success: false,
      error: "Unknown error",
      context: "disabled",
    }));
    expect(mockHandler.logOperationalError).toHaveBeenCalled();
  });

  it("tracks statistics and reset state", () => {
    const manager = new PlatformInitializationManager("twitch", noOpLogger);

    manager.beginInitialization();
    manager.markInitializationSuccess({ detail: "first" });

    const stats = manager.getStatistics();
    expect(stats.initializationCount).toBe(1);
    expect(stats.initializationAttempts).toBe(1);
    expect(stats.isInitialized).toBe(true);
    expect(stats.lastInitialization).toEqual(
      expect.objectContaining({
        success: true,
        detail: "first",
      }),
    );

    manager.reset();
    const resetStats = manager.getStatistics();
    expect(resetStats.initializationCount).toBe(0);
    expect(resetStats.initializationAttempts).toBe(0);
    expect(resetStats.isInitialized).toBe(false);
  });
});
