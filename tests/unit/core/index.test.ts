import { describe, expect, it } from "bun:test";
import * as core from "../../../src/core/index.ts";

describe("core/index", () => {
  it("re-exports core config module", () => {
    expect(core.config).toBeDefined();
    expect(typeof core.config.loadConfig).toBe("function");
    expect(typeof core.config._resetConfigForTesting).toBe("function");
    expect(typeof core.config._getConfigPath).toBe("function");
  });
});
