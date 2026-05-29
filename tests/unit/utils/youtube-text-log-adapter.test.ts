import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import { createMockFn, clearAllMocks } from "../../helpers/bun-mock-utils";
import type { TestMockFn } from "../../helpers/bun-mock-utils";
import { installYouTubeTextLogAdapter } from "../../../src/utils/youtube-text-log-adapter.ts";

type LoggerFixture = {
  debug: TestMockFn<[unknown, string?, unknown?], void>;
  info: TestMockFn<[unknown, string?, unknown?], void>;
  warn: TestMockFn<[unknown, string?, unknown?], void>;
  error: TestMockFn<[unknown, string?, unknown?], void>;
};
type ConsoleWarnMock = TestMockFn<Parameters<typeof console.warn>, void>;
type InstallResult = ReturnType<typeof installYouTubeTextLogAdapter>;
type WarningMetadata = Record<string, unknown>;

const createLoggerFixture = (): LoggerFixture => ({
  debug: createMockFn<[unknown, string?, unknown?], void>(),
  info: createMockFn<[unknown, string?, unknown?], void>(),
  warn: createMockFn<[unknown, string?, unknown?], void>(),
  error: createMockFn<[unknown, string?, unknown?], void>(),
});

const getMockCall = <Args extends unknown[]>(
  calls: Args[],
  index: number,
): Args => {
  const call = calls[index];
  expect(call).toBeDefined();
  if (call === undefined) {
    throw new Error(`Expected mock call ${index}`);
  }
  return call;
};

const expectMetadata = (value: unknown): WarningMetadata => {
  expect(value && typeof value === "object").toBe(true);
  if (!value || typeof value !== "object") {
    throw new Error("Expected warning metadata object");
  }
  return value as WarningMetadata;
};

function createPayload() {
  return {
    attachment_run: {
      startIndex: 19,
      alignment: "ALIGNMENT_VERTICAL_CENTER",
    },
    input_data: {
      content: "test-deep-pocket-monster and test-short-pocket-monster",
      styleRuns: [{ startIndex: 0 }],
      commandRuns: [{ startIndex: 3 }, { startIndex: 9 }],
      attachmentRuns: [{ startIndex: 19 }, { startIndex: 42 }],
    },
    parsed_runs: [
      {
        text: "test-deep-pocket-monster and test-short-pocket-monster",
        startIndex: 0,
      },
    ],
  };
}

describe("youtube text log adapter", () => {
  let originalConsoleWarn: typeof console.warn;
  let passthroughWarn: ConsoleWarnMock;
  let logger: LoggerFixture;

  beforeEach(() => {
    clearAllMocks();
    originalConsoleWarn = console.warn;
    passthroughWarn = createMockFn<Parameters<typeof console.warn>, void>();
    console.warn = passthroughWarn;
    logger = createLoggerFixture();
  });

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  it("installs once and collapses style command and attachment mismatch warnings to one line", () => {
    const firstInstall = installYouTubeTextLogAdapter({ logger });
    const secondInstall = installYouTubeTextLogAdapter({ logger });

    expect(firstInstall.installed).toBe(true);
    expect(secondInstall.installed).toBe(false);
    expect(secondInstall.reason).toBe("already-installed");

    const payload = createPayload();
    const expectedContentLength = payload.input_data.content.length;

    console.warn(
      "[YOUTUBEJS][Text]:",
      "Unable to find matching run for style run. Skipping...",
      payload,
    );
    console.warn(
      "[YOUTUBEJS][Text]:",
      "Unable to find matching run for command run. Skipping...",
      payload,
    );
    console.warn(
      "[YOUTUBEJS][Text]:",
      "Unable to find matching run for attachment run. Skipping...",
      payload,
    );

    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(passthroughWarn).toHaveBeenCalledTimes(0);

    const [firstMessage, firstContext, firstMetadata] =
      getMockCall(logger.warn.mock.calls, 0);
    expect(firstContext).toBe("youtube-text");
    expect(firstMessage).toContain("style");
    expect(firstMessage).not.toContain("\n");
    expect(expectMetadata(firstMetadata).warningType).toBe("style");

    const [thirdMessage, thirdContext, thirdMetadata] =
      getMockCall(logger.warn.mock.calls, 2);
    expect(thirdContext).toBe("youtube-text");
    expect(thirdMessage).toContain("attachment");
    const thirdWarningMetadata = expectMetadata(thirdMetadata);
    expect(thirdWarningMetadata.warningType).toBe("attachment");
    expect(thirdWarningMetadata.contentLength).toBe(expectedContentLength);

    const [, , secondMetadata] = getMockCall(logger.warn.mock.calls, 1);
    const secondWarningMetadata = expectMetadata(secondMetadata);
    expect(secondWarningMetadata.warningType).toBe("command");
    expect(secondWarningMetadata.commandRunCount).toBe(2);
  });

  it("passes through non-matching console warnings unchanged", () => {
    installYouTubeTextLogAdapter({ logger });

    console.warn("[YOUTUBEJS][Parser]:", "ParsingError: Type mismatch", {
      value: 1,
    });

    expect(logger.warn).toHaveBeenCalledTimes(0);
    expect(passthroughWarn).toHaveBeenCalledTimes(1);
    const args = getMockCall(passthroughWarn.mock.calls, 0);
    expect(args[0]).toBe("[YOUTUBEJS][Parser]:");
    expect(args[1]).toContain("ParsingError");
  });

  it("passes through unknown youtube text warning variants unchanged", () => {
    installYouTubeTextLogAdapter({ logger });

    console.warn(
      "[YOUTUBEJS][Text]:",
      "Unable to find matching run for emoji run. Skipping...",
      createPayload(),
    );

    expect(logger.warn).toHaveBeenCalledTimes(0);
    expect(passthroughWarn).toHaveBeenCalledTimes(1);
    const args = getMockCall(passthroughWarn.mock.calls, 0);
    expect(args[0]).toBe("[YOUTUBEJS][Text]:");
    expect(args[1]).toContain("emoji run");
  });

  it("falls back to passthrough output when normalization logging fails", () => {
    logger.warn.mockImplementation(() => {
      throw new Error("warn failed");
    });
    installYouTubeTextLogAdapter({ logger });

    console.warn(
      "[YOUTUBEJS][Text]:",
      "Unable to find matching run for attachment run. Skipping...",
      createPayload(),
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(passthroughWarn).toHaveBeenCalledTimes(1);
    const [message, context] = getMockCall(logger.error.mock.calls, 0);
    expect(message).toContain("Failed to normalize YouTube Text warning");
    expect(context).toBe("youtube-text-log-adapter");
  });

  it("does not install when logger interface is missing and preserves passthrough warnings", () => {
    const installResult = installYouTubeTextLogAdapter({ logger: {} });
    expect(installResult.installed).toBe(false);
    expect(installResult.reason).toBe("logger-unavailable");

    expect(() => {
      console.warn(
        "[YOUTUBEJS][Text]:",
        "Unable to find matching run for command run. Skipping...",
        createPayload(),
      );
    }).not.toThrow();
    expect(passthroughWarn).toHaveBeenCalledTimes(1);
  });

  it("degrades gracefully when console warn cannot be wrapped", () => {
    const originalConsole = globalThis.console;
    const loggerWithErrors = {
      debug: createMockFn(),
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
    };

    const fakeConsole: Pick<Console, "warn"> = {} as Pick<Console, "warn">;
    Object.defineProperty(fakeConsole, "warn", {
      enumerable: true,
      configurable: true,
      get() {
        return passthroughWarn;
      },
      set() {
        throw new Error("warn locked");
      },
    });

    let installResult: InstallResult;
    try {
      globalThis.console = fakeConsole as Console;
      installResult = installYouTubeTextLogAdapter({
        logger: loggerWithErrors,
      });
    } finally {
      globalThis.console = originalConsole;
    }

    expect(installResult.installed).toBe(false);
    expect(installResult.reason).toBe("install-failed");
    expect(loggerWithErrors.error).toHaveBeenCalledTimes(1);
    const [message, context] = getMockCall(loggerWithErrors.error.mock.calls, 0);
    expect(message).toContain("Failed to install YouTube Text warning adapter");
    expect(context).toBe("youtube-text-log-adapter");
  });
});
