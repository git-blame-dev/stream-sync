import { describe, test, expect, afterEach } from "bun:test";
import { createMockFn } from "../../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../../helpers/mock-factories";

import { createYouTubeConnectionFactory } from "../../../../../src/platforms/youtube/connections/youtube-connection-factory.ts";
import { InnertubeService } from "../../../../../src/services/innertube-service";

type FactoryOptions = NonNullable<
  Parameters<typeof createYouTubeConnectionFactory>[0]
>;
type FactoryPlatform = NonNullable<FactoryOptions["platform"]>;
type UnknownRecord = Record<string, unknown>;
type ChatEventHandler = (payload?: unknown) => void;
type HandlerMap = Record<string, ChatEventHandler>;
type RecordedMessage = UnknownRecord;
type RawLogCall = [channel: string, payload: unknown];
type ProcessingErrorCall = [
  message: string,
  error: unknown,
  category: string,
  metadata?: UnknownRecord,
];
type DisconnectCall = {
  videoId: string;
  reason: string;
  options?: { requestImmediateRefresh?: boolean; source?: string; expectedAttemptId?: number };
};

type ValidationResult = {
  shouldConnect: boolean;
  reason?: string;
};

type LiveChatBehavior = {
  value?: unknown;
  error?: Error;
  pending?: Promise<unknown>;
};

const services: Array<{ dispose(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.dispose())); });
const attemptContext = () => ({ signal: new AbortController().signal, adopt: () => {} });

const getHandler = (handlers: HandlerMap, event: string): ChatEventHandler => {
  const handler = handlers[event];
  expect(handler).toBeDefined();
  if (!handler) {
    throw new Error(`Expected ${event} handler to be registered`);
  }
  return handler;
};

const firstCall = <T>(calls: T[]): T => {
  const call = calls[0];
  expect(call).toBeDefined();
  if (!call) {
    throw new Error("Expected at least one recorded call");
  }
  return call;
};

const recordDisconnectCall = (
  calls: DisconnectCall[],
  videoId: string,
  reason: string,
  options?: DisconnectCall["options"],
): number => {
  const call = options === undefined ? { videoId, reason } : { videoId, reason, options };
  return calls.push(call);
};

const createFactory = ({
  validationResult,
  liveChatBehavior,
  platformOverrides,
  timeoutMs = 1000,
}: {
  validationResult?: ValidationResult;
  liveChatBehavior?: LiveChatBehavior;
  platformOverrides?: Record<string, unknown>;
  timeoutMs?: number;
} = {}) => {
  const platform: FactoryPlatform = {
    logger: noOpLogger,
    _validateVideoForConnection: () =>
      validationResult ?? { shouldConnect: true },
    config: {},
    isCurrentYouTubeConnection: createMockFn().mockReturnValue(true),
    setYouTubeConnectionReady: createMockFn(),
    disconnectFromYouTubeStream: createMockFn().mockResolvedValue(false),
    handleChatMessage: createMockFn(),
    logRawPlatformData: createMockFn().mockResolvedValue(),
    _handleProcessingError: createMockFn(),
    _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
    _shouldSkipMessage: createMockFn().mockReturnValue(false),
    _resolveChatItemAuthorName: createMockFn().mockReturnValue("Author"),
    ...(platformOverrides || {}),
  };

  const liveChat = liveChatBehavior?.value || null;
  const getLiveChat = liveChatBehavior?.error
    ? createMockFn().mockRejectedValue(liveChatBehavior.error)
    : liveChatBehavior?.pending
      ? createMockFn(() => liveChatBehavior.pending)
      : createMockFn().mockResolvedValue(liveChat);

  const info = {
    getLiveChat,
  };

  const yt = {
    getInfo: createMockFn().mockResolvedValue(info),
  };

  const service = new InnertubeService({ createWithTimeout: async () => yt }, { logger: noOpLogger });
  services.push(service);

  const factory = createYouTubeConnectionFactory({
    platform,
    innertubeService: service,
    innertubeCreationTimeoutMs: timeoutMs,
  });

  return {
    factory,
    liveChat,
    getLiveChat,
  };
};

describe("YouTube connection factory", () => {
  test("throws immediately when stream validation says not to connect", async () => {
    const liveChat = { id: "live-chat", on: createMockFn() };
    const validationResult = {
      shouldConnect: false,
      reason: "Video is not live content (replay/VOD)",
    };

    const { factory, getLiveChat } = createFactory({
      validationResult,
      liveChatBehavior: { value: liveChat },
    });

    await expect(factory.createConnection("video-1", attemptContext())).rejects.toThrow(
      "Stream validation failed: Video is not live content (replay/VOD)",
    );
    expect(getLiveChat).toHaveBeenCalledTimes(0);
  });

  test("throws when validation fails and live chat is unavailable", async () => {
    const validationResult = {
      shouldConnect: false,
      reason: "Video is not live content (replay/VOD)",
    };

    const { factory } = createFactory({
      validationResult,
      liveChatBehavior: { error: new Error("Live Chat is not available") },
    });

    await expect(factory.createConnection("video-2", attemptContext())).rejects.toThrow(
      "Stream validation failed: Video is not live content (replay/VOD)",
    );
  });

  test("adopts an unstarted managed connection after valid setup", async () => {
    const liveChat = { id: "live-chat", on: createMockFn(), start: createMockFn(), stop: createMockFn() };

    const { factory } = createFactory({
      validationResult: {
        shouldConnect: true,
        reason: "Stream is live",
      },
      liveChatBehavior: { value: liveChat },
    });

    const adopt = createMockFn();
    const connection = await factory.createConnection("video-3", { ...attemptContext(), adopt });
    expect(adopt).toHaveBeenCalledWith(connection);
    expect(liveChat.start).not.toHaveBeenCalled();
    await connection.stop();
    expect(liveChat.stop).toHaveBeenCalledTimes(1);
  });

  test("surfaces a getLiveChat setup failure without replacing the originating error", async () => {
    const { factory } = createFactory({
      validationResult: {
        shouldConnect: true,
        reason: "Stream is live",
      },
      liveChatBehavior: { error: new Error("synthetic getLiveChat failure") },
    });

    await expect(factory.createConnection("video-4", attemptContext())).rejects.toThrow(
      "synthetic getLiveChat failure",
    );
  });

  test("ignores every callback from a detached connection attempt", async () => {
    let current = true;
    const handlers: HandlerMap = {};
    const setReady = createMockFn();
    const disconnect = createMockFn().mockResolvedValue(false);
    const handleChatMessage = createMockFn();
    const { factory } = createFactory({
      platformOverrides: {
        isCurrentYouTubeConnection: () => current,
        setYouTubeConnectionReady: setReady,
        disconnectFromYouTubeStream: disconnect,
        handleChatMessage,
      },
    });
    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        handlers[event] = handler;
      }),
      start: createMockFn<[], void>(),
    };
    await factory.setupConnectionEventListeners(connection, "stale-video", 7);
    current = false;

    getHandler(handlers, "start")({ actions: [] });
    getHandler(handlers, "chat-update")({
      author: { id: "UC_STALE", name: "StaleUser" },
      text: "stale chat",
    });
    getHandler(handlers, "error")(new Error("terminal stale error"));
    getHandler(handlers, "end")();

    expect(setReady).not.toHaveBeenCalled();
    expect(handleChatMessage).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  test("cleans up an unowned connection when listener setup fails", async () => {
    const processingError = createMockFn();
    const stop = createMockFn().mockRejectedValue(new Error("stop cleanup failed"));
    const disconnect = createMockFn().mockResolvedValue(undefined);
    const { factory } = createFactory({
      platformOverrides: {
        _handleProcessingError: processingError,
      },
    });
    const connection = {
      on: createMockFn(),
      start: createMockFn(() => {
        throw new Error("start failed");
      }),
      stop,
      disconnect,
    };

    await expect(factory.setupConnectionEventListeners(connection, "setup-failure", 3))
      .rejects.toThrow("start failed");

    expect(stop).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(processingError).toHaveBeenCalledWith(
      expect.stringContaining("stop cleanup failed"),
      expect.any(Error),
      "connection-cleanup",
      { videoId: "setup-failure", attemptId: 3, method: "stop" },
    );
  });

  test("normalizes direct chat-update payloads before handleChatMessage", async () => {
    const handleChatMessageCalls: RecordedMessage[] = [];
    const processRegularChatMessageCalls: RecordedMessage[] = [];
    const chatUpdateHandlers: HandlerMap = {};
    const logRawPlatformDataCalls: RawLogCall[] = [];

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        handleChatMessage: (msg: UnknownRecord) => handleChatMessageCalls.push(msg),
        _processRegularChatMessage: (msg: UnknownRecord) =>
          processRegularChatMessageCalls.push(msg),
        _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: async (...args: RawLogCall) => {
          logRawPlatformDataCalls.push(args);
        },
        setYouTubeConnectionReady: createMockFn(),
        config: { dataLoggingEnabled: true },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        chatUpdateHandlers[event] = handler;
      }),
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 7);

    const rawChatItem = {
      author: { id: "UC_TEST_1", name: "TestUser" },
      text: "hello there",
    };

    getHandler(chatUpdateHandlers, "chat-update")(rawChatItem);

    expect(logRawPlatformDataCalls).toHaveLength(1);
    const logCall = firstCall(logRawPlatformDataCalls);
    expect(logCall[0]).toBe("chat");
    expect(logCall[1]).toBe(rawChatItem);

    expect(processRegularChatMessageCalls).toHaveLength(0);
    expect(handleChatMessageCalls).toHaveLength(1);
    expect(firstCall(handleChatMessageCalls)).toMatchObject({
      item: {
        type: "LiveChatTextMessage",
        author: { id: "UC_TEST_1", name: "TestUser" },
        message: { text: "hello there" },
      },
      videoId: "video-1",
    });
  });

  test("normalizes direct chat-update payloads with timestamp_usec", async () => {
    const handleChatMessage = createMockFn();
    const chatUpdateHandlers: HandlerMap = {};

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        handleChatMessage,
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: createMockFn().mockResolvedValue(),
        setYouTubeConnectionReady: createMockFn(),
        config: { dataLoggingEnabled: false },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        chatUpdateHandlers[event] = handler;
      }),
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);

    getHandler(chatUpdateHandlers, "chat-update")({
      author: { id: "UC_TS_1", name: "TimestampUser" },
      text: "timestamp check",
      timestamp_usec: "1704067200000000",
    });

    const handleCall = firstCall(handleChatMessage.mock.calls);
    const message = handleCall[0] as UnknownRecord;
    const item = message.item as UnknownRecord;
    expect(item.timestamp_usec).toBe("1704067200000000");
  });

  test("normalizes direct chat-update payloads with timestamp when microseconds are missing", async () => {
    const handleChatMessage = createMockFn();
    const chatUpdateHandlers: HandlerMap = {};

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        handleChatMessage,
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: createMockFn().mockResolvedValue(),
        setYouTubeConnectionReady: createMockFn(),
        config: { dataLoggingEnabled: false },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        chatUpdateHandlers[event] = handler;
      }),
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);

    getHandler(chatUpdateHandlers, "chat-update")({
      author: { id: "UC_TS_2", name: "TimestampUser" },
      text: "timestamp check",
      timestamp: 1704067200000,
    });

    const handleCall = firstCall(handleChatMessage.mock.calls);
    const message = handleCall[0] as UnknownRecord;
    const item = message.item as UnknownRecord;
    expect(item.timestamp).toBe(1704067200000);
  });

  test("skips direct chat-update payloads with missing author id", async () => {
    const handleChatMessageCalls: RecordedMessage[] = [];
    const chatUpdateHandlers: HandlerMap = {};
    const logRawPlatformDataCalls: RawLogCall[] = [];

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        handleChatMessage: (msg: UnknownRecord) => handleChatMessageCalls.push(msg),
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: async (...args: RawLogCall) => {
          logRawPlatformDataCalls.push(args);
        },
        setYouTubeConnectionReady: createMockFn(),
        config: { dataLoggingEnabled: true },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        chatUpdateHandlers[event] = handler;
      }),
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);

    const rawChatItem = {
      author: { name: "MissingIdUser" },
      text: "hello there",
    };

    getHandler(chatUpdateHandlers, "chat-update")(rawChatItem);

    expect(logRawPlatformDataCalls).toHaveLength(1);
    const logCall = firstCall(logRawPlatformDataCalls);
    expect(logCall[0]).toBe("chat");
    expect(logCall[1]).toBe(rawChatItem);
    expect(handleChatMessageCalls).toHaveLength(0);
  });

  test("forwards complex YouTube gift purchase announcements so header author hydration can run", async () => {
    const handleChatMessage = createMockFn();
    const extractMessagesFromChatItem = createMockFn().mockReturnValue([
      {
        type: "AddChatItemAction",
        item: {
          type: "LiveChatSponsorshipsGiftPurchaseAnnouncement",
          id: "LCC.test-gift-purchase-connection-001",
          timestamp_usec: "1704067200000000",
          author_external_channel_id: "UC_TEST_GIFTER_001",
          header: {
            type: "LiveChatSponsorshipsHeader",
            author_name: {
              text: "@GiftGiver",
              rtl: false,
            },
            author_photo: [
              {
                url: "https://example.invalid/yt-gift-giver.png",
                width: 64,
                height: 64,
              },
            ],
            author_badges: [],
          },
          giftMembershipsCount: 5,
          message: { text: "" },
        },
      },
    ]);
    const chatUpdateHandlers: HandlerMap = {};

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        handleChatMessage,
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: extractMessagesFromChatItem,
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: createMockFn().mockResolvedValue(),
        setYouTubeConnectionReady: createMockFn(),
        _resolveChatItemAuthorName: createMockFn().mockReturnValue(""),
        config: { dataLoggingEnabled: false },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        chatUpdateHandlers[event] = handler;
      }),
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);

    getHandler(chatUpdateHandlers, "chat-update")({
      type: "AddChatItemAction",
      item: {
        type: "LiveChatSponsorshipsGiftPurchaseAnnouncement",
      },
    });

    expect(handleChatMessage).toHaveBeenCalledTimes(1);
    expect(firstCall(handleChatMessage.mock.calls)[0]).toMatchObject({
      videoId: "video-1",
      item: {
        type: "LiveChatSponsorshipsGiftPurchaseAnnouncement",
        author_external_channel_id: "UC_TEST_GIFTER_001",
        header: {
          author_name: {
            text: "@GiftGiver",
          },
        },
        giftMembershipsCount: 5,
      },
    });
  });

  test("forwards modern GiftMessageView events without item.author.name", async () => {
    const handleChatMessage = createMockFn();
    const extractMessagesFromChatItem = createMockFn().mockReturnValue([
      {
        type: "AddChatItemAction",
        item: {
          type: "GiftMessageView",
          id: "gift-message-view-001",
          timestamp_usec: "1704067200000000",
          text: { content: "sent Let em cook" },
          author_name: { content: "@test-youtube-gifter " },
          gift_image: {
            sources: [
              { url: "https://example.invalid/let-em-cook-480.png", width: 480, height: 480 },
              { url: "https://example.invalid/let-em-cook-640.png", width: 640, height: 640 },
            ],
          },
          gift_image_a11y_label: "Let em cook",
        },
      },
    ]);
    const chatUpdateHandlers: HandlerMap = {};

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        handleChatMessage,
        _extractMessagesFromChatItem: extractMessagesFromChatItem,
        _resolveChatItemAuthorName: createMockFn().mockReturnValue("test-youtube-gifter"),
        config: { dataLoggingEnabled: false },
      },
    });
    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        chatUpdateHandlers[event] = handler;
      }),
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);
    getHandler(chatUpdateHandlers, "chat-update")({ type: "AddChatItemAction" });

    expect(handleChatMessage).toHaveBeenCalledTimes(1);
    expect(firstCall(handleChatMessage.mock.calls)[0]).toMatchObject({
      videoId: "video-1",
      item: { type: "GiftMessageView", author_name: { content: "@test-youtube-gifter " } },
    });
  });

  test("still skips non-gift complex chat updates when author is missing", async () => {
    const handleChatMessage = createMockFn();
    const extractMessagesFromChatItem = createMockFn().mockReturnValue([
      {
        type: "AddChatItemAction",
        item: {
          type: "LiveChatTickerSponsorItem",
          id: "LCC.test-non-gift-missing-author-001",
          timestamp_usec: "1704067200000000",
          message: { text: "" },
        },
      },
    ]);
    const chatUpdateHandlers: HandlerMap = {};

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        handleChatMessage,
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: extractMessagesFromChatItem,
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: createMockFn().mockResolvedValue(),
        setYouTubeConnectionReady: createMockFn(),
        _resolveChatItemAuthorName: createMockFn().mockReturnValue(""),
        config: { dataLoggingEnabled: false },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        chatUpdateHandlers[event] = handler;
      }),
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);

    getHandler(chatUpdateHandlers, "chat-update")({
      type: "AddChatItemAction",
      item: {
        type: "LiveChatTickerSponsorItem",
      },
    });

    expect(handleChatMessage).not.toHaveBeenCalled();
  });

  test("marks connection ready on start events, logs initial batches, and applies live chat mode", async () => {
    const connectionReadyCalls: string[] = [];
    const startHandlers: HandlerMap = {};
    const selectedChatFilter: { value: string | null } = { value: null };
    let applyFilterCalls = 0;

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        setYouTubeConnectionReady: (videoId: string) =>
          connectionReadyCalls.push(videoId),
        handleChatMessage: createMockFn(),
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: createMockFn().mockResolvedValue(),
        config: { dataLoggingEnabled: false, chatMode: "live" },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        startHandlers[event] = handler;
      }),
      applyFilter: (filter: string) => {
        applyFilterCalls += 1;
        selectedChatFilter.value = filter;
      },
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);

    getHandler(startHandlers, "start")({
      header: {
        view_selector: {
          sub_menu_items: [
            { selected: true, continuation: "top-cont" },
            { selected: false, continuation: "live-cont" },
          ],
        },
      },
      actions: [{ type: "AddChatItemAction" }, { type: "AddChatItemAction" }],
    });

    expect(applyFilterCalls).toBe(1);
    expect(selectedChatFilter.value).toBe("LIVE_CHAT");
    expect(connectionReadyCalls).toHaveLength(1);
    expect(connectionReadyCalls[0]).toBe("video-1");
  });

  test("applies top chat mode when configured", async () => {
    const startHandlers: HandlerMap = {};
    const selectedChatFilter: { value: string | null } = { value: null };
    let applyFilterCalls = 0;

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        setYouTubeConnectionReady: createMockFn(),
        handleChatMessage: createMockFn(),
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: createMockFn().mockResolvedValue(),
        config: { dataLoggingEnabled: false, chatMode: "top" },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        startHandlers[event] = handler;
      }),
      applyFilter: (filter: string) => {
        applyFilterCalls += 1;
        selectedChatFilter.value = filter;
      },
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);

    getHandler(startHandlers, "start")({
      header: {
        view_selector: {
          sub_menu_items: [
            { selected: false, continuation: "top-cont" },
            { selected: true, continuation: "live-cont" },
          ],
        },
      },
      actions: [],
    });

    expect(applyFilterCalls).toBe(1);
    expect(selectedChatFilter.value).toBe("TOP_CHAT");
  });

  test("keeps connection ready when chat mode selector is unavailable", async () => {
    const startHandlers: HandlerMap = {};
    let selectedChatFilter: string | null = null;
    const connectionReadyCalls: string[] = [];

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        setYouTubeConnectionReady: (videoId: string) =>
          connectionReadyCalls.push(videoId),
        handleChatMessage: createMockFn(),
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: createMockFn().mockResolvedValue(),
        config: { dataLoggingEnabled: false, chatMode: "live" },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        startHandlers[event] = handler;
      }),
      applyFilter: (filter: string) => {
        selectedChatFilter = filter;
      },
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);

    getHandler(startHandlers, "start")({ actions: [] });

    expect(selectedChatFilter).toBeNull();
    expect(connectionReadyCalls).toHaveLength(1);
    expect(connectionReadyCalls[0]).toBe("video-1");
  });

  test("does not apply filter when requested chat mode is already selected", async () => {
    const startHandlers: HandlerMap = {};
    let selectedChatFilter: string | null = null;

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        setYouTubeConnectionReady: createMockFn(),
        handleChatMessage: createMockFn(),
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: createMockFn().mockResolvedValue(),
        config: { dataLoggingEnabled: false, chatMode: "live" },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        startHandlers[event] = handler;
      }),
      applyFilter: (filter: string) => {
        selectedChatFilter = filter;
      },
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);

    getHandler(startHandlers, "start")({
      header: {
        view_selector: {
          sub_menu_items: [
            { selected: false, continuation: "top-cont" },
            { selected: true, continuation: null },
          ],
        },
      },
      actions: [],
    });

    expect(selectedChatFilter).toBeNull();
  });

  test("reports processing error when applyFilter throws", async () => {
    const startHandlers: HandlerMap = {};
    const processingErrors: ProcessingErrorCall[] = [];
    const applyFilter = createMockFn(() => {
      throw new Error("filter failed");
    });

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        setYouTubeConnectionReady: createMockFn(),
        _handleProcessingError: (...args: ProcessingErrorCall) => processingErrors.push(args),
        handleChatMessage: createMockFn(),
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: createMockFn().mockResolvedValue(),
        config: { dataLoggingEnabled: false, chatMode: "live" },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        startHandlers[event] = handler;
      }),
      applyFilter,
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);

    getHandler(startHandlers, "start")({
      header: {
        view_selector: {
          sub_menu_items: [
            { selected: true, continuation: "top-cont" },
            { selected: false, continuation: "live-cont" },
          ],
        },
      },
      actions: [],
    });

    expect(processingErrors).toHaveLength(1);
    expect(firstCall(processingErrors)[2]).toBe("chat-mode");
  });

  test("handles API errors from live chat with disconnect", async () => {
    const disconnectCalls: DisconnectCall[] = [];
    const errorHandlers: HandlerMap = {};

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        disconnectFromYouTubeStream: (videoId: string, reason: string, options?: DisconnectCall["options"]) =>
          recordDisconnectCall(disconnectCalls, videoId, reason, options),
        _handleProcessingError: createMockFn(),
        handleChatMessage: createMockFn(),
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: createMockFn().mockResolvedValue(),
        setYouTubeConnectionReady: createMockFn(),
        config: { dataLoggingEnabled: false },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        errorHandlers[event] = handler;
      }),
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 7);

    getHandler(errorHandlers, "error")(new Error("403 forbidden"));

    expect(disconnectCalls).toHaveLength(1);
    const disconnectCall = firstCall(disconnectCalls);
    expect(disconnectCall.videoId).toBe("video-1");
    expect(disconnectCall.reason).toBe("API error: 403 forbidden");
    expect(disconnectCall.options).toEqual({ expectedAttemptId: 7 });
  });

  test("does not disconnect on temporary live chat errors", async () => {
    const disconnectCalls: DisconnectCall[] = [];
    const errorHandlers: HandlerMap = {};

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        disconnectFromYouTubeStream: (videoId: string, reason: string, options?: DisconnectCall["options"]) =>
          recordDisconnectCall(disconnectCalls, videoId, reason, options),
        _handleProcessingError: createMockFn(),
        handleChatMessage: createMockFn(),
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: createMockFn().mockResolvedValue(),
        setYouTubeConnectionReady: createMockFn(),
        config: { dataLoggingEnabled: false },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        errorHandlers[event] = handler;
      }),
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);

    getHandler(errorHandlers, "error")(new Error("503 upstream unavailable"));

    expect(disconnectCalls).toHaveLength(0);
  });

  test("passes immediate-refresh context for terminal non-API errors", async () => {
    const disconnectCalls: DisconnectCall[] = [];
    const errorHandlers: HandlerMap = {};

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        disconnectFromYouTubeStream: (videoId: string, reason: string, options?: DisconnectCall["options"]) =>
          recordDisconnectCall(disconnectCalls, videoId, reason, options),
        _handleProcessingError: createMockFn(),
        handleChatMessage: createMockFn(),
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: createMockFn().mockResolvedValue(),
        setYouTubeConnectionReady: createMockFn(),
        config: { dataLoggingEnabled: false },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        errorHandlers[event] = handler;
      }),
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);

    getHandler(errorHandlers, "error")(
      new Error("Unexpected live chat incremental continuation response"),
    );

    expect(disconnectCalls).toHaveLength(1);
    expect(firstCall(disconnectCalls)).toEqual({
      videoId: "video-1",
      reason: "Error: Unexpected live chat incremental continuation response",
      options: { requestImmediateRefresh: true, source: "livechat-error", expectedAttemptId: 1 },
    });
  });

  test("routes complex chat items through extractors and logging", async () => {
    const handleChatMessageCalls: RecordedMessage[] = [];
    const chatUpdateHandlers: HandlerMap = {};
    const logRawPlatformDataCalls: RawLogCall[] = [];
    const shouldSkipMessage = createMockFn(
      (message: UnknownRecord) => (message.item as UnknownRecord | undefined)?.id === "skip-me",
    );
    const resolveChatItemAuthorName = createMockFn(
      (message: UnknownRecord) => {
        const item = message.item as UnknownRecord | undefined;
        const author = item?.author as UnknownRecord | undefined;
        return typeof author?.name === "string" ? author.name : "Author";
      },
    );
    const messages = [
      {
        item: {
          id: "skip-me",
          type: "LiveChatTextMessage",
          message: { text: "skip" },
          author: { name: "Skip" },
        },
      },
      {
        item: {
          id: "process-me",
          type: "LiveChatTextMessage",
          message: { text: "process" },
          author: { name: "Author" },
        },
      },
    ];

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        handleChatMessage: (msg: UnknownRecord) => handleChatMessageCalls.push(msg),
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: createMockFn().mockReturnValue(messages),
        _shouldSkipMessage: shouldSkipMessage,
        _resolveChatItemAuthorName: resolveChatItemAuthorName,
        logRawPlatformData: async (...args: RawLogCall) => {
          logRawPlatformDataCalls.push(args);
        },
        setYouTubeConnectionReady: createMockFn(),
        config: { dataLoggingEnabled: true },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        chatUpdateHandlers[event] = handler;
      }),
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);

    const rawChatItem = { type: "AddChatItemAction" };
    getHandler(chatUpdateHandlers, "chat-update")(rawChatItem);

    expect(handleChatMessageCalls).toHaveLength(1);
    expect(firstCall(handleChatMessageCalls).videoId).toBe("video-1");
    expect(logRawPlatformDataCalls).toHaveLength(1);
    const logCall = firstCall(logRawPlatformDataCalls);
    expect(logCall[0]).toBe("chat");
    expect(logCall[1]).toBe(rawChatItem);
  });

  test("disconnects when live chat ends", async () => {
    const disconnectCalls: DisconnectCall[] = [];
    const handlers: HandlerMap = {};

    const { factory } = createFactory({
      validationResult: { shouldConnect: true },
      platformOverrides: {
        disconnectFromYouTubeStream: (videoId: string, reason: string, options?: DisconnectCall["options"]) =>
          recordDisconnectCall(disconnectCalls, videoId, reason, options),
        handleChatMessage: createMockFn(),
        _processRegularChatMessage: createMockFn(),
        _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
        _shouldSkipMessage: createMockFn().mockReturnValue(false),
        logRawPlatformData: createMockFn().mockResolvedValue(),
        setYouTubeConnectionReady: createMockFn(),
        config: { dataLoggingEnabled: false },
      },
    });

    const connection = {
      on: createMockFn((event: string, handler: ChatEventHandler) => {
        handlers[event] = handler;
      }),
      start: createMockFn<[], void>(),
      removeAllListeners: createMockFn(),
    };

    await factory.setupConnectionEventListeners(connection, "video-1", 1);

    getHandler(handlers, "end")();

    expect(disconnectCalls).toHaveLength(1);
    const disconnectCall = firstCall(disconnectCalls);
    expect(disconnectCall.videoId).toBe("video-1");
    expect(disconnectCall.reason).toBe("stream ended");
    expect(disconnectCall.options).toEqual({
      requestImmediateRefresh: true,
      source: "livechat-end",
      expectedAttemptId: 1,
    });
  });
});
