import { randomUUID } from 'node:crypto';
import { DEFAULT_LOGGING_CONFIG } from './config-builders';
import { shouldLogAtThreshold } from './logger/levels';
import type { AppLogger, LogLevel, LogThreshold } from './logger/types';
import { safeObjectStringify, sanitizeLogData } from './logger/safe-log-serializer';
import { LineFileAppender } from '../utils/line-file-appender';
import { formatTimestampCompact, getSystemTimestampISO } from '../utils/timestamp';
import {
    createOperatorLogSource,
    type JsonLogValue,
    type OperatorLogSource
} from '../services/operator/operator-log-source';

type LogData = unknown;
type LogEntry = { runId: string; timestamp: string; level: LogLevel; message: string; source: string; data: JsonLogValue; dataText: string };
type Destination = 'console' | 'file';
type OutputConfig = { enabled?: boolean; level?: LogThreshold; directory?: string; filename?: string; maxBytes?: number; maxQueueBytes?: number; archiveMaxBytes?: number; archiveMaxAgeDays?: number };
type LoggingConfig = { console?: OutputConfig; file?: OutputConfig; [key: string]: unknown };
type LoggingOptions = { operatorCaptureEnabled?: boolean };
type LoggerOutputter = { write(logEntry: LogEntry): void };
type LoggerFileOutputter = LoggerOutputter & { config: OutputConfig; fileAppender: unknown };

/** Public logger surface; operator log storage remains available only via its accessor. */
export type UnifiedLoggerFacade = AppLogger & {
    config: LoggingConfig;
    outputs: { console: LoggerOutputter; file: LoggerFileOutputter };
    reconfigure(config: LoggingConfig): void;
    log(level: LogLevel, message: unknown, source?: string, data?: LogData): void;
    shouldOutput(level: LogLevel, destination: Destination): boolean;
    console(message: unknown, source?: string, data?: LogData): void;
    emergency(message: unknown, source?: string, data?: LogData): void;
};

let globalLoggingConfig: LoggingConfig | null = null;
let operatorCaptureEnabled = false;

function initializeLoggingConfig(appConfig: { logging?: LoggingConfig }, options: LoggingOptions = {}) {
    globalLoggingConfig = appConfig.logging || null;
    if (options.operatorCaptureEnabled !== undefined) {
        operatorCaptureEnabled = options.operatorCaptureEnabled;
    }
    if (globalLogger) {
        globalLogger.reconfigure(getLoggingConfig());
        globalLogger.setOperatorCaptureEnabled(operatorCaptureEnabled);
    }
    return globalLoggingConfig;
}

function getLoggingConfig(): LoggingConfig {
    if (!globalLoggingConfig) {
        return process.env.NODE_ENV === 'test'
            ? { ...DEFAULT_LOGGING_CONFIG, file: { ...DEFAULT_LOGGING_CONFIG.file, enabled: false } }
            : DEFAULT_LOGGING_CONFIG as LoggingConfig;
    }
    return globalLoggingConfig;
}

// Escape controls only at the rendering boundary; structured operator data stays useful.
function oneLine(text: string): string {
    return text.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g,
        character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function stderrFallback(text: string): void {
    try { process.stderr.write(oneLine(text).slice(0, 8192) + '\n'); }
    catch { /* A broken stderr must not recurse through the logger. */ }
}

function boundedText(value: unknown): string {
    let text = safeObjectStringify(value);
    if (text.length > 4096) text = text.slice(0, 4096) + '...';
    while (Buffer.byteLength(oneLine(text)) > 12 * 1024) text = text.slice(0, Math.floor(text.length / 2)) + '...';
    return text;
}

function createRecord(runId: string, level: LogLevel, message: unknown, source: string, data: unknown): LogEntry {
    let safeData = sanitizeLogData(data) ?? null;
    let dataText = JSON.stringify(safeData);
    if (Buffer.byteLength(oneLine(dataText)) > 16 * 1024) {
        safeData = '[TRUNCATED]';
        dataText = JSON.stringify(safeData);
    }
    return { runId, timestamp: getSystemTimestampISO(), level,
        message: boundedText(message), source: boundedText(source),
        data: safeData as JsonLogValue, dataText: typeof safeData === 'string' ? safeData : dataText };
}

class UnifiedLogger implements AppLogger {
    config: LoggingConfig;
    outputs: { console: ConsoleOutputter; file: FileOutputter };
    private readonly runId = randomUUID();
    private captureOperatorLogs: boolean;
    private operatorLogs: OperatorLogSource;

    constructor(config: LoggingConfig = {}, captureOperatorLogs = false) {
        this.config = config;
        this.outputs = {
            console: new ConsoleOutputter(),
            file: new FileOutputter(config.file)
        };
        this.captureOperatorLogs = captureOperatorLogs;
        this.operatorLogs = createOperatorLogSource();
    }

    reconfigure(config: LoggingConfig): void {
        this.config = config;
        this.outputs.file.reconfigure(config.file);
    }

    async flush(): Promise<void> { await this.outputs.file.fileAppender?.flush(); }

    setOperatorCaptureEnabled(enabled: boolean): void {
        this.captureOperatorLogs = enabled;
    }

    getOperatorLogSource(): OperatorLogSource | null {
        return this.captureOperatorLogs ? this.operatorLogs : null;
    }

    log(level: LogLevel, message: unknown, source = 'system', data: LogData = null) {
        const shouldWriteConsole = this.shouldOutput(level, 'console');
        const shouldWriteFile = this.shouldOutput(level, 'file');
        // Capture info+ and user-facing messages independently. Debug follows an enabled
        // output's explicit debug threshold, avoiding a second mutable verbosity switch.
        const shouldCapture = this.captureOperatorLogs && (level !== 'debug' || shouldWriteConsole || shouldWriteFile);
        if (!shouldWriteConsole && !shouldWriteFile && !shouldCapture) return;

        const entry = createRecord(this.runId, level, message, source, data);
        if (shouldWriteConsole) {
            try { this.outputs.console.write(entry); }
            catch { stderrFallback(`[Logger] Console output failed | ${entry.message}`); }
        }
        if (shouldWriteFile) {
            try { this.outputs.file.write(entry); }
            catch { stderrFallback(`[Logger] File output failed | ${entry.message}`); }
        }
        if (shouldCapture) {
            try {
                this.operatorLogs.append({ timestamp: formatTimestampCompact(entry.timestamp), level,
                    message: entry.message, source: entry.source, data: entry.data });
            } catch { stderrFallback(`[Logger] Operator capture failed | ${entry.message}`); }
        }
    }

    shouldOutput(level: LogLevel, destination: Destination): boolean {
        const destinationConfig = this.config[destination] as OutputConfig | undefined;
        if (!destinationConfig || !destinationConfig.enabled) return false;
        if (destination === 'file' && (!destinationConfig.directory || !this.outputs.file.config.enabled)) return false;
        if (level === 'console') return destination === 'console';
        return shouldLogAtThreshold(level, destinationConfig.level || 'info');
    }

    info(message: unknown, source = 'system', data: LogData = null) { this.log('info', message, source, data); }
    warn(message: unknown, source = 'system', data: LogData = null) { this.log('warn', message, source, data); }
    error(message: unknown, source = 'system', data: LogData = null) { this.log('error', message, source, data); }
    debug(message: unknown, source = 'system', data: LogData = null) { this.log('debug', message, source, data); }
    emergency(message: unknown, source = 'system', data: LogData = null) { this.log('emergency', message, source, data); }
    console(message: unknown, source = 'system', data: LogData = null) { this.log('console', message, source, data); }
}

class ConsoleOutputter {
    write(logEntry: LogEntry) {
        const { level, message, source, data, dataText } = logEntry;
        const timestamp = formatTimestampCompact(logEntry.timestamp);
        let output: string;
        if (level === 'console') output = `[${timestamp}] ${message}`;
        else if (level === 'emergency') output = `[EMERGENCY] ${message}`;
        else output = `[${timestamp}] [${level.toUpperCase()}] [${source}] ${message}`;
        if (data && level !== 'console' && level !== 'emergency') output += ` | Data: ${dataText}`;
        if (level === 'error' || level === 'emergency') process.stderr.write(oneLine(output) + '\n');
        else process.stdout.write(oneLine(output) + '\n');
    }
}

class FileOutputter {
    config: OutputConfig;
    fileAppender: LineFileAppender | null;

    constructor(config: OutputConfig = {}) {
        this.config = config;
        this.fileAppender = null;
        this.reconfigure(config);
    }

    reconfigure(config: OutputConfig = {}) {
        this.config = config;
        if (!config.enabled || !config.directory) return;
        const destination = { logDir: config.directory,
            ...(config.filename !== undefined ? { filename: config.filename } : {}),
            ...(config.maxBytes !== undefined ? { maxBytes: config.maxBytes } : {}),
            ...(config.maxQueueBytes !== undefined ? { maxQueueBytes: config.maxQueueBytes } : {}),
            ...(config.archiveMaxBytes !== undefined ? { archiveMaxBytes: config.archiveMaxBytes } : {}),
            ...(config.archiveMaxAgeDays !== undefined ? { archiveMaxAgeDays: config.archiveMaxAgeDays } : {}) };
        try {
            if (this.fileAppender) this.fileAppender.reconfigure(destination);
            else this.fileAppender = new LineFileAppender(destination);
        } catch {
            this.config = { ...config, enabled: false };
            stderrFallback('[Logger] Invalid file output configuration');
        }
    }

    write(logEntry: LogEntry) {
        if (!this.fileAppender || !this.config.enabled || !this.config.directory) return;
        const { timestamp, level, message, source, data, dataText } = logEntry;
        let logLine = `[${timestamp}] [${level.toUpperCase()}] [${source}] [run:${logEntry.runId}] ${message}`;
        if (data) logLine += ` | Data: ${dataText}`;
        const accepted = this.fileAppender.log(oneLine(logLine));
        if (!accepted && (level === 'warn' || level === 'error' || level === 'emergency')) {
            stderrFallback(logLine);
        }
    }
}

/** Independent instances share policy, never runtime state or file queues. */
function createLogger(config: LoggingConfig = {}, options: LoggingOptions = {}): UnifiedLogger {
    return new UnifiedLogger(config, options.operatorCaptureEnabled ?? false);
}

let globalLogger: UnifiedLogger | null = null;

function getUnifiedLogger(): UnifiedLoggerFacade & { flush(): Promise<void> } {
    if (!globalLogger) globalLogger = new UnifiedLogger(getLoggingConfig(), operatorCaptureEnabled);
    return globalLogger;
}

function getOperatorLogSource(): OperatorLogSource | null {
    getUnifiedLogger();
    return globalLogger!.getOperatorLogSource();
}

const logger = new Proxy<UnifiedLoggerFacade>({} as UnifiedLoggerFacade, {
    get(_target, prop) {
        const resolvedLogger = getUnifiedLogger();
        const value = Reflect.get(resolvedLogger, prop);
        return typeof value === 'function' ? value.bind(resolvedLogger) : value;
    }
}) as UnifiedLoggerFacade;

export {
    createLogger,
    getLoggingConfig,
    getOperatorLogSource,
    getUnifiedLogger,
    initializeLoggingConfig,
    logger
};
