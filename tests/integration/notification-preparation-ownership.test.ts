import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";
import type { DisplayQueueItem } from "../../src/interfaces/DisplayQueue";
import { NotificationManager } from "../../src/notifications/NotificationManager";
import { VFXCommandService } from "../../src/services/VFXCommandService";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture";

const giftEventType: "platform:gift" = PlatformEvents.GIFT;
const timestamp = "2024-01-01T00:00:00.000Z";
const gift = {
  id: "synthetic-gift-1", username: "synthetic-viewer", userId: "synthetic-user-1",
  timestamp, giftType: "Synthetic gift", giftCount: 1, amount: 5, currency: "USD",
};

const cleanups: Array<() => Promise<void>> = [];
const restorers: Array<() => void> = [];
afterEach(async () => {
  try { for (const restore of restorers.splice(0)) restore(); }
  finally { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); }
});

async function fixture() {
  const h = await createMainPresentationFixture();
  cleanups.push(h.dispose);
  h.config.gifts.command = "!synthetic-gift, Synthetic VFX Source";
  h.config.commands.gifts = "!synthetic-gift, Synthetic VFX Source";
  await h.start();
  const runtime = h.runtime;
  // These are the actual root-created instances. Queue inspection is admission
  // evidence here; no claim of VFX playback is made by preparation tests.
  const manager = runtime.notificationManager as NotificationManager;
  const vfxCommandService = runtime.vfxCommandService as unknown as VFXCommandService;
  return { runtime, manager, items: h.queue.state.queue as DisplayQueueItem[], vfxCommandService, config: h.config };
}

describe("notification preparation ownership through real runtime and manager", () => {
  it("resolves gift VFX once in the preparation owner", async () => {
    const { runtime, items, vfxCommandService } = await fixture();
    const lookup = spyOn(vfxCommandService, "getVFXConfig");
    restorers.push(() => lookup.mockRestore());
    const result = await runtime.handleGiftNotification("youtube", gift.username, gift);
    expect(result).toMatchObject({ success: true });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(items).toHaveLength(1);
    expect(items[0]?.vfxConfig).toMatchObject({ mediaSource: "Synthetic VFX Source" });
    expect(items[0]?.data).toMatchObject({ amount: 5, currency: "USD", userId: gift.userId });
  });

  it("does not resolve disabled gift VFX", async () => {
    const { runtime, config, items, vfxCommandService } = await fixture();
    config.youtube.giftsEnabled = false;
    const lookup = spyOn(vfxCommandService, "getVFXConfig");
    restorers.push(() => lookup.mockRestore());
    const result = await runtime.handleGiftNotification("youtube", gift.username, gift);
    expect(result).toMatchObject({ success: false });
    expect(lookup).not.toHaveBeenCalled();
    expect(items).toHaveLength(0);
  });

  it("keeps direct social inputs lenient and canonical inputs strict", async () => {
    const { runtime, manager, items } = await fixture();
    expect((await manager.handleNotification("platform:follow", "twitch", { username: gift.username })).success).toBe(true);
    const canonical = await runtime.handleFollowNotification("twitch", gift.username, { userId: gift.userId });
    expect(canonical).toMatchObject({ success: false });
    expect(items).toHaveLength(1);
  });

  it("routes the complete social notification family through canonical validation and preparation", async () => {
    const { runtime, items } = await fixture();
    for (const [type, platform] of [["platform:follow", "twitch"], ["platform:share", "tiktok"], ["platform:raid", "twitch"]] as const) {
      await runtime.platformEventRouter.routeEvent({
        type, platform, data: {
          username: " synthetic-viewer ", userId: gift.userId, timestamp, viewerCount: 3,
        },
      });
    }
    expect(items.map(item => item.type)).toEqual(["platform:raid", "platform:share", "platform:follow"]);
    for (const item of items) {
      expect(item.data.username).toBe(gift.username);
      expect(item.data.displayMessage).toBeString();
    }
    await expect(runtime.platformEventRouter.routeEvent({
      type: "platform:follow", platform: "twitch", data: { username: gift.username, timestamp },
    })).rejects.toThrow("requires userId");
    expect(items).toHaveLength(3);
  });

  it("retains anonymous and amountless jewels exceptions without inventing donor identity or value", async () => {
    const { runtime, items } = await fixture();
    const anonymous = await runtime.handleGiftNotification("twitch", undefined, {
      id: "synthetic-anonymous-1", timestamp, isAnonymous: true,
      giftType: "Bits", giftCount: 1, amount: 100, currency: "bits",
    });
    const jewels = await runtime.handleGiftNotification("youtube", gift.username, {
      id: "synthetic-jewels-1", timestamp, giftType: "Synthetic jewel", giftCount: 1, currency: "jewels",
      metadata: { missingFields: ["userId", "amount"] },
    });
    expect(anonymous).toMatchObject({ success: true });
    expect(jewels).toMatchObject({ success: true });
    expect(items[0]?.data).toMatchObject({ isAnonymous: true, currency: "bits", amount: 100 });
    expect(items[0]?.data.userId).toBeUndefined();
    expect(items[1]?.data.amount).toBeUndefined();
    expect(items[1]?.data.userId).toBeUndefined();
    expect(items[1]?.data.metadata).toEqual({ missingFields: ["userId", "amount"] });
  });

  it("rejects preparation-only monetization before VFX lookup or admission", async () => {
    const { manager, items, vfxCommandService } = await fixture();
    const lookup = spyOn(vfxCommandService, "getVFXConfig");
    restorers.push(() => lookup.mockRestore());
    expect(await manager.prepareNotification(giftEventType, "youtube", gift)).toMatchObject({
      success: false, error: "Monetization notifications require immediate handling",
    });
    expect(items).toHaveLength(0);
    expect(lookup).not.toHaveBeenCalled();
  });
});
