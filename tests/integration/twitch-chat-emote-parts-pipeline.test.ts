import { describe, test, expect } from "bun:test";
import EventEmitter from "events";

import { PlatformEventRouter } from "../../src/services/PlatformEventRouter.ts";
import { ChatNotificationRouter } from "../../src/services/ChatNotificationRouter.ts";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";
import { createConfigFixture } from "../helpers/config-fixture";
import { createMockDisplayQueue, noOpLogger } from "../helpers/mock-factories";

type ChatRouterRuntime = {
  config: ReturnType<typeof createConfigFixture>;
  displayQueue: ReturnType<typeof createMockDisplayQueue>;
  handleChatMessage: (
    platform: string,
    normalizedData: Record<string, unknown>,
  ) => Promise<unknown>;
};

type TestEventBus = {
  emit: (event: string, payload: unknown) => boolean;
  subscribe: (
    event: string,
    handler: (payload: unknown) => Promise<void>,
  ) => () => void;
};

type QueuedChatItem = {
  type: string;
  platform: string;
  data: { message: unknown; isPaypiggy?: unknown };
};

function expectQueuedChatItem(value: unknown): asserts value is QueuedChatItem {
  expect(value).toEqual(
    expect.objectContaining({
      type: expect.any(String),
      platform: expect.any(String),
      data: expect.objectContaining({ message: expect.anything() }),
    }),
  );
}

const createEventBus = (): TestEventBus => {
  const emitter = new EventEmitter();
  return {
    emit: (event, payload) => emitter.emit(event, payload),
    subscribe: (event, handler) => {
      const listener = (payload: unknown) => {
        void handler(payload);
      };
      emitter.on(event, listener);
      return () => emitter.off(event, listener);
    },
  };
};

describe("Twitch emote chat parts pipeline (integration)", () => {
  test("preserves canonical message.parts from router to display queue", async () => {
    const eventBus = createEventBus();
    const config = createConfigFixture({
      general: {
        messagesEnabled: true,
        logChatMessages: false,
      },
      twitch: {
        enabled: true,
        messagesEnabled: true,
      },
      obs: { enabled: false },
    });
    const displayQueue = createMockDisplayQueue();
    const runtime: ChatRouterRuntime = {
      config,
      displayQueue,
      handleChatMessage: async (_platform, _normalizedData) => {},
    };
    const chatRouter = new ChatNotificationRouter({
      runtime,
      logger: noOpLogger,
      config,
    });

    runtime.handleChatMessage = (platform, normalizedData) =>
      chatRouter.handleChatMessage(platform, normalizedData);

    const platformEventRouter = new PlatformEventRouter({
      eventBus,
      runtime,
      notificationManager: { handleNotification: async () => {} },
      config,
      logger: noOpLogger,
    });

    try {
      eventBus.emit("platform:event", {
        platform: "twitch",
        type: PlatformEvents.CHAT_MESSAGE,
        data: {
          username: "test-chat-user-name",
          userId: "test-chat-user-id",
          avatarUrl:
            "https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0",
          message: {
            text: "",
            parts: [
              {
                type: "emote",
                platform: "twitch",
                emoteId: "emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7",
                imageUrl:
                  "https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0",
              },
            ],
          },
          timestamp: "2024-01-01T00:00:00.000Z",
          isMod: false,
          isPaypiggy: false,
          isBroadcaster: false,
          metadata: {},
        },
      });

      await new Promise(setImmediate);

      expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
      const firstCall = displayQueue.addItem.mock.calls.at(0);
      expect(firstCall).toBeDefined();
      if (!firstCall) throw new Error("Expected a queued chat item");
      const [queued] = firstCall;
      expectQueuedChatItem(queued);
      expect(queued.type).toBe("chat");
      expect(queued.platform).toBe("twitch");
      expect(queued.data.message).toEqual({
        text: "",
        parts: [
          {
            type: "emote",
            platform: "twitch",
            emoteId: "emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7",
            imageUrl:
              "https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0",
          },
        ],
      });
      expect(queued.data.isPaypiggy).toBe(false);
    } finally {
      platformEventRouter.dispose();
    }
  });
});
