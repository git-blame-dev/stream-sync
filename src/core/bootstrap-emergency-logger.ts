import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { safeObjectStringify, sanitizeLogText } from './logger/safe-log-serializer';
import { ensureLogDirectorySync } from '../utils/log-directory';

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

function formatBootstrapErrorDetails(error: unknown): string {
    try {
        if (error instanceof Error) {
            return sanitizeLogText(error.stack || error.message);
        }
        if (typeof error === 'string') {
            return sanitizeLogText(error);
        }
        if (error && typeof error === 'object') {
            const constructor = error.constructor;
            const type = typeof constructor === 'function' && typeof constructor.name === 'string'
                ? constructor.name : 'Object';
            return safeObjectStringify({ type, fieldCount: Object.keys(error).length });
        }
        return sanitizeLogText(String(error));
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
            ensureLogDirectorySync(dependencies.logsDir, {
                existsSync: fileExistsSync,
                mkdirSync: createDirectorySync
            });
            appendLogFileSync(join(dependencies.logsDir, 'program-log.txt'), `${line}\n`);
        } catch (error) {
            writeStderr(`${fallbackPrefix} ${formatBootstrapErrorDetails(error)}\n`);
        }
    };

    return {
        writeUncaughtException(error: unknown): void {
            writeStderr(`[FATAL] Uncaught Exception: ${formatBootstrapErrorDetails(error)}\n`);
            writeProgramLog(`[FATAL] Uncaught Exception: ${formatBootstrapErrorDetails(error)}`, '[FATAL] Failed to write to log file:');
        },

        writeUnhandledRejection(reason: unknown): void {
            writeStderr(`[BOOTSTRAP] Unhandled Rejection: ${formatBootstrapErrorDetails(reason)}\n`);
            writeProgramLog(`[BOOTSTRAP] Unhandled Rejection: ${formatBootstrapErrorDetails(reason)}`, '[BOOTSTRAP] Failed to write to log file:');
        },

        writeMainFailure(error: unknown): void {
            writeStderr(`[FATAL] [Bootstrap] Main function failed: ${formatBootstrapErrorDetails(error)}\n`);
        }
    };
}

export { createBootstrapEmergencyLogger, formatBootstrapErrorDetails };
export type { BootstrapEmergencyLogger, BootstrapEmergencyLoggerDependencies };
