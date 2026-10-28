import { describe, it, expect } from "bun:test";
import {
  normalizeChannelHandle,
  normalizeHandleForCache,
  isChannelId,
  resolveChannelId,
} from "../../../src/services/youtube-channel-resolver";

describe("youtube-channel-resolver", () => {
  it("rejects non-channel browse IDs without publishing them", async () => {
    for (const browseId of ["PLsynthetic-playlist", "synthetic-arbitrary", "UCshort"]) {
      expect(await resolveChannelId({ resolveURL: async () => ({ payload: { browseId } }) }, "@synthetic")).toBeNull();
    }
  });

  it("rejects overlength handles instead of resolving a truncated identity", async () => {
    let requests = 0;
    const client = { resolveURL: async () => { requests++; return { payload: { browseId: "UC" + "a".repeat(22) } }; } };
    expect(normalizeChannelHandle("雪".repeat(129))).toBe("");
    expect(normalizeChannelHandle("😀".repeat(128))).toBe("😀".repeat(128));
    expect(await resolveChannelId(client, "雪".repeat(129))).toBeNull();
    expect(requests).toBe(0);
  });

  it("sanitizes callback text while preserving thrown error identity", async () => {
    const error = new Error("resolve failed access_token=synthetic-resolver-token");
    const messages: string[] = [];
    const contexts: unknown[] = [];
    let observedError: unknown;
    await expect(resolveChannelId({ resolveURL: async () => { throw error; } }, "@synthetic?access_token=synthetic-context-token", {
      throwOnError: true,
      onError: (message, actualError, _eventType, context) => { messages.push(message); contexts.push(context); observedError = actualError; },
    })).rejects.toBe(error);
    expect(messages.join(" ")).not.toContain("synthetic-resolver-token");
    expect(JSON.stringify(contexts)).not.toContain("synthetic-context-token");
    expect(observedError).toBe(error);
  });
  it("normalizes channel handle input", () => {
    expect(normalizeChannelHandle("  @TestHandle  ")).toBe("@TestHandle");
    expect(normalizeChannelHandle(null)).toBe("");
  });

  it("normalizes cache key for non-channel-id handles", () => {
    expect(normalizeHandleForCache("@SomeCreator")).toBe("somecreator");
    expect(normalizeHandleForCache("UC" + "a".repeat(22))).toBe("");
  });

  it("detects valid and invalid channel id formats", () => {
    expect(isChannelId("UC" + "a".repeat(22))).toBe(true);
    expect(isChannelId("UCshort")).toBe(false);
  });

  it("returns null and reports error when channel handle is missing", async () => {
    const errors: unknown[][] = [];
    const result = await resolveChannelId(null, "", {
      onError: (...args) => errors.push(args),
    });

    expect(result).toBeNull();
    expect(errors.length).toBe(1);
  });

  it("returns channel id input directly without resolver calls", async () => {
    const client = {
      resolveURL: () => Promise.resolve({ payload: { browseId: "unused" } }),
    };
    const channelId = "UC" + "b".repeat(22);
    const result = await resolveChannelId(client, channelId);

    expect(result).toBe(channelId);
  });

  it("returns null when resolver client is unavailable", async () => {
    const errors: unknown[][] = [];
    const result = await resolveChannelId({}, "@creator", {
      onError: (...args) => errors.push(args),
    });

    expect(result).toBeNull();
    expect(errors.length).toBe(1);
  });

  it("handles resolver failures with logger-backed error handler", async () => {
    const logger = {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    };
    const client = {
      resolveURL: () => Promise.reject(new Error("resolver down")),
    };

    const result = await resolveChannelId(client, "@CreatorName", {
      logger,
      throwOnError: false,
    });

    expect(result).toBeNull();
  });

  it("throws when throwOnError is enabled for unavailable resolver", async () => {
    await expect(
      resolveChannelId({}, "@creator", { throwOnError: true }),
    ).rejects.toThrow("resolveURL unavailable");
  });

  it("throws when throwOnError is enabled and resolve request fails", async () => {
    const client = {
      resolveURL: () => Promise.reject(new Error("request failed")),
    };

    await expect(
      resolveChannelId(client, "@creator", { throwOnError: true }),
    ).rejects.toThrow("request failed");
  });

  it("resolves browse id and trims output", async () => {
    const client = {
      resolveURL: () =>
        Promise.resolve({
          payload: { browseId: " UC" + "c".repeat(22) + " " },
        }),
    };

    const result = await resolveChannelId(client, "@CreatorName");

    expect(result).toBe("UC" + "c".repeat(22));
  });

  it("returns null when resolved payload has no browse id", async () => {
    const client = { resolveURL: () => Promise.resolve({ payload: {} }) };
    const errors: unknown[][] = [];
    const result = await resolveChannelId(client, "@MissingCreator", {
      onError: (...args) => errors.push(args),
    });

    expect(result).toBeNull();
    expect(errors.length).toBe(1);
  });
});
