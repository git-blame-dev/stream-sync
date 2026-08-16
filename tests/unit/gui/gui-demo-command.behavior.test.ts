import { describe, expect, it } from "bun:test";

import { buildGuiDemoConfig } from "../../../scripts/local/gui-demo";
import { DEMO_CHARACTER_CATALOG } from "../../../gui/src/demo/demo-catalog";

describe("GUI demo command behavior", () => {
  it("exposes the shared Goku, Naruto, and Ichigo demo avatar catalog", () => {
    expect(DEMO_CHARACTER_CATALOG).toEqual({
      Goku: "https://myanimelist.net/images/characters/2/344142.jpg",
      Naruto: "https://myanimelist.net/images/characters/15/570333.jpg",
      Ichigo: "https://myanimelist.net/images/characters/13/473588.jpg",
    });
  });
  it("disables operator mode without mutating the source config", () => {
    const source = {
      gui: {
        enableOperator: true,
        host: "127.0.0.1",
        port: 3399,
      },
    };

    const demoConfig = buildGuiDemoConfig(source);

    expect(demoConfig.gui).toMatchObject({
      enableOperator: false,
      host: "127.0.0.1",
      port: 3399,
    });
    expect(source.gui.enableOperator).toBe(true);
  });
});
