import { describe, test, expect, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { createMockNotificationManager } from "../helpers/mock-factories";
import { createTestAppRuntime } from "../helpers/runtime-test-harness";

describe("SuperSticker Notification Handling", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("emits a gift notification for SuperSticker payloads", async () => {
    const notificationManager = createMockNotificationManager({
      handleNotification: createMockFn().mockResolvedValue(true),
    });

    const { runtime } = createTestAppRuntime(
      {
        general: { enabled: true },
        youtube: { enabled: true },
      },
      {
        notificationManager,
      },
    );

    await runtime.handleGiftNotification("youtube", "StickerFan", {
      type: "platform:gift",
      giftType: "Super Sticker",
      giftCount: 1,
      amount: 5,
      currency: "USD",
      sticker: "Shiba dog shaking his hips saying Thank you",
      userId: "sticker-1",
      timestamp: "2024-01-01T00:00:00.000Z",
      id: "supersticker-evt-1",
    });

    expect(notificationManager.handleNotification).toHaveBeenCalledTimes(1);
    const [eventType, platform, payload] =
      notificationManager.handleNotification.mock.calls[0];
    expect(eventType).toBe("platform:gift");
    expect(platform).toBe("youtube");
    expect(payload).toEqual(
      expect.objectContaining({
        username: "StickerFan",
        giftType: "Super Sticker",
        giftCount: 1,
        amount: 5,
        currency: "USD",
        type: "platform:gift",
      }),
    );
  });
});
