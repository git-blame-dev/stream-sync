import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ini from "ini";

import { DEFAULTS } from "../../../src/core/config-schema";
import { ConfigValidator } from "../../../src/utils/config-validator";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

function readConfigExample() {
  const filePath = path.resolve(CURRENT_DIR, "../../../config.example.ini");
  const raw = fs.readFileSync(filePath, "utf8");
  return ini.parse(raw);
}

describe("config example GUI template behavior", () => {
  it("defines the gui section with schema-aligned keys and defaults", () => {
    const parsed = readConfigExample();
    expect(parsed.gui).toBeDefined();

    expect(Object.keys(parsed.gui).sort()).toEqual(
      Object.keys(DEFAULTS.gui).sort(),
    );

    const normalized = ConfigValidator.normalize({ gui: parsed.gui });
    expect(normalized.gui).toEqual(DEFAULTS.gui);
  });
});
