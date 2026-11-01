import { describe, expect, it } from "bun:test";
import { noOpLogger } from "../../helpers/mock-factories";
import { normalizeCurrency } from "../../../src/utils/currency-utils.ts";
describe("currency-utils behavior", () => {
  it("keeps quoted and embedded-quote credentials out of injected warning loggers", () => {
    const records: string[] = [];
    const logger = { warn: (message: string) => { records.push(message); } };
    for (const assignment of ['password="synthetic-password"', "access_token='synthetic-token'", "password=synthetic'credential", 'access_token=synthetic"credential']) {
      expect(normalizeCurrency(`${assignment}; scope missing`, { logger })).toBe('XXX');
    }
    expect(records).toHaveLength(4);
    for (const record of records) {
      expect(record).not.toMatch(/synthetic|credential/);
      expect(record).toContain('; scope missing');
    }
  });
  it("records sanitized unknown-input warnings without control characters", () => {
    const records: string[] = [];
    const logger = { warn: (message: string, context?: string) => { records.push(`${context}: ${message}`); } };
    expect(normalizeCurrency('access_token=synthetic-currency-token; scope missing\n\r\t', { logger })).toBe('XXX');
    expect(records).toHaveLength(1);
    expect(records[0]).not.toContain('synthetic-currency-token');
    expect(records[0]).toContain('; scope missing');
    expect(records[0]).not.toMatch(/[\r\n\t]/);
  });

  it("preserves passthrough and non-string coercion contracts", () => {
    expect(normalizeCurrency('zzz')).toBe('ZZZ');
    expect(normalizeCurrency({ toString: () => 'usd' })).toBe('USD');
    for (const value of [null, undefined, false, 0, 123, true, {}, []]) {
      expect(normalizeCurrency(value, { warnUnknown: false })).toBe('XXX');
    }
  });
  it("normalizes unknown currency to XXX", () => {
    const code = normalizeCurrency("💰", { logger: noOpLogger });
    expect(code).toBe("XXX");
  });

  it("maps known symbols and codes to canonical values", () => {
    expect(normalizeCurrency("$")).toBe("USD");
    expect(normalizeCurrency("usd")).toBe("USD");
  });
});
