import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { restoreAllMocks } from "../../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../../helpers/mock-factories";

import { TikTokPlatform } from "../../../../../src/platforms/tiktok.ts";
import { PlatformEvents } from "../../../../../src/interfaces/PlatformEvents";
import { createTikTokEventFactory } from "../../../../../src/platforms/tiktok/events/event-factory.ts";

describe("TikTokPlatform monetisation mapping", () => {
  type UnknownRecord = Record<string, unknown>;
  type EmittedEvent = { evt: string; payload: UnknownRecord };
  type TestPlatform = TikTokPlatform & {
    eventFactory: ReturnType<typeof createTikTokEventFactory>;
    _normalizeUserData: (data: UnknownRecord) => UnknownRecord;
    _getPlatformMessageId: (data: UnknownRecord) => string | undefined;
    _buildEventMetadata: (metadata: UnknownRecord) => UnknownRecord;
  };

  let platform: TestPlatform;
  let emitted: EmittedEvent[];

  const requirePlatformEvent = (): UnknownRecord => {
    const event = emitted.find((item) => item.evt === "platform:event");
    if (!event) {
      throw new Error("Expected platform:event to be emitted");
    }
    return event.payload;
  };

  afterEach(() => {
    restoreAllMocks();
  });

  beforeEach(() => {
    emitted = [];
    const eventBus = {
      emit: (evt: string, payload: unknown) => {
        if (payload && typeof payload === "object") {
          emitted.push({ evt, payload: payload as UnknownRecord });
        }
      },
    };

    platform = new TikTokPlatform(
      { username: "tester", enabled: false },
      {
        logger: noOpLogger,
        eventBus,
        TikTokWebSocketClient: function () {},
        WebcastEvent: {
          CHAT: "chat",
          GIFT: "gift",
          FOLLOW: "follow",
          SOCIAL: "social",
          ROOM_USER: "roomUser",
          ERROR: "error",
          DISCONNECT: "disconnect",
        },
        ControlEvent: {},
      },
    ) as TestPlatform;

    platform.eventFactory = createTikTokEventFactory({
      platformName: "tiktok",
      getTimestamp: (data: UnknownRecord) =>
        typeof data.timestamp === "string" ? data.timestamp : "2024-01-01T00:00:00Z",
      normalizeUserData: (data) => platform._normalizeUserData(data),
      getPlatformMessageId: (data) => platform._getPlatformMessageId(data),
      buildEventMetadata: (metadata) => platform._buildEventMetadata(metadata),
    });

    platform.emit = (eventName: string | symbol, ...args: unknown[]) => {
      const payload = args[0];
      if (typeof eventName === "string" && payload && typeof payload === "object") {
        emitted.push({ evt: eventName, payload: payload as UnknownRecord });
      }
      return true;
    };
  });

  it("emits paypiggy with normalized user and provided metadata", () => {
    const handler = platform.eventFactory.createSubscription({
      user: { userId: "u1", uniqueId: "memberuser", nickname: "MemberUser" },
      message: "Thanks for the support!",
      tier: "basic",
      months: 1,
      timestamp: "2024-01-01T00:00:00Z",
    });

    platform.emit("platform:event", handler);

    const paypiggyEvent = requirePlatformEvent();
    expect(paypiggyEvent.type).toBe(PlatformEvents.PAYPIGGY);
    expect(paypiggyEvent.userId).toBe("memberuser");
    expect(paypiggyEvent.username).toBe("MemberUser");
    expect(paypiggyEvent.tier).toBe("basic");
    expect(paypiggyEvent.months).toBe(1);
    expect(paypiggyEvent.message).toBe("Thanks for the support!");
  });

  it("emits superfan paypiggy with superfan tier", () => {
    const handler = platform.eventFactory.createSuperfan({
      user: {
        userId: "sf1",
        uniqueId: "superfanuser",
        nickname: "SuperfanUser",
      },
      timestamp: "2024-01-01T00:00:00Z",
    });

    platform.emit("platform:event", handler);

    const paypiggyEvent = requirePlatformEvent();
    expect(paypiggyEvent.type).toBe(PlatformEvents.PAYPIGGY);
    expect(paypiggyEvent.tier).toBe("superfan");
  });

  it("does not default tier, months, or message when missing", () => {
    const handler = platform.eventFactory.createSubscription({
      user: { userId: "u2", uniqueId: "plainmember", nickname: "PlainMember" },
      timestamp: "2024-01-01T00:00:00Z",
    });

    platform.emit("platform:event", handler);

    const paypiggyEvent = requirePlatformEvent();
    expect(paypiggyEvent.type).toBe(PlatformEvents.PAYPIGGY);
    expect(paypiggyEvent.userId).toBe("plainmember");
    expect(paypiggyEvent.username).toBe("PlainMember");
    expect(paypiggyEvent.tier).toBeUndefined();
    expect(paypiggyEvent.months).toBeUndefined();
    expect(paypiggyEvent.message).toBeUndefined();
  });

  it("emits gift with coin normalization", () => {
    const handler = platform.eventFactory.createGift({
      platform: "tiktok",
      userId: "g1",
      username: "giftuser",
      giftType: "Rose",
      giftCount: 2,
      amount: 500,
      currency: "coins",
      unitAmount: 250,
      repeatCount: 2,
      timestamp: "2024-01-01T00:00:00Z",
      id: "gift-msg-1",
    });

    platform.emit("platform:event", handler);

    const giftEvent = requirePlatformEvent();
    expect(giftEvent.type).toBe(PlatformEvents.GIFT);
    expect(giftEvent.giftType).toBe("Rose");
    expect(giftEvent.giftCount).toBe(2);
    expect(giftEvent.amount).toBe(500);
    expect(giftEvent.currency).toBe("coins");
    expect(giftEvent.username).toBe("giftuser");
  });
});
