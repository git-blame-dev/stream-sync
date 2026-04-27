import { describe, test, expect, afterEach } from "bun:test";
import {
  isDebugModeEnabled,
  getLazyLogger,
  getLazyUnifiedLogger,
  safeObjectStringify,
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

  test("safely stringifies primitives and objects", () => {
    expect(safeObjectStringify(null)).toBe("null");
    expect(safeObjectStringify(undefined)).toBe("undefined");
    expect(safeObjectStringify("hello")).toBe("hello");
    expect(safeObjectStringify(42)).toBe("42");
    expect(safeObjectStringify(true)).toBe("true");

    const circ: { self?: unknown } = {};
    circ.self = circ;
    expect(safeObjectStringify(circ, 1)).toContain("stringify failed");
  });

  test("serializes Error objects with message, stack, and name", () => {
    const error = new Error("test-boom");
    const serialized = safeObjectStringify(error);
    const parsed = JSON.parse(serialized);
    expect(parsed.message).toBe("test-boom");
    expect(parsed.name).toBe("Error");
    expect(parsed.stack).toContain("test-boom");
  });
});
