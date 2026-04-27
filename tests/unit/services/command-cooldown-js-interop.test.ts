import { describe, expect, it } from "bun:test";

const commandCooldownModule = require("../../../src/services/CommandCooldownService.ts");
import { createConfigFixture } from "../../helpers/config-fixture";

describe("command cooldown JS interop", () => {
  it("exposes CommandCooldownService as a named export from the JS wrapper", () => {
    expect(typeof commandCooldownModule.CommandCooldownService).toBe(
      "function",
    );
  });

  it("constructs the named wrapper export with config", () => {
    const service = new commandCooldownModule.CommandCooldownService({
      config: createConfigFixture(),
    });

    expect(service.getStatus().config.defaultCooldown).toBeGreaterThan(0);
    service.dispose();
  });
});
