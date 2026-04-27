import { describe, it, expect } from "bun:test";
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
    resolved.console("message", "source");

    expect(resolved.debugCalls).toBe(1);
    expect(resolved.consoleCalls).toBe(1);
    expect(typeof resolved.console).toBe("function");
  });
});
