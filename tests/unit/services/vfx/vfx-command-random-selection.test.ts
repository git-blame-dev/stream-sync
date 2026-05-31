import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import crypto from 'node:crypto';
import { createMockFn } from "../../../helpers/bun-mock-utils";
import { createConfigFixture } from "../../../helpers/config-fixture";

import { VFXCommandService } from "../../../../src/services/VFXCommandService.ts";

describe("VFXCommandService random variant selection", () => {
  const originalRandomInt = crypto.randomInt;
  type VfxPlaybackConfig = { filename: string } & Record<string, unknown>;
  type EffectsManager = {
    playMediaInOBS: ReturnType<typeof createMockFn>;
  };

  let mockEffectsManager: EffectsManager;
  let capturedCommands: VfxPlaybackConfig[];

  const createConfig = (commandValue: string | null) =>
    createConfigFixture({
      gifts: { command: commandValue },
      farewell: {},
      vfx: { filePath: "/tmp" },
      cooldowns: { cmdCooldown: 60, globalCmdCooldownMs: 60000 },
    });

  const isVfxPlaybackConfig = (config: unknown): config is VfxPlaybackConfig =>
    typeof config === "object" &&
    config !== null &&
    "filename" in config &&
    typeof config.filename === "string";

  const createService = (config: ReturnType<typeof createConfig>) =>
    Reflect.construct(VFXCommandService, [
      config,
      null,
      { effectsManager: mockEffectsManager },
    ]);

  beforeEach(() => {
    capturedCommands = [];
    mockEffectsManager = {
      playMediaInOBS: createMockFn().mockImplementation((config) => {
        if (!isVfxPlaybackConfig(config)) {
          throw new Error("Expected VFX playback config with filename");
        }
        capturedCommands.push(config);
        return Promise.resolve();
      }),
    };
  });

  afterEach(() => {
    crypto.randomInt = originalRandomInt;
  });

  test("selects a single variant based on deterministic random value", async () => {
    const config = createConfig("!one | !two | !three");
    crypto.randomInt = createMockFn().mockReturnValue(1);

    const service = createService(config);
    service.commandParser = {
      getVFXConfig: createMockFn((message) => ({
        command: message,
        commandKey: message,
        filename: `${message}.mp4`,
        mediaSource: "VFX Source",
        vfxFilePath: `${message}.vfx`,
        duration: 5000,
      })),
    };

    const result = await service.executeCommandForKey("gifts", {
      username: "testUser1",
      platform: "tiktok",
      userId: "test-user-123",
      skipCooldown: true,
    });

    expect(result.success).toBe(true);
    expect(capturedCommands.length).toBe(1);
    expect(capturedCommands[0]).toBeDefined();
    if (capturedCommands[0] === undefined) {
      throw new Error("Expected captured VFX command");
    }
    expect(capturedCommands[0].filename).toBe("!two.mp4");
  });

  test("returns friendly failure when command key is missing from config", async () => {
    const config = createConfig(null);

    const service = createService(config);
    const result = await service.executeCommandForKey("gifts", {
      username: "testUser1",
      platform: "tiktok",
      userId: "test-user-123",
      skipCooldown: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("No VFX configured for gifts");
    expect(capturedCommands.length).toBe(0);
  });

  test("selects farewell trigger variants from trigger segment only", async () => {
    const config = createConfig("!one");
    Reflect.set(config, "farewell", {
      command: "!bye|!bye2|!bye3, bye|goodbye|cya",
    });
    crypto.randomInt = createMockFn().mockReturnValue(2);

    const service = createService(config);
    service.commandParser = {
      getVFXConfig: createMockFn((message) => ({
        command: message,
        commandKey: message,
        filename: `${message}.mp4`,
        mediaSource: "VFX Source",
        vfxFilePath: `${message}.vfx`,
        duration: 5000,
      })),
    };

    const result = await service.executeCommandForKey("farewell", {
      username: "testUser2",
      platform: "twitch",
      userId: "test-user-456",
      skipCooldown: true,
    });

    expect(result.success).toBe(true);
    expect(capturedCommands.length).toBe(1);
    expect(capturedCommands[0]).toBeDefined();
    if (capturedCommands[0] === undefined) {
      throw new Error("Expected captured farewell VFX command");
    }
    expect(capturedCommands[0].filename).toBe("!bye3.mp4");
  });
});
