import { vi, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { DisplayQueueItem } from "../../../src/interfaces/DisplayQueue";

import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";

import { EventEmitter } from "node:events";
import NotificationManager from "../../../src/notifications/NotificationManager";
import { ChatNotificationRouter } from "../../../src/services/ChatNotificationRouter.ts";

type QueueItem = DisplayQueueItem;

type NotificationManagerLike = {
  handleNotification: (
    type: string,
    platform: string,
    data: Record<string, unknown>,
  ) => Promise<unknown>;
};

type ChatNotificationRouterLike = {
  enqueueChatMessage: (
    platform: string,
    author: Record<string, unknown>,
    message: string,
  ) => void;
  queueGreeting: (
    platform: string,
    username: string | undefined,
    options: {
      userId?: unknown;
      avatarUrl?: unknown;
      priority?: number;
      greetingProfile?:
        | ({ id: string; identities: string[]; greetingCommand: string } & Record<string, unknown>)
        | null
        | undefined;
    },
  ) => Promise<unknown>;
};

describe("Display items avoid hardcoded durations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("NotificationManager items", () => {
    let queuedItems: QueueItem[];
    let notificationManager: NotificationManagerLike;

    beforeEach(() => {
      queuedItems = [];
      notificationManager = new NotificationManager({
        logger: noOpLogger,
        displayQueue: {
          addItem: (item: QueueItem) => { queuedItems.push(item); return [item]; },
          getQueueLength: () => queuedItems.length,
        },
        eventBus: new EventEmitter(),
        constants: require("../../../src/core/constants"),
        config: createConfigFixture(),
        vfxCommandService: {
          executeCommand: vi.fn<(...args: unknown[]) => Promise<{ success: true; }>>().mockResolvedValue({ success: true }),
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
        userTrackingService: {
          isFirstMessage: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
        },
      });
    });

    it("enqueues follow notifications without a duration property", async () => {
      await notificationManager.handleNotification(
        "platform:follow",
        "tiktok",
        { username: "Follower", userId: "f-1" },
      );

      expect(queuedItems[0]).toBeDefined();
      expect(queuedItems[0]).not.toHaveProperty("duration");
    });
  });

  describe("ChatNotificationRouter items", () => {
    let queuedItems: QueueItem[];
    let router: ChatNotificationRouterLike;

    beforeEach(() => {
      queuedItems = [];
      const runtime = {
        displayQueue: {
          addItem: (item: QueueItem) => { queuedItems.push(item); return [item]; },
          addSequence: (items: QueueItem[]) => { queuedItems.push(...items); return items; },
        },
        config: createConfigFixture(),
        commandCooldownService: {
          checkUserCooldown: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
          updateUserCooldown: vi.fn<(...args: unknown[]) => unknown>(),
          checkGlobalCooldown: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
        },
        vfxCommandService: {
          getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
        },
      };

      router = new ChatNotificationRouter({
        runtime,
        logger: noOpLogger,
        config: createConfigFixture(),
      });
    });

    it("enqueues chat messages without a duration property", () => {
      router.enqueueChatMessage(
        "youtube",
        {
          userId: "u-2",
          username: "Chatter",
          displayName: "Chatter",
          message: "Hello world!",
        },
        "Hello world!",
      );

      expect(queuedItems[0]).toBeDefined();
      expect(queuedItems[0]).not.toHaveProperty("duration");
    });

    it("queues greetings without a duration property", async () => {
      await router.queueGreeting("youtube", "Greeter", {});

      expect(queuedItems[0]).toBeDefined();
      expect(queuedItems[0]).not.toHaveProperty("duration");
    });
  });
});
