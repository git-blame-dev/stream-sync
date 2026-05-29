import { describe, test, beforeEach, afterEach, expect } from "bun:test";

import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { wireStreamStatusHandlers } from "../../src/viewer-count/stream-status-handler.ts";
import { ViewerCountSystem } from "../../src/utils/viewer-count.ts";
import { createConfigFixture } from "../helpers/config-fixture";
import { noOpLogger } from "../helpers/mock-factories";

type EventHandler = (payload: unknown) => Promise<unknown> | unknown;
type TestEventBus = {
  subscribe: (event: string, handler: EventHandler) => () => void;
  emit: (event: string, payload: unknown) => Promise<void>;
};
type TestPlatforms = {
  youtube: {
    getViewerCount: () => Promise<number>;
  };
};

const createEventBus = (): TestEventBus => {
  const listeners = new Map<string, EventHandler[]>();
  return {
    subscribe(event: string, handler: EventHandler) {
      const existing = listeners.get(event) ?? [];
      existing.push(handler);
      listeners.set(event, existing);
      return () => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter(
            (fn: EventHandler) => fn !== handler,
          ),
        );
      };
    },
    async emit(event: string, payload: unknown) {
      const handlers = listeners.get(event) ?? [];
      await Promise.all(handlers.map((handler) => handler(payload)));
    },
  };
};

describe("YouTube stream-status viewer count integration (smoke)", () => {
  afterEach(async () => {
    restoreAllMocks();
    if (viewerCountSystem) {
      viewerCountSystem.stopPolling();
      await viewerCountSystem.cleanup();
    }
  });

  let viewerCountSystem: ViewerCountSystem | null;
  let eventBus: TestEventBus;
  let platforms: TestPlatforms;

  beforeEach(async () => {
    platforms = {
      youtube: {
        getViewerCount: createMockFn().mockResolvedValue(42),
      },
    };

    eventBus = createEventBus();
    viewerCountSystem = new ViewerCountSystem({
      platformProvider: () => platforms,
      config: createConfigFixture(),
      logger: noOpLogger,
    });

    await viewerCountSystem.initialize();
    viewerCountSystem.startPolling(); // YouTube starts as offline, so no polling yet

    wireStreamStatusHandlers({
      eventBus,
      viewerCountSystem,
    });
  });

  test("starts polling YouTube when stream status is live and records viewer count", async () => {
    const activeViewerCountSystem = viewerCountSystem;
    expect(activeViewerCountSystem).not.toBeNull();
    if (activeViewerCountSystem === null) {
      throw new Error("Expected initialized viewer count system");
    }

    await eventBus.emit("platform:event", {
      platform: "youtube",
      type: "platform:stream-status",
      data: { isLive: true, timestamp: new Date().toISOString() },
    });

    expect(platforms.youtube.getViewerCount).toHaveBeenCalled();
    expect(activeViewerCountSystem.counts.youtube).toBe(42);
    expect(activeViewerCountSystem.isStreamLive("youtube")).toBe(true);
    expect(activeViewerCountSystem.pollingHandles.youtube).toBeDefined();
  });
});
