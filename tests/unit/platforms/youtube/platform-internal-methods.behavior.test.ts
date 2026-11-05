import { vi, describe, it, expect, spyOn, afterEach } from 'bun:test';

import { createRecordingLogger } from "../../../helpers/recording-logger";
import { noOpLogger } from "../../../helpers/mock-factories";
import { YouTubePlatform } from "../../../../src/platforms/youtube";

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../../../../src/core/logging";
import { RawPlatformDataLoggingService } from "../../../../src/services/RawPlatformDataLoggingService";

import { InnertubeService } from "../../../../src/services/innertube-service";
import { YouTubeStreamDetectionService } from "../../../../src/services/youtube-stream-detection-service";
const owners: Array<{ platform: YouTubePlatform; metadata: InnertubeService }> = [];
afterEach(async () => { for (const owner of owners.splice(0)) { await owner.platform.cleanup(); await owner.metadata.dispose(); } });
const createPlatform = (dependencies: Record<string, unknown> = {}) =>
  {
  const metadata = new InnertubeService({ createWithTimeout: async () => { throw new Error("Unexpected synthetic SDK acquisition"); } }, { logger: noOpLogger });
  const platform = new YouTubePlatform({ enabled: true, username: "synthetic-channel", dataLoggingEnabled: !!dependencies.rawPlatformDataLoggingService }, {
    streamDetectionService: new YouTubeStreamDetectionService(metadata, { logger: noOpLogger }),
    innertubeService: metadata, logger: noOpLogger, USER_AGENTS: ["synthetic-agent"], Innertube: null, ...dependencies,
  });
  owners.push({ platform, metadata });
  return platform;
};

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
  it("emits failures for circular unknown errors without serializing provider data", () => {
    const logger = createRecordingLogger();
    const platform = createPlatform({ logger });
    const events: unknown[] = [];
    platform.on("platform:event", event => events.push(event));
    const unknownError: Record<string, unknown> = {
      message: "synthetic-private-error-body",
      headers: { authorization: "synthetic-private-token" },
      toJSON() { throw new Error("Unknown errors must not be serialized"); },
    };
    unknownError.self = unknownError;
    expect(() => platform._handleError(unknownError, "checkMultiStream")).not.toThrow();
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).toContain("platform:error");
    expect(JSON.stringify(events)).toContain("Non-Error YouTube failure");
    expect(JSON.stringify([logger.entries, events])).not.toContain("synthetic-private");

    const failure = new TypeError("Synthetic SDK failure");
    platform._handleError(failure, "checkMultiStream");
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).toContain("Synthetic SDK failure");
    expect(JSON.stringify(events)).toContain("TypeError");
  });

  it("resolves modern snake-case GiftMessageView author names", () => {
    const platform = createPlatform();

    expect(platform._resolveChatItemAuthorName({
      item: { author_name: { content: "@test-youtube-gifter " } },
    })).toBe("test-youtube-gifter");
  });

  it("classifies live and upcoming stream validation states", () => {
    const info = vi.fn<(...args: unknown[]) => unknown>();
    const platform = createPlatform({ logger: { ...noOpLogger, info } });

    const liveResult = platform._validateVideoForConnection("video-live", {
      basic_info: { id: "video-live", is_live: true, is_upcoming: false },
      page: [{}, { current_video_endpoint: { payload: { videoId: "video-live" } } }],
      livechat: { continuation: "SYNTHETIC_CHAT_CONTINUATION", is_replay: false },
      playability_status: { status: "OK" },
    });

    const upcomingResult = platform._validateVideoForConnection(
      "video-upcoming",
      {
        basic_info: { id: "video-upcoming", is_live: false, is_upcoming: true },
        playability_status: { status: "OK" },
      },
    );

    const vodResult = platform._validateVideoForConnection("video-vod", {
      basic_info: { id: "video-vod", is_live: false, is_upcoming: false },
      playability_status: { status: "ERROR" },
    });

    const premiere = platform._validateVideoForConnection("synthetic-premiere", {
      basic_info: { id: "synthetic-premiere", is_live: true, is_upcoming: true, title: "Synthetic premiere" },
    });
    expect(premiere.shouldConnect).toBe(false);
    expect(info).not.toHaveBeenCalled();
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
    const directory = await fs.mkdtemp(join(tmpdir(), "synthetic-youtube-raw-"));
    const written = Promise.withResolvers<void>();
    const originalAppend = fs.appendFile.bind(fs);
    const append = spyOn(fs, "appendFile").mockImplementation(async (...args) => {
      await originalAppend(...args);
      if (String(args[0]).startsWith(directory + "/")) written.resolve();
    });
    const platform = createPlatform({ rawPlatformDataLoggingService: new RawPlatformDataLoggingService({
      logger, config: { dataLoggingPath: directory },
    }) });
    try {
      platform._handleMissingChatEvent("UnknownRenderer", { item: { videoId: "synthetic-video" } });
      await written.promise;
      const files = await fs.readdir(directory);
      expect(files).toHaveLength(1);
      const record = JSON.parse(await fs.readFile(join(directory, files[0]!), "utf8"));
      expect(record.platform).toBe("youtube");
      expect(record.eventType).toBe("UnknownRenderer");
      expect(record.payload.metadata.videoId).toBe("synthetic-video");
    } finally { await platform.cleanup(); append.mockRestore(); await fs.rm(directory, { recursive: true, force: true }); }
  });
});
