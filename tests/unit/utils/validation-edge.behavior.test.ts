import { describe, expect, it } from "bun:test";
import {
  sanitizeDisplayName,
  sanitizeForDisplay,
  formatUsername12,
} from "../../../src/utils/validation.ts";
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

describe("bounded identity names", () => {
  it("honors custom, fractional, zero and invalid display limits", () => {
    expect(sanitizeDisplayName("SyntheticLongUsername", 5)).toBe("Synth");
    expect(sanitizeDisplayName("SyntheticLongUsername", 16)).toBe("SyntheticLongUse");
    expect(sanitizeDisplayName("SyntheticLongUsername", 5.9)).toBe("Synth");
    expect(sanitizeDisplayName("alpha beta gamma", 11)).toBe("alpha beta");
    for (const limit of [0, 0.5]) {
      expect(sanitizeDisplayName("name", limit)).toBe("");
      expect(sanitizeDisplayName(null, limit)).toBe("");
    }
    for (const limit of [-1, NaN, Infinity, -Infinity]) {
      expect(sanitizeDisplayName("SyntheticLongUsername", limit)).toBe("SyntheticLon");
    }
  });

  it("preserves display Unicode without splitting surrogate pairs and retains TTS rules", () => {
    expect(sanitizeDisplayName("界é🌸name", 4)).toBe("界é🌸");
    expect(sanitizeDisplayName("界é🌸name", 3)).toBe("界é");
    expect(formatUsername12("界é🌸name_123.x", true)).toBe("name 1 x");
    expect(formatUsername12("<b>name</b>", true)).toBe("bnameb");
  });

  it("sanitizes configured fallbacks once using the selected mode and limit", () => {
    // Config-loading suites evict the config module; bind the formatter to its current owner.
    const modulePath = nodeRequire.resolve("../../../src/utils/validation");
    const cachedModule = nodeRequire.cache[modulePath];
    delete nodeRequire.cache[modulePath];
    try {
      const { sanitizeDisplayName, formatUsername12, getFallbackUsername } = nodeRequire(modulePath) as typeof import("../../../src/utils/validation");
      const { config } = nodeRequire("../../../src/core/config") as typeof import("../../../src/core/config");
      const general = config.general as { fallbackUsername: string };
      const original = general.fallbackUsername;
      try {
        general.fallbackUsername = "<b>FallbackLongName</b> javascript:alert(1) 🌸";
        expect(getFallbackUsername()).toBe(general.fallbackUsername);
        expect(sanitizeDisplayName(null, 16)).toBe("FallbackLongName");
        expect(sanitizeDisplayName("<b></b>", 5)).toBe("Fallb");
        expect(formatUsername12(null)).toBe("FallbackLong");
        general.fallbackUsername = "🌸name_123.x";
        expect(formatUsername12("🌸", true)).toBe("name 1 x");
        general.fallbackUsername = "<b></b>javascript:alert(1)";
        expect(sanitizeDisplayName(null)).toBe("Unknown User");
        general.fallbackUsername = "   ";
        expect(formatUsername12(null, true)).toBe("Unknown User");
        expect(sanitizeDisplayName(null, 3)).toBe("Unk");
      } finally {
        general.fallbackUsername = original;
      }
    } finally {
      if (cachedModule) nodeRequire.cache[modulePath] = cachedModule;
      else delete nodeRequire.cache[modulePath];
    }
  });
});
describe("validation utilities", () => {
  describe("sanitizeForDisplay", () => {
    it("strips HTML/script and truncates to max length", () => {
      const result = sanitizeForDisplay(
        "<b>Hello</b><script>alert(1)</script> world",
        5,
      );
      expect(result).toBe("Hello");
    });

    it("removes HTML/script and trims/limits length", () => {
      const result = sanitizeForDisplay(
        "<b>Hello</b> <script>alert(1)</script>",
        20,
      );
      expect(result).toBe("Hello alert(1)");
    });

    it("returns empty string for invalid inputs", () => {
      expect(sanitizeForDisplay(null)).toBe("");
      expect(sanitizeForDisplay(undefined)).toBe("");
    });
  });

  describe("formatUsername12", () => {
    it("formats usernames to 12 chars with TTS sanitization when needed", () => {
      expect(formatUsername12("VeryLongUsername123", false)).toBe(
        "VeryLongUser",
      );
      expect(formatUsername12("🌸DemoUser🌸", true)).toBe("DemoUser");
    });

    it("returns fallback for null input", () => {
      const result = formatUsername12(null);
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns fallback for undefined input", () => {
      const result = formatUsername12(undefined);
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("handles empty string as invalid input", () => {
      const result = formatUsername12("");
      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(0);
    });

    it("handles whitespace-only input as invalid", () => {
      const result = formatUsername12("   ");
      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(0);
    });

    it("sanitizes display names through the shared display helper", () => {
      expect(sanitizeDisplayName("<b>test-user-name</b>")).toBe("test-user-na");
    });
  });
});
