import { vi, type Mock, describe, it, beforeEach, afterEach, expect } from 'bun:test';


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

describe("youtube text log adapter", () => {
  let originalConsole: Pick<Console, "warn" | "error" | "info" | "debug">;
  let passthroughWarn: ConsoleWarnMock;
  let logger: LoggerFixture;

  beforeEach(() => {
    vi.clearAllMocks();
    originalConsole = { warn: console.warn, error: console.error, info: console.info, debug: console.debug };
    passthroughWarn = vi.fn<(...args: Parameters<typeof console.warn>) => void>();
    console.warn = passthroughWarn;
    logger = createLoggerFixture();
  });

  afterEach(() => {
    Object.assign(console, originalConsole);
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

  it("routes other SDK warnings through the shared logger", () => {
    installYouTubeLogAdapter({ logger });

    console.warn("[YOUTUBEJS][Parser]:", "ParsingError: Type mismatch", {
      value: 1,
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(passthroughWarn).toHaveBeenCalledTimes(0);
    const args = getMockCall(logger.warn.mock.calls, 0);
    expect(args[1]).toBe("youtube-sdk");
    expect(args[0]).toContain("ParsingError");
  });

  it("routes unknown Text warning variants without their raw payloads", () => {
    installYouTubeLogAdapter({ logger });

    console.warn(
      "[YOUTUBEJS][Text]:",
      "Unable to find matching run for emoji run. Skipping...",
      createPayload(),
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(passthroughWarn).toHaveBeenCalledTimes(0);
    const args = getMockCall(logger.warn.mock.calls, 0);
    expect(args[1]).toBe("youtube-sdk");
    expect(args[0]).toContain("emoji run");
    expect(JSON.stringify(args)).not.toContain("test-deep-pocket-monster");
  });

  it("reports normalization failure without forwarding provider payloads", () => {
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
    expect(context).toBe("youtube-sdk");
  });

  it("routes every SDK console level and leaves unrelated output untouched", () => {
    const unrelated = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
    Object.assign(console, unrelated);
    installYouTubeLogAdapter({ logger });
    for (const level of ['warn', 'error', 'info', 'debug'] as const) {
      console[level]('[YOUTUBEJS][Session]:', 'Synthetic SDK diagnostic token=synthetic-secret', { payload: 'synthetic-private-body' });
      console[level]('Synthetic unrelated console message');
      expect(unrelated[level]).toHaveBeenCalledTimes(1);
      expect(unrelated[level].mock.calls[0]).toEqual(['Synthetic unrelated console message']);
      expect(logger[level]).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logger[level].mock.calls)).not.toContain('synthetic-secret');
      expect(JSON.stringify(logger[level].mock.calls)).not.toContain('synthetic-private-body');
    }
  });

  it("updates the destination on reinstall and isolates simultaneous logger failures", () => {
    installYouTubeLogAdapter({ logger });
    const replacement = createLoggerFixture();
    expect(installYouTubeLogAdapter({ logger: replacement }).reason).toBe('already-installed');
    console.warn('[YOUTUBEJS][Session]:', 'Synthetic redirected diagnostic');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(replacement.warn).toHaveBeenCalledTimes(1);
    replacement.warn.mockImplementation(() => { throw new Error('synthetic failed sink'); });
    replacement.error.mockImplementation(() => { throw new Error('synthetic failed error sink'); });
    expect(() => console.warn('[YOUTUBEJS][Session]:', 'Synthetic warning', { password: 'synthetic-private-body' })).not.toThrow();
    expect(passthroughWarn).not.toHaveBeenCalled();
  });

  it.each([true, false])("keeps safe separate SDK error details with a message argument=%s", hasMessage => {
    installYouTubeLogAdapter({ logger });
    const error = Object.assign(new Error('Synthetic DNS failure token=synthetic-private-token'), {
      code: 'ENOTFOUND', statusCode: 503,
      cause: { payload: 'synthetic-private-cause' }, response: { body: 'synthetic-private-body' },
    });
    const args = hasMessage ? ['Synthetic SDK request failed', error] : [error];
    console.error('[YOUTUBEJS][Session]:', ...args);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, source, data] = getMockCall(logger.error.mock.calls, 0);
    expect(source).toBe('youtube-sdk');
    expect(data).toMatchObject({ eventType: 'Session', errorDetails: { code: 'ENOTFOUND', statusCode: 503 } });
    expect(JSON.stringify(data)).toContain('Synthetic DNS failure');
    expect(JSON.stringify(data)).not.toMatch(/synthetic-private|stack|response|cause/);
  });

  it("rolls back earlier wrappers if a later console method cannot be replaced", () => {
    const fakeConsole: Pick<Console, 'warn'> = { warn: passthroughWarn };
    Object.defineProperty(fakeConsole, 'error', { get: () => originalConsole.error, set: () => { throw new Error('synthetic locked method'); } });
    const saved = globalThis.console;
    try {
      globalThis.console = fakeConsole as Console;
      expect(installYouTubeLogAdapter({ logger }).reason).toBe('install-failed');
      expect(fakeConsole.warn).toBe(passthroughWarn);
    } finally { globalThis.console = saved; }
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
    expect(message).toContain("Failed to install YouTube SDK logging adapter");
    expect(context).toBe("youtube-sdk");
  });
});
