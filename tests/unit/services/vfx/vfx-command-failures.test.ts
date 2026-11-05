import { describe, expect, it } from 'bun:test';

import { createConfigFixture } from "../../../helpers/config-fixture";
import { VFXCommandService } from "../../../../src/services/VFXCommandService.ts";

type CommandValue = string | undefined;

describe("VFXCommandService failure paths", () => {
  const createConfig = (commandValue: CommandValue = "!hello") =>
    createConfigFixture({
      greetings: { command: commandValue },
      farewell: {},
      vfx: { filePath: "/tmp" },
      cooldowns: { cmdCooldown: 60, globalCmdCooldownMs: 60000 },
    });

  it("returns friendly error when parser is missing", async () => {
    const service = new VFXCommandService(createConfig(), null);
    service.commandParser = null;

    const result = await service.executeCommand("!hello", {
      username: "testUser",
      platform: "tiktok",
      userId: "testUserId",
      skipCooldown: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("VFXCommandService requires commandParser");
  });

  it("returns friendly error when parser finds no VFX command", async () => {
    const service = new VFXCommandService(createConfig(), null);

    const result = await service.executeCommand("not-a-command", {
      username: "testUser",
      platform: "tiktok",
      userId: "testUserId",
      skipCooldown: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Command not found");
  });

  it("returns the actual validation error when the configured media path is empty", async () => {
    const config = createConfig();
    config.commands = { synthetic: "!boom, Synthetic VFX Source" };
    config.vfx.filePath = "";
    const service = new VFXCommandService(config, null);

    const result = await service.executeCommand("!boom", {
      username: "Synthetic Viewer",
      platform: "tiktok",
      userId: "synthetic-user",
      skipCooldown: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("VFX config requires vfxFilePath");
    expect(service.stats.failedCommands).toBe(1);
    expect(service.stats.timedCommands).toBe(1);
    expect(service.userLastCommand.size).toBe(0);
    expect(service.globalCommandCooldowns.size).toBe(0);
  });

  it("returns friendly error when command string is empty", async () => {
    const service = new VFXCommandService(createConfig(), null);

    const result = await service.executeCommand("", {
      username: "testUser",
      platform: "tiktok",
      userId: "testUserId",
      skipCooldown: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("VFXCommandService requires message");
  });

  it("returns friendly error when command is whitespace only", async () => {
    const service = new VFXCommandService(createConfig(), null);

    const result = await service.executeCommand("   ", {
      username: "testUser",
      platform: "tiktok",
      userId: "testUserId",
      skipCooldown: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Command not found");
  });

  it("returns missing key error when commandKey is absent", async () => {
    const service = new VFXCommandService(createConfig(), null);

    const result = await service.executeCommandForKey("", {
      username: "testUser",
      platform: "twitch",
      userId: "testUserId",
      skipCooldown: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Missing command key");
  });

  it("returns friendly error when config has no command for key", async () => {
    const service = new VFXCommandService(createConfig(), null);

    const result = await service.executeCommandForKey("missing", {
      username: "testUser",
      platform: "twitch",
      userId: "testUserId",
      skipCooldown: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("No VFX configured for missing");
  });

  it("throws when config is missing", () => {
    expect(() => Reflect.construct(VFXCommandService, [null, null])).toThrow(
      "VFXCommandService requires config",
    );
  });
});
