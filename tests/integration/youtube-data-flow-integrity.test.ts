import { describe, test, afterEach, expect } from "bun:test";

import EventEmitter from "events";
import NotificationManager from "../../src/notifications/NotificationManager";
import { YouTubePlatform } from "../../src/platforms/youtube";
import {
  initializeTestLogging,
  createMockPlatformDependencies,
} from "../helpers/test-setup";
import { getSyntheticFixture } from "../helpers/platform-test-data";
import { createMockDisplayQueue, noOpLogger } from "../helpers/mock-factories";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import {
  createConfigFixture,
  createYouTubeConfigFixture,
} from "../helpers/config-fixture";

initializeTestLogging();

const realSuperChat = getSyntheticFixture("youtube", "superchat");

type EventHandler = (event: unknown) => void;
type TestEventBus = {
  emit: (event: string, payload: unknown) => boolean;
  on: (event: string, handler: EventHandler) => EventEmitter;
  subscribe: (event: string, handler: EventHandler) => () => void;
};
type YouTubeGiftPayload = {
  type: "platform:gift";
  platform: "youtube";
  id: string;
  username: string;
  timestamp: string;
  displayMessage?: never;
  ttsMessage?: never;
  logMessage?: never;
  [key: string]: unknown;
};
type NotificationOutput = {
  displayMessage: string;
  ttsMessage: string;
  logMessage: string;
};
type NotificationResult = {
  success: boolean;
  notificationData?: NotificationOutput;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

function assertYouTubeGiftPayload(
  value: unknown,
): asserts value is YouTubeGiftPayload {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) {
    throw new Error("YouTube gift payload must be an object");
  }
  expect(value.type).toBe("platform:gift");
  expect(value.platform).toBe("youtube");
  expect(typeof value.id).toBe("string");
  expect(typeof value.username).toBe("string");
  expect(typeof value.timestamp).toBe("string");
}

function assertNotificationResult(
  value: unknown,
): asserts value is NotificationResult & {
  notificationData: NotificationOutput;
} {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) throw new Error("Notification result must be an object");
  expect(value.success).toBe(true);
  expect(isRecord(value.notificationData)).toBe(true);
  if (!isRecord(value.notificationData)) {
    throw new Error("Notification data must be an object");
  }
  expect(typeof value.notificationData.displayMessage).toBe("string");
  expect(typeof value.notificationData.ttsMessage).toBe("string");
  expect(typeof value.notificationData.logMessage).toBe("string");
}

const createEventBus = (): TestEventBus => {
  const emitter = new EventEmitter();
  return {
    emit: emitter.emit.bind(emitter),
    on: emitter.on.bind(emitter),
    subscribe: (event: string, handler: EventHandler) => {
      emitter.on(event, handler);
      return () => emitter.off(event, handler);
    },
  };
};

const createPlatformHarness = () => {
  const logger = noOpLogger;
  const platformConfig = createYouTubeConfigFixture({
    enabled: true,
    username: "test-channel",
  });
  const dependencies = createMockPlatformDependencies("youtube", { logger });
  const platform = new YouTubePlatform(platformConfig, dependencies);
  let capturedPayload: unknown;

  platform.handlers = {
    ...(platform.handlers || {}),
    onGift: (payload: unknown) => {
      capturedPayload = payload;
    },
  };

  return {
    platform,
    getCapturedPayload: () => capturedPayload,
  };
};

const createNotificationManagerHarness = () => {
  const displayQueue = createMockDisplayQueue();
  const logger = noOpLogger;
  const eventBus = createEventBus();
  const config = createConfigFixture({
    general: {
      debugEnabled: false,
      giftsEnabled: true,
    },
    youtube: { enabled: true },
  });

  const notificationManager = new NotificationManager({
    displayQueue,
    logger,
    eventBus,
    config,
    constants: require("../../src/core/constants"),
    obsGoals: { processDonationGoal: createMockFn() },
    vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
    userTrackingService: {
      isFirstMessage: createMockFn().mockResolvedValue(false),
    },
  });

  return {
    displayQueue,
    notificationManager,
  };
};

describe("YouTube data flow integrity", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("builds user-facing output from platform event payloads", async () => {
    const { platform, getCapturedPayload } = createPlatformHarness();
    await platform.handleChatMessage(realSuperChat);
    const capturedPayload = getCapturedPayload();

    assertYouTubeGiftPayload(capturedPayload);
    expect(capturedPayload.displayMessage).toBeUndefined();
    expect(capturedPayload.ttsMessage).toBeUndefined();
    expect(capturedPayload.logMessage).toBeUndefined();
    expect(capturedPayload.id).toBe(realSuperChat.item.id);
    expect(typeof capturedPayload.timestamp).toBe("string");
    expect(capturedPayload.timestamp.trim().length).toBeGreaterThan(0);

    const { displayQueue, notificationManager } =
      createNotificationManagerHarness();
    const result = await notificationManager.handleNotification(
      "platform:gift",
      capturedPayload.platform,
      capturedPayload,
    );

    assertNotificationResult(result);
    expect(result.notificationData.displayMessage).toContain("Super Chat");
    expect(result.notificationData.displayMessage).toContain(
      capturedPayload.username,
    );
    expect(result.notificationData.ttsMessage).toEqual(expect.any(String));
    expect(result.notificationData.ttsMessage.trim().length).toBeGreaterThan(0);
    expect(result.notificationData.logMessage).toEqual(expect.any(String));
    expect(result.notificationData.logMessage.trim().length).toBeGreaterThan(0);
    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
  });
});
