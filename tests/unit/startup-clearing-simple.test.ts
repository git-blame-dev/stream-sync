import { describe, expect, it } from "bun:test";
import { clearStartupTTS } from "../../src/obs/startup.ts";
import { noOpLogger } from "../helpers/mock-factories";

describe("startup TTS clearing error handling", () => {
  it("does not throw when clearing fails", async () => {
    await expect(clearStartupTTS({ obs: { ttsTxt: "tts" } }, { logger: noOpLogger, obsManager: { isConnected: () => true }, sourcesManager: { clearTextSource: async () => { throw new Error("OBS unavailable"); } } })).resolves.toBeUndefined();
  });

  it("does not throw for missing config", async () => {
    await expect(clearStartupTTS(null, { logger: noOpLogger })).resolves.toBeUndefined();
  });
});
