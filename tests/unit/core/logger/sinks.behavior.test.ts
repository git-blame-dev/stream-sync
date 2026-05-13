import { describe, test, expect, beforeEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { captureStdout, captureStderr } from "../../../helpers/output-capture";
import * as logging from "../../../../src/core/logging.ts";

describe("logger sink behavior", () => {
    beforeEach(() => {
        logging.setDebugMode(false);
        logging.initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: false } } });
    });

    test("writes info output to stdout using the runtime log line contract", () => {
        const stdoutCapture = captureStdout();
        const stderrCapture = captureStderr();

        try {
            logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: "debug" }, file: { enabled: false } } });
            logging.logger.info("test-info-message", "test-source", { event: "test-event" });

            const stdout = stdoutCapture.output.join("");
            expect(stdout).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[INFO\] \[test-source\] test-info-message \| Data: \{"event":"test-event"\}/);
            expect(stderrCapture.output.join("")).toBe("");
        } finally {
            stdoutCapture.restore();
            stderrCapture.restore();
        }
    });

    test("writes error and emergency output to stderr", () => {
        const stdoutCapture = captureStdout();
        const stderrCapture = captureStderr();

        try {
            logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: "debug" }, file: { enabled: false } } });
            logging.logger.error("test-error-message", "test-source");
            logging.logger.emergency?.("test-emergency-message", "test-source");

            const stderr = stderrCapture.output.join("");
            expect(stderr).toContain("test-error-message");
            expect(stderr).toContain("test-emergency-message");
            expect(stdoutCapture.output.join("")).not.toContain("test-error-message");
            expect(stdoutCapture.output.join("")).not.toContain("test-emergency-message");
        } finally {
            stdoutCapture.restore();
            stderrCapture.restore();
        }
    });

    test("writes console output as user-facing output without severity or source decoration", () => {
        const stdoutCapture = captureStdout();
const stderrCapture = captureStderr();

        try {
            logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: "error" }, file: { enabled: false } } });
            logging.logger.console?.("test-user-facing-message", "test-source", { event: "test-event" });

            const stdout = stdoutCapture.output.join("");
            expect(stdout).toMatch(/\[\d{2}:\d{2}:\d{2}\] test-user-facing-message/);
            expect(stdout).not.toContain("[CONSOLE]");
            expect(stdout).not.toContain("[test-source]");
            expect(stdout).not.toContain("Data:");
expect(stderrCapture.output.join("")).toBe("");
        } finally {
            stdoutCapture.restore();
stderrCapture.restore();
        }
    });

    test("writes runtime file logs using the approved human-readable contract", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-runtime-logs-"));

        try {
            logging.initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: true, level: "debug", directory: tempDir } } });
            logging.logger.info("test-file-info", "test-source", { event: "test-event" });
            logging.logger.error("test-file-error", "test-source");

            const runtimeLog = fs.readFileSync(path.join(tempDir, "runtime.log"), "utf8");
            expect(runtimeLog).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[INFO\] \[test-source\] test-file-info \| Data: \{"event":"test-event"\}/);
            expect(runtimeLog).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[ERROR\] \[test-source\] test-file-error/);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

test("does not write runtime logs when the file sink is disabled", () => {
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-runtime-logs-"));

try {
logging.initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: false, level: "debug", directory: tempDir } } });
logging.logger.info("test-no-file", "test-source");

expect(fs.existsSync(path.join(tempDir, "runtime.log"))).toBe(false);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
