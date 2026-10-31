import { describe, it, expect, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../helpers/mock-factories";
import { createYouTubeRunsMessageChatItem } from "../../../helpers/youtube-test-data";

import { YouTubePlatform } from "../../../../src/platforms/youtube";

type UnknownRecord = Record<string, unknown>;
type PlatformEvent = UnknownRecord & { type?: string; data?: UnknownRecord };
type TestLogger = {
  debug: ReturnType<typeof createMockFn>;
  info: ReturnType<typeof createMockFn>;
  warn: ReturnType<typeof createMockFn>;
  error: ReturnType<typeof createMockFn>;
};
type TestOverrides = {
  logger?: TestLogger | typeof noOpLogger;
  streamDetectionService?: ReturnType<typeof createStreamDetectionService>;
  timestampService?: ReturnType<typeof createTimestampService>;
  viewerService?: unknown;
  RawPlatformDataLoggingService?: unknown;
  notificationManager?: unknown;
};
type TestConnectionManager = Partial<
  Omit<YouTubePlatform["connectionManager"], "getConnectionStatus">
> & {
  getConnectionStatus?: (videoId: string) => { ready?: boolean } | null;
};
type TestPlatformOverrideKey =
  | "connectionManager"
  | "viewerService"
  | "viewerCountProvider"
  | "streamDetectionService"
  | "monitoringInterval"
  | "userAgentManager"
  | "handlers"
  | "streamViewerCounts"
  | "eventRouter"
  | "errorHandler";
type TestYouTubePlatform = Omit<YouTubePlatform, TestPlatformOverrideKey> & {
  connectionManager: TestConnectionManager;
  connectionStateManager?: UnknownRecord;
  viewerService: UnknownRecord | null;
  viewerCountProvider: UnknownRecord | null;
  streamDetectionService: unknown;
  monitoringInterval: unknown | null;
  userAgentManager: unknown;
  eventRouter?: unknown;
  errorHandler?: unknown;
  handlers: Record<string, (payload: UnknownRecord) => unknown>;
  streamViewerCounts: Map<string, number> | null | undefined;
  startMultiStreamMonitoring: () => Promise<void>;
};

const asTestPlatform = (platform: YouTubePlatform): TestYouTubePlatform => {
  const base: Omit<YouTubePlatform, TestPlatformOverrideKey> = platform;
  return Object.assign(base, {
    connectionManager: platform.connectionManager,
    viewerService: platform.viewerService,
    viewerCountProvider: platform.viewerCountProvider,
    streamDetectionService: platform.streamDetectionService,
    monitoringInterval: platform.monitoringInterval,
    userAgentManager: platform.userAgentManager,
    handlers: platform.handlers,
    streamViewerCounts: platform.streamViewerCounts,
    eventRouter: platform.eventRouter,
    errorHandler: platform.errorHandler,
  });
};

const first = <T,>(values: T[]): T => {
  const value = values[0];
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error("Expected at least one value");
  }
  return value;
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const getEventData = (event: PlatformEvent): UnknownRecord => {
  expect(event.data).toBeDefined();
  if (!isRecord(event.data)) {
    throw new Error("Expected event data object");
  }
  return event.data;
};

const getRecordProperty = (record: UnknownRecord, property: string): UnknownRecord => {
  const value = record[property];
  expect(value).toBeDefined();
  if (!isRecord(value)) {
    throw new Error(`Expected ${property} to be an object`);
  }
  return value;
};

const setNullableConnectionManager = (
  platform: TestYouTubePlatform,
  connectionManager: TestConnectionManager | null,
): void => {
  Object.defineProperty(platform, "connectionManager", {
    configurable: true,
    writable: true,
    value: connectionManager,
  });
};

const createTimestampService = () => ({
  extractTimestamp: createMockFn().mockReturnValue("2024-01-01T00:00:00.000Z"),
});

type StreamDetectionResult = {
  success: boolean;
  videoIds: string[];
  detectionMethod?: string;
  message?: string;
};

const createStreamDetectionService = (): {
  detectLiveStreams: ReturnType<typeof createMockFn<[unknown], Promise<StreamDetectionResult>>>;
} => ({
  detectLiveStreams: createMockFn<[unknown], Promise<StreamDetectionResult>>().mockResolvedValue({
    success: true,
    videoIds: [],
    detectionMethod: "mock",
  }),
});

const createPlatform = (overrides: TestOverrides = {}) => {
  const logger = overrides.logger || noOpLogger;
  const streamDetectionService =
    overrides.streamDetectionService || createStreamDetectionService();
  const timestampService =
    overrides.timestampService || createTimestampService();

  const dependencies = {
    USER_AGENTS: ["test-agent"],
    Innertube: null,
    logger,
    streamDetectionService,
    timestampService,
    viewerService: overrides.viewerService || null,
    RawPlatformDataLoggingService: overrides.RawPlatformDataLoggingService,
    notificationManager: overrides.notificationManager || {
      emit: createMockFn(),
      on: createMockFn(),
      removeListener: createMockFn(),
    },
  };

  const platform = asTestPlatform(
    new YouTubePlatform({ enabled: true, username: "test-channel" }, dependencies),
  );
  platform.startMultiStreamMonitoring = createMockFn().mockResolvedValue();

  if (!platform.connectionManager) {
    platform.connectionManager = {
      connectToStream: createMockFn().mockResolvedValue(true),
      getConnectionCount: createMockFn().mockReturnValue(0),
      getAllVideoIds: createMockFn().mockReturnValue([]),
      getActiveVideoIds: createMockFn().mockReturnValue([]),
      hasConnection: createMockFn().mockReturnValue(false),
      disconnectFromStream: createMockFn().mockResolvedValue(true),
      cleanupAllConnections: createMockFn().mockResolvedValue(),
      removeConnection: createMockFn(),
    };
  } else {
    platform.connectionManager.connectToStream =
      createMockFn().mockResolvedValue(true);
    platform.connectionManager.getConnectionCount =
      createMockFn().mockReturnValue(0);
    platform.connectionManager.getAllVideoIds = createMockFn().mockReturnValue(
      [],
    );
    platform.connectionManager.getActiveVideoIds =
      createMockFn().mockReturnValue([]);
    platform.connectionManager.hasConnection =
      createMockFn().mockReturnValue(false);
    platform.connectionManager.disconnectFromStream =
      createMockFn().mockResolvedValue(true);
    platform.connectionManager.cleanupAllConnections =
      createMockFn().mockResolvedValue();
    platform.connectionManager.removeConnection = createMockFn();
  }

  if (!platform.connectionStateManager) {
    platform.connectionStateManager = {
      markConnecting: createMockFn(),
      markConnected: createMockFn(),
      markError: createMockFn(),
    };
  } else {
    platform.connectionStateManager.markConnecting = createMockFn();
    platform.connectionStateManager.markConnected = createMockFn();
    platform.connectionStateManager.markError = createMockFn();
  }

  return { platform, logger, streamDetectionService, timestampService };
};

const createStandalonePlatform = (): TestYouTubePlatform =>
  asTestPlatform(
    new YouTubePlatform(
      { enableAPI: false, username: "creator", viewerCountEnabled: true },
      {
        logger: noOpLogger,
        streamDetectionService: createStreamDetectionService(),
      },
    ),
  );

const getDebugCalls = (logger: TestLogger) =>
  logger.debug.mock.calls.map(([message, _scope, metadata]: unknown[]) => ({
    message: typeof message === "string" ? message : String(message),
    metadata: isRecord(metadata) ? metadata : null,
  }));
const createLogger = () => ({
  debug: createMockFn(),
  info: createMockFn(),
  warn: createMockFn(),
  error: createMockFn(),
});
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe("YouTubePlatform modern architecture", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  it("emits aggregated viewer counts as platform events after stream updates", () => {
    const { platform } = createPlatform();
    const received: UnknownRecord[] = [];
    platform.on("platform:event", (payload: PlatformEvent) => {
      if (payload.type === "platform:viewer-count") {
        received.push(getEventData(payload));
      }
    });

    platform.updateViewerCountForStream("stream-1", 5);
    platform.updateViewerCountForStream("stream-2", 7);

    expect(received).not.toHaveLength(0);
    const latest = first(received.slice(-1));
    expect(latest.count).toBe(12);
    expect(latest.streamId).toBe("stream-2");
    expect(latest.platform).toBe("youtube");
    expect(latest.timestamp).toEqual(expect.any(String));
  });

  it("emits platform:event error with context and metadata", () => {
    const { platform } = createPlatform();
    const received: PlatformEvent[] = [];
    platform.on("platform:event", (payload: PlatformEvent) => {
      if (payload.type === "platform:error") {
        received.push(payload);
      }
    });

    platform._handleError(new Error("Boom"), "connectToYouTubeStream", {
      shouldEmit: true,
      shouldDisconnect: false,
      videoId: "video-1",
    });

    expect(received).toHaveLength(1);
    expect(first(received)).toMatchObject({
      type: "platform:error",
      platform: "youtube",
      data: {
        type: "platform:error",
        platform: "youtube",
        error: {
          message: "Boom",
          name: "Error",
        },
        context: {
          operation: "connectToYouTubeStream",
        },
        recoverable: true,
        timestamp: expect.any(String),
        metadata: expect.objectContaining({
          platform: "youtube",
          videoId: "video-1",
          correlationId: expect.any(String),
        }),
      },
    });
  });

  it("emits platform chat events for normalized chat items", async () => {
    const { platform } = createPlatform();
    const received = new Promise<UnknownRecord>((resolve) => {
      const handler = (payload: PlatformEvent) => {
        if (payload.type !== "platform:chat-message") {
          return;
        }
        platform.removeListener("platform:event", handler);
        resolve(getEventData(payload));
      };
      platform.on("platform:event", handler);
    });

    const chatItem = {
      item: {
        id: "test-msg-1",
        timestamp_usec: "1700000000000000",
        author: { id: "user-123", name: "TestUser" },
        message: { runs: [{ text: "Hello world" }] },
      },
      videoId: "vid-1",
    };

    platform._processRegularChatMessage(chatItem);

    const payload = await received;
    const message = getRecordProperty(payload, "message");
    const metadata = getRecordProperty(payload, "metadata");
    expect(payload.platform).toBe("youtube");
    expect(message.text).toBe("Hello world");
    expect(metadata.videoId).toBe("vid-1");
  });

  it("emits emote-only chat when message text is empty but canonical parts exist", () => {
    const { platform } = createPlatform();
    const emitted: UnknownRecord[] = [];
    platform.on("platform:event", (payload: PlatformEvent) => {
      if (payload.type === "platform:chat-message") {
        emitted.push(getEventData(payload));
      }
    });

    platform._processRegularChatMessage(
      createYouTubeRunsMessageChatItem({
        item: {
          message: {
            runs: [
              {
                emoji: {
                  emoji_id: "UC_TEST_EMOTE_300/TEST_EMOTE_300",
                  image: [
                    {
                      url: "https://yt3.ggpht.example.invalid/test-300=w48-h48-c-k-nd",
                      width: 48,
                      height: 48,
                    },
                  ],
                },
              },
            ],
          },
        },
        videoId: "test-video-id",
      }),
    );

    expect(emitted).toHaveLength(1);
    expect(first(emitted).message).toEqual({
      text: "",
      parts: [
        {
          type: "emote",
          platform: "youtube",
          emoteId: "UC_TEST_EMOTE_300/TEST_EMOTE_300",
          imageUrl: "https://yt3.ggpht.example.invalid/test-300=w48-h48-c-k-nd",
        },
      ],
    });
  });

  it("emits degraded chat when text and canonical message parts are both missing", () => {
    const { platform } = createPlatform();
    const emitted: UnknownRecord[] = [];
    platform.on("platform:event", (payload: PlatformEvent) => {
      if (payload.type === "platform:chat-message") {
        emitted.push(getEventData(payload));
      }
    });

    platform._processRegularChatMessage(
      createYouTubeRunsMessageChatItem({
        item: {
          message: {
            runs: [
              {
                emoji: {
                  emoji_id: "UC_TEST_EMOTE_301/TEST_EMOTE_301",
                  image: [],
                },
              },
            ],
          },
        },
      }),
    );

    expect(emitted).toHaveLength(1);
    const emittedChat = first(emitted);
    expect(emittedChat.message).toEqual({ text: "Unknown Message" });
    const metadata = emittedChat.metadata;
    expect(isRecord(metadata) ? metadata.missingFields : undefined).toContain("message");
  });

  it("emits chat with non-empty text even when message parts are missing", () => {
    const { platform } = createPlatform();
    const emitted: UnknownRecord[] = [];
    platform.on("platform:event", (payload: PlatformEvent) => {
      if (payload.type === "platform:chat-message") {
        emitted.push(getEventData(payload));
      }
    });

    platform._processRegularChatMessage(
      createYouTubeRunsMessageChatItem({
        item: {
          message: {
            text: "plain text only",
            runs: [],
          },
        },
      }),
    );

    expect(emitted).toHaveLength(1);
    expect(first(emitted).message).toEqual({ text: "plain text only" });
  });

  it("emits chat connected event when connectToYouTubeStream succeeds", async () => {
    const mockConnectionManager = {
      hasConnection: createMockFn().mockReturnValue(false),
      connectToStream: createMockFn().mockResolvedValue(true),
      getConnectionCount: createMockFn()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1),
      getConnectionId: createMockFn().mockReturnValue("youtube-abc123"),
    };

    const youtubePlatform = createStandalonePlatform();

    youtubePlatform.connectionManager = mockConnectionManager;
    const events: PlatformEvent[] = [];
    youtubePlatform.on("platform:event", (payload: PlatformEvent) => events.push(payload));

    await youtubePlatform.connectToYouTubeStream("abc123");

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: "youtube",
          type: "platform:chat-connected",
          data: expect.objectContaining({
            platform: "youtube",
            videoId: "abc123",
          }),
        }),
      ]),
    );
  });

  it("silently ignores gift redemption announcements", async () => {
    const logger = createLogger();
    const { platform } = createPlatform({ logger });

    await platform.handleChatMessage({
      type: "AddChatItemAction",
      item: {
        type: "LiveChatSponsorshipsGiftRedemptionAnnouncement",
        id: "test-gift-redemption-unknown",
        timestamp_usec: "1704067203000000",
        author: {
          id: "UC_TEST_CHANNEL_000100",
          name: "N/A",
        },
      },
    });

    expect(getDebugCalls(logger)).toEqual([]);
  });

  it("silently ignores duplicate renderer variants", async () => {
    const logger = createLogger();
    const { platform } = createPlatform({ logger });

    await platform.handleChatMessage({
      type: "AddChatItemAction",
      item: {
        type: "LiveChatPaidMessageRenderer",
        id: "test-renderer-duplicate",
        timestamp_usec: "1704067204000000",
        author: {
          id: "UC_TEST_CHANNEL_000200",
          name: "@testRenderer",
        },
      },
    });

    expect(getDebugCalls(logger)).toEqual([]);
  });

  it("catches async handler failures and logs error without unhandled rejection", async () => {
    const logger = createLogger();
    const { platform } = createPlatform({ logger });
    const handlerError = new Error("dispatch failed");
    platform.eventRouter = {
      routeEvent: createMockFn().mockRejectedValue(handlerError),
    };

    const errorHandlerCalls: UnknownRecord[] = [];
    platform.errorHandler = {
      handleEventProcessingError: (error: Error, eventType: string, eventData?: unknown, message?: string) => {
        errorHandlerCalls.push({ error, eventType, eventData, message });
      },
    };

    const unhandled: unknown[] = [];
    const listener = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", listener);

    try {
      await platform.handleChatMessage({
        item: {
          type: "LiveChatPaidMessage",
          id: "LCC.test-async-error",
          timestamp_usec: "1704067205000000",
          author: {
            id: "UC_TEST_CHANNEL_000400",
            name: "AsyncTester",
          },
        },
      });
      await flushPromises();
    } finally {
      process.off("unhandledRejection", listener);
    }

    expect(unhandled).toHaveLength(0);
    expect(errorHandlerCalls).toHaveLength(1);
    const errorHandlerCall = first(errorHandlerCalls);
    expect(errorHandlerCall.error).toBe(handlerError);
    expect(errorHandlerCall.eventType).toBe("LiveChatPaidMessage");
    expect(errorHandlerCall.message).toContain(
      "Error handling event type LiveChatPaidMessage",
    );
  });

  it("emits error notification when gift purchase header author is missing", async () => {
    const { platform } = createPlatform();
    const giftErrors: UnknownRecord[] = [];
    platform.handlers = {
      ...platform.handlers,
      onGiftPaypiggy: (payload: UnknownRecord) => giftErrors.push(payload),
    };

    const chatItem = {
      item: {
        type: "LiveChatSponsorshipsGiftPurchaseAnnouncement",
        id: "LCC.test-gift-purchase-missing-author",
        timestamp_usec: "1700000000000000",
        giftMembershipsCount: 3,
        header: {
          type: "LiveChatSponsorshipsHeader",
        },
      },
    };

    await platform.handleChatMessage(chatItem);

    expect(giftErrors).toHaveLength(1);
    const giftError = first(giftErrors);
    expect(giftError).toMatchObject({
      type: "platform:giftpaypiggy",
      platform: "youtube",
      giftCount: 3,
      id: "LCC.test-gift-purchase-missing-author",
      isError: true,
    });
    expect(giftError.timestamp).toBe(new Date(1700000000000).toISOString());
    expect(giftError.username).toBeUndefined();
  });

  it("emits unresolved GiftMessageView error payload when author data is missing", async () => {
    const { platform } = createPlatform();
    const giftErrors: UnknownRecord[] = [];
    platform.handlers = {
      ...platform.handlers,
      onGift: (payload: UnknownRecord) => giftErrors.push(payload),
    };

    const chatItem = {
      item: {
        type: "GiftMessageView",
        id: "LCC.test-giftmessageview-missing-author",
        timestamp_usec: "1700000000000000",
        text: {
          content: "sent Girl power for 300 Jewels",
        },
      },
    };

    await platform.handleChatMessage(chatItem);

    expect(giftErrors).toHaveLength(1);
    const giftError = first(giftErrors);
    expect(giftError).toMatchObject({
      type: "platform:gift",
      platform: "youtube",
      giftType: "YouTube Gift",
      giftCount: 1,
      id: "LCC.test-giftmessageview-missing-author",
      isError: true,
    });
    expect(giftError.username).toBeUndefined();
    expect(giftError.userId).toBeUndefined();
  });

  it("emits gift error payloads when monetization timestamps are missing", async () => {
    const { platform } = createPlatform();
    const giftErrors: UnknownRecord[] = [];
    platform.handlers = {
      ...platform.handlers,
      onGift: (payload: UnknownRecord) => giftErrors.push(payload),
    };

    const chatItem = {
      item: {
        type: "LiveChatPaidMessage",
        id: "LCC.test-superchat-missing-timestamp",
        purchase_amount: 5,
        purchase_currency: "USD",
        author: {
          id: "yt-user-missing-ts",
          name: "TestViewer",
        },
        message: { text: "Super chat" },
      },
    };

    await platform.handleChatMessage(chatItem);

    expect(giftErrors).toHaveLength(1);
    const giftError = first(giftErrors);
    expect(giftError).toMatchObject({
      type: "platform:gift",
      platform: "youtube",
      giftType: "Super Chat",
      giftCount: 1,
      id: "LCC.test-superchat-missing-timestamp",
      isError: true,
    });
    expect(giftError.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("does not infer domain live status from the first chat connection", async () => {
    const mockConnectionManager = {
      hasConnection: createMockFn().mockReturnValue(false),
      connectToStream: createMockFn().mockResolvedValue(true),
      getConnectionCount: createMockFn()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1),
      getConnectionId: createMockFn().mockReturnValue("youtube-abc123"),
    };

    const youtubePlatform = createStandalonePlatform();

    youtubePlatform.connectionManager = mockConnectionManager;
    const events: PlatformEvent[] = [];
    youtubePlatform.on("platform:event", (payload: PlatformEvent) => events.push(payload));

    await youtubePlatform.connectToYouTubeStream("abc123");

    expect(events.filter(event => event.type === "platform:stream-status")).toEqual([]);
    expect(youtubePlatform.getViewerMembershipSnapshot().availability).toBe("unknown");
  });

  it("does not infer domain offline status from the last chat disconnection", async () => {
    const mockConnectionManager = {
      hasConnection: createMockFn().mockReturnValue(true),
      disconnectFromStream: createMockFn().mockResolvedValue(true),
      getConnectionCount: createMockFn()
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(0),
    };

    const youtubePlatform = createStandalonePlatform();

    youtubePlatform.connectionManager = mockConnectionManager;
    const events: PlatformEvent[] = [];
    youtubePlatform.on("platform:event", (payload: PlatformEvent) => events.push(payload));

    await youtubePlatform.disconnectFromYouTubeStream("abc123", "stream ended");

    expect(events).toEqual([]);
  });

  it("does not infer terminal status from a refresh leaving zero chat connections", async () => {
    const platform = createStandalonePlatform();
    platform.connectionManager = {
      disconnectFromStream: createMockFn().mockResolvedValue(true),
      getConnectionCount: createMockFn().mockReturnValueOnce(1).mockReturnValue(0),
    };
    platform._youtubeMultiStreamManager.requestImmediateRefresh = createMockFn().mockResolvedValue(undefined);
    const events: PlatformEvent[] = [];
    platform.on("platform:event", (payload: PlatformEvent) => events.push(payload));

    await platform.disconnectFromYouTubeStream("abc123", "stream ended", {
      requestImmediateRefresh: true,
      source: "livechat-end",
    });

    expect(platform._youtubeMultiStreamManager.requestImmediateRefresh).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === "platform:stream-status")).toHaveLength(0);
  });

  it("does not emit terminal status when refresh fails", async () => {
    const platform = createStandalonePlatform();
    const refresh = createMockFn().mockRejectedValue(new Error("refresh failed"));
    platform.connectionManager = {
      disconnectFromStream: createMockFn().mockResolvedValue(true),
      getConnectionCount: createMockFn().mockReturnValueOnce(1).mockReturnValue(1),
    };
    platform._youtubeMultiStreamManager.requestImmediateRefresh = refresh;
    const events: PlatformEvent[] = [];
    platform.on("platform:event", (payload: PlatformEvent) => events.push(payload));

    await platform.disconnectFromYouTubeStream("abc123", "stream ended", {
      requestImmediateRefresh: true,
      source: "livechat-end",
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.data?.status === "stream-ended")).toHaveLength(0);
  });

  it("does not emit terminal status when a successful refresh leaves a replacement connection", async () => {
    const platform = createStandalonePlatform();
    platform.connectionManager = {
      disconnectFromStream: createMockFn().mockResolvedValue(true),
      getConnectionCount: createMockFn().mockReturnValueOnce(1).mockReturnValue(1),
    };
    platform._youtubeMultiStreamManager.requestImmediateRefresh = createMockFn().mockResolvedValue(undefined);
    const events: PlatformEvent[] = [];
    platform.on("platform:event", (payload: PlatformEvent) => events.push(payload));

    await platform.disconnectFromYouTubeStream("abc123", "stream ended", {
      requestImmediateRefresh: true,
      source: "livechat-end",
    });

    expect(events.filter((event) => event.data?.status === "stream-ended")).toHaveLength(0);
  });

  it("does not fabricate terminal status for repeated zero-connection livechat ends", async () => {
    const platform = createStandalonePlatform();
    platform.connectionManager = {
      disconnectFromStream: createMockFn().mockResolvedValue(true),
      getConnectionCount: createMockFn()
        .mockReturnValueOnce(2)
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(0)
        .mockReturnValue(0),
    };
    platform._youtubeMultiStreamManager.requestImmediateRefresh = createMockFn().mockResolvedValue(undefined);
    const events: PlatformEvent[] = [];
    platform.on("platform:event", (payload: PlatformEvent) => events.push(payload));

    await platform.disconnectFromYouTubeStream("abc123", "stream ended", {
      requestImmediateRefresh: true,
      source: "livechat-end",
    });
    await platform.disconnectFromYouTubeStream("def456", "stream ended", {
      requestImmediateRefresh: true,
      source: "livechat-end",
    });

    expect(events.filter((event) => event.type === "platform:stream-status")).toHaveLength(0);
  });

  it("removeYouTubeConnection clears active stream in viewer service when matching", () => {
    const { platform } = createPlatform();
    const clearCalled: string[] = [];
    platform.viewerService = {
      _activeStream: { videoId: "vid-123" },
      clearActiveStream: () => clearCalled.push("cleared"),
    };
    platform.connectionManager.removeConnection = createMockFn();

    platform.removeYouTubeConnection("vid-123");

    expect(clearCalled).toEqual(["cleared"]);
  });

  it("removeYouTubeConnection does not clear viewer service when videoId does not match", () => {
    const { platform } = createPlatform();
    const clearCalled: string[] = [];
    platform.viewerService = {
      _activeStream: { videoId: "other-vid" },
      clearActiveStream: () => clearCalled.push("cleared"),
    };
    platform.connectionManager.removeConnection = createMockFn();

    platform.removeYouTubeConnection("vid-123");

    expect(clearCalled).toEqual([]);
  });

  it("removeYouTubeConnection completes when viewer service throws error", () => {
    const { platform } = createPlatform();
    let removeConnectionCalled = false;
    platform.viewerService = {
      _activeStream: { videoId: "vid-123" },
      clearActiveStream: () => {
        throw new Error("service error");
      },
    };
    platform.connectionManager.removeConnection = async () => {
      removeConnectionCalled = true;
    };

    platform.removeYouTubeConnection("vid-123");

    expect(removeConnectionCalled).toBe(true);
  });

  it("disconnectFromYouTubeStream returns false when connectionManager is null", async () => {
    const { platform } = createPlatform();
    setNullableConnectionManager(platform, null);

    const result = await platform.disconnectFromYouTubeStream("vid-123");

    expect(result).toBe(false);
  });

  it("getActiveYouTubeVideoIds returns empty array when connectionManager is null", () => {
    const { platform } = createPlatform();
    setNullableConnectionManager(platform, null);

    const result = platform.getActiveYouTubeVideoIds();

    expect(result).toEqual([]);
  });

  it("getDetectedStreamIds returns empty array when connectionManager is null", () => {
    const { platform } = createPlatform();
    setNullableConnectionManager(platform, null);

    const result = platform.getDetectedStreamIds();

    expect(result).toEqual([]);
  });

  it("getViewerCount returns unavailable when provider is not available", async () => {
    const { platform } = createPlatform();
    platform.viewerCountProvider = null;

    const count = await platform.getViewerCount();

    expect(count).toBeNull();
  });

  it("getViewerCount returns unavailable without an observation capability", async () => {
    const { platform } = createPlatform();
    platform.viewerCountProvider = {
      getViewerCount: createMockFn().mockRejectedValue(
        new Error("provider error"),
      ),
    };

    const count = await platform.getViewerCount();

    expect(count).toBeNull();
  });

  it("getViewerCountForVideo returns unavailable when provider is not available", async () => {
    const { platform } = createPlatform();
    platform.viewerCountProvider = null;

    const count = await platform.getViewerCountForVideo("vid-123");

    expect(count).toBeNull();
  });

  it("getViewerCountForVideo returns unavailable when provider lacks single-video method", async () => {
    const { platform } = createPlatform();
    platform.viewerCountProvider = {};

    const count = await platform.getViewerCountForVideo("vid-123");

    expect(count).toBeNull();
  });

  it("getViewerCountForVideo returns unavailable on provider error", async () => {
    const { platform } = createPlatform();
    platform.viewerCountProvider = {
      getViewerCountForVideo: createMockFn().mockRejectedValue(
        new Error("provider error"),
      ),
    };

    const count = await platform.getViewerCountForVideo("vid-123");

    expect(count).toBeNull();
  });

  it("isActive returns false when isConnected throws", () => {
    const { platform } = createPlatform();
    platform.isConnected = () => {
      throw new Error("connection check failed");
    };

    const result = platform.isActive();

    expect(result).toBe(false);
  });

  it("getHealthStatus returns degraded when no active connections and not monitoring", () => {
    const { platform } = createPlatform();
    platform.connectionManager.getConnectionCount =
      createMockFn().mockReturnValue(0);
    platform.monitoringInterval = null;

    const status = platform.getHealthStatus();

    expect(status.overall).toBe("degraded");
  });

  it("getHealthStatus returns idle when no connections but monitoring active", () => {
    const { platform } = createPlatform();
    platform.connectionManager.getConnectionCount =
      createMockFn().mockReturnValue(0);
    platform.monitoringInterval = { testInterval: "health-status" };

    const status = platform.getHealthStatus();

    expect(status.overall).toBe("idle");
  });

  it("getHealthStatus returns healthy when connections exist", () => {
    const { platform } = createPlatform();
    platform.connectionManager.getConnectionCount =
      createMockFn().mockReturnValue(1);

    const status = platform.getHealthStatus();

    expect(status.overall).toBe("healthy");
  });

  it("cleanup handles viewerService cleanup error gracefully", async () => {
    const { platform } = createPlatform();
    platform.viewerService = {
      cleanup: () => {
        throw new Error("cleanup failed");
      },
    };

    await platform.cleanup();

    expect(platform.isInitialized).toBe(false);
  });


  it("reconnect calls initialize with existing handlers", async () => {
    const { platform } = createPlatform();
    platform.handlers = { onChat: createMockFn() };
    const initCalls: unknown[] = [];
    platform.initialize = createMockFn(async (handlers: unknown) => {
      initCalls.push(handlers);
    });

    await platform.reconnect();

    expect(initCalls).toHaveLength(1);
    expect(first(initCalls)).toEqual(platform.handlers);
  });

  it("membership reads do not require an available chat manager", () => {
    const { platform } = createPlatform();
    setNullableConnectionManager(platform, null);
    const events: PlatformEvent[] = [];
    platform.on("platform:event", (e: PlatformEvent) => events.push(e));

    expect(platform.getViewerMembershipSnapshot().availability).toBe("unknown");

    expect(events).toEqual([]);
  });

  it("chat count alone does not change membership", () => {
    const { platform } = createPlatform();
    platform.connectionManager.getConnectionCount =
      createMockFn().mockReturnValue(1);
    const events: PlatformEvent[] = [];
    platform.on("platform:event", (e: PlatformEvent) => events.push(e));

    expect(platform.getViewerMembershipSnapshot()).toEqual({ generation: 0, videoIds: [], availability: "unknown" });

    expect(events).toEqual([]);
  });

  it("sendMessage tries all active connections and returns true on success", async () => {
    const { platform } = createPlatform();
    platform.connectionManager.getAllVideoIds = createMockFn().mockReturnValue([
      "v1",
      "v2",
    ]);
    platform.connectionManager.getConnection = createMockFn((id) => ({
      sendMessage: createMockFn().mockResolvedValue(id === "v2"),
    }));
    platform.connectionManager.getConnectionStatus =
      createMockFn().mockReturnValue({ ready: true });

    const result = await platform.sendMessage("Hello");

    expect(result).toBe(true);
  });

  it("sendMessage returns false when no connections succeed", async () => {
    const { platform } = createPlatform();
    platform.connectionManager.getAllVideoIds = createMockFn().mockReturnValue([
      "v1",
    ]);
    platform.connectionManager.getConnection = createMockFn(() => ({
      sendMessage: createMockFn().mockResolvedValue(false),
    }));
    platform.connectionManager.getConnectionStatus =
      createMockFn().mockReturnValue({ ready: true });

    const result = await platform.sendMessage("Hello");

    expect(result).toBe(false);
  });

  it("sendMessage handles connection send error gracefully", async () => {
    const { platform } = createPlatform();
    platform.connectionManager.getAllVideoIds = createMockFn().mockReturnValue([
      "v1",
    ]);
    platform.connectionManager.getConnection = createMockFn(() => ({
      sendMessage: createMockFn().mockRejectedValue(new Error("send failed")),
    }));
    platform.connectionManager.getConnectionStatus =
      createMockFn().mockReturnValue({ ready: true });

    const result = await platform.sendMessage("Hello");

    expect(result).toBe(false);
  });

  it("getStatus returns isReady=false with no issues when disabled (by design)", () => {
    const { platform } = createPlatform();
    platform.config.enabled = false;

    const result = platform.getStatus();

    expect(result.isReady).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it("getStatus returns issue when enabled but not connected", () => {
    const { platform } = createPlatform();
    platform.config.enabled = true;
    platform.connectionManager = { getConnectionCount: () => 0 };

    const result = platform.getStatus();

    expect(result.isReady).toBe(false);
    expect(result.issues).toContain("Not connected");
  });

  it("getNextUserAgent delegates to userAgentManager", () => {
    const { platform } = createPlatform();
    platform.userAgentManager = {
      getNextUserAgent: createMockFn().mockReturnValue("test-ua"),
    };

    const result = platform.getNextUserAgent();

    expect(result).toBe("test-ua");
  });

  it("setYouTubeConnectionReady updates connection ready state", () => {
    const { platform } = createPlatform();
    const readyAttempt: { value: [string, number] | null } = { value: null };
    platform.connectionManager.setConnectionReady = (videoId: string, attemptId: number) => {
      readyAttempt.value = [videoId, attemptId];
    };

    platform.setYouTubeConnectionReady("vid-123", 9);

    expect(readyAttempt.value).toEqual(["vid-123", 9]);
  });

  it("isAnyYouTubeStreamReady delegates to connectionManager", () => {
    const { platform } = createPlatform();
    platform.connectionManager.isAnyConnectionReady =
      createMockFn().mockReturnValue(true);

    const result = platform.isAnyYouTubeStreamReady();

    expect(result).toBe(true);
  });

  it("getLiveVideoIdsByYoutubei throws when stream detection service unavailable", async () => {
    const { platform } = createPlatform();
    platform.streamDetectionService = null;

    await expect(platform.getLiveVideoIdsByYoutubei()).rejects.toThrow(
      "Service unavailable",
    );
  });

  it("getLiveVideoIdsByYoutubei returns empty array when no streams found", async () => {
    const { platform, streamDetectionService } = createPlatform();
    streamDetectionService.detectLiveStreams = createMockFn<
      [unknown],
      Promise<StreamDetectionResult>
    >().mockResolvedValue(
      {
        success: false,
        videoIds: [],
        message: "No streams",
      },
    );

    const result = await platform.getLiveVideoIdsByYoutubei();

    expect(result).toEqual([]);
  });

  it("getConnectionState returns state with connection info", () => {
    const { platform } = createPlatform();
    platform.connectionManager.getConnectionCount =
      createMockFn().mockReturnValue(1);
    platform.connectionManager.getActiveVideoIds =
      createMockFn().mockReturnValue(["v1"]);
    platform.connectionManager.isConnectionReady =
      createMockFn().mockReturnValue(true);
    platform.monitoringInterval = { testInterval: "connection-state" };

    const state = platform.getConnectionState();

    expect(state.isConnected).toBe(true);
    expect(state.isMonitoring).toBe(true);
    expect(state.totalConnections).toBe(1);
  });

  it("getStats returns platform stats", () => {
    const { platform } = createPlatform();
    platform.connectionManager.getConnectionCount =
      createMockFn().mockReturnValue(2);
    platform.connectionManager.getActiveVideoIds =
      createMockFn().mockReturnValue(["v1", "v2"]);
    platform.connectionManager.isConnectionReady =
      createMockFn().mockReturnValue(true);

    const stats = platform.getStats();

    expect(stats.platform).toBe("youtube");
    expect(stats.totalConnections).toBe(2);
  });

  it("isConfigured returns true when enabled and username set", () => {
    const { platform } = createPlatform();
    platform.config.enabled = true;
    platform.config.username = "test-user";

    expect(platform.isConfigured()).toBe(true);
  });

  it("isConfigured returns false when disabled", () => {
    const { platform } = createPlatform();
    platform.config.enabled = false;

    expect(platform.isConfigured()).toBe(false);
  });

  it("isConnected returns true when connectionManager has connections", () => {
    const { platform } = createPlatform();
    platform.connectionManager.getConnectionCount =
      createMockFn().mockReturnValue(1);

    expect(platform.isConnected()).toBe(true);
  });

  it("isConnected returns false when connectionManager has no connections", () => {
    const { platform } = createPlatform();
    platform.connectionManager.getConnectionCount =
      createMockFn().mockReturnValue(0);

    expect(platform.isConnected()).toBe(false);
  });

  it("getConnectionStatus returns current status", async () => {
    const { platform } = createPlatform();
    platform.connectionManager.getConnectionCount =
      createMockFn().mockReturnValue(1);

    const status = await platform.getConnectionStatus();

    expect(status.platform).toBe("youtube");
    expect(status.status).toBe("connected");
  });

  it("getTotalViewerCount sums all stream viewer counts", () => {
    const { platform } = createPlatform();
    platform.streamViewerCounts = new Map([
      ["v1", 10],
      ["v2", 20],
    ]);

    const total = platform.getTotalViewerCount();

    expect(total).toBe(30);
  });

  it("getTotalViewerCount returns 0 when no counts tracked", () => {
    const { platform } = createPlatform();
    platform.streamViewerCounts = null;

    const total = platform.getTotalViewerCount();

    expect(total).toBe(0);
  });

  it("_clearMonitoringInterval clears and nullifies interval", () => {
    const { platform } = createPlatform();
    const monitoringInterval = { testInterval: "clear-monitoring" };
    platform.monitoringInterval = monitoringInterval;
    const cleared: unknown[] = [];
    const originalClearInterval = global.clearInterval;
    global.clearInterval = (id: unknown) => {
      cleared.push(id);
    };

    platform._clearMonitoringInterval();

    global.clearInterval = originalClearInterval;
    expect(cleared).toContain(monitoringInterval);
    expect(platform.monitoringInterval).toBeNull();
  });

  it("handleChatTextMessage returns early when chatItem is invalid", () => {
    const { platform } = createPlatform();
    const events: PlatformEvent[] = [];
    platform.on("platform:event", (e: PlatformEvent) => events.push(e));

    platform.handleChatTextMessage(null);
    platform.handleChatTextMessage({ item: null });

    const chatEvents = events.filter((e) => e.type === "platform:chat-message");
    expect(chatEvents).toHaveLength(0);
  });

  it("handleChatTextMessage emits degraded chat payload when author identity is missing", () => {
    const { platform } = createPlatform();
    const events: PlatformEvent[] = [];
    platform.on("platform:event", (e: PlatformEvent) => events.push(e));

    platform.handleChatTextMessage({ item: { type: "test" } });

    const chatEvents = events.filter((e) => e.type === "platform:chat-message");
    expect(chatEvents).toHaveLength(1);
    const chatData = getEventData(first(chatEvents));
    expect(chatData.username).toBe("Unknown Username");
    expect(chatData.userId).toBeUndefined();
    expect(chatData.timestamp).toBeUndefined();
    expect(chatData.message).toEqual({ text: "Unknown Message" });
    const chatMetadata = chatData.metadata;
    expect(isRecord(chatMetadata) ? chatMetadata.missingFields : undefined).toEqual([
      "userId",
      "username",
      "message",
      "timestamp",
    ]);
  });

  it("_handleError emits error event and triggers cleanup when shouldDisconnect", async () => {
    const { platform } = createPlatform();
    const events: PlatformEvent[] = [];
    platform.on("platform:event", (e: PlatformEvent) => events.push(e));
    platform.isInitialized = true;

    platform._handleError(new Error("fatal"), "liveChatListener", {
      shouldEmit: true,
      shouldDisconnect: true,
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(events.some((e) => e.type === "platform:error")).toBe(true);
    expect(platform.isInitialized).toBe(false);
  });

  it("_generateErrorMessage returns context-specific messages", () => {
    const { platform } = createPlatform();

    expect(
      platform._generateErrorMessage("connectToYouTubeStream", "v1"),
    ).toContain("Failed to connect");
    expect(platform._generateErrorMessage("liveChatListener")).toContain(
      "live chat error",
    );
    expect(platform._generateErrorMessage("checkMultiStream")).toContain(
      "multi-stream",
    );
    expect(platform._generateErrorMessage("getLiveVideoIds")).toContain(
      "live video IDs",
    );
    expect(platform._generateErrorMessage("unknown")).toContain(
      "unexpected error",
    );
  });
});
