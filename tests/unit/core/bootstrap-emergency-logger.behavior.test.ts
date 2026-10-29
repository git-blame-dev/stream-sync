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
    test("removes complete URL secrets before independent stderr and file writes", () => {
        const capture = createStderrCapture();
        const writes: string[] = [];
        const logger = createBootstrapEmergencyLogger({ logsDir: '/synthetic-unused', stderr: capture.stderr,
            existsSync: () => true, appendFileSync: (_path, data) => { writes.push(String(data)); } });
        logger.writeUncaughtException(new Error('failed https://example.invalid/?opaque=synthetic-prefix,synthetic-tail scope missing'));
        logger.writeUncaughtException(new Error(JSON.stringify({
            url: 'https://example.invalid/?opaque=synthetic-escaped', diagnostic: 'scope missing',
        }).replace(/\//g, '\\/')));
        logger.writeUncaughtException(new Error(JSON.stringify({
            url: 'ht\ttps://example.invalid/?opaque=synthetic-whitespace', diagnostic: 'scope missing',
        })));
        for (const output of [capture.output.join(''), writes.join('')]) {
            expect(output).not.toContain('synthetic-');
            expect(output).toContain('scope missing');
        }
    });
    test("unknown rejection shapes cannot prevent any public emergency report", () => {
        const values: unknown[] = [Object.create(null), { constructor: null },
            Object.defineProperty({}, 'constructor', { get() { throw new Error('synthetic getter'); } }),
            new Proxy({}, { ownKeys() { throw new Error('synthetic keys'); } })];
        for (const value of values) {
            const capture = createStderrCapture();
            const writes: string[] = [];
            const logger = createBootstrapEmergencyLogger({ logsDir: '/synthetic-unused', stderr: capture.stderr,
                existsSync: () => true, appendFileSync: (_path, data) => { writes.push(String(data)); } });
            expect(() => logger.writeUnhandledRejection(value)).not.toThrow();
            expect(() => logger.writeUncaughtException(value)).not.toThrow();
            expect(() => logger.writeMainFailure(value)).not.toThrow();
            expect(capture.output).toHaveLength(3);
            expect(writes).toHaveLength(2);
        }
    });

    test("a broken stderr still permits the independent emergency file attempt", () => {
        const writes: string[] = [];
        const logger = createBootstrapEmergencyLogger({ logsDir: '/synthetic-unused',
            stderr: { write() { throw new Error('synthetic sink failure'); } }, existsSync: () => true,
            appendFileSync: (_path, data) => { writes.push(String(data)); } });
        expect(() => logger.writeUnhandledRejection(Object.create(null))).not.toThrow();
        expect(writes).toHaveLength(1);
    });
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
