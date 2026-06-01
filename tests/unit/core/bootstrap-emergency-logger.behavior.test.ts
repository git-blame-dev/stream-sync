import { describe, test, expect } from "bun:test";
import { createBootstrapEmergencyLogger } from "../../../src/core/bootstrap-emergency-logger.ts";

function createStderrCapture() {
    const output: string[] = [];
    return {
        stderr: {
            write(chunk: string | Uint8Array): boolean {
                output.push(String(chunk));
                return true;
            },
        },
        output,
    };
}

describe("bootstrap emergency logger behavior", () => {
    test("writes uncaught exception emergencies to stderr and the program log", () => {
        const stderrCapture = createStderrCapture();
        const fileWrites: string[] = [];
        const logger = createBootstrapEmergencyLogger({
            logsDir: "/test-logs",
            stderr: stderrCapture.stderr,
            existsSync: () => true,
            appendFileSync: (_path, data) => {
                fileWrites.push(String(data));
            },
        });

        logger.writeUncaughtException(new Error("test-bootstrap-failure"));

        expect(stderrCapture.output.join("")).toContain("[FATAL] Uncaught Exception:");
        expect(stderrCapture.output.join("")).toContain("test-bootstrap-failure");
        expect(fileWrites.join("")).toContain("[FATAL] Uncaught Exception:");
        expect(fileWrites.join("")).toContain("test-bootstrap-failure");
    });

    test("writes unhandled rejection emergencies without requiring process exit", () => {
        const stderrCapture = createStderrCapture();
        const fileWrites: string[] = [];
        const logger = createBootstrapEmergencyLogger({
            logsDir: "/test-logs",
            stderr: stderrCapture.stderr,
            existsSync: () => true,
            appendFileSync: (_path, data) => {
                fileWrites.push(String(data));
            },
        });

        logger.writeUnhandledRejection("test-rejection-reason");

        expect(stderrCapture.output.join("")).toContain("[BOOTSTRAP] Unhandled Rejection:");
        expect(stderrCapture.output.join("")).toContain("test-rejection-reason");
        expect(fileWrites.join("")).toContain("[BOOTSTRAP] Unhandled Rejection:");
        expect(fileWrites.join("")).toContain("test-rejection-reason");
    });

    test("reports emergency file write failures to stderr", () => {
        const stderrCapture = createStderrCapture();
        const logger = createBootstrapEmergencyLogger({
            logsDir: "/test-logs",
            stderr: stderrCapture.stderr,
            existsSync: () => true,
            appendFileSync: () => {
                throw new Error("test-file-write-failure");
            },
        });

        logger.writeUnhandledRejection(new Error("test-rejection"));

        const stderr = stderrCapture.output.join("");
        expect(stderr).toContain("test-rejection");
        expect(stderr).toContain("[BOOTSTRAP] Failed to write to log file:");
        expect(stderr).toContain("test-file-write-failure");
    });

    test("redacts secrets from bootstrap emergency output", () => {
        const stderrCapture = createStderrCapture();
        const fileWrites: string[] = [];
        const logger = createBootstrapEmergencyLogger({
            logsDir: "/test-logs",
            stderr: stderrCapture.stderr,
            existsSync: () => true,
            appendFileSync: (_path, data) => {
                fileWrites.push(String(data));
            },
        });

        logger.writeUnhandledRejection(new Error("Authorization: Bearer test-access-token"));

        expect(stderrCapture.output.join("")).toContain("[REDACTED]");
        expect(fileWrites.join("")).toContain("[REDACTED]");
        expect(stderrCapture.output.join("")).not.toContain("test-access-token");
        expect(fileWrites.join("")).not.toContain("test-access-token");
    });

    test("creates the program log directory before writing when it is missing", () => {
        const stderrCapture = createStderrCapture();
        const createdDirectories: Array<{ path: string; options: { recursive: true } }> = [];
        const fileWrites: string[] = [];
        const logger = createBootstrapEmergencyLogger({
            logsDir: "/test-logs",
            stderr: stderrCapture.stderr,
            existsSync: () => false,
            mkdirSync: (path, options) => {
                createdDirectories.push({ path: String(path), options: options as { recursive: true } });
                return undefined;
            },
            appendFileSync: (path, data) => {
                fileWrites.push(`${String(path)}:${String(data)}`);
            },
        });

        logger.writeUncaughtException(new Error("test-bootstrap-failure"));

        expect(createdDirectories).toEqual([{ path: "/test-logs", options: { recursive: true } }]);
        expect(fileWrites.join("")).toContain("/test-logs/program-log.txt");
        expect(fileWrites.join("")).toContain("test-bootstrap-failure");
    });

    test("reports emergency directory creation failures to stderr", () => {
        const stderrCapture = createStderrCapture();
        const fileWrites: string[] = [];
        const logger = createBootstrapEmergencyLogger({
            logsDir: "/test-logs",
            stderr: stderrCapture.stderr,
            existsSync: () => false,
            mkdirSync: () => {
                throw new Error("test-mkdir-failure");
            },
            appendFileSync: (_path, data) => {
                fileWrites.push(String(data));
            },
        });

        logger.writeUnhandledRejection(new Error("test-rejection"));

        const stderr = stderrCapture.output.join("");
        expect(stderr).toContain("[BOOTSTRAP] Unhandled Rejection:");
        expect(stderr).toContain("[BOOTSTRAP] Failed to write to log file:");
        expect(stderr).toContain("test-mkdir-failure");
        expect(fileWrites).toEqual([]);
    });

    test("writes main failure emergencies to stderr without writing startup log files", () => {
        const stderrCapture = createStderrCapture();
        const fileWrites: string[] = [];
        const logger = createBootstrapEmergencyLogger({
            logsDir: "/test-logs",
            stderr: stderrCapture.stderr,
            existsSync: () => true,
            appendFileSync: (_path, data) => {
                fileWrites.push(String(data));
            },
        });

        logger.writeMainFailure(new Error("test-main-failure"));

        expect(stderrCapture.output.join("")).toContain("[FATAL] [Bootstrap] Main function failed:");
        expect(stderrCapture.output.join("")).toContain("test-main-failure");
        expect(fileWrites).toEqual([]);
    });
});
