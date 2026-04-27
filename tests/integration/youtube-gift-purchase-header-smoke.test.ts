import { describe, test, afterEach, expect } from "bun:test";
import { YouTubePlatform } from "../../src/platforms/youtube";
import { getSyntheticFixture } from "../helpers/platform-test-data";
import { restoreAllMocks } from "../helpers/bun-mock-utils";
import { noOpLogger } from "../helpers/mock-factories";
import { createMockPlatformDependencies } from "../helpers/test-setup";
import { createYouTubeConfigFixture } from "../helpers/config-fixture";

const giftPurchaseHeaderOnly = getSyntheticFixture(
  "youtube",
  "gift-purchase-header",
);
const giftPurchaseTimestamp = new Date(
  Math.floor(Number(giftPurchaseHeaderOnly.item.timestamp_usec) / 1000),
).toISOString();

describe("YouTube Gift Purchase Smoke (Canonical Author)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("routes gift purchase through event pipeline to handler", async () => {
    const config = createYouTubeConfigFixture({
      enabled: true,
      username: "test-channel",
    });
    const dependencies = createMockPlatformDependencies("youtube", {
      logger: noOpLogger,
    });
    const platform = new YouTubePlatform(config, dependencies);
    const giftEvents = [];
    platform.handlers = {
      ...platform.handlers,
      onGiftPaypiggy: (event) => giftEvents.push(event),
    };

    await platform.handleChatMessage(giftPurchaseHeaderOnly);

    expect(giftEvents).toHaveLength(1);
    const notification = giftEvents[0];
    expect(notification.type).toBe("platform:giftpaypiggy");
    expect(notification.username).toBe("GiftGiver");
    expect(notification.userId).toBe(giftPurchaseHeaderOnly.item.author.id);
    expect(notification.giftCount).toBe(5);
    expect(notification.id).toBe(giftPurchaseHeaderOnly.item.id);
    expect(notification.timestamp).toBe(giftPurchaseTimestamp);
  });
});
