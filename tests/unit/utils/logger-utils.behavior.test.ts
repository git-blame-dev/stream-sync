import { describe, test, expect, afterEach } from "bun:test";
import {
    isDebugModeEnabled,
    getLazyLogger,
    getLazyUnifiedLogger,
} from "../../../src/utils/logger-utils.ts";
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
    expect(typeof logger.debug).toBe("function");

    const unifiedLogger = getLazyUnifiedLogger();
    expect(unifiedLogger).toBeDefined();
    expect(typeof unifiedLogger.debug).toBe("function");
  });

});
