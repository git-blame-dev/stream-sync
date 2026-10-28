import { describe, expect, beforeEach, afterEach, it } from "bun:test";
import { restoreAllMocks } from "../../helpers/bun-mock-utils";
import { initializeTestLogging } from "../../helpers/test-setup";
initializeTestLogging();

import { handleUserFacingError } from "../../../src/utils/user-friendly-errors.ts";
import {
  expectNoTechnicalArtifacts,
  expectContentReadabilityForAudience,
} from "../../helpers/assertion-helpers";
import { registerMockLifecycleHooks } from "../../helpers/mock-lifecycle";
import { noOpLogger } from "../../helpers/mock-factories";
registerMockLifecycleHooks({
  clearCallsBeforeEach: true,
  logPerformanceMetrics: true,
});

type TestLogger = typeof noOpLogger & {
  console: (message: string, context?: string) => void;
};

describe(
  "User-Friendly Error System",
  () => {
    describe("handleUserFacingError", () => {
      let mockLogger: TestLogger;
      let consoleOutput: string[];

      beforeEach(() => {
        consoleOutput = [];
        mockLogger = {
          ...noOpLogger,
          console: (message: string) => {
            consoleOutput.push(message);
          },
        };
      });

      describe("when showing user-facing errors", () => {
        it.each([
          ["YouTube connection timeout", "YOUTUBE CONNECTION PROBLEM", "WARNING"],
          ["Connection timeout", "INTERNET CONNECTION PROBLEM", "ERROR"],
        ])("classifies %s without losing specific precedence", (message, title, severity) => {
          handleUserFacingError(new Error(message), { logger: mockLogger });
          expect(consoleOutput.join("\n")).toContain(title);
          expect(consoleOutput.join("\n")).toContain(severity);
        });

        it.each(["YouTube connection timeout", "YouTube temporarily unavailable", "Unrecognized synthetic failure", "Token validation failed"])(
          "redacts recognized credentials through friendly formatting and logger records for %s",
          (prefix) => {
            const records: unknown[][] = [];
            mockLogger.error = (...args: unknown[]) => { records.push(args); };
            mockLogger.warn = (...args: unknown[]) => { records.push(args); };
            const credentials = [
              "Authorization: Basic synthetic-basic-secret",
              "Bearer synthetic-bearer-secret",
              '{"access_token":"synthetic-json-secret"}',
              'password="synthetic-quoted-secret tail"',
              "https://example.invalid/path?signature=synthetic-url-secret",
              `clientSecret="${"synthetic-long-secret".repeat(400)}"`,
            ].join(" | ");
            const original = new Error(`${prefix} | ${credentials}`);
            const originalMessage = original.message;
            handleUserFacingError(original, {
              logger: mockLogger,
              includeTechnical: true,
              category: "test-category password=synthetic-category-secret",
              opaque: { password: "synthetic-opaque-secret" },
            });
            const output = JSON.stringify({ records, consoleOutput });
            expect(records.length).toBeGreaterThan(0);
            expect(output).toContain("[REDACTED]");
            expect(output).not.toContain("synthetic-basic");
            expect(output).not.toContain("synthetic-bearer");
            expect(output).not.toContain("synthetic-json");
            expect(output).not.toContain("synthetic-quoted");
            expect(output).not.toContain("synthetic-url");
            expect(output).not.toContain("synthetic-long");
            expect(output).not.toContain("synthetic-category");
            expect(output).not.toContain("synthetic-opaque");
            expect(consoleOutput.join("\n")).not.toContain("Technical details:");
            expect(original.message).toBe(originalMessage);
          },
        );

        it("keeps diagnostics disabled without leaking the original error into logger metadata", () => {
          const records: unknown[][] = [];
          mockLogger.error = (...args: unknown[]) => { records.push(args); };
          handleUserFacingError(new Error("Unrecognized failure password=synthetic-disabled-secret"), {
            logger: mockLogger,
          });
          expect(consoleOutput.join("\n")).toContain("UNEXPECTED PROBLEM");
          expect(JSON.stringify({ records, consoleOutput })).not.toContain("synthetic-disabled");
          expect(JSON.stringify(records)).not.toContain("Technical:");
        });

        it("should display user-friendly console message", () => {
          const technicalError = "Missing clientId or clientSecret";

          handleUserFacingError(technicalError, { logger: mockLogger });

          const output = consoleOutput.join("\n");
          expectNoTechnicalArtifacts(output);
          expectContentReadabilityForAudience(output, "user");
        });

        it("should display user-friendly message for authentication errors", () => {
          const technicalError = new Error(
            "Token validation failed: 401 Unauthorized",
          );

          handleUserFacingError(technicalError, {
            logger: mockLogger,
            category: "authentication",
          });

          const output = consoleOutput.join("\n");
          expect(output).toContain("TWITCH CONNECTION PROBLEM");
          expect(output).toContain("reconnect your Twitch account");
          expectNoTechnicalArtifacts(output);
        });

        it("should not show console output when disabled", () => {
          const technicalError = "Some error";

          handleUserFacingError(
            technicalError,
            { logger: mockLogger },
            {
              showInConsole: false,
            },
          );

          expect(consoleOutput).toHaveLength(0);
        });

        it("should display warning-level messages appropriately", () => {
          const warningError = "YouTube API key missing";

          handleUserFacingError(warningError, {
            logger: mockLogger,
            category: "configuration",
          });

          const output = consoleOutput.join("\n");
          expect(output).toContain("YOUTUBE SETUP REQUIRED");
          expect(output).toContain("WARNING");
        });
      });

  describe("when handling exit scenarios", () => {
    let originalProcessExit: typeof process.exit;
    let exitCalled: boolean;
    let observedExitCode: number | undefined;

    beforeEach(() => {
      exitCalled = false;
      observedExitCode = undefined;
      originalProcessExit = process.exit;
      process.exit = ((code?: string | number | null | undefined) => {
        exitCalled = true;
        observedExitCode = typeof code === "number" ? code : undefined;
        return undefined as never;
      }) as typeof process.exit;
    });

        afterEach(() => {
          restoreAllMocks();
          process.exit = originalProcessExit;
        });

    it("exits with code 1 when exitOnError is true", () => {
      const criticalError = "Authentication validation failed";

          handleUserFacingError(
            criticalError,
            { logger: mockLogger },
            {
              exitOnError: true,
            },
          );

      expect(exitCalled).toBe(true);
      expect(observedExitCode).toBe(1);
    });

        it("should not exit by default", () => {
          const normalError = "Some recoverable error";

          handleUserFacingError(normalError, { logger: mockLogger });

          expect(exitCalled).toBe(false);
          expect(observedExitCode).toBeUndefined();
        });
      });
    });
  }
);
