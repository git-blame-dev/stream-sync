import { describe, expect, it } from "bun:test";
import NotificationManager from "../../../src/notifications/NotificationManager";
import { PRIORITY_LEVELS } from "../../../src/core/constants";
import { createConfigFixture } from "../../helpers/config-fixture";

const makeManager = (config = createConfigFixture()) => {
  const addItem = () => undefined;
  const manager = new NotificationManager({
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    constants: {
      PRIORITY_LEVELS,
      NOTIFICATION_CONFIGS: {
        "platform:follow": { settingKey: "followsEnabled", commandKey: "follow" },
        "platform:gift": { settingKey: "giftsEnabled", commandKey: "gifts" },
        farewell: { settingKey: "farewellsEnabled", commandKey: "farewell" },
      },
    },
    config,
    displayQueue: { addItem, getQueueLength: () => 0 },
    eventBus: {},
    obsGoals: { processDonationGoal() {} },
    vfxCommandService: { getVFXConfig: () => ({ command: "!bye", filename: "bye.mp4" }) },
  });
  return { manager, addItem };
};

const followData = { username: "viewer", userId: "id", timestamp: "2024-01-01T00:00:00.000Z" };
const farewellData = { username: "viewer", userId: "id", timestamp: "2024-01-01T00:00:00.000Z", command: "!bye", message: "goodbye" };

describe("NotificationManager preparation", () => {
  it("prepares without enqueueing, while handleNotification enqueues once", async () => {
    let count = 0;
    const { manager } = makeManager();
    manager.displayQueue.addItem = () => { count += 1; };
    const prepared = await manager.prepareNotification("platform:follow", "twitch", followData);
    expect(prepared.success).toBe(true);
    expect(count).toBe(0);
    const handled = await manager.handleNotification("platform:follow", "twitch", followData);
    expect(handled.success).toBe(true);
    expect(count).toBe(1);
  });

  it("returns a fully built farewell item with priority and VFX", async () => {
    const { manager } = makeManager();
    const result = await manager.prepareNotification("farewell", "twitch", farewellData);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected prepared farewell");
    const item = result.item;
    if (!item) throw new Error("Expected farewell item");
    expect(item.type).toBe("farewell");
    expect(item.priority).toBe(PRIORITY_LEVELS.FAREWELL);
    expect(item.vfxConfig).toEqual({ command: "!bye", filename: "bye.mp4" });
    expect(item.data.displayMessage).toBeTruthy();
  });

  it("keeps disabled and invalid preparation results structured", async () => {
    const disabled = makeManager(createConfigFixture({ general: { farewellsEnabled: false } }));
    const disabledResult = await disabled.manager.prepareNotification("farewell", "twitch", farewellData);
    expect(disabledResult).toMatchObject({ success: false, disabled: true, error: "Notifications disabled" });
    const invalid = makeManager();
    const invalidResult = await invalid.manager.prepareNotification("platform:follow", null, followData);
    expect(invalidResult).toMatchObject({ success: false, notificationType: "platform:follow" });
    expect(typeof invalidResult.error).toBe("string");
  });

  it("rejects side-effecting monetization preparation", async () => {
    const { manager } = makeManager();
    const result = await manager.prepareNotification("platform:gift", "twitch", {
      username: "viewer",
      userId: "id",
      giftType: "bits",
      giftCount: 1,
      amount: 100,
      currency: "bits",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Monetization notifications require immediate handling");
  });
});
