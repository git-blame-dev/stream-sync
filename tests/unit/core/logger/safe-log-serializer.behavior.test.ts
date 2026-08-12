import { describe, test, expect } from "bun:test";
import { safeObjectStringify, sanitizeLogText, sanitizeLogData } from "../../../../src/core/logger/safe-log-serializer.ts";

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

    test("sanitizes Map values according to their displayed string keys", () => {
        const serialized = safeObjectStringify(new Map<string, unknown>([
            ["access_token", "map-access-secret"],
            ["payload", { private: "map-raw-secret" }],
            ["callback_url", "https://example.test/path?secret=map-url-secret"],
        ]));

        expect(serialized).not.toContain("map-access-secret");
        expect(serialized).not.toContain("map-raw-secret");
        expect(serialized).not.toContain("map-url-secret");
        expect(serialized).toContain("[REDACTED_RAW_PAYLOAD]");
        expect(serialized).toContain("[REDACTED]");
    });

    test("does not expose stringify failure messages", () => {
        const value = {
            toJSON: () => { throw new Error("proxy-getter-secret"); },
        };

        const serialized = safeObjectStringify(value);

        expect(serialized).not.toContain("proxy-getter-secret");
    });

    test("bounds Error name and message within the shared budget", () => {
        const data = sanitizeLogData(new Error("error-" + "x".repeat(5000))) as { message: string };
        expect(data.message.length).toBe(4099);

        const broad = safeObjectStringify({ values: Array.from({ length: 100 }, () => Array.from({ length: 100 }, (_, index) => ({ value: `value-${index}` }))) });
        expect(broad).toContain("[Traversal budget exceeded]");
    });

    test("sanitizes hostile and non-JSON values without throwing", () => {
        const hostile = new Proxy({}, { ownKeys: () => { throw new Error("boom"); } });
        const data = sanitizeLogData({ hostile, big: 1n, symbol: Symbol("x"), fn() {}, nan: NaN, inf: Infinity, date: new Date("2020-01-01") });
        expect(() => JSON.stringify(data)).not.toThrow();
        expect(data).toMatchObject({ big: "1n", symbol: "Symbol(x)", nan: "NaN", inf: "Infinity", date: "2020-01-01T00:00:00.000Z" });
    });

    test("bounds strings and collection breadth and strips URL credentials", () => {
        const many = Array.from({ length: 105 }, (_, index) => index);
        const data = sanitizeLogData({ url: "https://user:pass@example.com/path?secret=x#hash", text: "x".repeat(5000), many }) as Record<string, unknown>;
        expect(data.url).toBe("https://example.com/path");
        expect((data.text as string).length).toBe(4099);
        expect((data.many as unknown[]).length).toBe(101);
    });

    test("redacts secret text in malformed URL-like fields", () => {
        const data = sanitizeLogData({ endpoint: "not a url Authorization: Bearer mixed-secret" }) as Record<string, unknown>;
        expect(data.endpoint).toBe("not a url Authorization: Bearer [REDACTED]");
    });

    test("shares traversal budget across broad nested payloads", () => {
        const data = sanitizeLogData({ branches: Array.from({ length: 100 }, () => Array.from({ length: 100 }, (_, index) => ({ value: `value-${index}` }))) }) as { branches: unknown[] };
        expect(data.branches.some((entry) => entry === "[Traversal budget exceeded]")).toBe(true);
        expect(() => JSON.stringify(data)).not.toThrow();
    });
});
