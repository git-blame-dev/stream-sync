import { describe, it, beforeEach, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  createMockFn,
  clearAllMocks,
  type TestMockFn,
} from "../../helpers/bun-mock-utils";
import {
  installYouTubeParserLogAdapter,
  collectParserWarningsDuring,
  type ParserWarningPayload,
} from "../../../src/utils/youtube-parser-log-adapter.ts";

type ParserWarningContext = Partial<{
  error_type: string;
  classname: string;
  expected: string | string[];
  error: Error | string;
  classdata: Record<string, unknown>;
  failed: number;
  total: number;
  titles: string[];
}>;

type ParserWarningHandler = (context: ParserWarningContext) => void;

type ParserApiFixture = {
  setParserErrorHandler: TestMockFn<[ParserWarningHandler], void>;
};

type LoggerFixture = {
  debug: TestMockFn<[unknown, string?, unknown?], void>;
  info: TestMockFn<[unknown, string?, unknown?], void>;
  warn: TestMockFn<[unknown, string?, unknown?], void>;
  error: TestMockFn<[unknown, string?, unknown?], void>;
};

function createLoggerFixture(): LoggerFixture {
  return {
    debug: createMockFn<[unknown, string?, unknown?], void>(),
    info: createMockFn<[unknown, string?, unknown?], void>(),
    warn: createMockFn<[unknown, string?, unknown?], void>(),
    error: createMockFn<[unknown, string?, unknown?], void>(),
  };
}

function createParserApiFixture(
  implementation?: (handler: ParserWarningHandler) => void,
): ParserApiFixture {
  return {
    setParserErrorHandler: createMockFn<[ParserWarningHandler], void>(
      implementation,
    ),
  };
}

function getInstalledParserHandler(parserApi: ParserApiFixture): ParserWarningHandler {
  const firstCall = parserApi.setParserErrorHandler.mock.calls[0];
  expect(firstCall).toBeDefined();
  if (firstCall === undefined) {
    throw new Error("Expected parser error handler to be installed");
  }
  return firstCall[0];
}

function expectLoggerCall(
  calls: [unknown, string?, unknown?][],
  index: number,
): [string, string | undefined, ParserWarningPayload] {
  const call = calls[index];
  expect(call).toBeDefined();
  if (call === undefined) {
    throw new Error(`Expected logger call at index ${index}`);
  }
  const [message, context, metadata] = call;
  expect(typeof message).toBe("string");
  expect(typeof context).toBe("string");
  expect(isParserWarningPayload(metadata)).toBe(true);
  if (
    typeof message !== "string" ||
    typeof context !== "string" ||
    !isParserWarningPayload(metadata)
  ) {
    throw new Error("Expected parser warning logger call");
  }
  return [message, context, metadata];
}

function expectStringLoggerCall(
  calls: [unknown, string?, unknown?][],
  index: number,
): [string, string | undefined, unknown] {
  const call = calls[index];
  expect(call).toBeDefined();
  if (call === undefined) {
    throw new Error(`Expected logger call at index ${index}`);
  }
  const [message, context, metadata] = call;
  expect(typeof message).toBe("string");
  if (typeof message !== "string") {
    throw new Error("Expected logger message string");
  }
  return [message, context, metadata];
}

function isParserWarningPayload(value: unknown): value is ParserWarningPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "errorType" in value &&
    "className" in value &&
    "expected" in value &&
    "detail" in value &&
    typeof value.errorType === "string" &&
    typeof value.className === "string" &&
    typeof value.expected === "string" &&
    typeof value.detail === "string"
  );
}

describe("youtube parser log adapter", () => {
  it("redacts complete quoted credentials before applying diagnostic output limits", () => {
    const parserApi = createParserApiFixture();
    const boundedLogger = createLoggerFixture();
    installYouTubeParserLogAdapter({ logger: boundedLogger, youtubeModule: { Parser: parserApi } });
    const handler = getInstalledParserHandler(parserApi);
    const secret = `${"test-private-segment-".repeat(300)}\\nTEST_PRIVATE_SUFFIX`;
    const fields = [
      `TestRenderer password="${secret}";scope`,
      `TestRenderer authorization: Bearer "${secret}";scope`,
      `TestRenderer {"password":"${secret}"};scope`,
    ];
    const collection = collectParserWarningsDuring(() => {
      for (const field of fields) handler({ error_type: field, classname: field, expected: [field] });
      handler({ error_type: "typecheck", classname: "TestSafeRenderer", expected: "TestSafeExpected" });
    });
    expect(collection.warnings).toHaveLength(4);
    const outputs = [JSON.stringify(boundedLogger.warn.mock.calls), JSON.stringify(collection.warnings)];
    for (const output of outputs) {
      expect(output).not.toContain("test-private-segment-");
      expect(output).not.toContain("TEST_PRIVATE_SUFFIX");
      expect(output).toContain("[REDACTED]");
    }
    for (const warning of collection.warnings) {
      for (const value of Object.values(warning)) expect(value.length).toBeLessThanOrEqual(256);
    }
    expect(collection.warnings[3]).toEqual({ errorType: "typecheck", className: "TestSafeRenderer", expected: "TestSafeExpected", detail: "" });
  });

  it("bounds and redacts structural diagnostics in both logger and collected warnings", () => {
    const parserApi = createParserApiFixture();
    const boundedLogger = createLoggerFixture();
    installYouTubeParserLogAdapter({ logger: boundedLogger, youtubeModule: { Parser: parserApi } });
    const handler = getInstalledParserHandler(parserApi);
    const secret = "test-parser-secret";
    const field = `Bearer ${secret} ${"X".repeat(10000)}`;
    const collection = collectParserWarningsDuring(() => {
      for (let index = 0; index < 120; index += 1) handler({
        error_type: field, classname: field, expected: Array.from({ length: 120 }, () => field),
        error: new Error("synthetic private chat body"), titles: ["synthetic private stream title"],
      });
    });
    expect(collection.warnings).toHaveLength(100);
    for (const warning of collection.warnings) {
      for (const value of Object.values(warning)) expect(value.length).toBeLessThanOrEqual(256);
    }
    for (const [message, , warning] of boundedLogger.warn.mock.calls) {
      expect((message as string).length).toBeLessThanOrEqual(1100);
      for (const value of Object.values(warning as ParserWarningPayload)) expect(value.length).toBeLessThanOrEqual(256);
    }
    const serialized = JSON.stringify({ logs: boundedLogger.warn.mock.calls, warnings: collection.warnings });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("synthetic private chat body");
    expect(serialized).not.toContain("synthetic private stream title");
    expect(serialized).not.toContain("stack");
  });

  it("rejects async collectors without leaking an unhandled rejection in a child runtime", () => {
    const modulePath = new URL("../../../src/utils/youtube-parser-log-adapter.ts", import.meta.url).href;
    const script = `
      import { collectParserWarningsDuring } from ${JSON.stringify(modulePath)};
      let invoked = false;
      let unhandled = false;
      process.on('unhandledRejection', () => { unhandled = true; });
      const rejectSync = (callback) => {
        try { collectParserWarningsDuring(callback); throw new Error('accepted async callback'); }
        catch (error) { if (!(error instanceof TypeError)) throw error; }
      };
      rejectSync(async () => { invoked = true; throw new Error('synthetic async failure'); });
      if (invoked) throw new Error('invoked declared async callback');
      rejectSync(() => Promise.reject(new Error('synthetic returned promise failure')));
      rejectSync(() => ({ then(_resolve, reject) { reject(new Error('synthetic thenable failure')); } }));
      await new Promise(resolve => setImmediate(resolve));
      if (unhandled) throw new Error('unhandled rejection escaped');
      if (collectParserWarningsDuring(() => 'test-sync-result').result !== 'test-sync-result') throw new Error('collector scope leaked');
    `;
    const child = spawnSync(process.execPath, ["--eval", script], { encoding: "utf8", timeout: 10000 });
    expect(child.status).toBe(0);
    expect(child.stderr).toBe("");
  });

  it("ignores malformed diagnostic shapes without stringifying payload objects", () => {
    const parserApi = createParserApiFixture();
    const boundedLogger = createLoggerFixture();
    installYouTubeParserLogAdapter({ logger: boundedLogger, youtubeModule: { Parser: parserApi } });
    const handler = getInstalledParserHandler(parserApi);
    const rawObject = { toString() { throw new Error("synthetic private body must not be stringified"); } };
    const collection = collectParserWarningsDuring(() => {
      handler(null as unknown as ParserWarningContext);
      handler({ error_type: rawObject, classname: rawObject, expected: [null, rawObject, "TestExpected"], error: rawObject } as unknown as ParserWarningContext);
    });
    expect(collection.warnings).toEqual([
      { errorType: "unknown", className: "unknown", expected: "", detail: "" },
      { errorType: "unknown", className: "unknown", expected: "TestExpected", detail: "" },
    ]);
    expect(boundedLogger.error).not.toHaveBeenCalled();
  });

  it("does not inspect expected entries beyond its bounded classification budget", () => {
    const parserApi = createParserApiFixture();
    const boundedLogger = createLoggerFixture();
    installYouTubeParserLogAdapter({ logger: boundedLogger, youtubeModule: { Parser: parserApi } });
    const expected = Array.from({ length: 101 }, () => "TestExpected");
    Object.defineProperty(expected, 100, { get() { throw new Error("synthetic out-of-budget entry"); } });
    getInstalledParserHandler(parserApi)({ expected, classname: "TestClass" });
    expect(boundedLogger.warn).toHaveBeenCalledTimes(1);
    expect(boundedLogger.error).not.toHaveBeenCalled();
  });

  it("retains only structural adapter-failure diagnostics without raw error messages", () => {
    const parserApi = createParserApiFixture();
    const failureLogger = createLoggerFixture();
    failureLogger.warn.mockImplementationOnce(() => { throw new Error("synthetic private failure body"); });
    installYouTubeParserLogAdapter({ logger: failureLogger, youtubeModule: { Parser: parserApi } });
    getInstalledParserHandler(parserApi)({ error_type: "Bearer test-failure-secret", classname: "TestClass" });
    expect(failureLogger.error).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(failureLogger.error.mock.calls);
    expect(serialized).not.toContain("synthetic private failure body");
    expect(serialized).not.toContain("test-failure-secret");
  });

  it("unwinds a throwing synchronous collector before subsequent scopes", () => {
    expect(() => collectParserWarningsDuring(() => { throw new Error("synthetic sync failure"); })).toThrow("synthetic sync failure");
    expect(collectParserWarningsDuring(() => "test-next-result")).toEqual({ result: "test-next-result", warnings: [] });
  });
  let logger: LoggerFixture;

  beforeEach(() => {
    clearAllMocks();
    logger = createLoggerFixture();
  });

  it("installs once per parser API and remains idempotent", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn<[ParserWarningHandler], void>(),
    } satisfies ParserApiFixture;

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
      setParserErrorHandler: createMockFn<[ParserWarningHandler], void>(),
    } satisfies ParserApiFixture;

    installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });

    const handler = getInstalledParserHandler(parserApi);
    handler({
      error_type: "typecheck",
      classname: "ListItemView",
      expected: ["MenuServiceItem", "MenuServiceItemDownload"],
      classdata: { key: "value" },
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);

    const [message, context, metadata] = expectLoggerCall(logger.warn.mock.calls, 0);
    expect(context).toBe("youtube-parser");
    expect(message).toContain("typecheck");
    expect(message).toContain("ListItemView");
    expect(message).toContain("MenuServiceItemDownload");
    expect(message).not.toContain("\n");
    expect(metadata.errorType).toBe("typecheck");
  });

  it("collapses parse and class-not-found contexts into one line without stack output", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn<[ParserWarningHandler], void>(),
    } satisfies ParserApiFixture;

    installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });

    const handler = getInstalledParserHandler(parserApi);

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

    const [parseMessage] = expectLoggerCall(logger.warn.mock.calls, 0);
    const [notFoundMessage] = expectLoggerCall(logger.warn.mock.calls, 1);

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
      youtubeModule: {},
    });

    expect(installResult.installed).toBe(false);
    expect(installResult.reason).toBe("parser-api-unavailable");
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("falls back to no-op logger when logger interface is missing", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn<[ParserWarningHandler], void>(),
    } satisfies ParserApiFixture;

    const installResult = installYouTubeParserLogAdapter({
      logger: {},
      youtubeModule: { Parser: parserApi },
    });

    expect(installResult.installed).toBe(true);
    expect(installResult.reason).toBe("installed");
    const handler = getInstalledParserHandler(parserApi);
    expect(() => {
      handler({ error_type: "parse", classname: "MenuFlexibleItem" });
    }).not.toThrow();
  });

  it("formats expected classification and summarizes string error length without its body", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn<[ParserWarningHandler], void>(),
    } satisfies ParserApiFixture;

    installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });

    const handler = getInstalledParserHandler(parserApi);
    handler({
      error_type: "parse",
      classname: "MenuFlexibleItem",
      expected: "MenuServiceItem",
      error: "line1\nline2",
    });

    const [message, context, metadata] = expectLoggerCall(logger.warn.mock.calls, 0);
    expect(context).toBe("youtube-parser");
    expect(message).toContain("expected=MenuServiceItem");
    expect(message).toContain("detail=errorMessageLength=11");
    expect(metadata.detail).toBe("errorMessageLength=11");
  });

  it("formats mutation counts and title counts without raw titles", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn<[ParserWarningHandler], void>(),
    } satisfies ParserApiFixture;

    installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });

    const handler = getInstalledParserHandler(parserApi);
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

    const [firstMessage] = expectLoggerCall(logger.warn.mock.calls, 0);
    const [secondMessage] = expectLoggerCall(logger.warn.mock.calls, 1);
    expect(firstMessage).toContain("detail=2/4 mutation items failed");
    expect(secondMessage).toContain("titleCount=2");
    expect(secondMessage).not.toContain("Song A");
  });

  it("reports adapter failures through platform error handler paths", () => {
    const parserApi = createParserApiFixture();
    const throwingLogger = createLoggerFixture();

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

    const handler = getInstalledParserHandler(parserApi);
    handler({ error_type: "parse", classname: "ParserClass" });
    handler({ error_type: "parse", classname: "ParserClass" });

    expect(throwingLogger.error).toHaveBeenCalledTimes(2);
    const [firstErrorMessage] = expectStringLoggerCall(throwingLogger.error.mock.calls, 0);
    const [secondErrorMessage] = expectStringLoggerCall(throwingLogger.error.mock.calls, 1);
    expect(firstErrorMessage).toContain(
      "Failed to normalize YouTube parser warning",
    );
    expect(secondErrorMessage).toContain(
      "Failed to normalize YouTube parser warning",
    );
  });

  it("degrades gracefully when parser handler installation fails", () => {
    const loggerWithErrors = {
      debug: createMockFn<[unknown, string?, unknown?], void>(),
      info: createMockFn<[unknown, string?, unknown?], void>(),
      warn: createMockFn<[unknown, string?, unknown?], void>(),
      error: createMockFn<[unknown, string?, unknown?], void>(),
    } satisfies LoggerFixture;
    const parserApi = createParserApiFixture(() => {
        throw new Error("cannot install parser handler");
      });

    const installResult = installYouTubeParserLogAdapter({
      logger: loggerWithErrors,
      youtubeModule: { Parser: parserApi },
    });

    expect(installResult.installed).toBe(false);
    expect(installResult.reason).toBe("install-failed");
    expect(loggerWithErrors.error).toHaveBeenCalledTimes(1);
    const [message, context] = expectStringLoggerCall(loggerWithErrors.error.mock.calls, 0);
    expect(message).toContain(
      "Failed to install YouTube parser warning adapter",
    );
    expect(context).toBe("youtube-parser-log-adapter");
  });

  it("collects normalized parser warnings during a synchronous scope without suppressing logging", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn<[ParserWarningHandler], void>(),
    } satisfies ParserApiFixture;

    installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });

    const handler = getInstalledParserHandler(parserApi);
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
        detail: "errorMessageLength=15",
      }),
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("keeps nested parser warning collection scopes isolated", () => {
    const parserApi = {
      setParserErrorHandler: createMockFn<[ParserWarningHandler], void>(),
    } satisfies ParserApiFixture;

    installYouTubeParserLogAdapter({
      logger,
      youtubeModule: { Parser: parserApi },
    });

    const handler = getInstalledParserHandler(parserApi);
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
