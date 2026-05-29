import { describe, expect, beforeEach, afterEach, it } from "bun:test";
import { restoreAllMocks } from "../../helpers/bun-mock-utils";
import { initializeTestLogging } from "../../helpers/test-setup";
initializeTestLogging();

import { handleUserFacingError } from "../../../src/utils/user-friendly-errors.ts";
import {
  expectNoTechnicalArtifacts,
  expectContentReadabilityForAudience,
} from "../../helpers/assertion-helpers";
import { setupAutomatedCleanup } from "../../helpers/mock-lifecycle";
import { noOpLogger } from "../../helpers/mock-factories";
setupAutomatedCleanup({
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
