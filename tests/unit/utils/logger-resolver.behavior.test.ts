import { describe, it, expect } from "bun:test";

import { createRecordingLogger } from "../../helpers/recording-logger";
import { resolveLogger } from "../../../src/utils/logger-resolver";
describe("logger-resolver behavior", () => {
  it("preserves prototype methods like console on class-based loggers", () => {
    class TestLogger {
      debugCalls = 0;
      consoleCalls = 0;

      debug(_message: unknown): void {
        this.debugCalls += 1;
      }

      info(): void {}

      warn(): void {}

      error(): void {}

      console(_message: unknown, _source?: string): void {
        this.consoleCalls += 1;
      }
    }

    const logger = new TestLogger();
    const resolved = resolveLogger(logger, "TestLogger");

    resolved.debug("test");
    expect(resolved.console).toBeDefined();
    if (resolved.console === undefined) {
      throw new Error("Expected console logger method to be preserved");
    }
    resolved.console("message", "source");

    expect(resolved.debugCalls).toBe(1);
    expect(resolved.consoleCalls).toBe(1);
    expect(typeof resolved.console).toBe("function");
  });

  it("returns a valid provided logger without losing canonical source and data entries", () => {
    const logger = createRecordingLogger();

    const resolved = resolveLogger(logger, "test-module");
    resolved.warn("test-visible-warning", "test-source", { code: "test-code" });

    expect(logger.entries).toContainEqual({
      level: "warn",
      message: "test-visible-warning",
      source: "test-source",
      data: { code: "test-code" },
    });
  });

  it("rejects an explicit partial logger dependency instead of filling missing methods with no-ops", () => {
    const partialLogger = {
      info: (_message: unknown, _source?: string, _data?: unknown): void => {},
    };

    expect(() => resolveLogger(partialLogger, "test-module")).toThrow(/test-module|logger/i);
    expect(() => resolveLogger(partialLogger, "test-module")).toThrow(/debug|warn|error/i);
  });

  it("rejects non-object explicit logger dependencies instead of falling back to a global logger", () => {
    expect(() => resolveLogger("test-not-a-logger", "test-module")).toThrow(/object|logger/i);
  });
});
