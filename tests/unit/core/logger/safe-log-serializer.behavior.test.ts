import { describe, test, expect } from "bun:test";
import { safeObjectStringify, sanitizeLogText } from "../../../../src/core/logger/safe-log-serializer.ts";

describe("safe log serializer behavior", () => {
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

    test("redacts API keys and JWT tokens while preserving presence booleans", () => {
        const serialized = safeObjectStringify({
            apiKey: "test-api-key",
            api_key: "test-snake-api-key",
            xApiKey: "test-x-api-key",
            "x-api-key": "test-header-api-key",
            jwtToken: "test-jwt-token",
            jwt_token: "test-snake-jwt-token",
            hasApiKey: true,
            hasJwtToken: true,
        });

        expect(serialized).toContain("[REDACTED]");
        expect(serialized).toContain('"hasApiKey":true');
        expect(serialized).toContain('"hasJwtToken":true');
        expect(serialized).not.toContain("test-api-key");
        expect(serialized).not.toContain("test-snake-api-key");
        expect(serialized).not.toContain("test-x-api-key");
        expect(serialized).not.toContain("test-header-api-key");
        expect(serialized).not.toContain("test-jwt-token");
        expect(serialized).not.toContain("test-snake-jwt-token");
    });

    test("serializes object keys deterministically regardless of insertion order", () => {
        const first = safeObjectStringify({ b: 2, a: 1 });
        const second = safeObjectStringify({ a: 1, b: 2 });

        expect(first).toBe(second);
        expect(first).toBe('{"a":1,"b":2}');
    });

    test("serializes repeated non-cyclic references while marking only true cycles as circular", () => {
        const shared = { id: "test-shared" };
        const cycle: { id: string; self?: unknown } = { id: "test-cycle" };
        cycle.self = cycle;

        const parsed = JSON.parse(
            safeObjectStringify({
                first: shared,
                second: shared,
                cycle,
            }),
        );

        expect(parsed.first).toEqual({ id: "test-shared" });
        expect(parsed.second).toEqual({ id: "test-shared" });
        expect(parsed.cycle.id).toBe("test-cycle");
        expect(parsed.cycle.self).toBe("[Circular]");
    });

    test("strips URL query values from arbitrary log text", () => {
        const sanitized = sanitizeLogText(
            "failed for wss://eventsub.wss.twitch.tv/ws?token=test-reconnect-token#secret-fragment",
        );

        expect(sanitized).toContain("wss://eventsub.wss.twitch.tv/ws");
        expect(sanitized).not.toContain("test-reconnect-token");
        expect(sanitized).not.toContain("secret-fragment");
    });

    test("redacts free-text secret formats in log messages", () => {
        const sanitized = sanitizeLogText(
            "Authorization: Bearer test-access-token Cookie: session=test-session-id jwtToken=test-jwt-token api_key=test-api-key",
        );

        expect(sanitized).toContain("[REDACTED]");
        expect(sanitized).not.toContain("test-access-token");
        expect(sanitized).not.toContain("test-session-id");
        expect(sanitized).not.toContain("test-jwt-token");
        expect(sanitized).not.toContain("test-api-key");
    });

    test("redacts raw provider payload containers", () => {
        const serialized = safeObjectStringify({
            payload: { message: "test-private-chat-text", access_token: "test-token" },
            originalData: { rawText: "test-private-provider-payload" },
            safeSummary: { hasPayload: true },
        });

        expect(serialized).toContain("[REDACTED_RAW_PAYLOAD]");
        expect(serialized).toContain('"hasPayload":true');
        expect(serialized).not.toContain("test-private-chat-text");
        expect(serialized).not.toContain("test-private-provider-payload");
        expect(serialized).not.toContain("test-token");
    });
});
