import { vi, type Mock, describe, test, expect, beforeEach } from 'bun:test';
import type { InstallYouTubeLiveChatUnknownRendererCaptureOptions } from "../../../../../src/platforms/youtube/connections/youtube-live-chat-unknown-renderer-capture";



const {
  installYouTubeParserLogAdapter,
} = require("../../../../../src/utils/youtube-parser-log-adapter.ts");
const {
  installYouTubeLiveChatUnknownRendererCapture,
} = require("../../../../../src/platforms/youtube/connections/youtube-live-chat-unknown-renderer-capture.ts");

type CaptureActionArgs = Exclude<
  Parameters<
    InstallYouTubeLiveChatUnknownRendererCaptureOptions["actions"]["execute"]
  >[1],
  undefined
>;
const captureActionArgsForTypeCheck = {} as CaptureActionArgs;
const parseFlagForTypeCheck: boolean | undefined =
  captureActionArgsForTypeCheck.parse;
const continuationForTypeCheck: string | undefined =
  captureActionArgsForTypeCheck.continuation;
void parseFlagForTypeCheck;
void continuationForTypeCheck;

type ParserError = { error_type: string; classname: string };
type ParserErrorHandler = (error: ParserError) => void;
type ParserApiFixture = {
  setParserErrorHandler: Mock<(...args: [ParserErrorHandler]) => void>;
  parseResponse: Mock<(...args: [unknown]) => unknown>;
};
type LiveChatActions = {
  execute: Mock<(...args: [string, CaptureActionArgs?]) => Promise<unknown>>;
};
type CapturedRendererLog = {
  videoId?: string | null;
  matchedRenderers?: Array<Record<string, unknown>>;
  parserWarnings?: unknown[];
  responseMetadata?: { captureTraversal: { visitedNodes: number; truncated: boolean } };
};
type LogUnknownRendererMock = Mock<(...args: [CapturedRendererLog]) => Promise<void>>;

const createParserApiFixture = (): ParserApiFixture => ({
  setParserErrorHandler: vi.fn<(...args: [ParserErrorHandler]) => void>(),
  parseResponse: vi.fn<(...args: [unknown]) => unknown>(),
});

const getParserErrorHandler = (
  parserApi: ParserApiFixture,
): ParserErrorHandler => {
  const [handler] = parserApi.setParserErrorHandler.mock.calls[0] ?? [];
  expect(handler).toBeDefined();
  if (handler === undefined) {
    throw new Error("Expected YouTube parser error handler to be installed");
  }
  return handler;
};

const createActions = (response: unknown): LiveChatActions => ({
  execute: vi.fn<(...args: [string, CaptureActionArgs?]) => Promise<unknown>>().mockResolvedValue(response),
});

const createLogUnknownRendererMock = (): LogUnknownRendererMock =>
  vi.fn<(...args: [CapturedRendererLog]) => Promise<void>>().mockResolvedValue(
    undefined,
  );

const getLoggedRenderer = (
  logUnknownRenderer: LogUnknownRendererMock,
): CapturedRendererLog => {
  const [payload] = logUnknownRenderer.mock.calls[0] ?? [];
  expect(payload).toBeDefined();
  if (payload === undefined) {
    throw new Error("Expected unknown renderer log payload");
  }
  return payload;
};

describe("YouTube live chat unknown renderer capture", () => {
  let logger;
  let parserApi: ParserApiFixture;

  const createGiftRawResponse = (
    text = "sent Clapping seal for 250 Jewels",
  ) => ({
    data: {
      continuationContents: {
        liveChatContinuation: {
          actions: [
            {
              trackingParams: "test-tracking-params",
              addChatItemAction: {
                clientId: "test-client-id",
                item: {
                  giftMessageView: {
                    id: "test-gift-id",
                    text: {
                      runs: [{ text }],
                    },
                  },
                  itemMetadata: {
                    source: "test-item-metadata",
                  },
                },
              },
            },
          ],
          continuations: [
            {
              timedContinuationData: {
                continuation: "test-continuation-2",
              },
            },
          ],
        },
      },
    },
  });

  const createParsedResponse = (token = "test-continuation-2") => ({
    continuation_contents: {
      continuation: {
        token,
      },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    logger = {
      debug: vi.fn<(...args: unknown[]) => unknown>(),
      info: vi.fn<(...args: unknown[]) => unknown>(),
      warn: vi.fn<(...args: unknown[]) => unknown>(),
      error: vi.fn<(...args: unknown[]) => unknown>(),
    };
    parserApi = createParserApiFixture();

    installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });
  });

  test("disabled capture passes original arguments through without parsing or touching response getters", async () => {
    let reads = 0;
    const response = Object.defineProperty({}, "data", { get() { reads++; throw new Error("test accessor"); } });
    const actions = createActions(response);
    const originalExecute = actions.execute;
    const logUnknownRenderer = createLogUnknownRendererMock();
    installYouTubeLiveChatUnknownRendererCapture({ actions, parser: parserApi, videoId: "test-disabled", isEnabled: () => false, logUnknownRenderer });
    const args = { continuation: "test-disabled-token", parse: true };
    expect(await actions.execute("live_chat/get_live_chat", args)).toBe(response);
    expect(originalExecute.mock.calls[0]?.[1]).toBe(args);
    expect(parserApi.parseResponse).not.toHaveBeenCalled();
    expect(logUnknownRenderer).not.toHaveBeenCalled();
    expect(reads).toBe(0);
  });

  test("disabling during a pending raw request still parses once but does not capture", async () => {
    let enabled = true;
    let complete: (response: unknown) => void = () => { throw new Error("test request not started"); };
    const actions = createActions(undefined);
    actions.execute.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const parsed = createParsedResponse();
    const handler = getParserErrorHandler(parserApi);
    parserApi.parseResponse.mockImplementation(() => { handler({ error_type: "class_not_found", classname: "GiftMessageView" }); return parsed; });
    const logUnknownRenderer = createLogUnknownRendererMock();
    installYouTubeLiveChatUnknownRendererCapture({ actions, parser: parserApi, videoId: "test-pending", isEnabled: () => enabled, logUnknownRenderer });
    const pending = actions.execute("live_chat/get_live_chat", { parse: true });
    enabled = false;
    complete(createGiftRawResponse());
    expect(await pending).toBe(parsed);
    expect(parserApi.parseResponse).toHaveBeenCalledTimes(1);
    expect(logUnknownRenderer).not.toHaveBeenCalled();
  });

  test("bounds cyclic, deep and wide diagnostics and skips accessors while retaining shared references", async () => {
    let reads = 0;
    const shared = { giftMessageView: { id: "test-shared" } };
    const raw: Record<string, unknown> = { first: shared, second: shared };
    raw.self = raw;
    Object.defineProperty(raw, "getter", { enumerable: true, get() { reads++; throw new Error("test accessor"); } });
    raw.proxy = new Proxy({}, { ownKeys() { reads++; throw new Error("test proxy"); } });
    let deep: unknown = { giftMessageView: { id: "test-too-deep" } };
    for (let index = 0; index < 30; index++) deep = { next: deep };
    raw.deep = deep;
    raw.wide = Array.from({ length: 200 }, (_, index) => ({ giftMessageView: { id: `test-wide-${index}` } }));
    const parsed = createParsedResponse();
    const handler = getParserErrorHandler(parserApi);
    parserApi.parseResponse.mockImplementation(() => { handler({ error_type: "class_not_found", classname: "GiftMessageView" }); return parsed; });
    const logUnknownRenderer = createLogUnknownRendererMock();
    const actions = createActions({ data: raw });
    installYouTubeLiveChatUnknownRendererCapture({ actions, parser: parserApi, videoId: "test-bounded", logUnknownRenderer });
    expect(await actions.execute("live_chat/get_live_chat", { parse: true })).toBe(parsed);
    const entry = getLoggedRenderer(logUnknownRenderer);
    expect(reads).toBe(0);
    expect(entry.matchedRenderers?.length).toBeLessThanOrEqual(100);
    expect(entry.matchedRenderers?.slice(0, 2).map(match => match.renderer)).toEqual([shared.giftMessageView, shared.giftMessageView]);
    expect(entry).toMatchObject({ responseMetadata: { captureTraversal: { truncated: true } } });
    expect(entry.matchedRenderers?.some(match => match.path === "$.deep.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.next.giftMessageView")).toBe(false);
  });

  test("diagnostic callback failures do not reject or repeat an otherwise parsed response", async () => {
    const parsed = createParsedResponse();
    const handler = getParserErrorHandler(parserApi);
    parserApi.parseResponse.mockImplementation(() => { handler({ error_type: "class_not_found", classname: "GiftMessageView" }); return parsed; });
    const actions = createActions(createGiftRawResponse());
    const originalExecute = actions.execute;
    const logUnknownRenderer = createLogUnknownRendererMock().mockRejectedValue(new Error("test diagnostic failure"));
    installYouTubeLiveChatUnknownRendererCapture({ actions, parser: parserApi, videoId: "test-failure", logUnknownRenderer });
    expect(await actions.execute("live_chat/get_live_chat", { parse: true })).toBe(parsed);
    expect(originalExecute).toHaveBeenCalledTimes(1);
    expect(parserApi.parseResponse).toHaveBeenCalledTimes(1);
  });

  test("caps total traversal nodes and warning classes with bounded paths and keys", async () => {
    const handler = getParserErrorHandler(parserApi);
    const parsed = createParsedResponse();
    parserApi.parseResponse.mockImplementation(() => {
      for (let index = 0; index < 150; index++) handler({ error_type: "class_not_found", classname: "GiftMessageView" });
      return parsed;
    });
    const raw = {
      ["test".repeat(2000)]: { giftMessageView: { id: "test-long-key" } },
      ["k".repeat(4095)]: { giftMessageView: { id: "test-long-path" } },
      list: Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => null))
    };
    const actions = createActions({ data: raw });
    const logUnknownRenderer = createLogUnknownRendererMock();
    installYouTubeLiveChatUnknownRendererCapture({ actions, parser: parserApi, videoId: "test-budget", logUnknownRenderer });
    expect(await actions.execute("live_chat/get_live_chat", { parse: true })).toBe(parsed);
    const entry = getLoggedRenderer(logUnknownRenderer);
    expect(entry.parserWarnings).toHaveLength(100);
    expect(entry.matchedRenderers).toEqual([]);
    expect(entry.responseMetadata?.captureTraversal).toEqual({ visitedNodes: 1000, truncated: true });
  });

  test("captures identities before concurrent requests settle and retires consumed continuation tokens", async () => {
    const handler = getParserErrorHandler(parserApi);
    parserApi.parseResponse.mockImplementation((data: unknown) => {
      handler({ error_type: "class_not_found", classname: "GiftMessageView" });
      return createParsedResponse((data as { next: string }).next);
    });
    const pendingResponses = new Map<string, (response: unknown) => void>();
    const actions = createActions(undefined);
    actions.execute.mockImplementation((_endpoint, args) => new Promise(resolve => { pendingResponses.set(args?.continuation ?? "", resolve); }));
    const logUnknownRenderer = createLogUnknownRendererMock();
    for (const videoId of ["test-one", "test-two"]) {
      installYouTubeLiveChatUnknownRendererCapture({ actions, parser: parserApi, videoId, initialContinuation: `${videoId}-initial`, logUnknownRenderer });
    }
    const first = actions.execute("live_chat/get_live_chat", { parse: true, continuation: "test-one-initial" });
    const second = actions.execute("live_chat/get_live_chat", { parse: true, continuation: "test-two-initial" });
    pendingResponses.get("test-two-initial")?.({ data: { giftMessageView: {}, next: "test-two-next" } });
    await second;
    pendingResponses.get("test-one-initial")?.({ data: { giftMessageView: {}, next: "test-one-next" } });
    await first;
    expect(logUnknownRenderer.mock.calls.map(([entry]) => entry.videoId)).toEqual(["test-two", "test-one"]);
    const retired = actions.execute("live_chat/get_live_chat", { parse: true, continuation: "test-one-initial" });
    pendingResponses.get("test-one-initial")?.({ data: { giftMessageView: {}, next: "test-unmapped-next" } });
    await retired;
    expect(logUnknownRenderer.mock.calls[2]?.[0].videoId).toBeNull();
    const next = actions.execute("live_chat/get_live_chat", { parse: true, continuation: "test-one-next" });
    pendingResponses.get("test-one-next")?.({ data: { giftMessageView: {}, next: "test-one-final" } });
    await next;
    expect(logUnknownRenderer.mock.calls[3]?.[0].videoId).toBe("test-one");
  });

  test("bypasses other endpoints and unparsed or malformed SDK responses", async () => {
    const actions = createActions({ data: {} });
    const original = actions.execute;
    const logUnknownRenderer = createLogUnknownRendererMock();
    installYouTubeLiveChatUnknownRendererCapture({ actions, parser: parserApi, videoId: "test-pass-through", logUnknownRenderer });
    for (const [endpoint, args] of [["test/other", { parse: true }], ["live_chat/get_live_chat", { parse: false }], ["live_chat/get_live_chat", undefined]] as const) {
      await actions.execute(endpoint, args);
      expect(original.mock.calls.at(-1)?.[1]).toBe(args);
    }
    original.mockResolvedValueOnce({ test: "not a raw response" });
    expect(await actions.execute("live_chat/get_live_chat_replay", { parse: true })).toEqual({ test: "not a raw response" });
    expect(parserApi.parseResponse).not.toHaveBeenCalled();
    installYouTubeLiveChatUnknownRendererCapture({ actions, parser: parserApi, videoId: "test-pass-through", isEnabled: () => { throw new Error("test predicate failure"); }, logUnknownRenderer });
    await actions.execute("live_chat/get_live_chat", { parse: true });
    expect(parserApi.parseResponse).not.toHaveBeenCalled();
  });

  test("re-parses raw live chat responses and logs matched unknown renderers", async () => {
    const rawResponse = createGiftRawResponse();
    const parsedResponse = createParsedResponse();
    const handler = getParserErrorHandler(parserApi);
    parserApi.parseResponse.mockImplementation((data: unknown) => {
      expect(data).toBe(rawResponse.data);
      handler({
        error_type: "class_not_found",
        classname: "GiftMessageView",
      });
      return parsedResponse;
    });

    const actions = createActions(rawResponse);
    const { execute } = actions;
    const logUnknownRenderer = createLogUnknownRendererMock();

    installYouTubeLiveChatUnknownRendererCapture({
      actions,
      parser: parserApi,
      videoId: "test-video-id",
      initialContinuation: "test-continuation-1",
      logUnknownRenderer,
    });

    const result = await actions.execute("live_chat/get_live_chat", {
      continuation: "test-continuation-1",
      parse: true,
    });

    expect(result).toBe(parsedResponse);
    expect(logUnknownRenderer).toHaveBeenCalledTimes(1);
    expect(getLoggedRenderer(logUnknownRenderer)).toMatchObject({
      videoId: "test-video-id",
      endpoint: "live_chat/get_live_chat",
      parserWarnings: [
        expect.objectContaining({ className: "GiftMessageView" }),
      ],
      matchedRenderers: [
        expect.objectContaining({
          className: "GiftMessageView",
          rawKey: "giftMessageView",
        }),
      ],
    });
    expect(execute.mock.calls[0]?.[1]).toMatchObject({
      continuation: "test-continuation-1",
      parse: false,
    });
  });

  test("captures the immediate item container for GiftMessageView so sibling item metadata can be inspected", async () => {
    const rawResponse = createGiftRawResponse("sent Girl power for 300 Jewels");
    const parsedResponse = createParsedResponse();
    const handler = getParserErrorHandler(parserApi);
    parserApi.parseResponse.mockImplementation(() => {
      handler({
        error_type: "class_not_found",
        classname: "GiftMessageView",
      });
      return parsedResponse;
    });

    const actions = createActions(rawResponse);
    const logUnknownRenderer = createLogUnknownRendererMock();

    installYouTubeLiveChatUnknownRendererCapture({
      actions,
      parser: parserApi,
      videoId: "test-video-id",
      initialContinuation: "test-continuation-1",
      logUnknownRenderer,
    });

    await actions.execute("live_chat/get_live_chat", {
      continuation: "test-continuation-1",
      parse: true,
    });

    expect(logUnknownRenderer).toHaveBeenCalledTimes(1);
    expect(getLoggedRenderer(logUnknownRenderer)).toMatchObject({
      matchedRenderers: [
        expect.objectContaining({
          containerPath:
            "$.continuationContents.liveChatContinuation.actions[0].addChatItemAction.item",
          container: {
            giftMessageView: expect.objectContaining({
              id: "test-gift-id",
            }),
            itemMetadata: {
              source: "test-item-metadata",
            },
          },
        }),
      ],
    });
  });

  test("captures the enclosing raw action wrapper for GiftMessageView so sibling action metadata can be inspected", async () => {
    const rawResponse = createGiftRawResponse("sent Girl power for 300 Jewels");
    const parsedResponse = createParsedResponse();
    const handler = getParserErrorHandler(parserApi);
    parserApi.parseResponse.mockImplementation(() => {
      handler({
        error_type: "class_not_found",
        classname: "GiftMessageView",
      });
      return parsedResponse;
    });

    const actions = createActions(rawResponse);
    const logUnknownRenderer = createLogUnknownRendererMock();

    installYouTubeLiveChatUnknownRendererCapture({
      actions,
      parser: parserApi,
      videoId: "test-video-id",
      initialContinuation: "test-continuation-1",
      logUnknownRenderer,
    });

    await actions.execute("live_chat/get_live_chat", {
      continuation: "test-continuation-1",
      parse: true,
    });

    expect(logUnknownRenderer).toHaveBeenCalledTimes(1);
    const [capturedMatch] = getLoggedRenderer(logUnknownRenderer).matchedRenderers ?? [];
    expect(capturedMatch).toBeDefined();
    if (capturedMatch === undefined) {
      throw new Error("Expected a captured renderer match");
    }
    expect(capturedMatch.actionPath).toBe(
      "$.continuationContents.liveChatContinuation.actions[0]",
    );
    expect(capturedMatch.action).toMatchObject({
      trackingParams: "test-tracking-params",
      addChatItemAction: {
        clientId: "test-client-id",
      },
    });
  });

  test("does not write capture logs when the parser sees no unknown renderers", async () => {
    const parsedResponse = createParsedResponse();
    parserApi.parseResponse.mockReturnValue(parsedResponse);

    const actions = createActions({ data: { ok: true } });
    const logUnknownRenderer = createLogUnknownRendererMock();

    installYouTubeLiveChatUnknownRendererCapture({
      actions,
      parser: parserApi,
      videoId: "test-video-id",
      initialContinuation: "test-continuation-1",
      logUnknownRenderer,
    });

    const result = await actions.execute("live_chat/get_live_chat", {
      continuation: "test-continuation-1",
      parse: true,
    });

    expect(result).toBe(parsedResponse);
    expect(logUnknownRenderer).not.toHaveBeenCalled();
  });

  test("does not attribute unresolved continuations to a stale stream id when multiple streams share actions", async () => {
    const rawResponse = createGiftRawResponse("sent Girl power for 300 Jewels");
    const parsedResponse = createParsedResponse("next-shared-token");
    const handler = getParserErrorHandler(parserApi);
    parserApi.parseResponse.mockImplementation(() => {
      handler({
        error_type: "class_not_found",
        classname: "GiftMessageView",
      });
      return parsedResponse;
    });

    const actions = createActions(rawResponse);
    const logUnknownRenderer = createLogUnknownRendererMock();

    installYouTubeLiveChatUnknownRendererCapture({
      actions,
      parser: parserApi,
      videoId: "stream-one",
      initialContinuation: "stream-one-continuation",
      logUnknownRenderer,
    });

    installYouTubeLiveChatUnknownRendererCapture({
      actions,
      parser: parserApi,
      videoId: "stream-two",
      initialContinuation: "stream-two-continuation",
      logUnknownRenderer,
    });

    await actions.execute("live_chat/get_live_chat", {
      continuation: "unmapped-stream-two-continuation",
      parse: true,
    });

    expect(logUnknownRenderer).toHaveBeenCalledTimes(1);
    expect(getLoggedRenderer(logUnknownRenderer)).toMatchObject({
      videoId: null,
      matchedRenderers: [
        expect.objectContaining({ rawKey: "giftMessageView" }),
      ],
    });
  });

  test("falls back to the only known stream id when a single-stream continuation is unresolved", async () => {
    const rawResponse = createGiftRawResponse("sent Girl power for 300 Jewels");
    const parsedResponse = createParsedResponse("next-single-token");
    const handler = getParserErrorHandler(parserApi);
    parserApi.parseResponse.mockImplementation(() => {
      handler({
        error_type: "class_not_found",
        classname: "GiftMessageView",
      });
      return parsedResponse;
    });

    const actions = createActions(rawResponse);
    const logUnknownRenderer = createLogUnknownRendererMock();

    installYouTubeLiveChatUnknownRendererCapture({
      actions,
      parser: parserApi,
      videoId: "single-stream",
      initialContinuation: "single-stream-continuation",
      logUnknownRenderer,
    });

    await actions.execute("live_chat/get_live_chat", {
      continuation: "unmapped-single-stream-continuation",
      parse: true,
    });

    expect(logUnknownRenderer).toHaveBeenCalledTimes(1);
    expect(getLoggedRenderer(logUnknownRenderer)).toMatchObject({
      videoId: "single-stream",
    });
  });
});
