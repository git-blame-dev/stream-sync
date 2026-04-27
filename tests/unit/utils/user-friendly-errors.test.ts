import { describe, expect, beforeEach, afterEach, it } from "bun:test";
import { spyOn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { initializeTestLogging, TEST_TIMEOUTS } from "../../helpers/test-setup";
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

describe(
  "User-Friendly Error System",
  () => {
    describe("handleUserFacingError", () => {
      let mockLogger;
      let consoleOutput;

      beforeEach(() => {
        consoleOutput = [];
        mockLogger = noOpLogger;
        mockLogger.console = (message) => {
          consoleOutput.push(message);
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
    let mockProcessExit;
    let observedExitCode: number | undefined;

    beforeEach(() => {
      observedExitCode = undefined;
      mockProcessExit = spyOn(process, "exit").mockImplementation((code) => {
        observedExitCode = typeof code === "number" ? code : undefined;
        return undefined as never;
      });
    });

        afterEach(() => {
          restoreAllMocks();
          mockProcessExit.mockRestore();
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

      expect(mockProcessExit).toHaveBeenCalled();
      expect(observedExitCode).toBe(1);
    });

        it("should not exit by default", () => {
          const normalError = "Some recoverable error";

          handleUserFacingError(normalError, { logger: mockLogger });

          expect(mockProcessExit).not.toHaveBeenCalled();
        });
      });
    });
  },
  TEST_TIMEOUTS.FAST,
);
