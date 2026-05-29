import { describe, test, afterEach, expect } from "bun:test";
import EventEmitter from "events";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import { TwitchPlatform } from "../../src/platforms/twitch";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";
import { createTwitchConfigFixture } from "../helpers/config-fixture";
import { noOpLogger } from "../helpers/mock-factories";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";

type PlatformEventPayload = {
  type: string;
  platform: string;
  data: Record<string, unknown>;
};

type TestEventBus = {
  emit: (event: string, payload: unknown) => boolean;
  subscribe: (event: string, handler: (payload: unknown) => void) => () => void;
};

const isPlatformEventPayload = (value: unknown): value is PlatformEventPayload =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  "platform" in value &&
  "data" in value &&
  typeof value.type === "string" &&
  typeof value.platform === "string" &&
  typeof value.data === "object" &&
  value.data !== null;

const expectPlatformEventPayload = (value: unknown): PlatformEventPayload => {
  if (!isPlatformEventPayload(value)) {
    throw new Error("Expected a platform event payload");
  }
  return value;
};

const createEventBus = (): TestEventBus => {
  const emitter = new EventEmitter();
  return {
    emit: emitter.emit.bind(emitter),
    subscribe: (event: string, handler: (payload: unknown) => void) => {
      emitter.on(event, handler);
      return () => emitter.off(event, handler);
    },
  };
};

const waitForPlatformEvent = (eventBus: TestEventBus) =>
  new Promise<PlatformEventPayload>((resolve) => {
    const unsubscribe = eventBus.subscribe("platform:event", (event: unknown) => {
      unsubscribe();
      resolve(expectPlatformEventPayload(event));
    });
  });

const createPlatform = () =>
  new TwitchPlatform(createTwitchConfigFixture({ enabled: true }), {
    logger: noOpLogger,
    twitchAuth: {
      isReady: () => true,
      refreshTokens: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
    },
  });

describe("Twitch social event bus routing (integration)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("emits follow events through lifecycle handlers", async () => {
    const eventBus = createEventBus();
    const lifecycle = new PlatformLifecycleService({
      config: { twitch: { enabled: true } },
      eventBus,
      logger: noOpLogger,
    });
    const platform = createPlatform();
    platform.handlers = lifecycle.createDefaultEventHandlers("twitch");

    const eventPromise = waitForPlatformEvent(eventBus);

    try {
      await platform.handleFollowEvent({
        username: "test-user-follow",
        userId: "test-user-id-follow",
        timestamp: "2024-01-01T00:00:00.000Z",
      });

      const event = await eventPromise;

      expect(event.type).toBe(PlatformEvents.FOLLOW);
      expect(event.platform).toBe("twitch");
      expect(event.data.username).toBe("test-user-follow");
      expect(event.data.userId).toBe("test-user-id-follow");
      expect(event.data.timestamp).toBe("2024-01-01T00:00:00.000Z");
    } finally {
      lifecycle.dispose();
    }
  });

  test("emits raid events through lifecycle handlers", async () => {
    const eventBus = createEventBus();
    const lifecycle = new PlatformLifecycleService({
      config: { twitch: { enabled: true } },
      eventBus,
      logger: noOpLogger,
    });
    const platform = createPlatform();
    platform.handlers = lifecycle.createDefaultEventHandlers("twitch");

    const eventPromise = waitForPlatformEvent(eventBus);

    try {
      await platform.handleRaidEvent({
        username: "test-user-raider",
        userId: "test-user-id-raider",
        viewerCount: 42,
        timestamp: "2024-01-01T00:00:00.000Z",
      });

      const event = await eventPromise;

      expect(event.type).toBe(PlatformEvents.RAID);
      expect(event.platform).toBe("twitch");
      expect(event.data.username).toBe("test-user-raider");
      expect(event.data.userId).toBe("test-user-id-raider");
      expect(event.data.viewerCount).toBe(42);
      expect(event.data.timestamp).toBe("2024-01-01T00:00:00.000Z");
    } finally {
      lifecycle.dispose();
    }
  });
});
