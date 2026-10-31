import { describe, test, afterEach, expect, spyOn } from "bun:test";
import { join } from "node:path";
import { restoreAllMocks } from "../helpers/bun-mock-utils";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture";
import { noOpLogger } from "../helpers/mock-factories";
import { createTwitchEventSubChatMessageEvent } from "../helpers/twitch-test-data";
import { TwitchAuth } from "../../src/auth/TwitchAuth.ts";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";
import { TwitchPlatform } from "../../src/platforms/twitch.ts";

type MainPresentationFixture = Awaited<
  ReturnType<typeof createMainPresentationFixture>
>;

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

describe("Twitch emote chat parts pipeline (smoke E2E)", () => {
  let activePresentation: MainPresentationFixture | null = null;
  let activePlatform: TwitchPlatform | null = null;
  let activeAuth: TwitchAuth | null = null;

  afterEach(async () => {
    const platform = activePlatform;
    const auth = activeAuth;
    const presentation = activePresentation;
    activePlatform = null;
    activeAuth = null;
    activePresentation = null;

    try {
      if (platform) {
        await platform.cleanup();
      }
    } finally {
      try {
        if (auth) {
          await auth.dispose();
        }
      } finally {
        restoreAllMocks();
        if (presentation) {
          await presentation.dispose();
        }
      }
    }
  });

  test("routes Twitch EventSub emote chat into display queue with canonical parts", async () => {
    const presentation = await createMainPresentationFixture();
    activePresentation = presentation;

    presentation.config.general.envFileReadEnabled = false;
    presentation.config.general.envFileWriteEnabled = false;
    presentation.config.logging.file.enabled = false;
    presentation.config.general.messagesEnabled = true;
    presentation.config.general.logChatMessages = false;
    presentation.config.general.greetingsEnabled = false;
    presentation.config.twitch.messagesEnabled = true;
    presentation.config.twitch.greetingsEnabled = false;
    presentation.config.twitch.dataLoggingEnabled = false;

    await presentation.start();

    const displayQueue = {
      addItem: spyOn(presentation.queue, "addItem"),
    };

    const auth = new TwitchAuth({
      clientId: "synthetic-client",
      tokenStorePath: join(presentation.dir, "synthetic-tokens.json"),
      logger: noOpLogger,
    });
    activeAuth = auth;

    const platform = new TwitchPlatform(
      {
        ...presentation.config.twitch,
        enabled: true,
        messagesEnabled: true,
        dataLoggingEnabled: false,
      },
      {
        logger: noOpLogger,
        twitchAuth: auth,
      },
    );
    activePlatform = platform;

    platform.handlers = {
      onChat: (payload) => {
        presentation.bus.emit("platform:event", {
          platform: "twitch",
          type: PlatformEvents.CHAT_MESSAGE,
          data: payload,
        });
      },
    };

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
  });
});
