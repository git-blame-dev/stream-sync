import { describe, expect, it } from "bun:test";
import { CommandParser } from "../../src/chat/commands";
import { ConfigValidator } from "../../src/utils/config-validator";
import { VFXCommandService } from "../../src/services/VFXCommandService.ts";
import { OBSEffectsManager } from "../../src/obs/effects";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noOpLogger } from "../helpers/mock-factories";
import { clearAllTimers, useFakeTimers, useRealTimers } from "../helpers/bun-timers";

type NormalizedConfig = ReturnType<typeof ConfigValidator.normalize>;
type ParserVFXConfig = NonNullable<ReturnType<CommandParser["getVFXConfig"]>>;

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${label} to be a string`);
  }
  return value;
}

function extractStringRecord(
  value: unknown,
  label: string,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be a string record`);
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );

  return Object.fromEntries(entries) as Record<string, string>;
}

function createCommandParser(normalized: NormalizedConfig): CommandParser {
  return new CommandParser({
    commands: extractStringRecord(normalized.commands, "commands"),
    farewell: extractStringRecord(normalized.farewell, "farewell"),
    vfx: { filePath: requireString(normalized.vfx.filePath, "vfx.filePath") },
    general: normalized.general,
  });
}

function createVFXService(normalized: NormalizedConfig): VFXCommandService {
  return new VFXCommandService(
    {
      ...normalized,
      commands: extractStringRecord(normalized.commands, "commands"),
      farewell: extractStringRecord(normalized.farewell, "farewell"),
      vfx: { filePath: requireString(normalized.vfx.filePath, "vfx.filePath") },
      cooldowns: { cmdCooldown: 60, globalCmdCooldownMs: 60000 },
    },
    null,
  );
}

function expectParserVFXConfig(config: ParserVFXConfig | null): ParserVFXConfig {
  expect(config).not.toBeNull();
  if (!config) {
    throw new Error("Expected VFX config");
  }
  return config;
}

describe("VFX chat command resolution smoke E2E", () => {
  const createRawConfig = () => ({
    general: {
      giftsEnabled: "true",
      commandsEnabled: "true",
      keywordParsingEnabled: "true",
    },
    obs: { enabled: "false" },
    commands: {
      "test-single": "!testsingle, vfx top",
      "test-keyword": "!testkeyword, vfx top, test phrase",
      "test-multi":
        "!testalpha|!testbravo, vfx center green, alpha|bravo|charlie",
      "test-triple": "!testone|!testtwo|!testthree, vfx bottom green, one|two",
    },
    gifts: {},
    vfx: {
      filePath: "/test/vfx/path",
    },
    farewell: {
      command: "",
    },
  });

  it("command definitions survive normalization and reach CommandParser", () => {
    const rawConfig = createRawConfig();

    const normalized = ConfigValidator.normalize(rawConfig);

    expect(normalized.commands["test-single"]).toBe("!testsingle, vfx top");
    expect(normalized.commands["test-keyword"]).toBe(
      "!testkeyword, vfx top, test phrase",
    );
    expect(normalized.commands["test-multi"]).toBe(
      "!testalpha|!testbravo, vfx center green, alpha|bravo|charlie",
    );
    expect(normalized.commands["test-triple"]).toBe(
      "!testone|!testtwo|!testthree, vfx bottom green, one|two",
    );
  });

  it("CommandParser populates triggers Map from normalized config", () => {
    const rawConfig = createRawConfig();
    const normalized = ConfigValidator.normalize(rawConfig);

    const commandParser = createCommandParser(normalized);

    expect(commandParser.parsedCommands.triggers.size).toBeGreaterThan(0);
    expect(commandParser.parsedCommands.triggers.has("!testsingle")).toBe(true);
    expect(commandParser.parsedCommands.triggers.has("!testkeyword")).toBe(
      true,
    );
    expect(commandParser.parsedCommands.triggers.has("!testalpha")).toBe(true);
    expect(commandParser.parsedCommands.triggers.has("!testbravo")).toBe(true);
    expect(commandParser.parsedCommands.triggers.has("!testone")).toBe(true);
    expect(commandParser.parsedCommands.triggers.has("!testtwo")).toBe(true);
    expect(commandParser.parsedCommands.triggers.has("!testthree")).toBe(true);
  });

  it("CommandParser populates keywords Map from normalized config", () => {
    const rawConfig = createRawConfig();
    const normalized = ConfigValidator.normalize(rawConfig);

    const commandParser = createCommandParser(normalized);

    expect(commandParser.parsedCommands.keywords.size).toBeGreaterThan(0);
    expect(commandParser.parsedCommands.keywords.has("test phrase")).toBe(true);
    expect(commandParser.parsedCommands.keywords.has("alpha")).toBe(true);
    expect(commandParser.parsedCommands.keywords.has("bravo")).toBe(true);
    expect(commandParser.parsedCommands.keywords.has("charlie")).toBe(true);
    expect(commandParser.parsedCommands.keywords.has("one")).toBe(true);
    expect(commandParser.parsedCommands.keywords.has("two")).toBe(true);
  });

  it("getVFXConfig returns correct config for single trigger command", () => {
    const rawConfig = createRawConfig();
    const normalized = ConfigValidator.normalize(rawConfig);

    const commandParser = createCommandParser(normalized);

    const vfxConfig = expectParserVFXConfig(
      commandParser.getVFXConfig("!testsingle", "!testsingle"),
    );

    expect(vfxConfig.filename).toBe("test-single");
    expect(vfxConfig.mediaSource).toBe("vfx top");
    expect(vfxConfig.vfxFilePath).toBe("/test/vfx/path");
    expect(vfxConfig.commandKey).toBe("test-single");
  });

  it("getVFXConfig returns correct config for multi-trigger command", () => {
    const rawConfig = createRawConfig();
    const normalized = ConfigValidator.normalize(rawConfig);

    const commandParser = createCommandParser(normalized);

    const vfxConfigOne = commandParser.getVFXConfig("!testone", "!testone");
    const vfxConfigTwo = commandParser.getVFXConfig("!testtwo", "!testtwo");
    const vfxConfigThree = commandParser.getVFXConfig(
      "!testthree",
      "!testthree",
    );

    const configOne = expectParserVFXConfig(vfxConfigOne);
    const configTwo = expectParserVFXConfig(vfxConfigTwo);
    const configThree = expectParserVFXConfig(vfxConfigThree);

    expect(configOne.filename).toBe("test-triple");
    expect(configTwo.filename).toBe("test-triple");
    expect(configThree.filename).toBe("test-triple");
  });

  it("getVFXConfig returns correct config for keyword match", () => {
    const rawConfig = createRawConfig();
    const normalized = ConfigValidator.normalize(rawConfig);

    const commandParser = createCommandParser(normalized);

    const vfxConfig = expectParserVFXConfig(
      commandParser.getVFXConfig("!nomatch", "that was a test phrase moment"),
    );

    expect(vfxConfig.filename).toBe("test-keyword");
    expect(vfxConfig.keyword).toBe("test phrase");
    expect(vfxConfig.matchType).toBe("keyword");
  });
});

describe("VFX notification resolution smoke E2E", () => {
  const createRawConfig = () => ({
    general: {
      giftsEnabled: "true",
      commandsEnabled: "true",
      keywordParsingEnabled: "true",
    },
    obs: { enabled: "false" },
    commands: {
      "test-gift-vfx": "!testgift, vfx top",
      "test-envelope-vfx": "!testenvelope, vfx center green",
      "test-follow-vfx": "!testfollow, vfx bottom green",
      "test-raid-vfx": "!testraid, vfx center green",
    },
    gifts: {
      command: "!testgift",
    },
    envelopes: {
      command: "!testenvelope",
    },
    follows: {
      command: "!testfollow",
    },
    raids: {
      command: "!testraid",
    },
    paypiggies: {
      command: "",
    },
    greetings: {
      command: "",
    },
    shares: {
      command: "",
    },
    vfx: {
      filePath: "/test/vfx/path",
    },
    farewell: {
      command: "",
    },
  });

  it("gifts.command survives config normalization", () => {
    const rawConfig = createRawConfig();
    const normalized = ConfigValidator.normalize(rawConfig);

    expect(normalized.gifts.command).toBe("!testgift");
  });

  it("envelopes.command survives config normalization", () => {
    const rawConfig = createRawConfig();
    const normalized = ConfigValidator.normalize(rawConfig);

    expect(normalized.envelopes.command).toBe("!testenvelope");
  });

  it("follows.command survives config normalization", () => {
    const rawConfig = createRawConfig();
    const normalized = ConfigValidator.normalize(rawConfig);

    expect(normalized.follows.command).toBe("!testfollow");
  });

  it("raids.command survives config normalization", () => {
    const rawConfig = createRawConfig();
    const normalized = ConfigValidator.normalize(rawConfig);

    expect(normalized.raids.command).toBe("!testraid");
  });

  it("VFXCommandService.getVFXConfig returns valid config for gifts", async () => {
    const rawConfig = createRawConfig();
    const normalized = ConfigValidator.normalize(rawConfig);
    const vfxService = createVFXService(normalized);

    const vfxConfig = await vfxService.getVFXConfig("gifts", null);

    expect(vfxConfig).not.toBeNull();
    if (!vfxConfig) throw new Error("Expected gift VFX config");
    expect(vfxConfig.filename).toBe("test-gift-vfx");
    expect(vfxConfig.mediaSource).toBe("vfx top");
  });

  it("executes configured gift VFX through real effects with simulated OBS completion", async () => {
    const rawConfig = createRawConfig();
    rawConfig.vfx.filePath = join(tmpdir(), "synthetic-gift-vfx");
    const normalized = ConfigValidator.normalize(rawConfig);
    const requests: Array<{ method: string; payload: unknown }> = [];
    const emitted: Array<{ event: string; payload: unknown }> = [];
    type Handler = (data?: Record<string, unknown>) => void;
    const handlers = new Map<string, Handler>();
    const removed: Array<[string, Handler]> = [];
    let completionHandler: Handler | undefined;
    const effectsManager = new OBSEffectsManager({
      ensureConnected: async () => {},
      call: async (method, payload) => {
        requests.push({ method, payload });
        return {};
      },
      addEventListener: (name, handler) => {
        handlers.set(name, handler);
        completionHandler = handler;
        // Only the external OBS playback-ended response is simulated.
        queueMicrotask(() => handler({ inputName: "vfx top" }));
      },
      removeEventListener: (name, handler) => {
        removed.push([name, handler]);
        if (handlers.get(name) === handler) handlers.delete(name);
      },
    }, { logger: noOpLogger, delay: async () => {} });
    const service = new VFXCommandService({
      commands: extractStringRecord(normalized.commands, "commands"),
      farewell: extractStringRecord(normalized.farewell, "farewell"),
      gifts: normalized.gifts,
      vfx: { filePath: requireString(normalized.vfx.filePath, "vfx.filePath") },
      cooldowns: { cmdCooldown: 0, globalCmdCooldownMs: 0 },
    }, { emit: (event, payload) => { emitted.push({ event, payload }); } }, { effectsManager });

    useFakeTimers();
    try {
      const result = await service.executeCommandForKey("gifts", {
        username: "SyntheticGiftViewer",
        platform: "twitch",
        userId: "synthetic-gift-viewer",
        skipCooldown: true,
        correlationId: "synthetic-gift-correlation",
        source: "display-queue",
        notificationType: "platform:gift",
      });
      expect(result.success).toBe(true);
      expect(requests).toEqual([
        { method: "SetInputSettings", payload: {
          inputName: "vfx top",
          inputSettings: { local_file: `${rawConfig.vfx.filePath}/test-gift-vfx.mp4`, looping: false },
          overlay: false,
        } },
        { method: "TriggerMediaInputAction", payload: {
          inputName: "vfx top",
          mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
        } },
      ]);
      expect(emitted.map(({ event }) => event)).toEqual([
        PlatformEvents.VFX_COMMAND_EXECUTED,
        PlatformEvents.VFX_EFFECT_COMPLETED,
      ]);
      for (const { event, payload } of emitted) {
        expect(payload).toMatchObject({
          type: event,
          command: "!testgift",
          commandKey: "test-gift-vfx",
          filename: "test-gift-vfx",
          mediaSource: "vfx top",
          username: "SyntheticGiftViewer",
          platform: "twitch",
          userId: "synthetic-gift-viewer",
          correlationId: "synthetic-gift-correlation",
          context: {
            username: "SyntheticGiftViewer",
            platform: "twitch",
            userId: "synthetic-gift-viewer",
            correlationId: "synthetic-gift-correlation",
            skipCooldown: true,
            source: "display-queue",
            notificationType: "platform:gift",
          },
        });
      }
      expect(completionHandler).toEqual(expect.any(Function));
      if (!completionHandler) throw new Error("Expected simulated OBS completion subscription");
      expect(removed).toEqual([["MediaInputPlaybackEnded", completionHandler]]);
      expect(handlers.size).toBe(0);
    } finally {
      clearAllTimers();
      useRealTimers();
    }
  });

  it("VFXCommandService.getVFXConfig returns valid config for envelopes", async () => {
    const rawConfig = createRawConfig();
    const normalized = ConfigValidator.normalize(rawConfig);
    const vfxService = createVFXService(normalized);

    const vfxConfig = await vfxService.getVFXConfig("envelopes", null);

    expect(vfxConfig).not.toBeNull();
    if (!vfxConfig) throw new Error("Expected envelope VFX config");
    expect(vfxConfig.filename).toBe("test-envelope-vfx");
    expect(vfxConfig.mediaSource).toBe("vfx center green");
  });

  it("VFXCommandService.getVFXConfig returns valid config for follows", async () => {
    const rawConfig = createRawConfig();
    const normalized = ConfigValidator.normalize(rawConfig);
    const vfxService = createVFXService(normalized);

    const vfxConfig = await vfxService.getVFXConfig("follows", null);

    expect(vfxConfig).not.toBeNull();
    if (!vfxConfig) throw new Error("Expected follow VFX config");
    expect(vfxConfig.filename).toBe("test-follow-vfx");
    expect(vfxConfig.mediaSource).toBe("vfx bottom green");
  });

  it("VFXCommandService.getVFXConfig returns valid config for raids", async () => {
    const rawConfig = createRawConfig();
    const normalized = ConfigValidator.normalize(rawConfig);
    const vfxService = createVFXService(normalized);

    const vfxConfig = await vfxService.getVFXConfig("raids", null);

    expect(vfxConfig).not.toBeNull();
    if (!vfxConfig) throw new Error("Expected raid VFX config");
    expect(vfxConfig.filename).toBe("test-raid-vfx");
    expect(vfxConfig.mediaSource).toBe("vfx center green");
  });

  it("VFXCommandService.getVFXConfig returns null when no command configured", async () => {
    const rawConfig = createRawConfig();
    const normalized = ConfigValidator.normalize(rawConfig);
    const vfxService = createVFXService(normalized);

    const vfxConfig = await vfxService.getVFXConfig("paypiggies", null);

    expect(vfxConfig).toBeNull();
  });
});
