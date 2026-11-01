import { vi, type Mock, describe, it, beforeEach, afterEach, expect } from 'bun:test';


import { createLogger } from "../../../src/core/logging";
import { captureStdout } from "../../helpers/output-capture";
import { installYouTubeLogAdapter } from "../../../src/utils/youtube-log-adapter.ts";

type LoggerFixture = {
  debug: Mock<(...args: [unknown, string?, unknown?]) => void>;
  info: Mock<(...args: [unknown, string?, unknown?]) => void>;
  warn: Mock<(...args: [unknown, string?, unknown?]) => void>;
  error: Mock<(...args: [unknown, string?, unknown?]) => void>;
};
type ConsoleWarnMock = Mock<(...args: Parameters<typeof console.warn>) => void>;
type InstallResult = ReturnType<typeof installYouTubeLogAdapter>;
type WarningMetadata = Record<string, unknown>;

const createLoggerFixture = (): LoggerFixture => ({
  debug: vi.fn<(...args: [unknown, string?, unknown?]) => void>(),
  info: vi.fn<(...args: [unknown, string?, unknown?]) => void>(),
  warn: vi.fn<(...args: [unknown, string?, unknown?]) => void>(),
  error: vi.fn<(...args: [unknown, string?, unknown?]) => void>(),
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

describe("youtube SDK log adapter", () => {
  let originalConsole: Console;
  let originalConsoleWarn: typeof console.warn;
  let passthroughWarn: ConsoleWarnMock;
  let logger: LoggerFixture;

  beforeEach(() => {
    vi.clearAllMocks();
    originalConsole = { ...console };
    originalConsoleWarn = console.warn;
    passthroughWarn = vi.fn<(...args: Parameters<typeof console.warn>) => void>();
    console.warn = passthroughWarn;
    logger = createLoggerFixture();
  });

  afterEach(() => {
    Object.assign(console, originalConsole);
    console.warn = originalConsoleWarn;
  });

  it("installs once and collapses style command and attachment mismatch warnings to one line", () => {
    const firstInstall = installYouTubeLogAdapter({ logger });
    const secondInstall = installYouTubeLogAdapter({ logger });

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

  it("routes other YouTube diagnostics without forwarding provider objects", () => {
    installYouTubeLogAdapter({ logger });

    console.warn("[YOUTUBEJS][Parser]:", "ParsingError: Type mismatch", {
      value: 1,
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(passthroughWarn).toHaveBeenCalledTimes(0);
    const args = getMockCall(logger.warn.mock.calls, 0);
    expect(args[0]).toContain("ParsingError");
    expect(args[1]).toBe("youtube-sdk");
    expect(JSON.stringify(args)).not.toContain('"value"');
  });

  it("summarizes unknown YouTube text variants without retaining their payload", () => {
    installYouTubeLogAdapter({ logger });

    console.warn(
      "[YOUTUBEJS][Text]:",
      "Unable to find matching run for emoji run. Skipping...",
      createPayload(),
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(passthroughWarn).toHaveBeenCalledTimes(0);
    const args = getMockCall(logger.warn.mock.calls, 0);
    expect(args[0]).toContain("emoji run");
    expect(JSON.stringify(args)).not.toContain('test-deep-pocket-monster');
  });

  it("reports normalization failure without forwarding the original payload", () => {
    logger.warn.mockImplementation(() => {
      throw new Error("warn failed");
    });
    installYouTubeLogAdapter({ logger });

    console.warn(
      "[YOUTUBEJS][Text]:",
      "Unable to find matching run for attachment run. Skipping...",
      createPayload(),
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(passthroughWarn).toHaveBeenCalledTimes(0);
    const [message, context] = getMockCall(logger.error.mock.calls, 0);
    expect(message).toContain("Failed to normalize YouTube SDK diagnostic");
    expect(context).toBe("youtube-log-adapter");
  });

  it("preserves unrelated console warnings", () => {
    installYouTubeLogAdapter({ logger });
    const payload = { synthetic: true };
    console.warn('synthetic unrelated warning', payload);
    expect(passthroughWarn).toHaveBeenCalledWith('synthetic unrelated warning', payload);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("redacts and bounds SDK diagnostic strings before forwarding to an injected logger", () => {
    installYouTubeLogAdapter({ logger });
    console.warn('[YOUTUBEJS][Session]:', 'token=synthetic-secret ' + 'x'.repeat(10_000), { private: 'synthetic-private' });
    const [message, source, metadata] = getMockCall(logger.warn.mock.calls, 0);
    expect(String(message).length).toBeLessThanOrEqual(4096);
    expect(source).toBe('youtube-sdk');
    expect(metadata).toMatchObject({ component: 'Session', argumentCount: 2 });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('synthetic-');
  });

  it("routes every SDK severity through real logging thresholds and operator capture", async () => {
    const { Log } = await import('youtubei.js');
    const logger = createLogger({ console: { enabled: true, level: 'debug' } }, { operatorCaptureEnabled: true });
    const output = captureStdout();
    try {
      installYouTubeLogAdapter({ logger });
      Log.setLevel(Log.Level.DEBUG, Log.Level.INFO, Log.Level.WARNING, Log.Level.ERROR);
      Log.debug('Session', 'synthetic debug');
      Log.info('Session', 'synthetic info');
      Log.warn('Session', 'synthetic warning');
      Log.error('Session', 'synthetic error', { private: 'synthetic-private-body' });
      expect(logger.getOperatorLogSource()!.history().entries.map(entry => entry.level)).toEqual(['debug', 'info', 'warn', 'error']);
      expect(JSON.stringify(logger.getOperatorLogSource()!.history())).not.toContain('synthetic-private-body');
      logger.reconfigure({ console: { enabled: false } });
      Log.debug('Session', 'synthetic hidden debug');
      expect(logger.getOperatorLogSource()!.history().entries).toHaveLength(4);
    } finally { Log.setLevel(Log.Level.WARNING); output.restore(); }
  });

  it("does not leak provider arguments when both injected diagnostic methods fail", () => {
    logger.warn.mockImplementation(() => { throw new Error('synthetic logging failure'); });
    logger.error.mockImplementation(() => { throw new Error('synthetic logging failure'); });
    installYouTubeLogAdapter({ logger });
    expect(() => console.warn('[YOUTUBEJS][Session]:', 'synthetic-private-message', { private: 'synthetic-private-body' })).not.toThrow();
    expect(passthroughWarn).toHaveBeenCalledWith('[YouTube] Diagnostic output failed');
    expect(JSON.stringify(passthroughWarn.mock.calls)).not.toContain('synthetic-private');
  });

  it("does not install when logger interface is missing and preserves passthrough warnings", () => {
    const installResult = installYouTubeLogAdapter({ logger: {} });
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
      debug: vi.fn<(...args: unknown[]) => unknown>(),
      info: vi.fn<(...args: unknown[]) => unknown>(),
      warn: vi.fn<(...args: unknown[]) => unknown>(),
      error: vi.fn<(...args: unknown[]) => unknown>(),
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
      installResult = installYouTubeLogAdapter({
        logger: loggerWithErrors,
      });
    } finally {
      globalThis.console = originalConsole;
    }

    expect(installResult.installed).toBe(false);
    expect(installResult.reason).toBe("install-failed");
    expect(loggerWithErrors.error).toHaveBeenCalledTimes(1);
    const [message, context] = getMockCall(loggerWithErrors.error.mock.calls, 0);
    expect(message).toContain("Failed to install YouTube SDK log adapter");
    expect(context).toBe("youtube-log-adapter");
  });
});
