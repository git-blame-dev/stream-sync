import { describe, test, expect, afterEach } from "bun:test";
import {
  isDebugModeEnabled,
  getLazyLogger,
  getLazyUnifiedLogger,
  safeObjectStringify,
  sanitizeLogText,
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
    expect(safeObjectStringify(circ, 1)).toContain("[Circular]");
  });

  test("serializes Error objects with message and name without stack details", () => {
    const error = new Error("test-boom");
    const serialized = safeObjectStringify(error);
    const parsed = JSON.parse(serialized);
    expect(parsed.message).toBe("test-boom");
    expect(parsed.name).toBe("Error");
    expect(parsed.stack).toBeUndefined();
  });

  test("redacts sensitive keys and strips URL query values", () => {
    const serialized = safeObjectStringify({
      access_token: "test-access-token",
      accessToken: "test-camel-access-token",
      refreshToken: "test-refresh-token",
      sessionId: "test-session-id",
      hasAccessToken: true,
      hasClientId: true,
      hasSessionId: true,
      authorization: "Bearer test-token",
      reconnect_url: "wss://eventsub.wss.twitch.tv/ws?token=test-reconnect-token#secret-fragment",
    });

    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain('"hasAccessToken":true');
    expect(serialized).toContain('"hasClientId":true');
    expect(serialized).toContain('"hasSessionId":true');
    expect(serialized).toContain("wss://eventsub.wss.twitch.tv/ws");
    expect(serialized).not.toContain("test-access-token");
    expect(serialized).not.toContain("test-camel-access-token");
    expect(serialized).not.toContain("test-refresh-token");
    expect(serialized).not.toContain("test-session-id");
    expect(serialized).not.toContain("Bearer test-token");
    expect(serialized).not.toContain("test-reconnect-token");
    expect(serialized).not.toContain("secret-fragment");
  });

  test("strips URL query values from arbitrary log text", () => {
    const sanitized = sanitizeLogText(
      "failed for wss://eventsub.wss.twitch.tv/ws?token=test-reconnect-token#secret-fragment",
    );

    expect(sanitized).toContain("wss://eventsub.wss.twitch.tv/ws");
    expect(sanitized).not.toContain("test-reconnect-token");
    expect(sanitized).not.toContain("secret-fragment");
  });
});
