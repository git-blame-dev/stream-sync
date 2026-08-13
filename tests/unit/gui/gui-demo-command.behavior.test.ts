import { describe, expect, it } from "bun:test";

import { buildGuiDemoConfig } from "../../../scripts/local/gui-demo";

describe("GUI demo command behavior", () => {
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
