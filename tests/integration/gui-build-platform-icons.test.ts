import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { build, type Rollup } from "vite";

const PROJECT_ROOT = process.cwd();
const PLATFORM_ICON_DIR = resolve(PROJECT_ROOT, "gui/src/assets/platform-icons");

describe("GUI production platform icons", () => {
  test("inlines the three original PNG assets without emitting separate files", async () => {
    const buildResult = await build({
      configFile: resolve(PROJECT_ROOT, "gui/vite.config.ts"),
      build: { write: false },
    });
    const outputs = (Array.isArray(buildResult) ? buildResult : [buildResult])
      .flatMap((result) => {
        if (!("output" in result)) {
          throw new Error("Expected a completed Vite build result");
        }
        return result.output;
      });
    const javaScript = outputs
      .filter((output): output is Rollup.OutputChunk => output.type === "chunk")
      .map((output) => output.code)
      .join("\n");
    for (const platform of ["youtube", "twitch", "tiktok"]) {
      const expectedBytes = await Bun.file(
        resolve(PLATFORM_ICON_DIR, `${platform}-icon.png`),
      ).bytes();
      const expectedDataUrl = `data:image/png;base64,${Buffer.from(expectedBytes).toString("base64")}`;

      expect(javaScript).toContain(expectedDataUrl);
    }
    expect(
      outputs.some(
        (output) => output.type === "asset" &&
          /(?:youtube|twitch|tiktok)-icon-[^/]+\.png$/u.test(output.fileName),
      ),
    ).toBe(false);
  });
});
