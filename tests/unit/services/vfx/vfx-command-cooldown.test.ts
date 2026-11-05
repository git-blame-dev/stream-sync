import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { EventBus } from "../../../../src/core/EventBus";
import { CommandParser } from "../../../../src/chat/commands";

import { noOpLogger } from "../../../helpers/mock-factories";
import {
  useFakeTimers,
  useRealTimers,
  advanceTimersByTime,
  setSystemTime,
} from "../../../helpers/bun-timers";
import { createConfigFixture } from "../../../helpers/config-fixture";

import { VFXCommandService } from "../../../../src/services/VFXCommandService.ts";
import { OBSEffectsManager } from "../../../../src/obs/effects.ts";

type CooldownOverrides = {
  cmdCooldown?: number;
  globalCmdCooldownMs?: number;
};

describe("VFXCommandService cooldown handling", () => {
  let effectsManager: OBSEffectsManager;
  let dir: string;
  let remoteEvents: EventEmitter;
  let remoteFailure: Error | undefined;
  let calls: Array<{ method: string; payload: Record<string, unknown> | undefined }>;

  const createConfig = (commandValue: string, overrides: CooldownOverrides = {}) =>
    createConfigFixture({
      commands: Object.fromEntries(["one", "two", "automatic", "spark", "boom"].map(name =>
        [`!${name}`, `!${name}, Synthetic VFX Source`])),
      gifts: { command: commandValue },
      farewell: {},
      vfx: { filePath: dir },
      cooldowns: {
        cmdCooldown: overrides.cmdCooldown ?? 60,
        globalCmdCooldownMs: overrides.globalCmdCooldownMs ?? 60000,
      },
    });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "synthetic-vfx-cooldown-"));
    try {
      const writes = await Promise.allSettled(["one", "two", "automatic", "spark", "boom"].map(name =>
        writeFile(join(dir, `!${name}.mp4`), "synthetic media; remote OBS playback is simulated")));
      const failedWrite = writes.find(result => result.status === "rejected");
      if (failedWrite?.status === "rejected") throw failedWrite.reason;
      remoteEvents = new EventEmitter();
      remoteFailure = undefined;
      calls = [];
      effectsManager = new OBSEffectsManager({
        ensureConnected: async () => {},
        call: async (method, payload) => {
          calls.push({ method, payload });
          if (remoteFailure) throw remoteFailure;
          if (method === "TriggerMediaInputAction") {
            remoteEvents.emit("MediaInputPlaybackEnded", { inputName: payload?.inputName });
          }
          return {};
        },
        addEventListener: (event, listener) => { remoteEvents.on(event, listener); },
        removeEventListener: (event, listener) => { remoteEvents.off(event, listener); },
      }, { logger: noOpLogger });
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  });

  afterEach(async () => {
    try {
      effectsManager?.dispose();
      expect(remoteEvents?.listenerCount("MediaInputPlaybackEnded") ?? 0).toBe(0);
    } finally {
      useRealTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("blocks repeat VFX command for same user during cooldown window", async () => {
    const service = new VFXCommandService(createConfig("!one | !two"), null, {
      effectsManager,
    });

    const first = await service.executeCommand("!one", {
      username: "testUser1",
      userId: "test-user-123",
      platform: "tiktok",
      skipCooldown: false,
    });
    expect(first.success).toBe(true);
    expect(service.commandParser).toBeInstanceOf(CommandParser);
    expect(calls).toEqual([
      { method: "SetInputSettings", payload: { inputName: "Synthetic VFX Source", inputSettings: {
        local_file: join(dir, "!one.mp4"), looping: false,
      }, overlay: false } },
      { method: "TriggerMediaInputAction", payload: { inputName: "Synthetic VFX Source",
        mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART" } },
    ]);

    const second = await service.executeCommand("!one", {
      username: "testUser1",
      userId: "test-user-123",
      platform: "tiktok",
      skipCooldown: false,
    });
    expect(second.success).toBe(false);
    expect(second.error).toBe("Command on cooldown");
    expect(calls).toHaveLength(2);
  });

  test("honors skipCooldown flag for notification-triggered executions", async () => {
    const service = new VFXCommandService(createConfig("!one | !two"), null, {
      effectsManager,
    });

    const first = await service.executeCommand("!one", {
      username: "testUser1",
      userId: "test-user-123",
      platform: "tiktok",
      skipCooldown: true,
    });

    const second = await service.executeCommand("!one", {
      username: "testUser1",
      userId: "test-user-123",
      platform: "tiktok",
      skipCooldown: true,
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });

  test("allows repeated automatic executions without userId and keeps cooldown maps empty", async () => {
    const service = new VFXCommandService(createConfig("!automatic"), null, {
      effectsManager,
    });

    const context = {
      username: "Synthetic Automation",
      platform: "twitch" as const,
      skipCooldown: true as const,
    };
    const first = await service.executeCommand("!automatic", context);
    const second = await service.executeCommand("!automatic", context);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(service.userLastCommand.size).toBe(0);
    expect(service.userCommandTimestamps.size).toBe(0);
    expect(service.globalCommandCooldowns.size).toBe(0);
  });

  test("rejects cooldown-enforced execution without userId", async () => {
    const service = new VFXCommandService(createConfig("!automatic"), null, {
      effectsManager,
    });

    const result = await Reflect.apply(service.executeCommand, service, [
      "!automatic",
      {
        username: "Synthetic Automation",
        platform: "twitch",
        skipCooldown: false,
      },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("userId");
  });

  test("allows automatic command-key execution without userId", async () => {
    const service = new VFXCommandService(createConfig("!automatic"), null, {
      effectsManager,
    });

    const result = await service.executeCommandForKey("gifts", {
      username: "Synthetic Automation",
      platform: "twitch",
      skipCooldown: true,
    });

    expect(result.success).toBe(true);
    expect(service.userLastCommand.size).toBe(0);
    expect(service.userCommandTimestamps.size).toBe(0);
    expect(service.globalCommandCooldowns.size).toBe(0);
  });

  test("returns failure when VFX execution throws", async () => {
    remoteFailure = new Error("synthetic OBS RPC failed");
    const service = new VFXCommandService(createConfig("!one | !two"), null, {
      effectsManager,
    });

    const result = await service.executeCommand("!boom", {
      username: "testUser1",
      userId: "test-user-123",
      platform: "tiktok",
      skipCooldown: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("synthetic OBS RPC failed");
    expect(service.userLastCommand.size).toBe(0);
    expect(service.globalCommandCooldowns.size).toBe(0);
    remoteFailure = undefined;
    const recovered = await service.executeCommand("!boom", {
      username: "SyntheticViewer", userId: "test-user-123", platform: "tiktok", skipCooldown: false,
    });
    expect(recovered.success).toBe(true);
  });

  test("allows disabling user and global cooldowns via zero config values", async () => {
    const service = new VFXCommandService(
      createConfig("!one", {
        cmdCooldown: 0,
        globalCmdCooldownMs: 0,
      }),
      null,
      {
        effectsManager,
      },
    );

    const first = await service.executeCommand("!one", {
      username: "testUser1",
      userId: "test-user-123",
      platform: "tiktok",
      skipCooldown: false,
    });
    const second = await service.executeCommand("!one", {
      username: "testUser1",
      userId: "test-user-123",
      platform: "tiktok",
      skipCooldown: false,
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });

  test("applies global cooldown across users using configured duration", async () => {
    useFakeTimers();
    setSystemTime(new Date(0));
    try {
      const service = new VFXCommandService(
        createConfig("!spark", {
          cmdCooldown: 0,
          globalCmdCooldownMs: 2000,
        }),
        null,
        {
          effectsManager,
        },
      );

      const first = await service.executeCommand("!spark", {
        username: "testUser1",
        userId: "test-user-u1",
        platform: "twitch",
        skipCooldown: false,
      });
      expect(first.success).toBe(true);

      const second = await service.executeCommand("!spark", {
        username: "testUser2",
        userId: "test-user-u2",
        platform: "twitch",
        skipCooldown: false,
      });
      expect(second.success).toBe(false);
      expect(second.error).toBe("Command on cooldown");

      advanceTimersByTime(2100);

      const third = await service.executeCommand("!spark", {
        username: "testUser2",
        userId: "test-user-u2",
        platform: "twitch",
        skipCooldown: false,
      });
      expect(third.success).toBe(true);
    } finally {
      useRealTimers();
    }
  });

  test("honors configured cooldown duration from config", async () => {
    useFakeTimers();
    setSystemTime(new Date(1000));
    try {
      const service = new VFXCommandService(
        createConfig("!one", {
          cmdCooldown: 1,
          globalCmdCooldownMs: 1,
        }),
        null,
        {
          effectsManager,
        },
      );

      const first = await service.executeCommandForKey("gifts", {
        username: "testUser1",
        userId: "test-user-123",
        platform: "twitch",
        skipCooldown: false,
      });
      expect(first.success).toBe(true);
      expect(service.userLastCommand.size).toBe(1);
      expect(
        service.checkCommandCooldown("test-user-123", "!one").allowed,
      ).toBe(false);

      const second = await service.executeCommandForKey("gifts", {
        username: "testUser1",
        userId: "test-user-123",
        platform: "twitch",
        skipCooldown: false,
      });
      expect(second.success).toBe(false);
      expect(second.error).toBe("Command on cooldown");

      advanceTimersByTime(1500);
      expect(
        service.checkCommandCooldown("test-user-123", "!one").allowed,
      ).toBe(true);

      const third = await service.executeCommandForKey("gifts", {
        username: "testUser1",
        userId: "test-user-123",
        platform: "twitch",
        skipCooldown: false,
      });
      expect(third.success).toBe(true);
    } finally {
      useRealTimers();
    }
  });

  test("prunes stale user cooldown bookkeeping after configured user cooldown elapses", async () => {
    useFakeTimers();
    setSystemTime(new Date(0));
    try {
      const service = new VFXCommandService(
        createConfig("!spark", {
          cmdCooldown: 1,
          globalCmdCooldownMs: 0,
        }),
        null,
        {
          effectsManager,
        },
      );

      const first = await service.executeCommand("!spark", {
        username: "testUser1",
        userId: "test-user-u1",
        platform: "twitch",
        skipCooldown: false,
      });
      expect(first.success).toBe(true);
      expect(service.userLastCommand.size).toBe(1);

      advanceTimersByTime(1500);

      const cooldownCheck = service.checkCommandCooldown(
        "test-user-u1",
        "!spark",
      );
      expect(cooldownCheck.allowed).toBe(true);
      expect(service.userLastCommand.size).toBe(0);
      expect(service.userCommandTimestamps.size).toBe(0);
    } finally {
      useRealTimers();
    }
  });

  test("prunes stale global cooldown bookkeeping using configured duration", async () => {
    useFakeTimers();
    setSystemTime(new Date(0));
    try {
      const service = new VFXCommandService(
        createConfig("!spark", {
          cmdCooldown: 0,
          globalCmdCooldownMs: 1000,
        }),
        null,
        {
          effectsManager,
        },
      );

      const first = await service.executeCommand("!spark", {
        username: "testUser1",
        userId: "test-user-u1",
        platform: "twitch",
        skipCooldown: false,
      });
      expect(first.success).toBe(true);
      expect(service.globalCommandCooldowns.size).toBe(1);

      advanceTimersByTime(1100);

      const cooldownCheck = service.checkCommandCooldown(
        "test-user-u2",
        "!spark",
      );
      expect(cooldownCheck.allowed).toBe(true);
      expect(service.globalCommandCooldowns.size).toBe(0);
    } finally {
      useRealTimers();
    }
  });

  test("requires event correlation and publishes resolved key completion", async () => {
    const bus = new EventBus();
    const events: unknown[] = [];
    const unsubscribe = bus.subscribe("vfx:effect-completed", event => { events.push(event); });
    try {
      const service = new VFXCommandService(createConfig("!automatic"), bus, { effectsManager });
      const context = { username: "Synthetic Automation", platform: "twitch", skipCooldown: true as const };
      const missingCorrelation = await service.executeCommandForKey("gifts", context);
      expect(missingCorrelation).toMatchObject({ success: false,
        error: "executeCommandForKey requires correlationId when events are enabled" });
      expect(calls).toEqual([]);
      expect(events).toEqual([]);

      const result = await service.executeCommandForKey("gifts", { ...context,
        correlationId: "synthetic-cooldown-key-correlation" });
      expect(result.success).toBe(true);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ command: "!automatic", commandKey: "!automatic",
        filename: "!automatic", mediaSource: "Synthetic VFX Source",
        correlationId: "synthetic-cooldown-key-correlation",
        context: { ...context, correlationId: "synthetic-cooldown-key-correlation" },
      });
      expect(events[0]).not.toHaveProperty("userId");
      expect(calls.map(call => call.method)).toEqual(["SetInputSettings", "TriggerMediaInputAction"]);
      expect(remoteEvents.listenerCount("MediaInputPlaybackEnded")).toBe(0);
    } finally { unsubscribe(); }
    expect(bus.listenerCount("vfx:effect-completed")).toBe(0);
  });

  test("unconfigured commands and disposed effects produce no playback or cooldown", async () => {
    const service = new VFXCommandService(createConfig("!one"), null, { effectsManager });
    const context = { username: "SyntheticViewer", userId: "synthetic-viewer-id",
      platform: "twitch", skipCooldown: false as const };
    expect(await service.executeCommand("!unconfigured", context)).toMatchObject({
      success: false, error: "Command not found",
    });
    effectsManager.dispose();
    expect(await service.executeCommand("!one", context)).toMatchObject({
      success: false, error: "OBS effects manager is disposed",
    });
    expect(calls).toEqual([]);
    expect(service.userLastCommand.size).toBe(0);
    expect(service.userCommandTimestamps.size).toBe(0);
    expect(service.globalCommandCooldowns.size).toBe(0);
  });

  test("reports truthful status metrics without queue bookkeeping placeholders", async () => {
    const service = new VFXCommandService(
      createConfig("!spark", {
        cmdCooldown: 0,
        globalCmdCooldownMs: 0,
      }),
      null,
      {
        effectsManager,
      },
    );

    const earlyReturnResult = await service.executeCommand("!spark", {
      username: "   ",
      userId: "test-user-u1",
      platform: "twitch",
      skipCooldown: true,
    });
    expect(earlyReturnResult.success).toBe(false);

    const timedResult = await service.executeCommand("!spark", {
      username: "testUser2",
      userId: "test-user-u2",
      platform: "twitch",
      skipCooldown: true,
    });
    expect(timedResult.success).toBe(true);

    const status = service.getStatus();
    expect(status).not.toHaveProperty("queueLength");
    expect(status).not.toHaveProperty("isProcessing");
    expect(status.stats.totalCommands).toBe(2);
    expect(status.stats.timedCommands).toBe(1);
    expect(status.stats.avgExecutionTime).toBeGreaterThan(0);
  });
});
