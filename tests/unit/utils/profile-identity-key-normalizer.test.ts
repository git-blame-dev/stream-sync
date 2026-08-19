import { describe, expect, it } from "bun:test";
import { normalizeProfileIdentityKey } from "../../../src/utils/profile-identity-key-normalizer";
describe("normalizeProfileIdentityKey", () => {
  it("normalizes casing and whitespace for greeting identity keys", () => {
    expect(normalizeProfileIdentityKey(" twitch ", "  TeSt-User  ")).toBe(
      "twitch:test-user",
    );
    expect(normalizeProfileIdentityKey("tiktok", "  TestUniqueId  ")).toBe(
      "tiktok:testuniqueid",
    );
  });

  it("strips leading @ only for youtube greeting identity keys", () => {
    expect(normalizeProfileIdentityKey(" youtube ", "  @@@TestUser  ")).toBe(
      "youtube:testuser",
    );
    expect(normalizeProfileIdentityKey("twitch", "@@TestUser")).toBe(
      "twitch:@@testuser",
    );
    expect(normalizeProfileIdentityKey("tiktok", "@@TestUser")).toBe(
      "tiktok:@@testuser",
    );
  });

  it("returns empty key for non-string or blank identity input", () => {
    expect(normalizeProfileIdentityKey("youtube", null)).toBe("");
    expect(normalizeProfileIdentityKey("youtube", undefined)).toBe("");
    expect(normalizeProfileIdentityKey("youtube", 42)).toBe("");
    expect(normalizeProfileIdentityKey("youtube", {})).toBe("");
    expect(normalizeProfileIdentityKey("youtube", "   ")).toBe("");
    expect(normalizeProfileIdentityKey("youtube", "@@@")).toBe("");
    expect(normalizeProfileIdentityKey(" kick ", "user")).toBe("");
  });
});
