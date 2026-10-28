import { describe, expect, it } from "bun:test";

import { CheermoteProcessor } from "../../../src/utils/cheermote-processor.ts";
import { extractTwitchMessageData } from "../../../src/utils/message-normalization.ts";

describe("Cheermote counting", () => {
  const cheer = (bits: unknown, prefix = "Cheer") => ({
    type: "cheermote",
    text: `${prefix}${String(bits)}`,
    cheermote: { prefix, bits, tier: 100 },
  });

  it("admits only positive safe integer bits and selects an accepted identity", () => {
    const invalidBits = [-1, 1.5, 0, "0", "1e3", true, [100], {}, "", "  ",
      Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1,
      String(Number.MAX_SAFE_INTEGER + 1)];
    const fragments = [
      ...invalidBits.map((bits) => cheer(bits, "Invalid")),
      cheer(" 100 ", "Valid"),
      { type: "text", text: " safe text " },
    ];
    const processed = CheermoteProcessor.processEventSubFragments(fragments);
    expect(processed.totalBits).toBe(100);
    expect(processed.types).toEqual([{ prefix: "Valid", count: 1, totalBits: 100 }]);
    const extracted = extractTwitchMessageData({ fragments });
    expect(extracted.textContent).toBe("safe text");
    expect(extracted.cheermoteInfo).toMatchObject({
      prefix: "Valid", text: "Valid 100 ", count: 1, totalBits: 100, tier: 100,
    });
  });

  it("ignores null and non-record fragments without losing valid neighbors", () => {
    const fragments = [null, undefined, false, 1, "text", [],
      { type: "cheermote", cheermote: null },
      { type: "cheermote", cheermote: { prefix: {}, bits: 10 } },
      { type: "cheermote", cheermote: { prefix: "123", bits: 10 } },
      cheer(100), { type: "text", text: "hello" }];
    expect(CheermoteProcessor.processEventSubFragments(fragments).totalBits).toBe(100);
    expect(extractTwitchMessageData({ fragments })).toMatchObject({
      textContent: "hello", cheermoteInfo: { prefix: "Cheer", count: 1, totalBits: 100 },
    });
  });

  it("omits cheermote info for all-invalid amounts while retaining text", () => {
    const fragments = [cheer(0), cheer("1e3"), cheer(-1), { type: "text", text: "safe text" }];
    expect(CheermoteProcessor.processEventSubFragments(fragments).totalBits).toBe(0);
    expect(extractTwitchMessageData({ fragments })).toEqual({ textContent: "safe text", cheermoteInfo: null });
  });

  it("accepts digit-only strings and rejects fractional or signed string forms", () => {
    const fragments = [cheer("00100"), cheer("100.0"), cheer("+100"), cheer("-100")];
    expect(extractTwitchMessageData({ fragments }).cheermoteInfo).toMatchObject({ count: 1, totalBits: 100 });
  });

  it("omits an unsafe aggregate instead of publishing a rounded total", () => {
    const fragments = [cheer(Number.MAX_SAFE_INTEGER), cheer(1, "Party"),
      { type: "text", text: "safe text" }];
    expect(CheermoteProcessor.processEventSubFragments(fragments).totalBits).toBe(0);
    expect(extractTwitchMessageData({ fragments })).toEqual({ textContent: "safe text", cheermoteInfo: null });
    expect(CheermoteProcessor.processEventSubFragments([cheer(Number.MAX_SAFE_INTEGER)]).totalBits)
      .toBe(Number.MAX_SAFE_INTEGER);
  });

  it("counts accepted prefixes independently of object prototype property names", () => {
    const result = CheermoteProcessor.processEventSubFragments([
      cheer(100, "__proto__"), cheer(100, "__proto__"), cheer(10, "constructor"),
    ]);
    expect(result.totalBits).toBe(210);
    expect(result.types).toEqual([
      { prefix: "__proto__", count: 2, totalBits: 200 },
      { prefix: "constructor", count: 1, totalBits: 10 },
    ]);
  });

  it("counts cheermotes and totals bits from EventSub fragments", () => {
    const fragments = [
      {
        type: "cheermote",
        text: "uni100",
        cheermote: { prefix: "uni", bits: 100 },
      },
      {
        type: "cheermote",
        text: "uni100",
        cheermote: { prefix: "uni", bits: 100 },
      },
    ];

    const result = CheermoteProcessor.processEventSubFragments(fragments);

    if (!("fragments" in result)) {
      throw new Error("Expected cheermote fragments in result");
    }
    expect(result.fragments).toHaveLength(2);
    expect(result.totalBits).toBe(200);
    expect(result.primaryType).toBe("uni");
  });

  it("selects primary cheermote by total bits across types", () => {
    const fragments = [
      {
        type: "cheermote",
        text: "Cheer10",
        cheermote: { prefix: "Cheer", bits: 10 },
      },
      {
        type: "cheermote",
        text: "Cheer10",
        cheermote: { prefix: "Cheer", bits: 10 },
      },
      {
        type: "cheermote",
        text: "Cheer10",
        cheermote: { prefix: "Cheer", bits: 10 },
      },
      {
        type: "cheermote",
        text: "Cheer10",
        cheermote: { prefix: "Cheer", bits: 10 },
      },
      {
        type: "cheermote",
        text: "Cheer10",
        cheermote: { prefix: "Cheer", bits: 10 },
      },
      {
        type: "cheermote",
        text: "uni100",
        cheermote: { prefix: "uni", bits: 100 },
      },
    ];

    const result = CheermoteProcessor.processEventSubFragments(fragments);

    expect(result.totalBits).toBe(150);
    expect(result.primaryType).toBe("uni");
  });

  it("returns cheermote counts in extracted message data", () => {
    const messageObj = {
      text: "uni100 uni100",
      fragments: [
        {
          type: "cheermote",
          text: "uni100",
          cheermote: { prefix: "uni", bits: 100 },
        },
        {
          type: "cheermote",
          text: "uni100",
          cheermote: { prefix: "uni", bits: 100 },
        },
      ],
    };

    const result = extractTwitchMessageData(messageObj);

    expect(result.cheermoteInfo).toEqual(
      expect.objectContaining({
        count: 2,
        totalBits: 200,
        prefix: "uni",
      }),
    );
  });

  it("returns an empty result when no cheermote fragments are present", () => {
    const result = CheermoteProcessor.processEventSubFragments([
      { type: "text", text: "hello world" },
    ]);

    expect(result).toEqual({
      totalBits: 0,
      primaryType: null,
      cleanPrimaryType: null,
      textContent: "",
      mixedTypes: false,
      otherTypesCount: 0,
      types: [],
    });
  });

  it("returns mixed type metadata when multiple cheermote prefixes are present", () => {
    const result = CheermoteProcessor.processEventSubFragments([
      {
        type: "cheermote",
        text: "Cheer100",
        cheermote: { prefix: "Cheer100", bits: 100 },
      },
      {
        type: "cheermote",
        text: "Party50",
        cheermote: { prefix: "Party50", bits: 50 },
      },
    ]);

    expect(result.mixedTypes).toBe(true);
    expect(result.otherTypesCount).toBe(1);
    expect(result.types).toHaveLength(2);
  });
});
