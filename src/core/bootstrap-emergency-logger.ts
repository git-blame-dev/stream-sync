import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeLogText } from './logger/safe-log-serializer';

type BootstrapEmergencyLoggerDependencies = {
    logsDir: string;
    stderr?: Pick<NodeJS.WriteStream, 'write'>;
    existsSync?: typeof existsSync;
    mkdirSync?: typeof mkdirSync;
    appendFileSync?: typeof appendFileSync;
};

type BootstrapEmergencyLogger = {
    writeUncaughtException(error: unknown): void;
    writeUnhandledRejection(reason: unknown): void;
    writeMainFailure(error: unknown): void;
};

const MAX_EMERGENCY_DETAILS_LENGTH = 4096;

function formatBootstrapErrorDetails(error: unknown): string {
    try {
        // Never traverse arbitrary rejection payloads or invoke their serialization hooks.
        const details = error instanceof Error ? error.stack || error.message
            : error !== null && typeof error === 'object' ? '[Non-Error object]' : String(error);
        // Redact before truncation so a cut through a secret cannot defeat matching.
        const safe = sanitizeLogText(details).replace(/[\x00-\x1f\x7f]/g, ' ');
        return safe.length > MAX_EMERGENCY_DETAILS_LENGTH
            ? `${safe.slice(0, MAX_EMERGENCY_DETAILS_LENGTH - 3)}...` : safe;
    } catch {
        return '[Unformattable error]';
    }
}

function createBootstrapEmergencyLogger(dependencies: BootstrapEmergencyLoggerDependencies): BootstrapEmergencyLogger {
    const stderr = dependencies.stderr ?? process.stderr;
    const fileExistsSync = dependencies.existsSync ?? existsSync;
    const createDirectorySync = dependencies.mkdirSync ?? mkdirSync;
    const appendLogFileSync = dependencies.appendFileSync ?? appendFileSync;

    const writeStderr = (line: string): void => {
        try { stderr.write(line); } catch { /* Other emergency sinks must still be attempted. */ }
    };

    const writeProgramLog = (line: string, fallbackPrefix: string): void => {
        try {
            if (!fileExistsSync(dependencies.logsDir)) {
                createDirectorySync(dependencies.logsDir, { recursive: true });
            }
            appendLogFileSync(join(dependencies.logsDir, 'program-log.txt'), `${line}\n`);
        } catch (error) {
            writeStderr(`${fallbackPrefix} ${formatBootstrapErrorDetails(error)}\n`);
        }
    };

    return {
        writeUncaughtException(error: unknown): void {
            const line = `[FATAL] Uncaught Exception: ${formatBootstrapErrorDetails(error)}`;
            writeStderr(`${line}\n`);
            writeProgramLog(line, '[FATAL] Failed to write to log file:');
        },

        writeUnhandledRejection(reason: unknown): void {
            const line = `[BOOTSTRAP] Unhandled Rejection: ${formatBootstrapErrorDetails(reason)}`;
            writeStderr(`${line}\n`);
            writeProgramLog(line, '[BOOTSTRAP] Failed to write to log file:');
        },

        writeMainFailure(error: unknown): void {
            writeStderr(`[FATAL] [Bootstrap] Main function failed: ${formatBootstrapErrorDetails(error)}\n`);
        }
    };
}

export { createBootstrapEmergencyLogger, formatBootstrapErrorDetails };
export type { BootstrapEmergencyLogger, BootstrapEmergencyLoggerDependencies };
