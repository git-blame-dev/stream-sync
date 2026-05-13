import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { safeObjectStringify, sanitizeLogText } from './logger/safe-log-serializer';

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
    if (error instanceof Error) {
        return sanitizeLogText(error.stack || error.message);
    }
    if (typeof error === 'string') {
        return sanitizeLogText(error);
    }
    if (error && typeof error === 'object') {
        return safeObjectStringify({ type: error.constructor.name, fieldCount: Object.keys(error as Record<string, unknown>).length });
    }
    return sanitizeLogText(String(error));
}

function createBootstrapEmergencyLogger(dependencies: BootstrapEmergencyLoggerDependencies): BootstrapEmergencyLogger {
    const stderr = dependencies.stderr ?? process.stderr;
    const fileExistsSync = dependencies.existsSync ?? existsSync;
    const createDirectorySync = dependencies.mkdirSync ?? mkdirSync;
    const appendLogFileSync = dependencies.appendFileSync ?? appendFileSync;

    const writeProgramLog = (line: string, fallbackPrefix: string): void => {
        try {
            if (!fileExistsSync(dependencies.logsDir)) {
                createDirectorySync(dependencies.logsDir, { recursive: true });
            }
            appendLogFileSync(join(dependencies.logsDir, 'program-log.txt'), `${line}\n`);
        } catch (error) {
            stderr.write(`${fallbackPrefix} ${formatBootstrapErrorDetails(error)}\n`);
        }
    };

    return {
        writeUncaughtException(error: unknown): void {
            stderr.write(`[FATAL] Uncaught Exception: ${formatBootstrapErrorDetails(error)}\n`);
            writeProgramLog(`[FATAL] Uncaught Exception: ${formatBootstrapErrorDetails(error)}`, '[FATAL] Failed to write to log file:');
        },

        writeUnhandledRejection(reason: unknown): void {
            stderr.write(`[BOOTSTRAP] Unhandled Rejection: ${formatBootstrapErrorDetails(reason)}\n`);
            writeProgramLog(`[BOOTSTRAP] Unhandled Rejection: ${formatBootstrapErrorDetails(reason)}`, '[BOOTSTRAP] Failed to write to log file:');
        },

        writeMainFailure(error: unknown): void {
            stderr.write(`[FATAL] [Bootstrap] Main function failed: ${formatBootstrapErrorDetails(error)}\n`);
        }
    };
}

export { createBootstrapEmergencyLogger, formatBootstrapErrorDetails };
export type { BootstrapEmergencyLogger, BootstrapEmergencyLoggerDependencies };
