import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { EventEmitter } from "events";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { TwitchPlatform } from "../../../src/platforms/twitch";
import { PlatformEvents } from "../../../src/interfaces/PlatformEvents";

type PlatformEventPayload = Record<string, unknown> & {
  type: string;
  months?: number;
  tier?: string;
  username?: string;
  giftCount?: number;
  amount?: number;
  currency?: string;
  giftType?: string;
  message?: string;
};

type EmittedPlatformEvent = { evt: string; payload: unknown };

const requirePlatformPayload = (payload: unknown): PlatformEventPayload => {
  if (
    payload === null ||
    typeof payload !== "object" ||
    !("type" in payload) ||
    typeof payload.type !== "string"
  ) {
    throw new Error("Expected platform event payload");
  }
  return { ...payload, type: payload.type };
};

describe("TwitchPlatform monetisation mapping", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let twitch: TwitchPlatform & { emit: (evt: string, payload: unknown) => boolean };
  let emitted: EmittedPlatformEvent[];

  beforeEach(() => {
    emitted = [];
    const eventBus = {
      emit: (evt: string, payload: unknown): void => { emitted.push({ evt, payload }); },
    };
    class MockTwitchEventSub {
      private readonly emitter = new EventEmitter();
      async initialize(): Promise<void> {}
      async sendMessage(): Promise<void> {}
      async disconnect(): Promise<void> {}
      on(eventName: string, handler: (...args: unknown[]) => void): void {
        this.emitter.on(eventName, handler);
      }
      removeListener(eventName: string, handler: (...args: unknown[]) => void): void {
        this.emitter.removeListener(eventName, handler);
      }
    }
    class MockRawPlatformDataLoggingService {
      async logRawPlatformData(): Promise<void> {}
    }

    twitch = new TwitchPlatform(
      { username: "tester" },
      {
        logger: noOpLogger,
        twitchAuth: {
          isReady: createMockFn().mockReturnValue(true),
        },
        RawPlatformDataLoggingService: MockRawPlatformDataLoggingService,
        TwitchEventSub: MockTwitchEventSub,
        eventBus,
      },
    );

    twitch.emit = (evt: string, payload: unknown): boolean => {
      emitted.push({ evt, payload });
      return true;
    };

    expect(twitch.eventFactory).toBeDefined();
  });

  it("emits paypiggy with normalized months and canonical type", async () => {
    const handler = twitch.eventFactory.createPaypiggyEvent({
      userId: "u1",
      username: "SubUser",
      tier: "2000",
      months: 5,
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    twitch.emit("platform:event", handler);

    const paypiggyEvent = requirePlatformPayload(emitted.find(
      (e) => e.evt === "platform:event",
    )?.payload);
    expect(paypiggyEvent.type).toBe(PlatformEvents.PAYPIGGY);
    expect(paypiggyEvent.months).toBe(5);
    expect(paypiggyEvent.tier).toBe("2000");
    expect(paypiggyEvent.username).toBe("SubUser");
  });

  it("emits giftpaypiggy with normalized giftCount", async () => {
    const handler = twitch.eventFactory.createGiftPaypiggyEvent({
      userId: "g1",
      username: "GiftUser",
      giftCount: 10,
      tier: "1000",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    twitch.emit("platform:event", handler);

    const giftEvent = requirePlatformPayload(emitted.find((e) => e.evt === "platform:event")?.payload);
    expect(giftEvent.type).toBe(PlatformEvents.GIFTPAYPIGGY);
    expect(giftEvent.giftCount).toBe(10);
    expect(giftEvent.tier).toBe("1000");
    expect(giftEvent.username).toBe("GiftUser");
  });

  it("emits gift with bits amount preserved", async () => {
    const handler = twitch.eventFactory.createGiftEvent({
      userId: "c1",
      username: "CheerUser",
      giftType: "bits",
      giftCount: 1,
      amount: 250,
      currency: "bits",
      message: "Great stream!",
      id: "bits-evt-1",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    twitch.emit("platform:event", handler);

    const giftEvent = requirePlatformPayload(emitted.find((e) => e.evt === "platform:event")?.payload);
    expect(giftEvent.type).toBe(PlatformEvents.GIFT);
    expect(giftEvent.amount).toBe(250);
    expect(giftEvent.currency).toBe("bits");
    expect(giftEvent.giftType).toBe("bits");
    expect(giftEvent.giftCount).toBe(1);
    expect(giftEvent.message).toBe("Great stream!");
    expect(giftEvent.username).toBe("CheerUser");
  });
});
