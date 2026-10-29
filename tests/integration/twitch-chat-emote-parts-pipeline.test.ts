import { describe, test, afterEach, expect, spyOn } from "bun:test";
import { restoreAllMocks } from "../helpers/bun-mock-utils";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";

type MainPresentationFixture = Awaited<
  ReturnType<typeof createMainPresentationFixture>
>;

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

describe("Twitch emote chat parts pipeline (integration)", () => {
  let activePresentation: MainPresentationFixture | null = null;

  afterEach(async () => {
    const presentation = activePresentation;
    activePresentation = null;
    try {
      restoreAllMocks();
    } finally {
      if (presentation) {
        await presentation.dispose();
      }
    }
  });

  test("preserves canonical message.parts from router to display queue", async () => {
    const presentation = await createMainPresentationFixture();
    activePresentation = presentation;

    presentation.config.general.envFileReadEnabled = false;
    presentation.config.general.envFileWriteEnabled = false;
    presentation.config.logging.file.enabled = false;
    presentation.config.logging.chat.enabled = false;
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

    presentation.bus.emit("platform:event", {
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
  });
});
