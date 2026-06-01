import { describe, expect, it } from "bun:test";
import { validateDisplayConfig } from "../../../src/obs/display-config-validator.ts";

describe("display-config-validator", () => {
  describe("validateDisplayConfig", () => {
    it("accepts valid config with groups enabled", () => {
      const result = validateDisplayConfig(
        { sourceName: "text", sceneName: "main", groupName: "grp" },
        "chat",
      );
      expect(result).toBe(true);
    });

    it("accepts valid config when groups disabled via null", () => {
      const result = validateDisplayConfig(
        { sourceName: "text", sceneName: "main", groupName: null },
        "notification",
      );
      expect(result).toBe(true);
    });

    it("accepts valid config when groupName is omitted", () => {
      const result = validateDisplayConfig(
        { sourceName: "text", sceneName: "main" },
        "chat",
      );
      expect(result).toBe(true);
    });

    it("rejects missing configuration type", () => {
      const result = validateDisplayConfig(
        { sourceName: "text", sceneName: "main", groupName: "grp" },
        "",
      );
      expect(result).toBe(false);
    });

    it("rejects invalid config objects", () => {
      const result = validateDisplayConfig(null, "chat");
      expect(result).toBe(false);
    });

    it("rejects missing required source or scene", () => {
      const result = validateDisplayConfig(
        { sourceName: "", sceneName: null },
        "chat",
      );
      expect(result).toBe(false);
    });

    it("rejects invalid provided groupName when groups enabled", () => {
      const result = validateDisplayConfig(
        { sourceName: "text", sceneName: "main", groupName: "" },
        "chat",
      );
      expect(result).toBe(false);
    });

    it("rejects whitespace-only source or scene names", () => {
      expect(
        validateDisplayConfig(
          { sourceName: "   ", sceneName: "main", groupName: null },
          "chat",
        ),
      ).toBe(false);
      expect(
        validateDisplayConfig(
          { sourceName: "text", sceneName: "   ", groupName: null },
          "chat",
        ),
      ).toBe(false);
    });
  });
});
