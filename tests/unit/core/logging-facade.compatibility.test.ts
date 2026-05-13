import { describe, test, expect, beforeEach } from "bun:test";
import { captureStdout, captureStderr } from "../../helpers/output-capture";
import * as logging from "../../../src/core/logging.ts";

describe("logging facade compatibility", () => {
    beforeEach(() => {
        logging.setDebugMode(false);
        logging.initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: false } } });
    });

    test("keeps the public logging facade exports stable", () => {
        expect(logging.logger).toBeDefined();
        expect(typeof logging.getUnifiedLogger).toBe("function");
        expect(typeof logging.initializeLoggingConfig).toBe("function");
        expect(typeof logging.getLoggingConfig).toBe("function");
        expect(typeof logging.getDebugMode).toBe("function");
        expect(typeof logging.setDebugMode).toBe("function");
        expect(typeof logging.logger.debug).toBe("function");
        expect(typeof logging.logger.info).toBe("function");
        expect(typeof logging.logger.warn).toBe("function");
        expect(typeof logging.logger.error).toBe("function");
        expect(typeof logging.logger.console).toBe("function");
        expect(typeof logging.logger.emergency).toBe("function");
    });

    test("routes facade logger calls through the active runtime configuration", () => {
        const stdoutCapture = captureStdout();
        const stderrCapture = captureStderr();

        try {
            logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: "info" }, file: { enabled: false } } });
            logging.logger.info("test-facade-visible", "test-source");

            expect(stdoutCapture.output.join("")).toContain("test-facade-visible");
            expect(stdoutCapture.output.join("")).toContain("test-source");
            expect(stderrCapture.output.join("")).toBe("");
        } finally {
            stdoutCapture.restore();
            stderrCapture.restore();
        }
    });

    test("keeps exported logger references live after reconfiguration", () => {
        const stdoutCapture = captureStdout();
const stderrCapture = captureStderr();

        try {
            const loggerReference = logging.logger;
            logging.initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: false } } });
            loggerReference.info("test-hidden-before", "test-source");

            logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: "info" }, file: { enabled: false } } });
            loggerReference.info("test-visible-after", "test-source");

            const stdout = stdoutCapture.output.join("");
            expect(stdout).not.toContain("test-hidden-before");
            expect(stdout).toContain("test-visible-after");
expect(stderrCapture.output.join("")).toBe("");
        } finally {
            stdoutCapture.restore();
stderrCapture.restore();
        }
    });

    test("preserves logging-boundary redaction through the compatibility facade", () => {
        const stdoutCapture = captureStdout();
const stderrCapture = captureStderr();

        try {
            logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: "info" }, file: { enabled: false } } });
            logging.logger.info("test-redaction", "test-source", { access_token: "test-access-token" });

            const stdout = stdoutCapture.output.join("");
            expect(stdout).toContain("test-redaction");
            expect(stdout).toContain("[REDACTED]");
            expect(stdout).not.toContain("test-access-token");
expect(stderrCapture.output.join("")).toBe("");
        } finally {
            stdoutCapture.restore();
stderrCapture.restore();
        }
    });
});
