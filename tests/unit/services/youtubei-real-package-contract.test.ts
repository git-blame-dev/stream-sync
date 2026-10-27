import { describe, expect, test } from "bun:test";

const packageRoot = `${import.meta.dir}/../../../node_modules/youtubei.js`;

describe("youtubei.js 18.3.0 real-package contract", () => {
  test("loads the installed package and exposes the parser API", async () => {
    const packageInfo = await import(`${packageRoot}/package.json`, { with: { type: "json" } });
    const youtubei = await import(`${packageRoot}/dist/src/platform/node.js?real-contract`);

    expect(packageInfo.default.version).toBe("18.3.0");
    expect(typeof youtubei.Innertube.create).toBe("function");
    expect(typeof youtubei.Parser.parseResponse).toBe("function");
    expect(typeof youtubei.Parser.setParserErrorHandler).toBe("function");
  });
});
