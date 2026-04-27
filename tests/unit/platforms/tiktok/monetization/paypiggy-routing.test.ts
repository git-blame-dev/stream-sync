import { describe, test, expect, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../../../helpers/bun-mock-utils";

import { PlatformEvents } from "../../../../../src/interfaces/PlatformEvents";
import { TikTokPlatform } from "../../../../../src/platforms/tiktok.ts";
import { createMockTikTokPlatformDependencies } from "../../../../helpers/mock-factories";
import * as testClock from "../../../../helpers/test-clock";

describe("TikTok paypiggy routing", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const baseConfig = { enabled: true, username: "paypiggy_tester" };

  const createPlatform = () =>
    new TikTokPlatform(baseConfig, {
      ...createMockTikTokPlatformDependencies(),
      timestampService: {
        extractTimestamp: createMockFn(() =>
          new Date(testClock.now()).toISOString(),
        ),
      },
    });

  test("emits paypiggy for subscription events with nested identity", async () => {
    const platform = createPlatform();
    const paypiggyEvents = [];
    platform.handlers = {
      ...platform.handlers,
      onPaypiggy: (data) => paypiggyEvents.push(data),
    };

    await platform._handleStandardEvent(
      "paypiggy",
      {
        user: {
          userId: "tt-sub-1",
          uniqueId: "subscriber_one",
          nickname: "SubscriberOne",
        },
        message: "hello there",
        common: { createTime: testClock.now() },
      },
      {
        factoryMethod: "createSubscription",
        emitType: PlatformEvents.PAYPIGGY,
      },
    );

    expect(paypiggyEvents).toHaveLength(1);
    expect(paypiggyEvents[0].userId).toBe("subscriber_one");
    expect(paypiggyEvents[0].username).toBe("SubscriberOne");
    expect(paypiggyEvents[0].tier).toBeUndefined();
  });

  test("emits paypiggy for superfan events with nested identity", async () => {
    const platform = createPlatform();
    const paypiggyEvents = [];
    platform.handlers = {
      ...platform.handlers,
      onPaypiggy: (data) => paypiggyEvents.push(data),
    };

    await platform._handleStandardEvent(
      "paypiggy",
      {
        user: {
          userId: "tt-super-1",
          uniqueId: "superfan_one",
          nickname: "SuperfanOne",
        },
        message: "superfan here",
        common: { createTime: testClock.now() },
      },
      {
        factoryMethod: "createSuperfan",
        emitType: PlatformEvents.PAYPIGGY,
      },
    );

    expect(paypiggyEvents).toHaveLength(1);
    expect(paypiggyEvents[0].userId).toBe("superfan_one");
    expect(paypiggyEvents[0].username).toBe("SuperfanOne");
    expect(paypiggyEvents[0].tier).toBe("superfan");
  });
});
