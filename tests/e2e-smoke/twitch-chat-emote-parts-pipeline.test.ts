import { describe, test, expect } from "bun:test";
import EventEmitter from "events";
import { createMockDisplayQueue, noOpLogger } from "../helpers/mock-factories";
import { createConfigFixture } from "../helpers/config-fixture";
import { createTwitchEventSubChatMessageEvent } from "../helpers/twitch-test-data";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";
import { TwitchPlatform } from "../../src/platforms/twitch.ts";
import { ChatNotificationRouter } from "../../src/services/ChatNotificationRouter.ts";
import { PlatformEventRouter } from "../../src/services/PlatformEventRouter.ts";

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
  data: { message: unknown };
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

describe("Twitch emote chat parts pipeline (smoke E2E)", () => {
  test("routes Twitch EventSub emote chat into display queue with canonical parts", async () => {
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

    const platform = new TwitchPlatform(config.twitch, {
      logger: noOpLogger,
      twitchAuth: {
        isReady: () => true,
        refreshTokens: async () => true,
      },
      RawPlatformDataLoggingService: class {
        async logRawPlatformData(): Promise<void> {}
      },
    });

    platform.handlers = {
      onChat: (payload) => {
        eventBus.emit("platform:event", {
          platform: "twitch",
          type: PlatformEvents.CHAT_MESSAGE,
          data: payload,
        });
      },
    };

    try {
      await platform.onMessageHandler(
        createTwitchEventSubChatMessageEvent({
          chatter_user_id: "test-smoke-user-id",
          chatter_user_name: "test-smoke-user-name",
          broadcaster_user_id: "test-smoke-broadcaster-id",
          timestamp: "2024-01-01T00:00:00.000Z",
        }),
      );

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
        text: "testEmote test message testEmote hello world this is a message to everyone testEmote how are we today?",
        parts: [
          {
            type: "emote",
            platform: "twitch",
            emoteId: "emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7",
            imageUrl:
              "https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0",
          },
          {
            type: "text",
            text: " test message ",
          },
          {
            type: "emote",
            platform: "twitch",
            emoteId: "emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7",
            imageUrl:
              "https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0",
          },
          {
            type: "text",
            text: " hello world this is a message to everyone ",
          },
          {
            type: "emote",
            platform: "twitch",
            emoteId: "emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7",
            imageUrl:
              "https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0",
          },
          {
            type: "text",
            text: " how are we today?",
          },
        ],
      });
    } finally {
      platformEventRouter.dispose();
      await platform.cleanup();
    }
  });
});
