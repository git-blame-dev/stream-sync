import { describe, expect, it } from "bun:test";
import packageJson from "../../../package.json";

describe("GUI toolchain scripts behavior", () => {
  it("defines the GUI command matrix scripts", () => {
    expect(packageJson.scripts).toBeDefined();
    expect(packageJson.scripts.build).toBe(
      "vite build --config gui/vite.config.ts",
    );
    expect(packageJson.scripts.dev).toBe("vite --config gui/vite.config.ts");
    expect(packageJson.scripts["gui:preview"]).toBe(
      "npm run build && tsx scripts/local/gui-preview.ts",
    );
    expect(packageJson.scripts["gui:preview:gift-animation"]).toBe(
      "npm run build && bun scripts/local/gui-gift-animation-preview.ts",
    );
    expect(packageJson.scripts["typecheck:gui"]).toBe(
      "tsc --noEmit -p gui/tsconfig.json",
    );
    expect(packageJson.scripts["typecheck:gui-node"]).toBe(
      "tsc --noEmit -p tsconfig.json",
    );
  });
});
