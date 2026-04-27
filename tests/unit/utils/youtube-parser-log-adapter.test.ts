import { describe, it, beforeEach, expect } from "bun:test";
import { createMockFn, clearAllMocks } from "../../helpers/bun-mock-utils";
import {
  installYouTubeParserLogAdapter,
  collectParserWarningsDuring,
} from "../../../src/utils/youtube-parser-log-adapter.ts";
describe("youtube parser log adapter", () => {
  let logger;

  beforeEach(() => {
    clearAllMocks();
    logger = {
      debug: createMockFn(),
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
    };
  });

  it("installs once per parser API and remains idempotent", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn(),
    };

    const firstInstall = installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });
    const secondInstall = installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });

    expect(firstInstall.installed).toBe(true);
    expect(secondInstall.installed).toBe(false);
    expect(secondInstall.reason).toBe("already-installed");
    expect(parserApi.setParserErrorHandler).toHaveBeenCalledTimes(1);
  });

  it("collapses parser typecheck warnings into one line", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn(),
    };

    installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });

    const handler = parserApi.setParserErrorHandler.mock.calls[0][0];
    handler({
      error_type: "typecheck",
      classname: "ListItemView",
      expected: ["MenuServiceItem", "MenuServiceItemDownload"],
      classdata: { key: "value" },
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);

    const [message, context, metadata] = logger.warn.mock.calls[0];
    expect(context).toBe("youtube-parser");
    expect(message).toContain("typecheck");
    expect(message).toContain("ListItemView");
    expect(message).toContain("MenuServiceItemDownload");
    expect(message).not.toContain("\n");
    expect(metadata.errorType).toBe("typecheck");
  });

  it("collapses parse and class-not-found contexts into one line without stack output", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn(),
    };

    installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });

    const handler = parserApi.setParserErrorHandler.mock.calls[0][0];

    handler({
      error_type: "parse",
      classname: "MenuFlexibleItem",
      error: new Error("Type mismatch\nstack line"),
    });
    handler({
      error_type: "class_not_found",
      classname: "UnknownRenderer",
    });

    expect(logger.warn).toHaveBeenCalledTimes(2);

    const [parseMessage] = logger.warn.mock.calls[0];
    const [notFoundMessage] = logger.warn.mock.calls[1];

    expect(parseMessage).toContain("parse");
    expect(parseMessage).toContain("MenuFlexibleItem");
    expect(parseMessage).not.toContain("\n");
    expect(notFoundMessage).toContain("class_not_found");
    expect(notFoundMessage).toContain("UnknownRenderer");
    expect(notFoundMessage).not.toContain("\n");
  });

  it("no-ops when parser API is unavailable", () => {
    const installResult = installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Innertube: {} },
    });

    expect(installResult.installed).toBe(false);
    expect(installResult.reason).toBe("parser-api-unavailable");
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("falls back to no-op logger when logger interface is missing", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn(),
    };

    const installResult = installYouTubeParserLogAdapter({
      logger: {},
      youtubeModule: { Parser: parserApi },
    });

    expect(installResult.installed).toBe(true);
    expect(installResult.reason).toBe("installed");
    const handler = parserApi.setParserErrorHandler.mock.calls[0][0];
    expect(() => {
      handler({ error_type: "parse", classname: "MenuFlexibleItem" });
    }).not.toThrow();
  });

  it("formats string expected and string error details as one line", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn(),
    };

    installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });

    const handler = parserApi.setParserErrorHandler.mock.calls[0][0];
    handler({
      error_type: "parse",
      classname: "MenuFlexibleItem",
      expected: "MenuServiceItem",
      error: "line1\nline2",
    });

    const [message, context, metadata] = logger.warn.mock.calls[0];
    expect(context).toBe("youtube-parser");
    expect(message).toContain("expected=MenuServiceItem");
    expect(message).toContain("detail=line1 line2");
    expect(metadata.detail).toBe("line1 line2");
  });

  it("formats mutation and title metadata into one line detail output", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn(),
    };

    installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });

    const handler = parserApi.setParserErrorHandler.mock.calls[0][0];
    handler({
      error_type: "mutation_data_invalid",
      classname: "MusicMultiSelectMenuItem",
      failed: 2,
      total: 4,
    });
    handler({
      error_type: "mutation_data_invalid",
      classname: "MusicMultiSelectMenuItem",
      titles: ["Song A", "Song B"],
    });

    const [firstMessage] = logger.warn.mock.calls[0];
    const [secondMessage] = logger.warn.mock.calls[1];
    expect(firstMessage).toContain("detail=2/4 mutation items failed");
    expect(secondMessage).toContain("titles=Song A, Song B");
  });

  it("reports adapter failures through platform error handler paths", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn(),
    };
    const throwingLogger = {
      debug: createMockFn(),
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
    };

    throwingLogger.warn.mockImplementationOnce(() => {
      throw new Error("warn logger failed");
    });
    throwingLogger.warn.mockImplementationOnce(() => {
      throw "warn logger failed as string";
    });

    installYouTubeParserLogAdapter({
      logger: throwingLogger,
      youtubeModule: { Parser: parserApi },
    });

    const handler = parserApi.setParserErrorHandler.mock.calls[0][0];
    handler({ error_type: "parse", classname: "ParserClass" });
    handler({ error_type: "parse", classname: "ParserClass" });

    expect(throwingLogger.error).toHaveBeenCalledTimes(2);
    const firstErrorMessage = throwingLogger.error.mock.calls[0][0];
    const secondErrorMessage = throwingLogger.error.mock.calls[1][0];
    expect(firstErrorMessage).toContain(
      "Failed to normalize YouTube parser warning",
    );
    expect(secondErrorMessage).toContain(
      "Failed to normalize YouTube parser warning",
    );
  });

  it("degrades gracefully when parser handler installation fails", () => {
    const loggerWithErrors = {
      debug: createMockFn(),
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
    };
    const parserApi = {
      setParserErrorHandler: createMockFn(() => {
        throw new Error("cannot install parser handler");
      }),
    };

    const installResult = installYouTubeParserLogAdapter({
      logger: loggerWithErrors,
      youtubeModule: { Parser: parserApi },
    });

    expect(installResult.installed).toBe(false);
    expect(installResult.reason).toBe("install-failed");
    expect(loggerWithErrors.error).toHaveBeenCalledTimes(1);
    const [message, context] = loggerWithErrors.error.mock.calls[0];
    expect(message).toContain(
      "Failed to install YouTube parser warning adapter",
    );
    expect(context).toBe("youtube-parser-log-adapter");
  });

  it("collects normalized parser warnings during a synchronous scope without suppressing logging", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn(),
    };

    installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });

    const handler = parserApi.setParserErrorHandler.mock.calls[0][0];
    const collection = collectParserWarningsDuring(() => {
      handler({
        error_type: "class_not_found",
        classname: "GiftMessageView",
      });
      handler({
        error_type: "parse",
        classname: "MenuFlexibleItem",
        error: "failed to parse",
      });

      return "test-result";
    });

    expect(collection.result).toBe("test-result");
    expect(collection.warnings).toEqual([
      expect.objectContaining({
        errorType: "class_not_found",
        className: "GiftMessageView",
      }),
      expect.objectContaining({
        errorType: "parse",
        className: "MenuFlexibleItem",
        detail: "failed to parse",
      }),
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("keeps nested parser warning collection scopes isolated", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn(),
    };

    installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });

    const handler = parserApi.setParserErrorHandler.mock.calls[0][0];
    const outerCollection = collectParserWarningsDuring(() => {
      handler({
        error_type: "class_not_found",
        classname: "OuterGiftView",
      });

      const innerCollection = collectParserWarningsDuring(() => {
        handler({
          error_type: "class_not_found",
          classname: "InnerGiftView",
        });
        return "inner-result";
      });

      handler({
        error_type: "class_not_found",
        classname: "OuterGiftAfterInnerView",
      });

      return innerCollection;
    });

    expect(outerCollection.result).toEqual({
      result: "inner-result",
      warnings: [expect.objectContaining({ className: "InnerGiftView" })],
    });
    expect(outerCollection.warnings).toEqual([
      expect.objectContaining({ className: "OuterGiftView" }),
      expect.objectContaining({ className: "OuterGiftAfterInnerView" }),
    ]);
  });
});
