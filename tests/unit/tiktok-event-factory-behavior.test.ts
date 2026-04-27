import { afterEach, describe, expect, it } from "bun:test";

import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { noOpLogger } from "../helpers/mock-factories";
import testClock from "../helpers/test-clock";
import * as logging from "../../src/core/logging";
import { TikTokPlatform } from "../../src/platforms/tiktok";

logging.initializeLoggingConfig({
  logging: { console: { enabled: false }, file: { enabled: false } },
});

type TikTokChatEvent = {
  type: string;
  platform: string;
  userId: string;
  username: string;
  message: Record<string, unknown>;
  metadata: {
    platform: string;
    correlationId: string;
  };
  timestamp: string;
  badgeImages?: Array<{
    imageUrl: string;
    source: string;
    label: string;
  }>;
};

type TikTokPlatformConstructor = new (
  config: Record<string, unknown>,
  deps: Record<string, unknown>,
) => {
  eventFactory: {
    createChatMessage: (payload: Record<string, unknown>) => TikTokChatEvent;
  };
};
const TikTokPlatformClass =
  TikTokPlatform as unknown as TikTokPlatformConstructor;

describe("TikTok eventFactory chat message behavior", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  it("builds a normalized chat event from raw TikTok data", () => {
    const connectionFactory = {
      createConnection: () => ({
        connect: createMockFn(),
        on: createMockFn(),
        emit: createMockFn(),
        removeAllListeners: createMockFn(),
      }),
    };
    const platform = new TikTokPlatformClass(
      { enabled: false },
      {
        WebcastEvent: {},
        ControlEvent: {},
        logger: noOpLogger,
        connectionFactory,
        timestampService: {
          extractTimestamp: createMockFn(() =>
            new Date(testClock.now()).toISOString(),
          ),
        },
      },
    );

    const rawChat = {
      comment: "hi there",
      user: {
        userId: "tt-user-1",
        uniqueId: "user123",
        nickname: "StreamerFan",
      },
      common: { createTime: testClock.now() },
    };

    const event = platform.eventFactory.createChatMessage(rawChat);

    expect(event.type).toBe("platform:chat-message");
    expect(event.platform).toBe("tiktok");
    expect(event.userId).toBe("user123");
    expect(event.username).toBe("StreamerFan");
    expect(event.message).toEqual({ text: "hi there" });
    expect(event.metadata.platform).toBe("tiktok");
    expect(event.metadata.correlationId).toBeDefined();
    expect(event.timestamp).toBeDefined();
  });

  it("builds emote-only chat events with canonical message.parts", () => {
    const connectionFactory = {
      createConnection: () => ({
        connect: createMockFn(),
        on: createMockFn(),
        emit: createMockFn(),
        removeAllListeners: createMockFn(),
      }),
    };
    const platform = new TikTokPlatformClass(
      { enabled: false },
      {
        WebcastEvent: {},
        ControlEvent: {},
        logger: noOpLogger,
        connectionFactory,
        timestampService: {
          extractTimestamp: createMockFn(() =>
            new Date(testClock.now()).toISOString(),
          ),
        },
      },
    );

    const rawChat = {
      comment: " ",
      emotes: [
        {
          placeInComment: 0,
          emote: {
            emoteId: "1234512345123451234",
            image: {
              imageUrl: "https://example.invalid/tiktok-emote.webp",
            },
          },
        },
      ],
      user: {
        userId: "tt-user-2",
        uniqueId: "user234",
        nickname: "EmoteFan",
      },
      common: { createTime: testClock.now() },
    };

    const event = platform.eventFactory.createChatMessage(rawChat);

    expect(event.message).toEqual({
      text: "",
      parts: [
        {
          type: "emote",
          platform: "tiktok",
          emoteId: "1234512345123451234",
          imageUrl: "https://example.invalid/tiktok-emote.webp",
          placeInComment: 0,
        },
      ],
    });
  });

  it("extracts and forwards canonical badgeImages from raw TikTok chat payload", () => {
    const connectionFactory = {
      createConnection: () => ({
        connect: createMockFn(),
        on: createMockFn(),
        emit: createMockFn(),
        removeAllListeners: createMockFn(),
      }),
    };
    const platform = new TikTokPlatformClass(
      { enabled: false },
      {
        WebcastEvent: {},
        ControlEvent: {},
        logger: noOpLogger,
        connectionFactory,
        timestampService: {
          extractTimestamp: createMockFn(() =>
            new Date(testClock.now()).toISOString(),
          ),
        },
      },
    );

    const rawChat = {
      comment: "test chat message",
      user: {
        userId: "test-user-id-1",
        uniqueId: "test-user-unique-id-1",
        nickname: "test-user-display-name",
        badges: [
          {
            text: { defaultPattern: "Level 22" },
            combine: {
              icon: {
                url: [
                  "https://example.invalid/level-22-p16.png",
                  "https://example.invalid/level-22-p19.png",
                ],
              },
            },
          },
          {
            text: { defaultPattern: "Fans Level 36" },
            combine: {
              icon: {
                url: [
                  "https://example.invalid/fans-36-p16.png",
                  "https://example.invalid/fans-36-p19.png",
                ],
              },
            },
          },
          {
            text: { defaultPattern: "Moderator" },
            combine: {
              icon: {
                url: [
                  "https://example.invalid/moderator-p16.png",
                  "https://example.invalid/moderator-p19.png",
                ],
              },
            },
          },
        ],
      },
      common: { createTime: testClock.now() },
    };

    const event = platform.eventFactory.createChatMessage(rawChat);

    expect(event.badgeImages).toEqual([
      {
        imageUrl: "https://example.invalid/level-22-p16.png",
        source: "tiktok",
        label: "Level 22",
      },
      {
        imageUrl: "https://example.invalid/fans-36-p16.png",
        source: "tiktok",
        label: "Fans Level 36",
      },
      {
        imageUrl: "https://example.invalid/moderator-p16.png",
        source: "tiktok",
        label: "Moderator",
      },
    ]);
  });
});
