import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import NotificationManager from "../../../src/notifications/NotificationManager";
import { createMainPresentationFixture } from "../../helpers/main-presentation-fixture";
import { createConfigFixture } from "../../helpers/config-fixture";
import { SpamDetectionConfig } from "../../../src/utils/spam-detection";
import { expectNoTechnicalArtifacts } from "../../helpers/assertion-helpers";
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
  h.config.spam.enabled = true;
  h.config.spam.detectionWindow = 60;
  h.config.spam.maxIndividualNotifications = 1;
  h.config.spam.lowValueThreshold = 10;
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


describe("Spam configuration and real notification admission", () => {
  it("loads the complete typed configuration into the actual spam config owner", () => {
    const config = createConfigFixture();
    const spam = config.spam;
    expect(spam.enabled).toBe(true);
    for (const key of ["detectionWindow", "maxIndividualNotifications", "lowValueThreshold"] as const) {
      expect(typeof spam[key]).toBe("number");
      expect(spam[key]).toBeGreaterThan(0);
    }
    const owner = new SpamDetectionConfig(spam, { logger: manager.logger });
    expect(owner.getPlatformConfig("tiktok")).toEqual({ enabled: true,
      detectionWindow: spam.detectionWindow, maxIndividualNotifications: spam.maxIndividualNotifications,
      lowValueThreshold: spam.lowValueThreshold });
  });

  for (const internal of [false, true]) it(`applies real threshold suppression via ${internal ? "internal" : "public"} entry and admits a healthy donor`, async () => {
    const handle = (data: typeof gift) => internal
      ? manager.handleNotificationInternal("platform:gift", "tiktok", data, false)
      : manager.handleNotification("platform:gift", "tiktok", data);
    expect((await handle(gift)).success).toBe(true);
    expect(h.queue.state.queue).toHaveLength(1);
    expect(h.queue.state.queue[0]).toMatchObject({ type: "platform:gift", platform: "tiktok", data: gift });
    await h.drain();
    expect(h.rows).toHaveLength(1);
    expect(await handle(gift)).toMatchObject({ success: false, suppressed: true, reason: "spam_detection" });
    expect(h.queue.getQueueLength()).toBe(0);
    await h.drain();
    expect(h.rows).toHaveLength(1);
    expect((await handle({ ...gift, userId: "synthetic-healthy-user", username: "Synthetic Healthy" })).success).toBe(true);
    await h.drain();
    expect(h.rows).toHaveLength(2);
    expect(h.rows[1]).toMatchObject({ type: "platform:gift", platform: "tiktok", data: {
      ...gift, userId: "synthetic-healthy-user", username: "Synthetic Healthy" } });
  });

  for (const internal of [false, true]) it(`admits low-value gifts with an explicitly omitted detector via ${internal ? "internal" : "public"} entry`, async () => {
    const detector = manager.donationSpamDetector;
    manager.donationSpamDetector = undefined;
    try {
      for (let index = 0; index < 2; index++) {
        const result = internal
          ? await manager.handleNotificationInternal("platform:gift", "tiktok", { ...gift, amount: 1 }, false)
          : await manager.handleNotification("platform:gift", "tiktok", { ...gift, amount: 1 });
        expect(result.success).toBe(true);
      }
      expect(h.queue.state.queue).toHaveLength(2);
      for (const item of h.queue.state.queue) expect(item).toMatchObject({ type: "platform:gift", platform: "tiktok", data: { ...gift, amount: 1 } });
      await h.drain();
      expect(h.rows).toHaveLength(2);
    } finally { manager.donationSpamDetector = detector; }
  });

  it("bypasses real suppression for aggregated gifts while individual gifts remain suppressed", async () => {
    expect((await manager.handleNotification("platform:gift", "tiktok", gift)).success).toBe(true);
    await h.drain();
    expect(await manager.handleNotification("platform:gift", "tiktok", gift)).toMatchObject({ suppressed: true });
    await h.drain();
    expect(h.rows).toHaveLength(1);
    const aggregate = { ...gift, giftCount: 5, amount: 50, isAggregated: true };
    expect((await manager.handleNotification("platform:gift", "tiktok", aggregate)).success).toBe(true);
    expect(h.queue.state.queue).toHaveLength(1);
    expect(h.queue.state.queue[0]).toMatchObject({ type: "platform:gift", platform: "tiktok", data: aggregate });
    await h.drain();
    expect(h.rows).toHaveLength(2);
    expect(h.rows[1]?.data).toMatchObject(aggregate);
  });

  it("requires exact productive display copy without configuration artifacts", async () => {
    const result = await manager.handleNotification("platform:gift", "tiktok", gift);
    expect(result.success).toBe(true);
    expect(h.queue.state.queue).toHaveLength(1);
    const item = h.queue.state.queue[0];
    if (!item || !("data" in item) || typeof item.eventId !== "string") throw new Error("Expected one admitted notification item with event ID");
    expect(item).toMatchObject({ type: "platform:gift", platform: "tiktok", data: {
      ...gift, displayMessage: "Synthetic Viewer sent Rose gift (10 coins)" } });
    expect(typeof item.data.displayMessage).toBe("string");
    expectNoTechnicalArtifacts(item.data.displayMessage as string);
    expect(item.data).not.toHaveProperty("spamDetectionConfig");
    expect(item.data).not.toHaveProperty("configService");
    await h.drain();
    expect(h.rows).toEqual([{ eventId: item.eventId, type: item.type, platform: item.platform,
      data: item.data, timestamp: item.data.timestamp }]);
  });
});
