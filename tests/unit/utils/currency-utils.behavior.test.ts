import { describe, expect, it } from "bun:test";
import { noOpLogger } from "../../helpers/mock-factories";
import { normalizeCurrency } from "../../../src/utils/currency-utils.ts";
describe("currency-utils behavior", () => {
  it("normalizes unknown currency to XXX", () => {
    const code = normalizeCurrency("💰", { logger: noOpLogger });
    expect(code).toBe("XXX");
  });

  it("maps known symbols and codes to canonical values", () => {
    expect(normalizeCurrency("$")).toBe("USD");
    expect(normalizeCurrency("usd")).toBe("USD");
  });
});
