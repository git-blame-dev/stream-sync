import { join } from "node:path";
import { createOperatorControlService } from "../../../src/services/operator/operator-control-service";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import NotificationManager from "../../../src/notifications/NotificationManager";
import { createMainPresentationFixture } from "../../helpers/main-presentation-fixture";
import { PRIORITY_LEVELS } from "../../../src/core/constants";
import { createNotificationContribution } from "../../../src/notifications/notification-contribution";
import { VFXCommandService } from "../../../src/services/VFXCommandService";
let h: Awaited<ReturnType<typeof createMainPresentationFixture>>;
let manager: NotificationManager;
let dispose: (() => Promise<void>) | undefined;
beforeEach(async () => {
  dispose = undefined;
  h = await createMainPresentationFixture();
  dispose = h.dispose;
  h.config.general.envFileReadEnabled = false;
  h.config.general.envFileWriteEnabled = false;
  h.config.general.logChatMessages = false;
  h.config.logging.file.enabled = false;
  h.config.logging.chat.enabled = false;
  h.config.vfx.filePath = "/synthetic-only";
  await h.start();
  const owner = h.runtime.notificationManager;
  if (!(owner instanceof NotificationManager)) throw new Error("Expected the real runtime notification manager");
  manager = owner;
});
afterEach(async () => {
  const cleanup = dispose;
  dispose = undefined;
  await cleanup?.();
});

const donor = { userId: "synthetic-user", username: "Synthetic Viewer" };
const gift = { ...donor, giftType: "Rose", giftCount: 1, amount: 10, currency: "coins" };

describe("NotificationManager real runtime outcomes", () => {
  it("awaits aggregate admission and preserves the original contributions", async () => {
    const contribution = createNotificationContribution("tiktok", "platform:gift", {
      ...gift, id: "synthetic-original", timestamp: "2026-01-01T00:00:00.000Z",
    });
    await manager.handleAggregatedDonation({ ...donor, platform: "tiktok",
      giftTypes: ["Rose", "Heart"], totalGifts: 15, totalCoins: 500,
      message: "Thank you!", contributions: [contribution],
    });
    expect(h.queue.state.queue).toHaveLength(1);
    const item = h.queue.state.queue[0];
    if (!item || !("data" in item) || typeof item.eventId !== "string") throw new Error("Expected one admitted notification item with event ID");
    expect(item).toMatchObject({ type: "platform:gift", platform: "tiktok", priority: PRIORITY_LEVELS.GIFT,
      data: { ...donor, giftType: "Multiple Gifts (Rose, Heart)", giftCount: 15,
        amount: 500, currency: "coins", isAggregated: true, contributions: [contribution], message: "Thank you!",
        displayMessage: "Synthetic Viewer sent 15x Multiple Gifts (Rose, Heart) (500 coins)" } });
    await h.drain();
    expect(h.rows).toEqual([{ eventId: item.eventId, type: item.type, platform: item.platform,
      data: item.data, timestamp: item.data.timestamp }]);
  });

  it("observes a real queue decline without output, then admits a healthy aggregate", async () => {
    const controls = await createOperatorControlService({ filePath: join(h.dir, "synthetic-decline-controls.json"), defaults: {
      messagesEnabled: true, commandsEnabled: true, greetingsEnabled: true, farewellsEnabled: true,
      followsEnabled: true, giftsEnabled: true, paypiggiesEnabled: true, raidsEnabled: true, sharesEnabled: true,
    } });
    h.queue.operatorControls = controls;
    await controls.setEnabled("giftsEnabled", false);
    const aggregate = { ...donor, platform: "tiktok", giftTypes: ["Rose"], totalGifts: 1, totalCoins: 100, message: "test message" };
    await manager.handleAggregatedDonation(aggregate);
    expect(h.queue.getQueueLength()).toBe(0);
    await h.drain();
    expect(h.rows).toHaveLength(0);
    await controls.setEnabled("giftsEnabled", true);
    await manager.handleAggregatedDonation(aggregate);
    expect(h.queue.getQueueLength()).toBe(1);
    await h.drain();
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ type: "platform:gift", platform: "tiktok", data: { amount: 100, giftCount: 1, currency: "coins" } });
  });

  it("admits a complete gift and TTS copy with both TTS flags enabled", async () => {
    h.config.obs.ttsChatEnabled = true;
    h.config.obs.ttsNotificationsEnabled = true;
    await manager.processNotification({ type: "platform:gift", platform: "tiktok", data: gift });
    expect(h.queue.state.queue).toHaveLength(1);
    expect(h.queue.state.queue[0]).toMatchObject({ type: "platform:gift", platform: "tiktok", data: {
      ...gift, ttsMessage: "Synthetic Viewer sent a Rose for 10 coins" } });
  });

  for (const input of [
    { type: "platform:gift", platform: "tiktok", data: null },
    { type: "unknown:type", platform: "test", data: {} },
  ]) it(`produces no rows for ${input.type}/${String(input.data)}, then processes a healthy gift`, async () => {
    await manager.processNotification(input);
    expect(h.queue.getQueueLength()).toBe(0);
    await h.drain();
    expect(h.rows).toHaveLength(0);
    await manager.processNotification({ type: "platform:gift", platform: "tiktok", data: gift });
    await h.drain();
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ type: "platform:gift", data: gift });
  });

  it("suppresses disabled gifts then resumes after the gate opens", async () => {
    h.config.tiktok.giftsEnabled = false;
    await manager.processNotification({ type: "platform:gift", platform: "tiktok", data: gift });
    await h.drain();
    expect(h.rows).toHaveLength(0);
    expect(h.queue.getQueueLength()).toBe(0);
    h.config.tiktok.giftsEnabled = true;
    await manager.processNotification({ type: "platform:gift", platform: "tiktok", data: gift });
    await h.drain();
    expect(h.rows).toHaveLength(1);
  });

  it("executes VFX through real owners, skips incomplete inputs and recovers from external failure", async () => {
    const vfx = h.runtime.vfxCommandService;
    if (!(vfx instanceof VFXCommandService)) throw new Error("Expected the real runtime VFX service");
    h.config.commands.synthetic = "!synthetic,Synthetic VFX,,5000";
    vfx.reloadConfig();
    const original = h.socket.call.bind(h.socket);
    const restarts: unknown[] = [];
    const completions: unknown[] = [];
    let fail = true;
    const wire = spyOn(h.socket, "call").mockImplementation(async (method, data = {}) => {
      if (method === "TriggerMediaInputAction") {
        restarts.push(data.inputName);
        if (fail) throw new Error("Synthetic external restart failure");
        queueMicrotask(() => h.socket.emit("MediaInputPlaybackEnded", { inputName: data.inputName }));
        return {};
      }
      return original(method, data);
    });
    let unsubscribe = () => {};
    try {
      unsubscribe = h.bus.subscribe("vfx:effect-completed", event => { completions.push(event); });
      await manager.processVFXForNotification({ type: "platform:gift", vfxCommand: null });
      await manager.processVFXForNotification({ type: "platform:gift", platform: "tiktok", username: donor.username, vfxCommand: "!synthetic" });
      expect(restarts).toEqual([]);
      expect(completions).toEqual([]);
      await manager.processVFXForNotification({ type: "platform:gift", platform: "tiktok", ...donor, vfxCommand: "!synthetic" });
      expect(restarts).toEqual(["Synthetic VFX"]);
      expect(completions).toEqual([]);
      fail = false;
      await manager.processVFXForNotification({ type: "platform:gift", platform: "tiktok", ...donor, vfxCommand: "!synthetic", correlationId: "synthetic-correlation" });
      expect(restarts).toEqual(["Synthetic VFX", "Synthetic VFX"]);
      expect(completions).toHaveLength(1);
      expect(completions[0]).toMatchObject({ correlationId: "synthetic-correlation", ...donor, platform: "tiktok",
        context: { correlationId: "synthetic-correlation", ...donor, platform: "tiktok", type: "platform:gift", skipCooldown: true } });
    } finally {
      try { unsubscribe(); } finally { wire.mockRestore(); }
    }
  });

  it("retains explicit and canonical priority contracts", () => {
    expect(manager.getPriorityForType("platform:gift", { priority: 99 })).toBe(99);
    const priorities = { "platform:follow": PRIORITY_LEVELS.FOLLOW, "platform:gift": PRIORITY_LEVELS.GIFT,
      "platform:envelope": PRIORITY_LEVELS.ENVELOPE, "platform:paypiggy": PRIORITY_LEVELS.PAYPIGGY,
      "platform:raid": PRIORITY_LEVELS.RAID, "platform:share": PRIORITY_LEVELS.SHARE,
      "platform:giftpaypiggy": PRIORITY_LEVELS.GIFTPAYPIGGY, "platform:chat-message": PRIORITY_LEVELS.CHAT,
      command: PRIORITY_LEVELS.COMMAND, greeting: PRIORITY_LEVELS.GREETING, farewell: PRIORITY_LEVELS.FAREWELL };
    for (const [type, priority] of Object.entries(priorities)) expect(manager.getPriorityForType(type, {})).toBe(priority);
    for (const type of ["unknown:type", "chat"]) expect(() => manager.getPriorityForType(type, {})).toThrow("Missing priority mapping");
  });

  it("builds exact follow copy through the actual builder", () => {
    expect(manager.build({ type: "platform:follow", platform: "twitch", ...donor })).toMatchObject({
      type: "platform:follow", platform: "twitch", displayMessage: "Synthetic Viewer just followed!" });
  });

  for (const [type, data, error] of [
    ["platform:gift", null, "Invalid"], ["subscription", { userId: "synthetic-user" }, "Unknown"],
    ["unknown:type", { userId: "synthetic-user" }, "Unknown"],
    ["platform:gift", { type: "platform:follow", userId: "synthetic-user" }, "Unknown"],
  ] as const) it(`rejects direct invalid DTO ${type}/${error} and preserves following admission`, async () => {
    const result = await manager.handleNotification(type, "tiktok", data);
    expect(result.success).toBe(false);
    expect(result.error?.toLowerCase()).toContain(error.toLowerCase());
    expect(h.queue.getQueueLength()).toBe(0);
    await h.drain();
    expect(h.rows).toHaveLength(0);
    expect((await manager.handleNotification("platform:gift", "tiktok", gift)).success).toBe(true);
    expect(h.queue.getQueueLength()).toBe(1);
  });

  it("publishes the direct error through the real diagnostic owner", () => {
    const output = spyOn(manager.logger, "error");
    try {
      manager._handleNotificationError("Synthetic error message", new Error("synthetic failure"),
        { data: "synthetic" }, { eventType: "synthetic-event" });
      expect(output).toHaveBeenCalledTimes(1);
      expect(output).toHaveBeenCalledWith("notification-manager", "notification-manager", {
        error: "synthetic failure", errorDetails: { message: "synthetic failure", name: "Error" },
        eventType: "synthetic-event", eventDataSummary: { fieldCount: 1, hasMessage: false, hasRawData: false, hasPayload: false },
      });
    } finally { output.mockRestore(); }
  });

  it("uses the actual tracking service for first and returning messages", async () => {
    expect(await manager._isFirstMessage(donor.userId)).toBe(true);
    expect(await manager._isFirstMessage(donor.userId)).toBe(false);
    const tracking = manager.userTrackingService;
    manager.userTrackingService = undefined;
    try { await expect(manager._isFirstMessage(donor.userId)).rejects.toThrow("UserTrackingService"); }
    finally { manager.userTrackingService = tracking; }
    expect(await manager._isFirstMessage("synthetic-following-user")).toBe(true);
  });
});
