import { describe, test, afterEach, expect } from "bun:test";
import EventEmitter from "events";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import { YouTubePlatform } from "../../src/platforms/youtube";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";
import { createYouTubeConfigFixture } from "../helpers/config-fixture";
import { noOpLogger } from "../helpers/mock-factories";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";

type EventHandler = (event: unknown) => void;
type TestEventBus = {
  emit: (event: string, payload: unknown) => boolean;
  subscribe: (event: string, handler: EventHandler) => () => void;
};
type PlatformEventPayload = {
  type: string;
  platform: string;
  data: {
    count?: number;
    isLive?: boolean;
    streamId?: string;
    timestamp: string;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

function assertPlatformEventPayload(
  value: unknown,
): asserts value is PlatformEventPayload {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) throw new Error("Platform event must be an object");
  expect(typeof value.type).toBe("string");
  expect(typeof value.platform).toBe("string");
  expect(isRecord(value.data)).toBe(true);
  if (!isRecord(value.data)) {
    throw new Error("Platform event data must be an object");
  }
  expect(typeof value.data.timestamp).toBe("string");
}

const createEventBus = (): TestEventBus => {
  const emitter = new EventEmitter();
  return {
    emit: emitter.emit.bind(emitter),
    subscribe: (event: string, handler: EventHandler) => {
      emitter.on(event, handler);
      return () => emitter.off(event, handler);
    },
  };
};

const waitForPlatformEvent = (eventBus: TestEventBus) =>
  new Promise<PlatformEventPayload>((resolve) => {
    const unsubscribe = eventBus.subscribe(
      "platform:event",
      (event: unknown) => {
        unsubscribe();
        assertPlatformEventPayload(event);
        resolve(event);
      },
    );
  });

const createPlatform = () =>
  new YouTubePlatform(
    createYouTubeConfigFixture({ enabled: true, username: "test-channel" }),
    {
      logger: noOpLogger,
      USER_AGENTS: ["test-agent"],
      streamDetectionService: {
        detectLiveStreams: createMockFn().mockResolvedValue({
          success: true,
          videoIds: [],
        }),
      },
    },
  );

describe("YouTube stream status + viewer count event bus (integration)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("emits viewer-count events through lifecycle handlers", async () => {
    const eventBus = createEventBus();
    const lifecycle = new PlatformLifecycleService({
      config: { youtube: { enabled: true, username: "test-channel" } },
      eventBus,
      logger: noOpLogger,
    });
    const platform = createPlatform();
    platform.handlers = lifecycle.createDefaultEventHandlers("youtube");

    const eventPromise = waitForPlatformEvent(eventBus);

    try {
      platform.updateViewerCountForStream("test-stream-1", 123);

      const event = await eventPromise;

      expect(event.type).toBe(PlatformEvents.VIEWER_COUNT);
      expect(event.platform).toBe("youtube");
      expect(event.data.count).toBe(123);
      expect(event.data.streamId).toBe("test-stream-1");
      expect(Number.isNaN(Date.parse(event.data.timestamp))).toBe(false);
    } finally {
      lifecycle.dispose();
    }
  });

  test("emits stream-status events through lifecycle handlers", async () => {
    const eventBus = createEventBus();
    const lifecycle = new PlatformLifecycleService({
      config: { youtube: { enabled: true, username: "test-channel" } },
      eventBus,
      logger: noOpLogger,
    });
    const platform = createPlatform();
    platform.handlers = lifecycle.createDefaultEventHandlers("youtube");
    platform.connectionManager.connections.set("test-stream-1", {
      connection: null,
      state: "connected",
      metadata: {},
    });

    const eventPromise = waitForPlatformEvent(eventBus);

    try {
      await platform.disconnectFromYouTubeStream(
        "test-stream-1",
        "test-disconnect",
      );

      const event = await eventPromise;

      expect(event.type).toBe(PlatformEvents.STREAM_STATUS);
      expect(event.platform).toBe("youtube");
      expect(event.data.isLive).toBe(false);
      expect(Number.isNaN(Date.parse(event.data.timestamp))).toBe(false);
    } finally {
      lifecycle.dispose();
    }
  });
});
