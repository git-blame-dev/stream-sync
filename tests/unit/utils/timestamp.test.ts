import { describe, it, expect } from "bun:test";
import testClock from "../../helpers/test-clock";
import {
  isIsoTimestamp,
  getSystemTimestampISO,
  parseTimestampMs,
  parseTimestampISO,
} from "../../../src/utils/timestamp.ts";
describe("Timestamp utilities", () => {
  describe("isIsoTimestamp", () => {
    it("validates correct ISO timestamps", () => {
      expect(isIsoTimestamp("2024-01-01T00:00:00Z")).toBe(true);
      expect(isIsoTimestamp("2024-01-01T00:00:00.000Z")).toBe(true);
      expect(isIsoTimestamp("2026-12-31T23:59:59.999Z")).toBe(true);
    });

    it("rejects invalid formats", () => {
      expect(isIsoTimestamp("2024-01-01")).toBe(false);
      expect(isIsoTimestamp("2024-01-01T00:00:00")).toBe(false);
      expect(isIsoTimestamp("not-a-date")).toBe(false);
      expect(isIsoTimestamp("")).toBe(false);
      expect(isIsoTimestamp(null)).toBe(false);
      expect(isIsoTimestamp(123456)).toBe(false);
    });
  });

  describe("getSystemTimestampISO", () => {
    it("returns valid ISO timestamp string", () => {
      const result = getSystemTimestampISO();
      expect(typeof result).toBe("string");
      expect(isIsoTimestamp(result)).toBe(true);
    });

    it("returns current time", () => {
      const before = testClock.now();
      const result = getSystemTimestampISO();
      const after = testClock.now();
      const resultMs = new Date(result).getTime();
      expect(resultMs).toBeGreaterThanOrEqual(before);
      expect(resultMs).toBeLessThanOrEqual(after);
    });
  });

  describe("parseTimestampMs", () => {
    it("parses finite numeric millisecond timestamps", () => {
      expect(parseTimestampMs(1_700_000_000_000)).toBe(1_700_000_000_000);
      expect(parseTimestampMs(" 1700000000000 ")).toBe(1_700_000_000_000);
    });

    it("supports explicit seconds and microseconds units", () => {
      expect(parseTimestampMs(1_700_000_000, { numericUnit: "seconds" })).toBe(
        1_700_000_000_000,
      );
      expect(
        parseTimestampMs(1_700_000_000_000_999, {
          numericUnit: "microseconds",
          microsecondRounding: "floor",
        }),
      ).toBe(1_700_000_000_000);
      expect(
        parseTimestampMs(1_700_000_000_000_999, {
          numericUnit: "microseconds",
          microsecondRounding: "round",
        }),
      ).toBe(1_700_000_000_001);
    });

    it("infers seconds and microseconds with configurable boundaries", () => {
      expect(
        parseTimestampMs(999_999_999_999, {
          inferSecondsBelow: 1_000_000_000_000,
        }),
      ).toBe(999_999_999_999_000);
      expect(
        parseTimestampMs(1_000_000_000_000_000, {
          inferMicrosecondsThreshold: 1_000_000_000_000_000,
          inferMicrosecondsThresholdInclusive: true,
          microsecondRounding: "round",
        }),
      ).toBe(1_000_000_000_000);
    });

    it("parses date strings and Date objects only when allowed", () => {
      const iso = "2026-01-04T09:43:46.004Z";
      const date = new Date(iso);
      expect(parseTimestampMs(iso)).toBeNull();
      expect(parseTimestampMs(iso, { allowDateString: true })).toBe(Date.parse(iso));
      expect(parseTimestampMs(date)).toBeNull();
      expect(parseTimestampMs(date, { allowDateObject: true })).toBe(Date.parse(iso));
    });

    it("rejects invalid and non-positive values when required", () => {
      expect(parseTimestampMs("not-a-time", { allowDateString: true })).toBeNull();
      expect(parseTimestampMs(Number.POSITIVE_INFINITY)).toBeNull();
      expect(parseTimestampMs(0, { requirePositive: true })).toBeNull();
      expect(parseTimestampMs(-1, { requirePositive: true })).toBeNull();
    });

    it("can require integer numeric strings", () => {
      expect(parseTimestampMs("1700000000000.5", { requireIntegerNumericString: true })).toBeNull();
      expect(parseTimestampMs(1700000000000.5, { requireIntegerNumericString: true })).toBe(
        1700000000000.5,
      );
    });
  });

  describe("parseTimestampISO", () => {
    it("returns normalized ISO strings", () => {
      expect(parseTimestampISO(1_700_000_000_000)).toBe(
        new Date(1_700_000_000_000).toISOString(),
      );
      expect(parseTimestampISO("2024-01-01T00:00:00Z", { allowDateString: true })).toBe(
        "2024-01-01T00:00:00.000Z",
      );
    });

    it("returns null when parsed milliseconds cannot form a valid Date", () => {
      expect(parseTimestampISO(9e20)).toBeNull();
    });
  });
});
