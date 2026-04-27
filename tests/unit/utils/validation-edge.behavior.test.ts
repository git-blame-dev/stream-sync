import { describe, expect, it } from "bun:test";
import {
  sanitizeDisplayName,
  sanitizeForDisplay,
  formatUsername12,
} from "../../../src/utils/validation.ts";
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
