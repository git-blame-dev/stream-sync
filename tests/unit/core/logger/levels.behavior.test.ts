import { describe, expect, it } from "bun:test";

import { isLogThreshold, shouldLogAtThreshold } from "../../../../src/core/logger/levels";

describe("logger level policy", () => {
  it("accepts severity thresholds and rejects user-output levels", () => {
    expect(isLogThreshold("debug")).toBe(true);
    expect(isLogThreshold("info")).toBe(true);
    expect(isLogThreshold("warn")).toBe(true);
    expect(isLogThreshold("error")).toBe(true);
    expect(isLogThreshold("console")).toBe(false);
    expect(isLogThreshold("emergency")).toBe(false);
  });

  it("compares runtime severities without treating console as a threshold severity", () => {
    expect(shouldLogAtThreshold("debug", "info")).toBe(false);
    expect(shouldLogAtThreshold("warn", "info")).toBe(true);
    expect(shouldLogAtThreshold("console", "debug")).toBe(false);
    expect(shouldLogAtThreshold("emergency", "error")).toBe(true);
  });
});
