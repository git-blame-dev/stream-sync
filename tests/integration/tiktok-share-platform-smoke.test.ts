import { describe, test, afterEach, expect } from "bun:test";
import EventEmitter from "events";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import NotificationManager from "../../src/notifications/NotificationManager";
import { TikTokPlatform } from "../../src/platforms/tiktok";
import { createTestAppRuntime } from "../helpers/runtime-test-harness";
import {
  createMockDisplayQueue,
  createMockTikTokPlatformDependencies,
  noOpLogger,
} from "../helpers/mock-factories";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import {
  createConfigFixture,
  createTikTokConfigFixture,
} from "../helpers/config-fixture";
import { createTikTokShareEvent } from "../helpers/tiktok-test-data";
import { expectNoTechnicalArtifacts } from "../helpers/assertion-helpers";

type EventHandler = (payload: unknown) => void;
type RuntimeEventHandler = (payload: Record<string, unknown>) => void | Promise<void>;

type UserFacingNotificationData = {
  displayMessage: string;
  ttsMessage: string;
  logMessage: string;
  username: string;
};

type DisplayQueueItem = {
  type: string;
  platform: string;
  data: UserFacingNotificationData;
};

const createEventBus = () => {
  const emitter = new EventEmitter();
  return {
    emit: (event: string, payload: unknown) => {
      emitter.emit(event, payload);
    },
    on: (event: string, handler: EventHandler) => {
      emitter.on(event, handler);
    },
    subscribe: (event: string, handler: RuntimeEventHandler) => {
      emitter.on(event, handler);
      return () => emitter.off(event, handler);
    },
  };
};

const isDisplayQueueItem = (value: unknown): value is DisplayQueueItem => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  const data = item.data;
  if (!data || typeof data !== "object") {
    return false;
  }
  const notificationData = data as Record<string, unknown>;
  return (
    typeof item.type === "string" &&
    typeof item.platform === "string" &&
    typeof notificationData.username === "string" &&
    typeof notificationData.displayMessage === "string" &&
    typeof notificationData.ttsMessage === "string" &&
    typeof notificationData.logMessage === "string"
  );
};

const assertDisplayQueueItem = (value: unknown): DisplayQueueItem => {
  expect(isDisplayQueueItem(value)).toBe(true);
  if (!isDisplayQueueItem(value)) {
    throw new Error("Expected a typed display queue item");
  }
  return value;
};

const assertUserFacingOutput = (
  data: UserFacingNotificationData,
  { username }: { username: string },
) => {
  const fields = ["displayMessage", "ttsMessage", "logMessage"] as const;
  fields.forEach((field) => {
    expect(data[field].trim()).not.toBe("");
    expectNoTechnicalArtifacts(data[field]);
  });
  fields.forEach((field) => {
    expect(data[field]).toContain(username);
  });
};

describe("TikTok share platform flow (smoke)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("routes share through lifecycle, router, and display queue", async () => {
    const eventBus = createEventBus();
    const logger = noOpLogger;
    const displayQueue = createMockDisplayQueue();
    const configOverrides = {
      general: {
        sharesEnabled: true,
      },
      tiktok: {
        enabled: true,
        sharesEnabled: true,
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
      config: { tiktok: { enabled: true } },
      eventBus,
      logger,
    });

    const { runtime } = createTestAppRuntime(configOverrides, {
      eventBus,
      notificationManager,
      displayQueue,
      logger,
    });

    const platform = new TikTokPlatform(
      createTikTokConfigFixture({ enabled: true }),
      {
        ...createMockTikTokPlatformDependencies(),
        WebcastEvent: {
          CHAT: "chat",
          GIFT: "gift",
          FOLLOW: "follow",
          SOCIAL: "social",
          ROOM_USER: "roomUser",
          ERROR: "error",
          DISCONNECT: "disconnect",
        },
      },
    );
    platform.handlers =
      platformLifecycleService.createDefaultEventHandlers("tiktok");

    const eventTimestampMs = Date.parse("2025-01-20T12:00:00.000Z");
    const shareEvent = createTikTokShareEvent({
      user: { uniqueId: "test-user-share", nickname: "test-user-share" },
      common: { createTime: eventTimestampMs },
    });

    try {
      await platform.handleTikTokSocial(shareEvent);

      await Promise.resolve();

      expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
      const firstCall = displayQueue.addItem.mock.calls[0];
      expect(firstCall).toBeDefined();
      if (!firstCall) {
        throw new Error("Expected display queue addItem to be called");
      }
      const queued = assertDisplayQueueItem(firstCall[0]);
      expect(queued.type).toBe("platform:share");
      expect(queued.platform).toBe("tiktok");
      expect(queued.data.username).toBe("test-user-share");
      assertUserFacingOutput(queued.data, { username: "test-user-share" });
    } finally {
      runtime.platformEventRouter?.dispose();
      platformLifecycleService.dispose();
    }
  });
});
