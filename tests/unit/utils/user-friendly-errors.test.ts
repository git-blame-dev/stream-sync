import { dirname } from "node:path";
import { withNativeChildEnvironment } from "../../helpers/native-child-environment";
import { describe, expect, beforeEach, it } from "bun:test";
import { initializeTestLogging } from "../../helpers/test-setup";
initializeTestLogging();

import { handleUserFacingError } from "../../../src/utils/user-friendly-errors.ts";
import {
  expectNoTechnicalArtifacts,
  expectContentReadabilityForAudience,
} from "../../helpers/assertion-helpers";
import { noOpLogger } from "../../helpers/mock-factories";
import { createRecordingLogger } from "../../helpers/recording-logger";

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

      it.each([
        [true, true, ["console", "error"]],
        [true, false, ["console"]],
        [false, true, ["error"]],
        [false, false, []],
      ] as const)("honors display=%s and diagnostics=%s exactly once", (showInConsole, logTechnical, expected) => {
        const logger = createRecordingLogger();
        handleUserFacingError(new Error("Synthetic unexpected failure"), { logger }, { showInConsole, logTechnical });
        expect(logger.entries.map(entry => entry.level)).toEqual([...expected]);
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
        it.each([true, false])("preserves native exit behavior with exitOnError=%s", async (exitOnError) => {
          await withNativeChildEnvironment(async (env) => {
            const script = `
              import { handleUserFacingError } from ${JSON.stringify(import.meta.resolve("../../../src/utils/user-friendly-errors.ts"))};
              const logger = {
                console(message) { process.stdout.write(message); },
                error() {}, warn() {},
              };
              handleUserFacingError("Token validation failed: 401 Unauthorized", { logger },
                ${exitOnError ? "{ exitOnError: true }" : "{}"});
              process.stdout.write("SYNTHETIC_RETURNED");
            `;
            const child = Bun.spawnSync([process.execPath, "--no-env-file", "--eval", script], {
              cwd: dirname(env.CHAT_BOT_CONFIG_PATH!),
              env,
              stdout: "pipe",
              stderr: "pipe",
              timeout: 5_000,
            });
            expect(child.exitCode).toBe(exitOnError ? 1 : 0);
            expect(child.stderr.toString()).toBe("");
            expect(child.stdout.toString()).toContain("TWITCH CONNECTION PROBLEM");
            expect(child.stdout.toString().includes("SYNTHETIC_RETURNED")).toBe(!exitOnError);
          });
        });
      });
    });
  }
);
