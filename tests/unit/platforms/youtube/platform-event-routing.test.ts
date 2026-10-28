import { describe, test, expect, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { noOpLogger } from "../../../helpers/mock-factories";
import { createMockFn, restoreAllMocks } from "../../../helpers/bun-mock-utils";

import { YouTubePlatform } from "../../../../src/platforms/youtube";
import { PlatformEvents } from "../../../../src/interfaces/PlatformEvents";
import { createMockPlatformDependencies } from "../../../helpers/test-setup";
import { createYouTubeConfigFixture } from "../../../helpers/config-fixture";

type PlatformPayload = {
  platform: string;
  [key: string]: unknown;
};

const isPlatformPayload = (value: unknown): value is PlatformPayload =>
  !!value &&
  typeof value === "object" &&
  "platform" in value &&
  typeof value.platform === "string";

const isEmittedPlatformEvent = (
  value: unknown,
): value is { platform: string; data: unknown } =>
  isPlatformPayload(value) && "data" in value;

describe("YouTube Platform Event Routing", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const baseConfig = createYouTubeConfigFixture({
    enabled: true,
    username: "test-channel",
  });

  const YOUTUBE_HANDLER_MAP = {
    [PlatformEvents.CHAT_MESSAGE]: {
      handlerName: "onChat",
      dataKey: "message",
    },
    [PlatformEvents.GIFT]: { handlerName: "onGift", dataKey: "giftType" },
    [PlatformEvents.GIFTPAYPIGGY]: {
      handlerName: "onGiftPaypiggy",
      dataKey: "giftCount",
    },
    [PlatformEvents.PAYPIGGY]: { handlerName: "onPaypiggy", dataKey: "tier" },
    [PlatformEvents.STREAM_STATUS]: {
      handlerName: "onStreamStatus",
      dataKey: "isLive",
    },
    [PlatformEvents.STREAM_DETECTED]: {
      handlerName: "onStreamDetected",
      dataKey: "newStreamIds",
    },
    [PlatformEvents.VIEWER_COUNT]: {
      handlerName: "onViewerCount",
      dataKey: "count",
    },
  };

  const FIXED_TIMESTAMP = "2024-06-15T12:00:00.000Z";

  const PAYLOAD_BY_TYPE = {
    [PlatformEvents.CHAT_MESSAGE]: {
      platform: "youtube",
      username: "test-user",
      userId: "test-user-id",
      message: { text: "test-message" },
      timestamp: FIXED_TIMESTAMP,
    },
    [PlatformEvents.GIFT]: {
      platform: "youtube",
      username: "test-user",
      userId: "test-user-id",
      giftType: "test-super-chat",
      giftCount: 1,
      amount: 5,
      currency: "USD",
      timestamp: FIXED_TIMESTAMP,
    },
    [PlatformEvents.GIFTPAYPIGGY]: {
      platform: "youtube",
      username: "test-user",
      userId: "test-user-id",
      giftCount: 5,
      tier: "test-tier-1",
      timestamp: FIXED_TIMESTAMP,
    },
    [PlatformEvents.PAYPIGGY]: {
      platform: "youtube",
      username: "test-user",
      userId: "test-user-id",
      tier: "test-member",
      months: 3,
      timestamp: FIXED_TIMESTAMP,
    },
    [PlatformEvents.STREAM_STATUS]: {
      platform: "youtube",
      isLive: true,
      timestamp: FIXED_TIMESTAMP,
    },
    [PlatformEvents.STREAM_DETECTED]: {
      platform: "youtube",
      newStreamIds: ["test-stream-1"],
      allStreamIds: ["test-stream-1"],
      detectionTime: 1000,
    },
    [PlatformEvents.VIEWER_COUNT]: {
      platform: "youtube",
      count: 42,
      timestamp: FIXED_TIMESTAMP,
    },
  } satisfies Record<string, PlatformPayload>;

  const createPlatform = (logger = noOpLogger) =>
    new YouTubePlatform(baseConfig, {
      ...createMockPlatformDependencies("youtube"),
      logger,
      streamDetectionService: {
        detectLiveStreams: createMockFn().mockResolvedValue({
          success: true,
          videoIds: [],
        }),
      },
    });

  test("isolates a throwing legacy observer while preserving synchronous publication and payload identity", () => {
    const reports: unknown[][] = [];
    const platform = createPlatform({ ...noOpLogger, error: (...args: unknown[]) => { reports.push(args); } });
    const order: string[] = [];
    const payload = { platform: "youtube", message: "synthetic private payload" };
    platform.on("platform:event", (event) => { expect(event.data).toBe(payload); order.push("local"); });
    platform.handlers.onChat = (received) => {
      expect(received).toBe(payload);
      order.push("handler");
      throw new Error("Bearer test-handler-secret");
    };
    expect(() => platform._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, payload)).not.toThrow();
    expect(order).toEqual(["local", "handler"]);
    expect(reports).toHaveLength(1);
    expect(JSON.stringify(reports)).not.toContain("test-handler-secret");
    expect(JSON.stringify(reports)).not.toContain(payload.message);
    platform.handlers.onChat = () => { order.push("healthy"); };
    platform._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, payload);
    expect(order).toEqual(["local", "handler", "local", "healthy"]);
  });

  test("contains a throwing legacy observer reporter without recursive reporting", () => {
    let attempts = 0;
    const platform = createPlatform({ ...noOpLogger, error: () => { attempts += 1; throw new Error("synthetic reporter failure"); } });
    platform.handlers.onChat = () => { throw new Error("synthetic callback failure"); };
    expect(() => platform._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, {})).not.toThrow();
    expect(attempts).toBe(1);
    platform.handlers.onChat = () => {};
    expect(() => platform._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, {})).not.toThrow();
    expect(attempts).toBe(1);
  });

  test("contains rejected legacy observers in a child runtime", () => {
    const child = spawnSync(process.execPath, ["test", import.meta.path, "-t", "YouTube legacy callback rejection child"], {
      encoding: "utf8", timeout: 15000, env: { ...process.env, STREAM_SYNC_LEGACY_OBSERVER_CHILD: "youtube" },
    });
    expect(child.status).toBe(0);
    expect(`${child.stdout}${child.stderr}`).toContain("1 pass");
  });

  test.skipIf(process.env.STREAM_SYNC_LEGACY_OBSERVER_CHILD !== "youtube")("YouTube legacy callback rejection child", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => { unhandled.push(error); };
    process.on("unhandledRejection", onUnhandled);
    try {
      let attempts = 0;
      let completeReport: () => void = () => {};
      let reporterThrows = false;
      const platform = createPlatform({ ...noOpLogger, error: () => {
        attempts += 1;
        completeReport();
        if (reporterThrows) throw new Error("synthetic reporter failure");
      } });
      const order: string[] = [];
      const payload = { platform: "youtube" };
      platform.on("platform:event", (event) => { expect(event.data).toBe(payload); order.push("local"); });
      for (const throws of [false, true]) {
        reporterThrows = throws;
        for (const mode of ["rejection", "then-getter"]) {
          const reported = new Promise<void>((resolve) => { completeReport = resolve; });
          platform.handlers.onChat = (received) => {
            expect(received).toBe(payload);
            order.push("handler");
            if (mode === "rejection") return Promise.reject(new Error("synthetic callback rejection"));
            return Object.defineProperty({}, "then", { get() { throw new Error("synthetic then getter failure"); } });
          };
          const start = order.length;
          platform._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, payload);
          order.push("returned");
          expect(order.slice(start)).toEqual(["local", "handler", "returned"]);
          await reported;
        }
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(attempts).toBe(4);
      expect(unhandled).toEqual([]);
      platform.handlers.onChat = () => { order.push("healthy"); };
      platform._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, payload);
      expect(order.slice(-2)).toEqual(["local", "healthy"]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  describe("handler map dispatch", () => {
    for (const [eventType, { handlerName, dataKey }] of Object.entries(
      YOUTUBE_HANDLER_MAP,
    )) {
      test(`${eventType} routes to ${handlerName} with payload data`, () => {
        const platform = createPlatform();
        const collected: PlatformPayload[] = [];
        platform.handlers = {
          ...platform.handlers,
          [handlerName]: (data: unknown) => {
            if (isPlatformPayload(data)) {
              collected.push(data);
            }
          },
        };

        const payload = { ...PAYLOAD_BY_TYPE[eventType] };
        platform._emitPlatformEvent(eventType, payload);

        expect(collected).toHaveLength(1);
        const [collectedEvent] = collected;
        if (!collectedEvent) {
          throw new Error("expected collected platform event");
        }
        expect(collectedEvent[dataKey]).toBeDefined();
        expect(collectedEvent.platform).toBe("youtube");
      });
    }
  });

  test("emits platform:event on local EventEmitter for all mapped types", () => {
    const platform = createPlatform();
    const emittedEvents: Array<{ platform: string; data: unknown }> = [];
    platform.on("platform:event", (event) => {
      if (isEmittedPlatformEvent(event)) {
        emittedEvents.push(event);
      }
    });

    for (const eventType of Object.keys(YOUTUBE_HANDLER_MAP)) {
      const payload = { ...PAYLOAD_BY_TYPE[eventType] };
      platform._emitPlatformEvent(eventType, payload);
    }

    expect(emittedEvents).toHaveLength(Object.keys(YOUTUBE_HANDLER_MAP).length);
    for (const event of emittedEvents) {
      expect(event.platform).toBe("youtube");
      expect(event.data).toBeDefined();
    }
  });

  test("handles missing handler without throwing", () => {
    const platform = createPlatform();
    platform.handlers = {};

    expect(() => {
      platform._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, {
        platform: "youtube",
        username: "test-user",
        message: { text: "test-message" },
      });
    }).not.toThrow();
  });

  test("handles null handlers without throwing", () => {
    const platform = createPlatform();
    Object.assign(platform, { handlers: null });

    expect(() => {
      platform._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, {
        platform: "youtube",
        message: { text: "test-message" },
      });
    }).not.toThrow();
  });

  test("unmapped event type does not invoke any handler", () => {
    const platform = createPlatform();
    const collected: unknown[] = [];
    platform.handlers = {
      onChat: (data) => collected.push(data),
      onGift: (data) => collected.push(data),
    };

    platform._emitPlatformEvent("platform:nonexistent", {
      platform: "youtube",
    });

    expect(collected).toHaveLength(0);
  });
});
