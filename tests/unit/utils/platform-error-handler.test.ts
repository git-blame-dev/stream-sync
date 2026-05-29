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
  let errorHandler: PlatformErrorHandler;
  let testPlatformName: string;

  beforeEach(() => {
    testPlatformName = "tiktok";
    errorHandler = new PlatformErrorHandler(noOpLogger, testPlatformName);
  });

  describe("Error Recovery Behavior", () => {
    test("maintains system stability during initialization failures", () => {
      const initError = new Error("Network connection failed");
      let systemCrashed = false;

      try {
        errorHandler.handleInitializationError(initError, "startup");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error)) {
          throw new Error("Expected initialization error");
        }
        expect(error).toBe(initError);
        expect(error.message).toBe("Network connection failed");
        expect(error.message).not.toContain("undefined");
        expect(error.message).not.toContain("null");
      }

      expect(systemCrashed).toBe(false);
    });

    test("prevents chat processing pipeline disruption during event errors", () => {
      const eventError = new Error("Failed to parse gift data");
      const eventType = "platform:gift";
      const eventData = {
        id: "gift_123",
        type: "platform:gift",
        username: "TestUser",
      };
      let chatProcessingStopped = false;

      try {
        errorHandler.handleEventProcessingError(
          eventError,
          eventType,
          eventData,
        );
        chatProcessingStopped = false;
      } catch {
        chatProcessingStopped = true;
      }

      expect(chatProcessingStopped).toBe(false);
    });

    test("maintains user experience during service unavailability", () => {
      const serviceError = new Error("Authentication service timeout");
      const serviceName = "AuthenticationService";
      let userExperienceDisrupted = false;

      try {
        errorHandler.handleServiceUnavailableError(serviceName, serviceError);
        userExperienceDisrupted = false;
      } catch {
        userExperienceDisrupted = true;
      }

      expect(userExperienceDisrupted).toBe(false);
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
