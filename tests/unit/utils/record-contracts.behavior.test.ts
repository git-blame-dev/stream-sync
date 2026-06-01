import { describe, expect, test } from "bun:test";
import {
  asRecord,
  getArray,
  getBoolean,
  getErrorDetails,
  getErrorMessage,
  getNumber,
  getRecord,
  getString,
  isRecord,
  omitUndefined,
  toRecord,
  type UnknownRecord,
} from "../../../src/utils/record-contracts.ts";

describe("record contract utilities", () => {
  describe("record coercion", () => {
    test("accepts non-array objects and preserves their identity", () => {
      const record = { id: "event-1" };
      const empty = Object.create(null) as UnknownRecord;

      expect(isRecord(record)).toBe(true);
      expect(toRecord(record)).toBe(record);
      expect(asRecord(record)).toBe(record);
      expect(isRecord(empty)).toBe(true);
      expect(toRecord(empty)).toBe(empty);
    });

    test("rejects null, arrays, and primitive values", () => {
      const nonRecords: readonly unknown[] = [
        null,
        undefined,
        [],
        "value",
        123,
        false,
        10n,
      ];

      for (const value of nonRecords) {
        expect(isRecord(value)).toBe(false);
        expect(toRecord(value)).toBeNull();
        expect(asRecord(value)).toBeNull();
      }
    });
  });

  describe("typed field readers", () => {
    test("getString returns only exact string values", () => {
      const record: UnknownRecord = {
        text: "hello",
        empty: "",
        number: 7,
        objectString: new String("hello"),
      };

      expect(getString(record, "text")).toBe("hello");
      expect(getString(record, "empty")).toBe("");
      expect(getString(record, "number")).toBeNull();
      expect(getString(record, "objectString")).toBeNull();
      expect(getString(record, "missing")).toBeNull();
    });

    test("getNumber returns only finite number values", () => {
      const record: UnknownRecord = {
        zero: 0,
        decimal: 12.5,
        nan: Number.NaN,
        infinity: Number.POSITIVE_INFINITY,
        numericString: "12.5",
      };

      expect(getNumber(record, "zero")).toBe(0);
      expect(getNumber(record, "decimal")).toBe(12.5);
      expect(getNumber(record, "nan")).toBeNull();
      expect(getNumber(record, "infinity")).toBeNull();
      expect(getNumber(record, "numericString")).toBeNull();
      expect(getNumber(record, "missing")).toBeNull();
    });

    test("getBoolean returns only boolean values", () => {
      const record: UnknownRecord = {
        enabled: true,
        disabled: false,
        numeric: 0,
        text: "false",
      };

      expect(getBoolean(record, "enabled")).toBe(true);
      expect(getBoolean(record, "disabled")).toBe(false);
      expect(getBoolean(record, "numeric")).toBeNull();
      expect(getBoolean(record, "text")).toBeNull();
      expect(getBoolean(record, "missing")).toBeNull();
    });

    test("getArray returns only array values", () => {
      const list = ["one", 2];
      const record: UnknownRecord = {
        list,
        empty: [],
        arrayLike: { 0: "one", length: 1 },
      };

      expect(getArray(record, "list")).toBe(list);
      expect(getArray(record, "empty")).toEqual([]);
      expect(getArray(record, "arrayLike")).toBeNull();
      expect(getArray(record, "missing")).toBeNull();
    });

    test("getRecord returns only non-array object values", () => {
      const nested = { id: "nested" };
      const record: UnknownRecord = {
        nested,
        list: [],
        empty: null,
        text: "nested",
      };

      expect(getRecord(record, "nested")).toBe(nested);
      expect(getRecord(record, "list")).toBeNull();
      expect(getRecord(record, "empty")).toBeNull();
      expect(getRecord(record, "text")).toBeNull();
      expect(getRecord(record, "missing")).toBeNull();
    });
  });

  describe("error normalization", () => {
    test("getErrorMessage reports Error, primitive, and record messages", () => {
      expect(getErrorMessage(new Error("boom"))).toBe("boom");
      expect(getErrorMessage(new TypeError(""))).toBe("TypeError");
      expect(getErrorMessage("plain failure")).toBe("plain failure");
      expect(getErrorMessage(404)).toBe("404");
      expect(getErrorMessage(false)).toBe("false");
      expect(getErrorMessage(null)).toBe("null");
      expect(getErrorMessage(undefined)).toBe("undefined");
      expect(getErrorMessage({ message: "record failure" })).toBe("record failure");
      expect(getErrorMessage({ error: "service failure" })).toBe("service failure");
      expect(getErrorMessage({ message: "", error: "fallback failure" })).toBe(
        "fallback failure",
      );
      expect(getErrorMessage({ message: 500 })).toBe("Unknown error");
    });

    test("getErrorDetails keeps supported Error details and stringifies causes", () => {
      const error = new Error("outer", { cause: new Error("inner") });
      error.name = "CustomError";

      expect(getErrorDetails(error)).toEqual({
        message: "outer",
        name: "CustomError",
        cause: "inner",
      });
    });

    test("getErrorDetails keeps supported record details only", () => {
      expect(
        getErrorDetails({
          message: "bad request",
          name: "ApiError",
          code: 429,
          statusCode: 503,
          ignored: "not copied",
        }),
      ).toEqual({
        message: "bad request",
        name: "ApiError",
        code: 429,
        statusCode: 503,
      });

      expect(getErrorDetails({ error: "service unavailable", code: true })).toEqual({
        message: "service unavailable",
      });
      expect(getErrorDetails("offline")).toEqual({ message: "offline" });
    });
  });

  test("omitUndefined removes only undefined values", () => {
    expect(
      omitUndefined({
        missing: undefined,
        nullable: null,
        disabled: false,
        count: 0,
        label: "",
      }),
    ).toEqual({
      nullable: null,
      disabled: false,
      count: 0,
      label: "",
    });
  });
});
