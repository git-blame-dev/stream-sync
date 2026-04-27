import { describe, it, expect } from "bun:test";
import { interpolateTemplate } from "../../../src/utils/notification-template-interpolator.ts";
describe("notification-template-interpolator", () => {
  describe("interpolateTemplate", () => {
    it("replaces template variables with data values", () => {
      const result = interpolateTemplate("{username} followed", {
        username: "test-user",
      });
      expect(result).toBe("test-user followed");
    });

    it("replaces multiple variables", () => {
      const result = interpolateTemplate("{username} sent {count}", {
        username: "test-user",
        count: 5,
      });
      expect(result).toBe("test-user sent 5");
    });

    it("throws for non-string template", () => {
      expect(() => interpolateTemplate(null, {})).toThrow(
        "Template must be a string",
      );
    });

    it("throws for empty string template", () => {
      expect(() => interpolateTemplate("", {})).toThrow(
        "Template must be a string",
      );
    });

    it("throws for numeric template", () => {
      expect(() => interpolateTemplate(123, {})).toThrow(
        "Template must be a string",
      );
    });

    it("throws when required template variable is missing", () => {
      expect(() => interpolateTemplate("{missing}", {})).toThrow(
        "Missing template value for missing",
      );
    });

    it("throws when template variable value is null", () => {
      expect(() => interpolateTemplate("{key}", { key: null })).toThrow(
        "Missing template value for key",
      );
    });

    it("returns empty string for objects without extractable values", () => {
      const badObj = Object.create(null);
      const result = interpolateTemplate("{val}", { val: badObj });
      expect(result).toBe("");
    });

    it("handles null data gracefully for static templates", () => {
      expect(interpolateTemplate("static text", null)).toBe("static text");
    });

    it("handles undefined data gracefully for static templates", () => {
      expect(interpolateTemplate("static text", undefined)).toBe("static text");
    });

    it("enriches paypiggy data before interpolation", () => {
      const result = interpolateTemplate("{username} {paypiggyAction}!", {
        type: "platform:paypiggy",
        username: "test-user",
        platform: "twitch",
      });
      expect(result).toBe("test-user just subscribed!");
    });

    it("sanitizes data to prevent template injection", () => {
      const result = interpolateTemplate("{name}", { name: "test{injection}" });
      expect(result).toBe("test");
      expect(result).not.toContain("{");
    });
  });
});
