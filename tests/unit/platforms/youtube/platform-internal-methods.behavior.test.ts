import { describe, it, expect } from "bun:test";
import { createMockFn } from "../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../helpers/mock-factories";
import { YouTubePlatform } from "../../../../src/platforms/youtube";

type LoggedRawEvent = {
  eventType: string;
  payload: {
    metadata: {
      videoId?: unknown;
    };
  };
};

const createStreamDetectionService = () => ({
  detectLiveStreams: createMockFn().mockResolvedValue({
    success: true,
    videoIds: [],
    detectionMethod: "mock",
  }),
});

const createPlatform = () =>
  new YouTubePlatform(
    { enabled: true, username: "test-channel" },
    {
      logger: noOpLogger,
      streamDetectionService: createStreamDetectionService(),
      notificationManager: {
        emit: createMockFn(),
        on: createMockFn(),
        removeListener: createMockFn(),
      },
      USER_AGENTS: ["test-agent"],
      Innertube: null,
    },
  );

const extractMessagesFromUnknownPayload = (
  platform: YouTubePlatform,
  payload: unknown,
): ReturnType<YouTubePlatform["_extractMessagesFromChatItem"]> =>
  Reflect.apply(platform._extractMessagesFromChatItem, platform, [payload]);

const shouldSkipUnknownMessage = (
  platform: YouTubePlatform,
  message: unknown,
): boolean => Reflect.apply(platform._shouldSkipMessage, platform, [message]);

describe("YouTubePlatform internal behavior", () => {
  it("classifies live and upcoming stream validation states", () => {
    const platform = createPlatform();
    platform._handlePremiereDetection = createMockFn();

    const liveResult = platform._validateVideoForConnection("video-live", {
      basic_info: { is_live: true, is_upcoming: false },
      playability_status: { status: "OK" },
    });

    const upcomingResult = platform._validateVideoForConnection(
      "video-upcoming",
      {
        basic_info: { is_live: false, is_upcoming: true },
        playability_status: { status: "OK" },
      },
    );

    const vodResult = platform._validateVideoForConnection("video-vod", {
      basic_info: { is_live: false, is_upcoming: false },
      playability_status: { status: "ERROR" },
    });

    expect(liveResult.shouldConnect).toBe(true);
    expect(liveResult.reason).toBe("Stream is live");
    expect(upcomingResult.shouldConnect).toBe(false);
    expect(upcomingResult.reason).toContain("upcoming");
    expect(vodResult.shouldConnect).toBe(false);
    expect(vodResult.reason).toContain("not live content");
  });

  it("extracts messages from batched and single chat payloads", () => {
    const platform = createPlatform();

    const batchedMessages = platform._extractMessagesFromChatItem({
      actions: [
        {
          addChatItemAction: { item: { type: "LiveChatTextMessage", id: "a" } },
        },
        {
          addChatItemAction: { item: { type: "LiveChatPaidMessage", id: "b" } },
        },
      ],
    });

    const singleMessage = platform._extractMessagesFromChatItem({
      type: "LiveChatTextMessage",
      item: { type: "LiveChatTextMessage", id: "single" },
    });

    const invalidMessage = extractMessagesFromUnknownPayload(platform, null);

    expect(batchedMessages).toHaveLength(2);
    expect(singleMessage).toHaveLength(1);
    const [message] = singleMessage;
    if (!message) {
      throw new Error("expected single extracted message");
    }
    expect(message.type).toBe("LiveChatTextMessage");
    expect(invalidMessage).toEqual([]);
  });

  it("applies message skip policy for invalid, duplicate, system, and normal items", () => {
    const platform = createPlatform();

    expect(shouldSkipUnknownMessage(platform, null)).toBe(true);
    expect(
      platform._shouldSkipMessage({ type: "LiveChatPaidMessageRenderer" }),
    ).toBe(false);
    expect(
      platform._shouldSkipMessage({ type: "LiveChatPurchaseMessage" }),
    ).toBe(true);
    expect(platform._shouldSkipMessage({ type: "LiveChatTextMessage" })).toBe(
      false,
    );
  });

  it("logs and forwards unknown events with resolved video id metadata", async () => {
    const platform = createPlatform();
    const loggedEvents: LoggedRawEvent[] = [];
    platform.logRawPlatformData = createMockFn(
      async (eventType: string, payload: LoggedRawEvent["payload"]) => {
        loggedEvents.push({ eventType, payload });
      },
    );

    platform._handleMissingChatEvent("UnknownRenderer", {
      item: { videoId: "video-from-item" },
    });

    await Promise.resolve();

    expect(loggedEvents).toHaveLength(1);
    const [loggedEvent] = loggedEvents;
    if (!loggedEvent) {
      throw new Error("expected logged raw event");
    }
    expect(loggedEvent.eventType).toBe("UnknownRenderer");
    expect(loggedEvent.payload.metadata.videoId).toBe("video-from-item");
  });
});
