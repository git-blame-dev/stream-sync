import { describe, test, afterEach, expect, spyOn } from "bun:test";
import { restoreAllMocks } from "../helpers/bun-mock-utils";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture";
import { noOpLogger } from "../helpers/mock-factories";
import { createYouTubeRunsMessageChatItem } from "../helpers/youtube-test-data";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";
import { YouTubePlatform } from "../../src/platforms/youtube";
import { InnertubeService } from "../../src/services/innertube-service";
import { YouTubeStreamDetectionService } from "../../src/services/youtube-stream-detection-service";
import { ViewerCountExtractionService } from "../../src/services/viewer-count-extraction-service";

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

describe("YouTube emote chat parts pipeline (smoke E2E)", () => {
  let activePresentation: MainPresentationFixture | null = null;
  let activePlatform: YouTubePlatform | null = null;
  let activeDetector: YouTubeStreamDetectionService | null = null;
  let activeMetadata: InnertubeService | null = null;

  afterEach(async () => {
    const platform = activePlatform;
    const detector = activeDetector;
    const metadata = activeMetadata;
    const presentation = activePresentation;
    activePlatform = null;
    activeDetector = null;
    activeMetadata = null;
    activePresentation = null;

    try {
      if (platform) {
        await platform.cleanup();
      }
    } finally {
      try {
        if (detector) {
          await detector.cleanup();
        }
      } finally {
        try {
          if (metadata) {
            await metadata.dispose();
          }
        } finally {
          restoreAllMocks();
          if (presentation) {
            await presentation.dispose();
          }
        }
      }
    }
  });

  const startYouTubeChatSmokeFixture = async () => {
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
    presentation.config.youtube.username = "test-channel";
    presentation.config.youtube.dataLoggingEnabled = false;

    await presentation.start();

    const displayQueue = {
      addItem: spyOn(presentation.queue, "addItem"),
    };

    const metadata = new InnertubeService(
      {
        createWithTimeout: async () => ({
          getInfo: async () => ({}),
          getChannel: async () => ({
            videos: [],
            getLiveStreams: async () => ({ videos: [] }),
          }),
        }),
      },
      { logger: noOpLogger },
    );
    activeMetadata = metadata;
    const detector = new YouTubeStreamDetectionService(metadata, {
      logger: noOpLogger,
    });
    activeDetector = detector;

    const platform = new YouTubePlatform(
      {
        ...presentation.config.youtube,
        enabled: true,
        messagesEnabled: true,
        username: "test-channel",
        dataLoggingEnabled: false,
      },
      {
        logger: noOpLogger,
        innertubeService: metadata,
        streamDetectionService: detector,
        viewerExtractionService: new ViewerCountExtractionService(metadata, {
          logger: noOpLogger,
        }),
        USER_AGENTS: ["test-agent"],
      },
    );
    activePlatform = platform;

    platform.handlers = {
      onChat: (payload) => {
        presentation.bus.emit("platform:event", {
          platform: "youtube",
          type: PlatformEvents.CHAT_MESSAGE,
          data: payload,
        });
      },
    };

    return { platform, displayQueue };
  };

  test("routes YouTube runs emoji chat into display queue with canonical parts", async () => {
    const { platform, displayQueue } = await startYouTubeChatSmokeFixture();

    platform.handleChatTextMessage(
      createYouTubeRunsMessageChatItem({
        item: {
          author: {
            id: "UC_TEST_CHANNEL_800001",
            name: "test-smoke-youtube-user",
          },
          message: {
            text: "UC_TEST_EMOTE_800/TEST_EMOTE_800",
            runs: [
              {
                text: "UC_TEST_EMOTE_800/TEST_EMOTE_800",
                emoji: {
                  emoji_id: "UC_TEST_EMOTE_800/TEST_EMOTE_800",
                  is_custom: true,
                  shortcuts: [":testEightHundred:"],
                  image: [
                    {
                      url: "https://yt3.ggpht.example.invalid/test-youtube-emote-800=w48-h48-c-k-nd",
                      width: 48,
                      height: 48,
                    },
                  ],
                },
              },
            ],
          },
        },
        videoId: "test-smoke-video-id",
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
    expect(queued.platform).toBe("youtube");
    expect(queued.data.message).toEqual({
      text: ":testEightHundred:",
      parts: [
        {
          type: "emote",
          platform: "youtube",
          emoteId: "UC_TEST_EMOTE_800/TEST_EMOTE_800",
          imageUrl:
            "https://yt3.ggpht.example.invalid/test-youtube-emote-800=w48-h48-c-k-nd",
        },
      ],
    });
  });

  test("routes YouTube non-custom emoji runs into glyph text for display queue", async () => {
    const { platform, displayQueue } = await startYouTubeChatSmokeFixture();

    platform.handleChatTextMessage(
      createYouTubeRunsMessageChatItem({
        item: {
          author: {
            id: "UC_TEST_CHANNEL_800002",
            name: "test-smoke-youtube-unicode-user",
          },
          message: {
            runs: [
              { text: "hi how are you " },
              {
                emoji: {
                  emoji_id: "U+1F64F",
                  is_custom: false,
                  shortcuts: [":folded_hands:"],
                  image: [
                    {
                      url: "https://yt3.ggpht.example.invalid/test-youtube-unicode-folded-hands=w48-h48-c-k-nd",
                      width: 48,
                      height: 48,
                    },
                  ],
                },
              },
              { text: "goodbye " },
              {
                emoji: {
                  emoji_id: "U+1F494",
                  is_custom: false,
                  shortcuts: [":broken_heart:"],
                  image: [
                    {
                      url: "https://yt3.ggpht.example.invalid/test-youtube-unicode-broken-heart=w48-h48-c-k-nd",
                      width: 48,
                      height: 48,
                    },
                  ],
                },
              },
            ],
          },
        },
        videoId: "test-smoke-video-id-unicode",
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
    expect(queued.platform).toBe("youtube");
    expect(queued.data.message).toEqual({
      text: "hi how are you \ud83d\ude4fgoodbye \ud83d\udc94",
    });
  });
});
