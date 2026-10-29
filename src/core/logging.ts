import { DEFAULT_LOGGING_CONFIG } from './config-builders';
import { shouldLogAtThreshold } from './logger/levels';
import type { AppLogger, LogLevel, LogThreshold } from './logger/types';
import { safeObjectStringify, sanitizeLogData, sanitizeLogText } from './logger/safe-log-serializer';
import { LineFileAppender } from '../utils/line-file-appender';
import { formatTimestampCompact } from '../utils/timestamp';
import {
    createOperatorLogSource,
    type JsonLogValue,
    type OperatorLogSource
} from '../services/operator/operator-log-source';

type LogData = unknown;
type LogEntry = { timestamp: string; level: LogLevel; message: string; source: string; data: LogData };
type Destination = 'console' | 'file';
type OutputConfig = { enabled?: boolean; level?: LogThreshold; directory?: string; filename?: string };
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
        return DEFAULT_LOGGING_CONFIG as LoggingConfig;
    }
    return globalLoggingConfig;
}

let debugMode = false;

function getDebugMode() {
    return debugMode;
}

function setDebugMode(enabled: unknown) {
    if (typeof enabled === 'boolean') {
        debugMode = enabled;
        return;
    }

    if (typeof enabled === 'number') {
        debugMode = enabled !== 0;
        return;
    }

    if (typeof enabled === 'string') {
        const normalized = enabled.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
            debugMode = true;
            return;
        }
        if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off' || normalized === '') {
            debugMode = false;
            return;
        }
    }

    debugMode = !!enabled;
}

class UnifiedLogger implements AppLogger {
    config: LoggingConfig;
    outputs: { console: ConsoleOutputter; file: FileOutputter };
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
        this.outputs = {
            console: new ConsoleOutputter(),
            file: new FileOutputter(config.file)
        };
    }

    setOperatorCaptureEnabled(enabled: boolean): void {
        this.captureOperatorLogs = enabled;
    }

    getOperatorLogSource(): OperatorLogSource | null {
        return this.captureOperatorLogs ? this.operatorLogs : null;
    }

    log(level: LogLevel, message: unknown, source = 'system', data: LogData = null) {
        const shouldWriteConsole = this.shouldOutput(level, 'console');
        const shouldWriteFile = this.shouldOutput(level, 'file');
        if (!shouldWriteConsole && !shouldWriteFile) return;

        const timestamp = formatTimestampCompact(new Date());
        const safeMessage = typeof message === 'string' ? sanitizeLogText(message) : safeObjectStringify(message);
        const safeSource = typeof source === 'string' ? sanitizeLogText(source) : safeObjectStringify(source);
        const logEntry = { timestamp, level, message: safeMessage, source: safeSource, data };

        if (shouldWriteConsole) this.outputs.console.write(logEntry);
        if (shouldWriteFile) this.outputs.file.write(logEntry);
        if (shouldWriteConsole && this.captureOperatorLogs) {
            this.operatorLogs.append({
                timestamp,
                level,
                message: safeMessage,
                source: safeSource,
                data: sanitizeLogData(data) as JsonLogValue
            });
        }
    }

    shouldOutput(level: LogLevel, destination: Destination): boolean {
        const destinationConfig = this.config[destination] as OutputConfig | undefined;
        if (!destinationConfig || !destinationConfig.enabled) return false;
        if (destination === 'file' && !destinationConfig.directory) return false;
        if (level === 'console') return destination === 'console';
        if (level === 'debug' && getDebugMode()) return true;
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
        const { timestamp, level, message, source, data } = logEntry;
        let output: string;
        if (level === 'console') output = `[${timestamp}] ${message}`;
        else if (level === 'emergency') output = `[EMERGENCY] ${message}`;
        else output = `[${timestamp}] [${level.toUpperCase()}] [${source}] ${message}`;
        if (data && level !== 'console' && level !== 'emergency') output += ` | Data: ${safeObjectStringify(data)}`;
        if (level === 'error' || level === 'emergency') process.stderr.write(output + '\n');
        else process.stdout.write(output + '\n');
    }
}

class FileOutputter {
    config: OutputConfig;
    fileAppender: LineFileAppender | null;

    constructor(config: OutputConfig = {}) {
        this.config = config;
        const logDir = this.config.directory;
        this.fileAppender = this.config.enabled && logDir
            ? new LineFileAppender({ logDir, filename: this.config.filename || 'runtime.log' })
            : null;
    }

    write(logEntry: LogEntry) {
        if (!this.fileAppender) return;
        const { timestamp, level, message, source, data } = logEntry;
        let logLine = `[${timestamp}] [${level.toUpperCase()}] [${source}] ${message}`;
        if (data) logLine += ` | Data: ${safeObjectStringify(data)}`;
        this.fileAppender.log(logLine);
    }
}

let globalLogger: UnifiedLogger | null = null;

function getUnifiedLogger(): UnifiedLoggerFacade {
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
    getDebugMode,
    getLoggingConfig,
    getOperatorLogSource,
    getUnifiedLogger,
    initializeLoggingConfig,
    logger,
    setDebugMode
};
