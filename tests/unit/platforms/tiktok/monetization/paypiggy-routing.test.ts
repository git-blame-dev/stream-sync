import { vi, describe, test, expect, afterEach } from 'bun:test';


import { PlatformEvents } from "../../../../../src/interfaces/PlatformEvents";
import { createTikTokLifetimeFixture } from "../../../../helpers/tiktok-connector-fixture";
import * as testClock from "../../../../helpers/test-clock";

type TikTokLifetimeFixture = ReturnType<typeof createTikTokLifetimeFixture>;

type PaypiggyEvent = {
  userId: string;
  username: string;
  tier?: string;
};

const getOnlyPaypiggyEvent = (
  events: readonly PaypiggyEvent[],
): PaypiggyEvent => {
  expect(events).toHaveLength(1);
  const event = events[0];
  expect(event).toBeDefined();
  if (!event) {
    throw new Error("Expected one paypiggy event");
  }
  return event;
};

describe("TikTok paypiggy routing", () => {
  const activeFixtures: TikTokLifetimeFixture[] = [];

  afterEach(async () => {
    try {
      while (activeFixtures.length > 0) {
        const fixture = activeFixtures.pop();
        if (fixture) {
          await fixture.cleanup();
        }
      }
    } finally {
      vi.restoreAllMocks();
    }
  });

  const baseConfig = {
    enabled: true,
    username: "paypiggy_tester",
    dataLoggingEnabled: false,
    dataLoggingPath: "",
    envFileReadEnabled: false,
    envFileWriteEnabled: false,
  };

  const createPlatform = () => {
    const fixture = createTikTokLifetimeFixture(baseConfig);
    activeFixtures.push(fixture);
    return fixture.platform;
  };

  test("emits paypiggy for subscription events with nested identity", async () => {
    const platform = createPlatform();
    const paypiggyEvents: PaypiggyEvent[] = [];
    platform.handlers = {
      ...platform.handlers,
      onPaypiggy: (data: unknown) => {
        expect(isPaypiggyEvent(data)).toBe(true);
        if (!isPaypiggyEvent(data)) {
          throw new Error("Expected paypiggy event payload");
        }
        paypiggyEvents.push(data);
      },
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

    expect(getOnlyPaypiggyEvent(paypiggyEvents)).toMatchObject({
      userId: "subscriber_one",
      username: "SubscriberOne",
    });
    expect(getOnlyPaypiggyEvent(paypiggyEvents).tier).toBeUndefined();
  });

  test("emits paypiggy for superfan events with nested identity", async () => {
    const platform = createPlatform();
    const paypiggyEvents: PaypiggyEvent[] = [];
    platform.handlers = {
      ...platform.handlers,
      onPaypiggy: (data: unknown) => {
        expect(isPaypiggyEvent(data)).toBe(true);
        if (!isPaypiggyEvent(data)) {
          throw new Error("Expected paypiggy event payload");
        }
        paypiggyEvents.push(data);
      },
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

    expect(getOnlyPaypiggyEvent(paypiggyEvents)).toMatchObject({
      userId: "superfan_one",
      username: "SuperfanOne",
      tier: "superfan",
    });
  });
});

function isPaypiggyEvent(value: unknown): value is PaypiggyEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const event = value as Record<string, unknown>;
  return (
    typeof event.userId === "string" &&
    typeof event.username === "string" &&
    (event.tier === undefined || typeof event.tier === "string")
  );
}
