import { describe, expect, it } from "bun:test";
import { createMockFn } from "../helpers/bun-mock-utils";
import { noOpLogger } from "../helpers/mock-factories";
import { clearStartupTTS } from "../../src/obs/startup.ts";

describe("startup TTS clearing", () => {
  it("clears the configured TTS source when OBS is connected", async () => {
    const clear = createMockFn<[string], Promise<void>>().mockResolvedValue();
    await clearStartupTTS({ obs: { ttsTxt: "tts" } }, { logger: noOpLogger, obsManager: { isConnected: () => true }, sourcesManager: { clearTextSource: clear } });
    expect(clear).toHaveBeenCalledWith("tts");
  });

  it("skips when OBS is disconnected or source is missing", async () => {
    const clear = createMockFn<[string], Promise<void>>().mockResolvedValue();
    await clearStartupTTS({ obs: { ttsTxt: "tts" } }, { logger: noOpLogger, obsManager: { isConnected: () => false }, sourcesManager: { clearTextSource: clear } });
    await clearStartupTTS({ obs: { ttsTxt: "" } }, { logger: noOpLogger, obsManager: { isConnected: () => true }, sourcesManager: { clearTextSource: clear } });
    expect(clear).not.toHaveBeenCalled();
  });
});
