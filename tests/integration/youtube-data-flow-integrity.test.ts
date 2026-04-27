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
import { createTextProcessingManager } from "../../src/utils/text-processing";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import {
  createConfigFixture,
  createYouTubeConfigFixture,
} from "../helpers/config-fixture";

initializeTestLogging();

const realSuperChat = getSyntheticFixture("youtube", "superchat");

const createEventBus = () => {
  const emitter = new EventEmitter();
  return {
    emit: emitter.emit.bind(emitter),
    on: emitter.on.bind(emitter),
    subscribe: (event, handler) => {
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
  let capturedPayload;

  platform.handlers = {
    ...(platform.handlers || {}),
    onGift: (payload) => {
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
  const textProcessing = createTextProcessingManager({ logger });
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
    textProcessing,
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

    expect(capturedPayload).toBeDefined();
    expect(capturedPayload.type).toBe("platform:gift");
    expect(capturedPayload.platform).toBe("youtube");
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

    expect(result.success).toBe(true);
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
