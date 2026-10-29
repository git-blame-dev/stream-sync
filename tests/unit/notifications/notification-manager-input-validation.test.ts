import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { VFXCommandService } from "../../../src/services/VFXCommandService";
import NotificationManager from "../../../src/notifications/NotificationManager";
import { createMainPresentationFixture } from "../../helpers/main-presentation-fixture";
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

describe("NotificationManager input validation through real runtime owners", () => {
  for (const platform of [null, undefined, 123]) it(`rejects ${String(platform)} platform with zero output and a healthy following case`, async () => {
    const result = await manager.handleNotification("platform:follow", platform, donor);
    expect(result.success).toBe(false);
    expect(result.error).toContain("platform");
    expect(h.queue.getQueueLength()).toBe(0);
    await h.drain();
    expect(h.rows).toHaveLength(0);
    expect((await manager.handleNotification("platform:follow", "tiktok", donor)).success).toBe(true);
    await h.drain();
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ type: "platform:follow", platform: "tiktok", data: donor });
  });

  it("normalizes mixed-case processNotification platform into the admitted canonical item", async () => {
    await manager.processNotification({ type: "platform:follow", platform: "TikTok", data: donor });
    expect(h.queue.state.queue).toHaveLength(1);
    const item = h.queue.state.queue[0];
    if (!item || !("data" in item) || typeof item.eventId !== "string") throw new Error("Expected one admitted notification item with event ID");
    expect(item).toMatchObject({ type: "platform:follow", platform: "tiktok", data: {
      ...donor, displayMessage: "Synthetic Viewer just followed!" } });
    await h.drain();
    expect(h.rows).toEqual([{ eventId: item.eventId, type: item.type, platform: item.platform,
      data: item.data, timestamp: item.data.timestamp }]);
  });

  it("rejects invalid processNotification platform without output and still processes the next item", async () => {
    await manager.processNotification({ type: "platform:follow", platform: 123, data: donor });
    await h.drain();
    expect(h.rows).toHaveLength(0);
    expect(h.queue.getQueueLength()).toBe(0);
    await manager.processNotification({ type: "platform:follow", platform: "TikTok", data: donor });
    await h.drain();
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]?.platform).toBe("tiktok");
  });

  it("returns disabled with zero output and resumes when follows are enabled", async () => {
    h.config.tiktok.followsEnabled = false;
    expect(await manager.handleNotification("platform:follow", "tiktok", donor)).toMatchObject({ success: false, disabled: true });
    await h.drain();
    expect(h.rows).toHaveLength(0);
    expect(h.queue.getQueueLength()).toBe(0);
    h.config.tiktok.followsEnabled = true;
    expect((await manager.handleNotification("platform:follow", "tiktok", donor)).success).toBe(true);
    await h.drain();
    expect(h.rows).toHaveLength(1);
  });

  for (const debugEnabled of [false, true]) it(`admits exact follow copy with debug=${debugEnabled}`, async () => {
    h.config.general.debugEnabled = debugEnabled;
    expect((await manager.handleNotification("platform:follow", "tiktok", donor)).success).toBe(true);
    expect(h.queue.state.queue).toHaveLength(1);
    expect(h.queue.state.queue[0]).toMatchObject({ type: "platform:follow", platform: "tiktok", data: { ...donor, displayMessage: "Synthetic Viewer just followed!" } });
  });

  it("awaits a single-Rose aggregate and observes its admitted output", async () => {
    await manager.handleAggregatedDonation({ ...donor, platform: "tiktok", message: "test message", giftTypes: ["Rose"], totalGifts: 1, totalCoins: 100 });
    expect(h.queue.state.queue).toHaveLength(1);
    expect(h.queue.state.queue[0]).toMatchObject({ type: "platform:gift", platform: "tiktok", data: {
      ...donor, amount: 100, currency: "coins", giftCount: 1, giftType: "Multiple Gifts (Rose)", isAggregated: true } });
  });

  for (const config of [null, undefined]) it(`rejects ${String(config)} constructor config`, () => {
    expect(() => Reflect.construct(NotificationManager, [{ logger: manager.logger, constants: manager.constants,
      eventBus: h.bus, displayQueue: h.queue, config }])).toThrow("config");
  });

  it("continues admission after the actual VFX config owner throws", async () => {
    const rootVfx = manager.vfxCommandService;
    const invalidVfx: VFXCommandService = Reflect.construct(VFXCommandService, [
      { ...h.config, commands: null, follows: { command: "!synthetic" } }, h.bus,
    ]);
    await expect(invalidVfx.getVFXConfig("follows", null)).rejects.toThrow("commandParser");
    Reflect.set(manager, "vfxCommandService", invalidVfx);
    try {
      expect((await manager.handleNotification("platform:follow", "tiktok", donor)).success).toBe(true);
      expect(h.queue.state.queue).toHaveLength(1);
      expect(h.queue.state.queue[0]).toMatchObject({ type: "platform:follow", platform: "tiktok", vfxConfig: null,
        data: { ...donor, displayMessage: "Synthetic Viewer just followed!" } });
      await h.drain();
      expect(h.rows).toHaveLength(1);
    } finally { manager.vfxCommandService = rootVfx; }
    expect((await manager.handleNotification("platform:follow", "tiktok", donor)).success).toBe(true);
    await h.drain();
    expect(h.rows).toHaveLength(2);
  });

  it("continues admission with a non-string optional VFX command", async () => {
    Reflect.set(h.config.follows, "command", 123);
    expect((await manager.handleNotification("platform:follow", "tiktok", donor)).success).toBe(true);
    expect(h.queue.state.queue).toHaveLength(1);
    expect(h.queue.state.queue[0]).toMatchObject({ type: "platform:follow", data: { ...donor, displayMessage: "Synthetic Viewer just followed!" } });
  });
});
