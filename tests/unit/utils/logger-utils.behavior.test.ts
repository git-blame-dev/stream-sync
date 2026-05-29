import { describe, test, expect, afterEach } from "bun:test";
import {
    isDebugModeEnabled,
    getLazyLogger,
    getLazyUnifiedLogger,
} from "../../../src/utils/logger-utils.ts";

const getDebugMember = (value: unknown): unknown => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  return Reflect.get(value, "debug");
};

describe("logger-utils behavior", () => {
  const originalArgv = [...process.argv];
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.argv = [...originalArgv];
    process.env = { ...originalEnv };
  });

  test("detects debug mode via argv or env", () => {
    process.argv.push("--debug");
    expect(isDebugModeEnabled()).toBe(true);
    process.argv = [...originalArgv];
    process.env.EMERGENCY_DEBUG = "1";
    expect(isDebugModeEnabled()).toBe(true);
  });

  test("lazily loads loggers", () => {
    const logger = getLazyLogger();
    expect(logger).toBeDefined();
    const loggerDebug = getDebugMember(logger);
    if (typeof loggerDebug !== "function") {
      throw new Error("Expected lazy logger to expose debug");
    }
    expect(typeof loggerDebug).toBe("function");

    const unifiedLogger = getLazyUnifiedLogger();
    expect(unifiedLogger).toBeDefined();
    const unifiedLoggerDebug = getDebugMember(unifiedLogger);
    if (typeof unifiedLoggerDebug !== "function") {
      throw new Error("Expected lazy unified logger to expose debug");
    }
    expect(typeof unifiedLoggerDebug).toBe("function");
  });

});
