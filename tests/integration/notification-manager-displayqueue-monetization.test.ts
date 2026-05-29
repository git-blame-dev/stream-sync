import { describe, test, beforeEach, afterEach, expect } from "bun:test";
import {
  createMockFn,
  clearAllMocks,
  restoreAllMocks,
  type TestMockFn,
} from "../helpers/bun-mock-utils";
import EventEmitter from "events";
import { PlatformEventRouter } from "../../src/services/PlatformEventRouter.ts";
import NotificationManager from "../../src/notifications/NotificationManager";
import { DisplayQueue } from "../../src/obs/display-queue";
import * as constants from "../../src/core/constants";
import { noOpLogger } from "../helpers/mock-factories";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";
import { createConfigFixture } from "../helpers/config-fixture";
import { waitFor } from "../helpers/event-driven-testing";

type EventBusHandler = (payload: unknown) => void | Promise<void>;
type EventBus = {
  emit: (eventName: string, payload: unknown) => boolean;
  on: (eventName: string, handler: EventBusHandler) => EventEmitter;
  subscribe: (eventName: string, handler: EventBusHandler) => () => void;
};
type MonetizationType =
  | "platform:giftpaypiggy"
  | "platform:gift"
  | "platform:paypiggy"
  | "platform:envelope";
type MonetizationPayload = Record<string, unknown> & {
  username: string;
  userId: string;
  id: string;
  timestamp: string;
};
type DisplayQueueItem = {
  type: MonetizationType;
  platform: string;
  data: Record<string, unknown>;
};
type RecordedVfxEvent = {
  commandKey: string;
  username: unknown;
  platform: string;
  userId: unknown;
  context: { source: string };
};
type RuntimePayload = Record<string, unknown> & { type?: MonetizationType };
type DisplayQueueAddItem = Parameters<DisplayQueue["addItem"]>[0];
type DisplayQueueObsManager = {
  isReady: () => Promise<boolean>;
  call: (requestType: string, payload: Record<string, unknown>) => Promise<unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const requireDisplayQueueItem = (value: unknown): DisplayQueueItem => {
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
  return {
    type: value.type as MonetizationType,
    platform: value.platform,
    data: value.data,
  };
};

const requireRecordedVfxEvent = (value: unknown): RecordedVfxEvent => {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value) || !isRecord(value.context)) {
    throw new Error("Expected recorded VFX event");
  }
  expect(typeof value.commandKey).toBe("string");
  expect(typeof value.platform).toBe("string");
  expect(value.context.source).toBe("display-queue");
  if (typeof value.commandKey !== "string" || typeof value.platform !== "string") {
    throw new Error("Recorded VFX event has invalid shape");
  }
  return {
    commandKey: value.commandKey,
    username: value.username,
    platform: value.platform,
    userId: value.userId,
    context: { source: "display-queue" },
  };
};

describe("Monetisation pipeline integration", () => {
  let eventBus: EventBus;
  let recordedEvents: RecordedVfxEvent[];
  let displayQueue: DisplayQueue;
  let addItemMock: TestMockFn<[DisplayQueueAddItem], void>;
  let notificationManager: NotificationManager;
  let router: PlatformEventRouter;
  let config: ReturnType<typeof createConfigFixture>;
  const fixedTimestamp = "2025-01-01T00:00:00.000Z";

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

  beforeEach(() => {
    eventBus = createEventBus();
    recordedEvents = [];
    eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (data) => {
      recordedEvents.push(requireRecordedVfxEvent(data));
    });

    const displayQueueConfig = {
      autoProcess: false,
      maxQueueSize: 25,
      ttsEnabled: false,
      chat: {
        sourceName: "chat-source",
        sceneName: "chat-scene",
        groupName: "chat-group",
        platformLogos: {},
      },
      notification: {
        sourceName: "notif-source",
        sceneName: "notif-scene",
        groupName: "notif-group",
        platformLogos: {},
      },
      obs: { ttsTxt: "tts-source" },
      vfx: { vfxFilePath: "/test/vfx/path" },
      twitch: {},
      youtube: {},
      tiktok: {},
    };

    const mockObs: DisplayQueueObsManager = {
      isReady: createMockFn().mockResolvedValue(true),
      call: createMockFn().mockResolvedValue({ success: true }),
    };

    displayQueue = new DisplayQueue(
      mockObs,
      displayQueueConfig,
      constants,
      eventBus,
    );
    displayQueue.playGiftVideoAndAudio = createMockFn().mockResolvedValue();
    displayQueue.isTTSEnabled = createMockFn(() => false);
    displayQueue.getDuration = createMockFn(() => 0);
    const originalAddItem = displayQueue.addItem.bind(displayQueue);
    addItemMock = createMockFn<[DisplayQueueAddItem], void>((item) => {
      originalAddItem(item);
    });
    displayQueue.addItem = addItemMock;

    displayQueue.processQueue = createMockFn(async () => {
      while (displayQueue.queue.length > 0) {
        const item = requireDisplayQueueItem(displayQueue.queue.shift());
        const commandKey =
          typeof item.data.commandKey === "string"
            ? item.data.commandKey
            : item.type === "platform:paypiggy"
              ? "paypiggies"
              : "gifts";
        eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, {
          commandKey,
          username: item.data?.username,
          platform: item.platform,
          userId: item.data?.userId,
          context: { source: "display-queue" },
        });
      }
    });

    const vfxCommandService = {
      executeCommand: createMockFn(),
      getVFXConfig: createMockFn(async (commandKey) => ({
        commandKey,
        command: `!${commandKey}`,
        filename: `${commandKey}.mp4`,
        mediaSource: "vfx top",
        vfxFilePath: "/test/vfx/path",
        duration: 10,
      })),
    };

    config = createConfigFixture({
      general: {
        giftsEnabled: true,
        paypiggiesEnabled: true,
      },
      twitch: {},
      youtube: {},
      tiktok: {},
    });

    notificationManager = new NotificationManager({
      logger: noOpLogger,
      constants,
      obsGoals: { processDonationGoal: createMockFn() },
      displayQueue: {
        addItem: (item: Record<string, unknown>) => {
          displayQueue.addItem(requireDisplayQueueItem(item));
        },
        getQueueLength: () => displayQueue.queue.length,
      },
      eventBus,
      config,
      vfxCommandService,
      userTrackingService: {
        isFirstMessage: createMockFn().mockResolvedValue(false),
      },
    });

    const runtime = {
      handleGiftNotification: createMockFn(
        (platform: string, _username: unknown, payload: RuntimePayload) =>
        notificationManager.handleNotification(
          payload.type || "platform:gift",
          platform,
          payload,
        ),
      ),
      handleGiftPaypiggyNotification: createMockFn(
        (platform: string, _username: unknown, payload: RuntimePayload) =>
          notificationManager.handleNotification(
            "platform:giftpaypiggy",
            platform,
            payload,
          ),
      ),
      handlePaypiggyNotification: createMockFn(
        (platform: string, _username: unknown, payload: RuntimePayload) =>
        notificationManager.handleNotification(
          "platform:paypiggy",
          platform,
          payload,
        ),
      ),
      handleEnvelopeNotification: createMockFn(
        (platform: string, payload: RuntimePayload) =>
        notificationManager.handleNotification(
          "platform:envelope",
          platform,
          payload,
        ),
      ),
    };

    router = new PlatformEventRouter({
      eventBus,
      runtime,
      notificationManager,
      config,
      logger: noOpLogger,
    });
  });

  afterEach(() => {
    router?.dispose();
    if (displayQueue && typeof displayQueue.stop === "function") {
      displayQueue.stop();
    }
    clearAllMocks();
    restoreAllMocks();
  });

  const flows: Array<
    {
      platform: string;
      type: MonetizationType;
      expectedCommandKey: string;
      username: string;
      userId: string;
      giftType?: string;
      giftCount?: number;
      amount?: number;
      currency?: string;
    }
  > = [
    {
      platform: "youtube",
      type: "platform:giftpaypiggy",
      expectedCommandKey: "gifts",
      username: "GiftPilot",
      userId: "yt-gift-1",
    },
    {
      platform: "youtube",
      type: "platform:gift",
      giftType: "Super Chat",
      giftCount: 1,
      amount: 5,
      currency: "USD",
      expectedCommandKey: "gifts",
      username: "ChatPilot",
      userId: "yt-superchat-2",
    },
    {
      platform: "youtube",
      type: "platform:gift",
      giftType: "Super Sticker",
      giftCount: 1,
      amount: 10,
      currency: "USD",
      expectedCommandKey: "gifts",
      username: "StickerPilot",
      userId: "yt-sticker-3",
    },
    {
      platform: "twitch",
      type: "platform:giftpaypiggy",
      expectedCommandKey: "gifts",
      username: "SubPilot",
      userId: "tw-giftpaypiggy-4",
    },
    {
      platform: "twitch",
      type: "platform:gift",
      giftType: "bits",
      giftCount: 1,
      amount: 100,
      currency: "bits",
      expectedCommandKey: "gifts",
      username: "BitsPilot",
      userId: "tw-bits-5",
    },
    {
      platform: "tiktok",
      type: "platform:paypiggy",
      expectedCommandKey: "paypiggies",
      username: "MemberPilot",
      userId: "tt-paypiggy-7",
    },
    {
      platform: "tiktok",
      type: "platform:envelope",
      giftType: "Treasure Chest",
      giftCount: 1,
      amount: 100,
      currency: "coins",
      expectedCommandKey: "gifts",
      username: "ChestPilot",
      userId: "tt-envelope-1",
    },
  ];

  test.each(flows)(
    "routes %s %s with canonical command key",
    async ({
      platform,
      type,
      expectedCommandKey,
      username,
      userId,
      giftType,
      giftCount,
      amount,
      currency,
    }) => {
      recordedEvents.length = 0;

      const baseData: MonetizationPayload = {
        username,
        userId,
        id: `event-${userId}`,
        timestamp: fixedTimestamp,
      };
      const typeData: Partial<Record<MonetizationType, Record<string, unknown>>> = {
        "platform:giftpaypiggy": { giftCount: 5, tier: "1000" },
        "platform:paypiggy": { membershipLevel: "Member", months: 2 },
      };
      const payload = {
        ...baseData,
        ...(typeData[type] ?? {}),
        ...(giftType ? { giftType } : {}),
        ...(giftCount ? { giftCount } : {}),
        ...(amount !== undefined ? { amount } : {}),
        ...(currency ? { currency } : {}),
      };

      if (type === "platform:envelope") {
        await notificationManager.handleNotification(
          "platform:envelope",
          platform,
          payload,
        );
      } else {
        eventBus.emit("platform:event", {
          platform,
          type,
          data: payload,
        });
      }

      await waitFor(() => addItemMock.mock.calls.length === 1, {
        timeout: 100,
        interval: 1,
      });

      expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
      const queueItem = requireDisplayQueueItem(addItemMock.mock.calls[0]?.[0]);
      expect(typeof queueItem.data.displayMessage).toBe("string");
      expect(typeof queueItem.data.logMessage).toBe("string");
      if (
        typeof queueItem.data.displayMessage !== "string" ||
        typeof queueItem.data.logMessage !== "string"
      ) {
        throw new Error("Expected display and log copy");
      }
      expect(queueItem.data.displayMessage).toBeTruthy();
      expect(queueItem.data.logMessage).toBeTruthy();
      expect(queueItem.data.displayMessage).not.toMatch(/undefined|null/i);
      expect(queueItem.data.logMessage).not.toMatch(/undefined|null/i);

      await displayQueue.processQueue();

      expect(recordedEvents).toHaveLength(1);
      const recordedEvent = requireRecordedVfxEvent(recordedEvents[0]);
      expect(recordedEvent.commandKey).toBe(expectedCommandKey);
      expect(recordedEvent.username).toBe(username);
      expect(recordedEvent.platform).toBe(platform);
      expect(recordedEvent.userId).toBe(userId);
      expect(recordedEvent.context.source).toBe("display-queue");
    },
  );

  test("respects paypiggiesEnabled gating", async () => {
    config.general.paypiggiesEnabled = false;
    config.twitch.paypiggiesEnabled = false;

    eventBus.emit("platform:event", {
      platform: "twitch",
      type: "platform:paypiggy",
      data: {
        username: "GatedMember",
        userId: "member-1",
        id: "paypiggy-1",
        timestamp: fixedTimestamp,
      },
    });

    await displayQueue.processQueue();

    expect(displayQueue.queue).toHaveLength(0);
    expect(recordedEvents).toHaveLength(0);
  });

  test("respects giftsEnabled gating for all gift-like monetisation", async () => {
    config.general.giftsEnabled = false;
    config.twitch.giftsEnabled = false;

    eventBus.emit("platform:event", {
      platform: "twitch",
      type: "platform:gift",
      data: {
        username: "GatedGifter",
        userId: "gifter-1",
        id: "gift-1",
        timestamp: fixedTimestamp,
        bits: 100,
        giftType: "bits",
        giftCount: 1,
        amount: 100,
        currency: "bits",
      },
    });

    await displayQueue.processQueue();

    expect(displayQueue.queue).toHaveLength(0);
    expect(recordedEvents).toHaveLength(0);
  });

  test("normalizes paypiggy months/levels and builds copy/TTS/log without placeholders", async () => {
    eventBus.emit("platform:event", {
      platform: "youtube",
      type: "platform:paypiggy",
      data: {
        username: "RenewedMember",
        userId: "member-22",
        id: "paypiggy-2",
        timestamp: fixedTimestamp,
        membershipLevel: "Test Member Plus",
        months: 2,
      },
    });

    await waitFor(() => displayQueue.queue.length === 1, {
      timeout: 100,
      interval: 1,
    });

    expect(displayQueue.queue).toHaveLength(1);
    const item = requireDisplayQueueItem(displayQueue.queue[0]);
    expect(item.data.months).toBe(2);
    expect(item.data.displayMessage).toMatch(/2nd month/i);
    expect(item.data.displayMessage).toContain("Test Member Plus");
    expect(item.data.ttsMessage).toMatch(/2nd month/i);
    expect(item.data.logMessage).not.toMatch(/undefined|null/);
    expect(item.data.displayMessage).not.toMatch(/undefined|null/);
    expect(item.data.ttsMessage).not.toMatch(/undefined|null/);
  });
});
