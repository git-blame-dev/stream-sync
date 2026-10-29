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

describe("YouTube emote chat parts pipeline (integration)", () => {
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

  const startYouTubeChatIntegrationFixture = async () => {
    const presentation = await createMainPresentationFixture();
    activePresentation = presentation;

    presentation.config.general.envFileReadEnabled = false;
    presentation.config.general.envFileWriteEnabled = false;
    presentation.config.logging.file.enabled = false;
    presentation.config.logging.chat.enabled = false;
    presentation.config.general.messagesEnabled = true;
    presentation.config.general.logChatMessages = false;
    presentation.config.general.greetingsEnabled = false;
    presentation.config.youtube.messagesEnabled = true;
    presentation.config.youtube.greetingsEnabled = false;
    presentation.config.youtube.dataLoggingEnabled = false;

    await presentation.start();

    const displayQueue = {
      addItem: spyOn(presentation.queue, "addItem"),
    };

    return { eventBus: presentation.bus, displayQueue };
  };

  test("preserves canonical message.parts from router to display queue", async () => {
    const { eventBus, displayQueue } =
      await startYouTubeChatIntegrationFixture();

    eventBus.emit("platform:event", {
      platform: "youtube",
      type: PlatformEvents.CHAT_MESSAGE,
      data: {
        username: "test-youtube-user",
        userId: "UC_TEST_CHANNEL_700000",
        avatarUrl:
          "https://yt3.ggpht.example.invalid/test-youtube-user=w48-h48-c-k-nd",
        message: {
          text: "",
          parts: [
            {
              type: "emote",
              platform: "youtube",
              emoteId: "UC_TEST_EMOTE_700/TEST_EMOTE_700",
              imageUrl:
                "https://yt3.ggpht.example.invalid/test-youtube-emote-700=w48-h48-c-k-nd",
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
    expect(queued.platform).toBe("youtube");
    expect(queued.data.message).toEqual({
      text: "",
      parts: [
        {
          type: "emote",
          platform: "youtube",
          emoteId: "UC_TEST_EMOTE_700/TEST_EMOTE_700",
          imageUrl:
            "https://yt3.ggpht.example.invalid/test-youtube-emote-700=w48-h48-c-k-nd",
        },
      ],
    });
  });

  test("preserves non-custom emoji glyph text without emitting emote parts", async () => {
    const { eventBus, displayQueue } =
      await startYouTubeChatIntegrationFixture();

    eventBus.emit("platform:event", {
      platform: "youtube",
      type: PlatformEvents.CHAT_MESSAGE,
      data: {
        username: "test-youtube-unicode-user",
        userId: "UC_TEST_CHANNEL_700001",
        avatarUrl:
          "https://yt3.ggpht.example.invalid/test-youtube-unicode-user=w48-h48-c-k-nd",
        message: {
          text: "hi how are you \ud83d\ude4fgoodbye \ud83d\udc94",
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
    expect(queued.platform).toBe("youtube");
    expect(queued.data.message).toEqual({
      text: "hi how are you \ud83d\ude4fgoodbye \ud83d\udc94",
    });
  });
});
