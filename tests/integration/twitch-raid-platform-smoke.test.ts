import { describe, test, afterEach, expect } from "bun:test";
import EventEmitter from "events";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import NotificationManager from "../../src/notifications/NotificationManager";
import { TwitchPlatform } from "../../src/platforms/twitch";
import { createTestAppRuntime } from "../helpers/runtime-test-harness";
import { createMockDisplayQueue, noOpLogger } from "../helpers/mock-factories";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import {
  createConfigFixture,
  createTwitchConfigFixture,
} from "../helpers/config-fixture";
import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";
import { waitFor } from "../helpers/event-driven-testing";

type EventBusHandler = (payload: unknown) => void | Promise<void>;
type EventBus = {
  emit: (eventName: string, payload: unknown) => boolean;
  on: (eventName: string, handler: EventBusHandler) => EventEmitter;
  subscribe: (eventName: string, handler: EventBusHandler) => () => void;
};
type RuntimeOptions = NonNullable<Parameters<typeof createTestAppRuntime>[1]>;
type RuntimeEventBus = NonNullable<RuntimeOptions["eventBus"]>;
type QueueItem = {
  type: string;
  platform: string;
  data: Record<string, unknown>;
};
type RaidCopyExpectations = {
  username?: string;
  viewerCount?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const requireQueueItem = (value: unknown): QueueItem => {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) {
    throw new Error("Expected queued display item");
  }
  expect(typeof value.type).toBe("string");
  expect(typeof value.platform).toBe("string");
  expect(isRecord(value.data)).toBe(true);
  if (
    typeof value.type !== "string" ||
    typeof value.platform !== "string" ||
    !isRecord(value.data)
  ) {
    throw new Error("Queued display item has invalid shape");
  }
  return { type: value.type, platform: value.platform, data: value.data };
};

const createRuntimeEventBus = (eventBus: EventBus): RuntimeEventBus => ({
  emit: (eventName: string, payload: unknown) => {
    eventBus.emit(eventName, payload);
  },
  subscribe: (
    eventName: string,
    handler: (event: Record<string, unknown>) => void | Promise<void>,
  ) =>
    eventBus.subscribe(eventName, (payload) => {
      if (isRecord(payload)) {
        return handler(payload);
      }
      return handler({});
    }),
});

const createEventBus = (): EventBus => {
  const emitter = new EventEmitter();
  return {
    emit: emitter.emit.bind(emitter),
    on: emitter.on.bind(emitter),
    subscribe: (event: string, handler: EventBusHandler) => {
      emitter.on(event, handler);
      return () => {
        emitter.off(event, handler);
      };
    },
  };
};

const assertUserFacingOutput = (
  data: Record<string, unknown>,
  { username, viewerCount }: RaidCopyExpectations,
) => {
  const fields = ["displayMessage", "ttsMessage", "logMessage"];
  fields.forEach((field) => {
    expect(typeof data[field]).toBe("string");
    if (typeof data[field] !== "string") {
      throw new Error(`Expected ${field} to be notification copy`);
    }
    expect(typeof data[field]).toBe("string");
    expect(data[field].trim()).not.toBe("");
    expectNoTechnicalArtifacts(data[field]);
  });
  if (username) {
    fields.forEach((field) => {
      expect(data[field]).toContain(username);
    });
  }
  if (viewerCount !== undefined) {
    const countText = String(viewerCount);
    fields.forEach((field) => {
      expect(data[field]).toContain(countText);
    });
  }
};

describe("Twitch raid platform flow (smoke)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("routes raid through lifecycle, router, and display queue", async () => {
    const eventBus = createEventBus();
    const logger = noOpLogger;
    const displayQueue = createMockDisplayQueue();
    const configOverrides = {
      general: {
        raidsEnabled: true,
      },
      twitch: {
        enabled: true,
        raidsEnabled: true,
      },
      obs: { enabled: false },
    };
    const config = createConfigFixture(configOverrides);
    const notificationManager = new NotificationManager({
      displayQueue,
      logger,
      eventBus,
      config,
      constants: require("../../src/core/constants"),
      obsGoals: { processDonationGoal: createMockFn() },
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue(null),
      },
      userTrackingService: {
        isFirstMessage: createMockFn().mockResolvedValue(false),
      },
    });

    const platformLifecycleService = new PlatformLifecycleService({
      config: { twitch: { enabled: true } },
      eventBus,
      logger,
    });

    const { runtime } = createTestAppRuntime(configOverrides, {
      overrides: {
        eventBus: createRuntimeEventBus(eventBus),
        notificationManager,
        displayQueue,
        logger,
      },
    });

    const platform = new TwitchPlatform(
      createTwitchConfigFixture({ enabled: true }),
      {
        logger,
        twitchAuth: {
          isReady: () => true,
        },
      },
    );
    platform.handlers =
      platformLifecycleService.createDefaultEventHandlers("twitch");

    try {
      await platform.handleRaidEvent({
        username: "test-user-raider",
        userId: "test-user-id-raider",
        viewerCount: 42,
        timestamp: "2024-01-01T00:00:00.000Z",
      });

      await waitFor(() => displayQueue.addItem.mock.calls.length === 1, {
        timeout: 100,
        interval: 1,
      });

      expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
      const queued = requireQueueItem(displayQueue.addItem.mock.calls[0]?.[0]);
      expect(queued.type).toBe("platform:raid");
      expect(queued.platform).toBe("twitch");
      expect(queued.data.username).toBe("test-user-raider");
      expect(queued.data.viewerCount).toBe(42);
      assertUserFacingOutput(queued.data, {
        username: "test-user-raider",
        viewerCount: 42,
      });
    } finally {
      runtime.platformEventRouter?.dispose();
      platformLifecycleService.dispose();
    }
  });
});
