import { describe, test, expect, afterEach } from "bun:test";
import { isBootstrapDebugModeEnabled } from "../../../src/utils/bootstrap-debug-mode.ts";

describe("bootstrap-debug-mode behavior", () => {
  const originalArgv = [...process.argv];
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.argv = [...originalArgv];
    process.env = { ...originalEnv };
  });

  test("detects debug mode via argv or env", () => {
    process.argv.push("--debug");
    expect(isBootstrapDebugModeEnabled()).toBe(true);
    process.argv = [...originalArgv];
    process.env.EMERGENCY_DEBUG = "1";
    expect(isBootstrapDebugModeEnabled()).toBe(true);
  });

  test("stays disabled without argv or emergency env flag", () => {
    process.argv = originalArgv.filter((arg) => arg !== "--debug");
    delete process.env.EMERGENCY_DEBUG;

    expect(isBootstrapDebugModeEnabled()).toBe(false);
  });

});
