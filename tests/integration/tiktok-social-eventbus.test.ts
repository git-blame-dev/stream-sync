import { describe, test, afterEach, expect } from "bun:test";
import EventEmitter from "events";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import { TikTokPlatform } from "../../src/platforms/tiktok";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";
import { createTikTokConfigFixture } from "../helpers/config-fixture";
import {
  createMockTikTokPlatformDependencies,
  noOpLogger,
} from "../helpers/mock-factories";
import {
  createTikTokFollowEvent,
  createTikTokShareEvent,
} from "../helpers/tiktok-test-data";
import { restoreAllMocks } from "../helpers/bun-mock-utils";

const createEventBus = () => {
  const emitter = new EventEmitter();
  return {
    emit: emitter.emit.bind(emitter),
    subscribe: (event, handler) => {
      emitter.on(event, handler);
      return () => emitter.off(event, handler);
    },
  };
};

const waitForPlatformEvent = (eventBus) =>
  new Promise((resolve) => {
    const unsubscribe = eventBus.subscribe("platform:event", (event) => {
      unsubscribe();
      resolve(event);
    });
  });

const createPlatform = () =>
  new TikTokPlatform(
    createTikTokConfigFixture({ enabled: true }),
    createMockTikTokPlatformDependencies(),
  );

describe("TikTok social event bus routing (integration)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("emits follow events through lifecycle handlers", async () => {
    const eventTimestampMs = Date.parse("2025-01-20T12:00:00.000Z");
    const eventBus = createEventBus();
    const lifecycle = new PlatformLifecycleService({
      config: { tiktok: { enabled: true } },
      eventBus,
      logger: noOpLogger,
    });
    const platform = createPlatform();
    platform.handlers = lifecycle.createDefaultEventHandlers("tiktok");

    const followEvent = createTikTokFollowEvent({
      user: { uniqueId: "test-user-follow", nickname: "test-user-follow" },
      common: { createTime: eventTimestampMs },
    });
    const eventPromise = waitForPlatformEvent(eventBus);

    try {
      await platform.handleTikTokSocial(followEvent);

      const event = await eventPromise;
      const expectedTimestamp = new Date(eventTimestampMs).toISOString();

      expect(event.type).toBe(PlatformEvents.FOLLOW);
      expect(event.platform).toBe("tiktok");
      expect(event.data.userId).toBe("test-user-follow");
      expect(event.data.username).toBe("test-user-follow");
      expect(event.data.timestamp).toBe(expectedTimestamp);
    } finally {
      lifecycle.dispose();
    }
  });

  test("emits share events through lifecycle handlers", async () => {
    const eventTimestampMs = Date.parse("2025-01-20T12:00:00.000Z");
    const eventBus = createEventBus();
    const lifecycle = new PlatformLifecycleService({
      config: { tiktok: { enabled: true } },
      eventBus,
      logger: noOpLogger,
    });
    const platform = createPlatform();
    platform.handlers = lifecycle.createDefaultEventHandlers("tiktok");

    const shareEvent = createTikTokShareEvent({
      user: { uniqueId: "test-user-share", nickname: "test-user-share" },
      common: { createTime: eventTimestampMs },
    });
    const eventPromise = waitForPlatformEvent(eventBus);

    try {
      await platform.handleTikTokSocial(shareEvent);

      const event = await eventPromise;
      const expectedTimestamp = new Date(eventTimestampMs).toISOString();

      expect(event.type).toBe(PlatformEvents.SHARE);
      expect(event.platform).toBe("tiktok");
      expect(event.data.userId).toBe("test-user-share");
      expect(event.data.username).toBe("test-user-share");
      expect(event.data.timestamp).toBe(expectedTimestamp);
    } finally {
      lifecycle.dispose();
    }
  });
});
