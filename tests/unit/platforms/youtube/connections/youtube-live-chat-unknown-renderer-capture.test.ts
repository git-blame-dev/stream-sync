import { describe, test, expect, beforeEach } from "bun:test";
import type { InstallYouTubeLiveChatUnknownRendererCaptureOptions } from "../../../../../src/platforms/youtube/connections/youtube-live-chat-unknown-renderer-capture";
import {
  createMockFn,
  clearAllMocks,
} from "../../../../helpers/bun-mock-utils";

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

describe("YouTube live chat unknown renderer capture", () => {
  let logger;
  let parserApi;

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
    clearAllMocks();
    logger = {
      debug: createMockFn(),
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
    };
    parserApi = {
      setParserErrorHandler: createMockFn(),
      parseResponse: createMockFn(),
    };

    installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });
  });

  test("re-parses raw live chat responses and logs matched unknown renderers", async () => {
    const rawResponse = createGiftRawResponse();
    const parsedResponse = createParsedResponse();
    const handler = parserApi.setParserErrorHandler.mock.calls[0][0];
    parserApi.parseResponse.mockImplementation((data) => {
      expect(data).toBe(rawResponse.data);
      handler({
        error_type: "class_not_found",
        classname: "GiftMessageView",
      });
      return parsedResponse;
    });

    const execute = createMockFn().mockResolvedValue(rawResponse);
    const actions = {
      execute,
    };
    const logUnknownRenderer = createMockFn().mockResolvedValue(undefined);

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
    expect(logUnknownRenderer.mock.calls[0][0]).toMatchObject({
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
    expect(execute.mock.calls[0][1]).toMatchObject({
      continuation: "test-continuation-1",
      parse: false,
    });
  });

  test("captures the immediate item container for GiftMessageView so sibling item metadata can be inspected", async () => {
    const rawResponse = createGiftRawResponse("sent Girl power for 300 Jewels");
    const parsedResponse = createParsedResponse();
    const handler = parserApi.setParserErrorHandler.mock.calls[0][0];
    parserApi.parseResponse.mockImplementation(() => {
      handler({
        error_type: "class_not_found",
        classname: "GiftMessageView",
      });
      return parsedResponse;
    });

    const actions = {
      execute: createMockFn().mockResolvedValue(rawResponse),
    };
    const logUnknownRenderer = createMockFn().mockResolvedValue(undefined);

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
    expect(logUnknownRenderer.mock.calls[0][0]).toMatchObject({
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
    const handler = parserApi.setParserErrorHandler.mock.calls[0][0];
    parserApi.parseResponse.mockImplementation(() => {
      handler({
        error_type: "class_not_found",
        classname: "GiftMessageView",
      });
      return parsedResponse;
    });

    const actions = {
      execute: createMockFn().mockResolvedValue(rawResponse),
    };
    const logUnknownRenderer = createMockFn().mockResolvedValue(undefined);

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
    const capturedMatch =
      logUnknownRenderer.mock.calls[0][0].matchedRenderers[0];
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

    const execute = createMockFn().mockResolvedValue({ data: { ok: true } });
    const actions = {
      execute,
    };
    const logUnknownRenderer = createMockFn().mockResolvedValue(undefined);

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
    const handler = parserApi.setParserErrorHandler.mock.calls[0][0];
    parserApi.parseResponse.mockImplementation(() => {
      handler({
        error_type: "class_not_found",
        classname: "GiftMessageView",
      });
      return parsedResponse;
    });

    const execute = createMockFn().mockResolvedValue(rawResponse);
    const actions = { execute };
    const logUnknownRenderer = createMockFn().mockResolvedValue(undefined);

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
    expect(logUnknownRenderer.mock.calls[0][0]).toMatchObject({
      videoId: null,
      matchedRenderers: [
        expect.objectContaining({ rawKey: "giftMessageView" }),
      ],
    });
  });

  test("falls back to the only known stream id when a single-stream continuation is unresolved", async () => {
    const rawResponse = createGiftRawResponse("sent Girl power for 300 Jewels");
    const parsedResponse = createParsedResponse("next-single-token");
    const handler = parserApi.setParserErrorHandler.mock.calls[0][0];
    parserApi.parseResponse.mockImplementation(() => {
      handler({
        error_type: "class_not_found",
        classname: "GiftMessageView",
      });
      return parsedResponse;
    });

    const execute = createMockFn().mockResolvedValue(rawResponse);
    const actions = { execute };
    const logUnknownRenderer = createMockFn().mockResolvedValue(undefined);

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
    expect(logUnknownRenderer.mock.calls[0][0]).toMatchObject({
      videoId: "single-stream",
    });
  });
});
