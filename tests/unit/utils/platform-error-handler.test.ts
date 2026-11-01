import { describe, test, expect, beforeEach } from "bun:test";
import { noOpLogger } from "../../helpers/mock-factories";
import { createRecordingLogger } from "../../helpers/recording-logger";
import { captureStderr, captureStdout } from "../../helpers/output-capture";
import * as logging from "../../../src/core/logging.ts";
import {
  PlatformErrorHandler,
  createPlatformErrorHandler,
} from "../../../src/utils/platform-error-handler.ts";
describe("Platform Error Handler - User Experience Behavior", () => {
  test("curates every recovery error before passing it to an external logger", () => {
    const logger = createRecordingLogger();
    const handler = new PlatformErrorHandler(logger, "test-platform");
    const error = Object.assign(new Error("access_token=test-token Authorization: Bearer test-bearer https://example.invalid/failure?signature=test-signature"), {
      name: "TestProviderError", code: "TEST_RETRY", statusCode: 429,
      response: { data: { message: "test-private-chat" } },
      headers: { Authorization: "test-header" },
      cause: new Error("test-private-cause"),
    });
    expect(() => handler.handleInitializationError(error)).toThrow(error);
    handler.handleConnectionError(error);
    handler.handleServiceUnavailableError("test-service", error);
    handler.handleMessageSendError(error);
    expect(logger.entries).toHaveLength(4);
    for (const entry of logger.entries) {
      expect(entry.data === error).toBe(false);
      expect(entry.data).toMatchObject({
        errorType: "TestProviderError",
        errorDetails: { name: "TestProviderError", code: "TEST_RETRY", statusCode: 429 },
      });
    }
    const output = JSON.stringify(logger.entries);
    for (const forbidden of ["test-token", "test-bearer", "test-signature", "test-private-chat", "test-header", "test-private-cause", '"stack"', '"response"', '"headers"', '"cause"']) {
      expect(output.includes(forbidden)).toBe(false);
    }
  });

  test("sanitizes caller diagnostic strings and bounds error text", () => {
    const logger = createRecordingLogger();
    const text = "https://example.invalid/test?access_token=test-caller-secret";
    const handler = new PlatformErrorHandler(logger, text);
    handler.handleConnectionError("test", text, text);
    handler.handleMessageSendError("test", text, text);
    handler.handleServiceUnavailableError(text, "test");
    handler.handleEventProcessingError("test", text, null, text, text);
    handler.logOperationalError(text, text, { error: text });
    handler.handleCleanupError("test", text, text);
    handler.handleAuthenticationError(text);
    handler.handleDataLoggingError("test", text, text);
    expect(JSON.stringify(logger.entries).includes("test-caller-secret")).toBe(false);
    handler.handleConnectionError("x".repeat(10_000));
    expect((logger.entries.at(-1)?.data as { error: string }).error.length).toBeLessThanOrEqual(4096);
  });

  test("keeps non-Error recovery reasons curated and initialization identity unchanged", () => {
    const logger = createRecordingLogger();
    const handler = new PlatformErrorHandler(logger, "test-platform");
    for (const reason of ["access_token=test-string-secret", null, undefined, 7, { message: "test failure", code: 503, statusCode: 503, payload: "test-private-body" }]) {
      let caught: unknown = "not thrown";
      try { handler.handleInitializationError(reason); } catch (error) { caught = error; }
      expect(caught).toBe(reason);
      handler.handleConnectionError(reason);
      handler.handleServiceUnavailableError("test-service", reason);
      handler.handleMessageSendError(reason);
    }
    expect(logger.entries).toHaveLength(20);
    expect(logger.entries[4]?.data).toEqual({ error: "null", errorDetails: { message: "null" } });
    expect(logger.entries.at(-1)?.data).toEqual({
      error: "test failure", errorDetails: { message: "test failure", code: 503, statusCode: 503 },
    });
    expect(JSON.stringify(logger.entries).includes("test-string-secret")).toBe(false);
    expect(JSON.stringify(logger.entries).includes("test-private-body")).toBe(false);
  });

  test("preserves logger failure propagation rather than claiming recovery completed", () => {
    const failure = new Error("test logger failure");
    const logger = { error: () => { throw failure; }, warn: () => { throw failure; } };
    const handler = new PlatformErrorHandler(logger, "test-platform");
    expect(() => handler.handleInitializationError(new Error("test original"))).toThrow(failure);
    expect(() => handler.handleConnectionError("test")).toThrow(failure);
    expect(() => handler.handleServiceUnavailableError("test-service", "test")).toThrow(failure);
    expect(() => handler.handleMessageSendError("test")).toThrow(failure);
  });

  test("retains curated operational diagnostics and cleanup context without raw content", () => {
    const logger = createRecordingLogger();
    const handler = new PlatformErrorHandler(logger, "test-platform");
    handler.logOperationalError("test operation", "test-context", { errorType: "TestFailure", code: "TEST_RETRY", statusCode: 429, hasPayload: true });
    handler.logOperationalError("test array", "test-context", ["test-private-content"]);
    handler.logOperationalError("test null", "test-context", null);
    handler.handleCleanupError(new Error("test cleanup"), "test-resource");
    handler.handleAuthenticationError("not ready");
    handler.handleDataLoggingError(new Error("test disk failure"), "test-events");
    expect(logger.entries[0]?.data).toEqual({ payloadSummary: { errorType: "TestFailure", code: "TEST_RETRY", statusCode: 429, hasPayload: true } });
    expect(logger.entries[1]?.data).toEqual({ payloadSummary: { fieldCount: 1, hasMessage: false, hasRawData: false, hasPayload: false } });
    expect(logger.entries[2]?.data).toBeUndefined();
    expect(logger.entries[3]).toMatchObject({ level: "warn", data: { error: "test cleanup", resource: "test-resource" } });
    expect(logger.entries[4]?.message).toBe("Cannot proceed - test-platform authentication not ready");
    expect(logger.entries[5]).toMatchObject({ message: "Error logging test-events data: test disk failure", source: "test-platform" });
  });
  let errorHandler: PlatformErrorHandler;
  let testPlatformName: string;

  beforeEach(() => {
    testPlatformName = "tiktok";
    errorHandler = new PlatformErrorHandler(noOpLogger, testPlatformName);
  });

  describe("Error Recovery Behavior", () => {
    test("rethrows the original initialization failure", () => {
      const failure = new Error("test initialization failure");
      expect(() => errorHandler.handleInitializationError(failure, "startup")).toThrow(failure);
    });

    test("reports an event failure without throwing", () => {
      const logger = createRecordingLogger();
      const handler = new PlatformErrorHandler(logger, "test-platform");
      expect(() => handler.handleEventProcessingError(new Error("test parse failure"), "test:event", {
        id: "test-event", type: "test:event"
      })).not.toThrow();
      expect(logger.entries).toHaveLength(1);
      expect(logger.entries[0]).toMatchObject({ level: "error" });
    });

    test("reports service unavailability without throwing", () => {
      const logger = createRecordingLogger();
      const handler = new PlatformErrorHandler(logger, "test-platform");
      expect(() => handler.handleServiceUnavailableError("test-service", new Error("test unavailable"))).not.toThrow();
      expect(logger.entries).toHaveLength(1);
      expect(logger.entries[0]).toMatchObject({ level: "warn" });
    });

    test("provides consistent error recovery across different error types", () => {
      const connectionError = new Error("WebSocket connection failed");
      const authError = "not ready";
      const cleanupError = new Error("Failed to cleanup resources");

      let allErrorsHandledGracefully = true;

      try {
        errorHandler.handleConnectionError(connectionError, "reconnect");
        errorHandler.handleAuthenticationError(authError);
        errorHandler.handleCleanupError(cleanupError, "EventSub subscriptions");
      } catch {
        allErrorsHandledGracefully = false;
      }

      expect(allErrorsHandledGracefully).toBe(true);
    });

    test("maintains platform functionality during message sending failures", () => {
      const sendError = new Error("API rate limit exceeded");
      const context = "chat message sending";
      let platformFunctionalityMaintained = true;

      try {
        errorHandler.handleMessageSendError(sendError, context);
      } catch {
        platformFunctionalityMaintained = false;
      }

      expect(platformFunctionalityMaintained).toBe(true);
    });
  });

  describe("Factory Function Behavior", () => {
    test("creates functional error handler instances", () => {
      const platformName = "youtube";

      const handler = createPlatformErrorHandler(noOpLogger, platformName);

      expect(handler).toBeInstanceOf(PlatformErrorHandler);
      expect(handler.logger).toBe(noOpLogger);
      expect(handler.platformName).toBe(platformName);

      let handlerFunctional = true;
      try {
        handler.handleConnectionError(new Error("Test error"), "test");
      } catch {
        handlerFunctional = false;
      }
      expect(handlerFunctional).toBe(true);
    });
  });

  describe("Error Message Quality", () => {
    test("produces clean error contexts without technical artifacts", () => {
      const testError = new Error("User-facing error occurred");

      const contexts: string[] = [];
      try {
        errorHandler.handleInitializationError(
          testError,
          "user session startup",
        );
      } catch (error: unknown) {
        contexts.push((error as Error).message);
      }

      contexts.forEach((context) => {
        expect(context).not.toMatch(/undefined|null|NaN/);
        expect(context).not.toMatch(/\{.*\}/);
      });
    });
  });

test("records event errors without promoting raw event data or allowing metadata overwrite", () => {
    const logger = createRecordingLogger();
    const handler = new PlatformErrorHandler(logger, "twitch");

    handler.handleEventProcessingError(
      new Error("test event failure"),
      "platform:chat-message",
      {
        error: "malicious overwrite",
        eventType: "malicious-type",
        message: "test-private-chat-text",
        access_token: "test-access-token",
      },
      "Event processing failed",
      "twitch",
    );

    expect(logger.entries).toHaveLength(1);
    const payload = logger.entries[0]?.data as Record<string, unknown>;
    const serializedPayload = JSON.stringify(payload);
    expect(payload.error).toBe("test event failure");
    expect(payload.eventType).toBe("platform:chat-message");
    expect(serializedPayload).toContain("eventDataSummary");
    expect(serializedPayload).not.toContain("malicious overwrite");
    expect(serializedPayload).not.toContain("malicious-type");
    expect(serializedPayload).not.toContain("test-private-chat-text");
    expect(serializedPayload).not.toContain("test-access-token");
});

test("records event summaries without provider-controlled key names", () => {
    const logger = createRecordingLogger();
    const handler = new PlatformErrorHandler(logger, "twitch");

    handler.handleEventProcessingError(
        new Error("test event failure"),
        "platform:chat-message",
        { "test-private-dynamic-key test-access-token": "value" },
        "Event processing failed",
        "twitch",
    );

    const serializedPayload = JSON.stringify(logger.entries);
    expect(serializedPayload).toContain("eventDataSummary");
    expect(serializedPayload).not.toContain("test-private-dynamic-key");
    expect(serializedPayload).not.toContain("test-access-token");
});

test("records operational errors with payload summaries instead of raw payloads", () => {
    const logger = createRecordingLogger();
    const handler = new PlatformErrorHandler(logger, "twitch");

    handler.logOperationalError("Operational failure", "twitch", {
        message: "test-private-chat-text",
        access_token: "test-access-token",
        payload: { nested: "test-nested-provider-data" },
    });

    expect(logger.entries).toHaveLength(1);
    const payload = logger.entries[0]?.data as Record<string, unknown>;
    const serializedPayload = JSON.stringify(payload);
    expect(serializedPayload).toContain("payloadSummary");
    expect(serializedPayload).toContain("fieldCount");
    expect(serializedPayload).toContain("hasPayload");
    expect(serializedPayload).not.toContain("test-private-chat-text");
    expect(serializedPayload).not.toContain("test-access-token");
    expect(serializedPayload).not.toContain("test-nested-provider-data");
});

test("records operational payload summaries without provider-controlled key names", () => {
    const logger = createRecordingLogger();
    const handler = new PlatformErrorHandler(logger, "twitch");

    handler.logOperationalError("Operational failure", "twitch", {
        "test-private-chat-text test-access-token": "value",
        payload: { nested: "test-nested-provider-data" },
    });

    const serializedPayload = JSON.stringify(logger.entries);
    expect(serializedPayload).toContain("payloadSummary");
    expect(serializedPayload).not.toContain("test-private-chat-text");
    expect(serializedPayload).not.toContain("test-access-token");
    expect(serializedPayload).not.toContain("test-nested-provider-data");
});

test("fails fast for invalid logger dependencies by default", () => {
    expect(() => new PlatformErrorHandler({}, "twitch")).toThrow(/twitch|logger/i);
  });

test("fails fast when logger is missing warning support used by recovery paths", () => {
    const errorOnlyLogger = {
      error: (_message: unknown, _source?: string, _data?: unknown): void => {},
    };

    expect(() => new PlatformErrorHandler(errorOnlyLogger, "twitch")).toThrow(/warn|logger/i);
});

test("uses the global logger only when no explicit logger is provided", () => {
    const stderrCapture = captureStderr();
const stdoutCapture = captureStdout();

    try {
        logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: "error" }, file: { enabled: false } } });
        const handler = createPlatformErrorHandler(undefined, "test-platform");

        handler.logOperationalError("test-global-handler-error", "test-platform");

        expect(stderrCapture.output.join("")).toContain("test-global-handler-error");
expect(stdoutCapture.output.join("")).toBe("");
    } finally {
        stderrCapture.restore();
stdoutCapture.restore();
        logging.initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: false } } });
    }
});
});
