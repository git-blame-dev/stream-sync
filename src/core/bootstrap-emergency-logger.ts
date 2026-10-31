import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, renameSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { sanitizeLogText } from './logger/safe-log-serializer';

type BootstrapEmergencyLoggerDependencies = {
    logsDir: string;
    stderr?: Pick<NodeJS.WriteStream, 'write'>;
    existsSync?: typeof existsSync;
    mkdirSync?: typeof mkdirSync;
    appendFileSync?: typeof appendFileSync;
    renameSync?: typeof renameSync;
};

type BootstrapEmergencyLogger = {
    writeUncaughtException(error: unknown): void;
    writeUnhandledRejection(reason: unknown): void;
    writeMainFailure(error: unknown): void;
};

const MAX_EMERGENCY_DETAILS_LENGTH = 4096;
const MAX_EMERGENCY_FILE_BYTES = 1024 * 1024;

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
    const moveFileSync = dependencies.renameSync ?? renameSync;
    const activePath = join(dependencies.logsDir, 'program-log.txt');
    const backupPath = `${activePath}.1`;

    const writeStderr = (line: string): void => {
        try { stderr.write(line); } catch { /* Other emergency sinks must still be attempted. */ }
    };

    const managedFileSize = (path: string): number => {
        let file: Stats;
        try {
            file = lstatSync(path);
        } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return 0;
            throw error;
        }
        if (!file.isFile()) throw new Error('Emergency log destination is not a regular file');
        if (file.size > MAX_EMERGENCY_FILE_BYTES) {
            // Historical bytes are preserved, but excluded from the active-plus-backup bound.
            moveFileSync(path, `${path}.preserved-${randomUUID()}`);
            writeStderr('[BOOTSTRAP] Preserved oversized emergency history outside managed rotation.\n');
            return 0;
        }
        return file.size;
    };

    const writeProgramLog = (line: string, fallbackPrefix: string): void => {
        try {
            if (!fileExistsSync(dependencies.logsDir)) {
                createDirectorySync(dependencies.logsDir, { recursive: true });
            }
            managedFileSize(backupPath);
            const activeBytes = managedFileSize(activePath);
            const record = `${line}\n`;
            if (activeBytes + Buffer.byteLength(record, 'utf8') > MAX_EMERGENCY_FILE_BYTES) {
                moveFileSync(activePath, backupPath);
            }
            appendLogFileSync(activePath, record);
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
