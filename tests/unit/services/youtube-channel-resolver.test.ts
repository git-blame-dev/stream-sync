import { describe, it, expect } from "bun:test";
const {
  normalizeChannelHandle,
  normalizeHandleForCache,
  isChannelId,
  resolveChannelId,
} = require("../../../src/services/youtube-channel-resolver.ts");

describe("youtube-channel-resolver", () => {
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
    const errors = [] as any[];
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
    const errors = [] as any[];
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
    const errors = [] as any[];
    const result = await resolveChannelId(client, "@MissingCreator", {
      onError: (...args) => errors.push(args),
    });

    expect(result).toBeNull();
    expect(errors.length).toBe(1);
  });
});
