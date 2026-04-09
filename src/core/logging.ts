import { createRequire } from 'node:module';

import { DEFAULT_LOGGING_CONFIG } from './config-builders';
import { safeObjectStringify } from '../utils/logger-utils';

const nodeRequire = createRequire(import.meta.url);
const { formatTimestampCompact } = nodeRequire('../utils/text-processing') as {
    formatTimestampCompact: (date: Date) => string;
};
const { FileLogger } = nodeRequire('../utils/file-logger') as {
    FileLogger: new (options: { logDir: string; filename: string }) => {
        log: (line: string) => void;
    };
};

const LOG_LEVELS = ['debug', 'info', 'console', 'warn', 'error', 'emergency'];

type LogLevel = 'debug' | 'info' | 'console' | 'warn' | 'error' | 'emergency';
type LogData = unknown;
type LogEntry = { timestamp: string; level: LogLevel; message: string; source: string; data: LogData };
type Destination = 'console' | 'file';
type OutputConfig = { enabled?: boolean; level?: LogLevel; directory?: string; filename?: string };
type LoggingConfig = { console?: OutputConfig; file?: OutputConfig; [key: string]: unknown };

let globalLoggingConfig: LoggingConfig | null = null;

function initializeLoggingConfig(appConfig: { logging?: LoggingConfig }) {
    globalLoggingConfig = appConfig.logging || null;
    return globalLoggingConfig;
}

function getLoggingConfig(): LoggingConfig {
    if (!globalLoggingConfig) {
        return DEFAULT_LOGGING_CONFIG as unknown as LoggingConfig;
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

class UnifiedLogger {
    config: LoggingConfig;
    outputs: { console: ConsoleOutputter; file: FileOutputter };

    constructor(config: LoggingConfig = {}) {
        this.config = config;
        this.outputs = {
            console: new ConsoleOutputter(),
            file: new FileOutputter(config.file)
        };
    }
    
    log(level: LogLevel, message: unknown, source = 'system', data: LogData = null) {
        const timestamp = formatTimestampCompact(new Date());
        const safeMessage = typeof message === 'string' ? message : safeObjectStringify(message);
        const safeSource = typeof source === 'string' ? source : safeObjectStringify(source);
        
        const logEntry = {
            timestamp,
            level,
            message: safeMessage,
            source: safeSource,
            data
        };
        
        if (this.shouldOutput(level, 'console')) {
            this.outputs.console.write(logEntry);
        }
        
        if (this.shouldOutput(level, 'file')) {
            this.outputs.file.write(logEntry);
        }
    }
    
    shouldOutput(level: LogLevel, destination: Destination): boolean {
        const destinationConfig = this.config[destination] as OutputConfig | undefined;
        if (!destinationConfig || !destinationConfig.enabled) return false;
        if (destination === 'file' && !destinationConfig.directory) {
            return false;
        }
        
        if (destination === 'console' && (level === 'console' || level === 'warn' || level === 'error')) {
            return true;
        }
        
        if (level === 'debug' && getDebugMode()) {
            return true;
        }
        
        const messageLevel = LOG_LEVELS.indexOf(level);
        const configLevel = LOG_LEVELS.indexOf(destinationConfig.level || 'info');
        return messageLevel >= configLevel;
    }
    
    info(message: unknown, source = 'system', data: LogData = null) {
        this.log('info', message, source, data);
    }
    
    warn(message: unknown, source = 'system', data: LogData = null) {
        this.log('warn', message, source, data);
    }
    
    error(message: unknown, source = 'system', data: LogData = null) {
        this.log('error', message, source, data);
    }
    
    debug(message: unknown, source = 'system', data: LogData = null) {
        this.log('debug', message, source, data);
    }

    emergency(message: unknown, source = 'system', data: LogData = null) {
        this.log('emergency', message, source, data);
    }

    console(message: unknown, source = 'system', data: LogData = null) {
        this.log('console', message, source, data);
    }
}

class ConsoleOutputter {
    write(logEntry: LogEntry) {
        const { timestamp, level, message, source, data } = logEntry;
        let output;
        if (level === 'console') {
            output = `[${timestamp}] ${message}`;
        } else if (level === 'emergency') {
            output = `[EMERGENCY] ${message}`;
        } else {
            output = `[${timestamp}] [${level.toUpperCase()}] [${source}] ${message}`;
        }
        if (data && level !== 'console' && level !== 'emergency') {
            output += ` | Data: ${safeObjectStringify(data)}`;
        }
        if (level === 'error' || level === 'emergency') {
            process.stderr.write(output + '\n');
        } else {
            process.stdout.write(output + '\n');
        }
    }
}

class FileOutputter {
    config: OutputConfig;
    fileLogger: InstanceType<typeof FileLogger> | null;

    constructor(config: OutputConfig = {}) {
        this.config = config;
        const logDir = this.config.directory;
        if (!this.config.enabled || !logDir) {
            this.fileLogger = null;
            return;
        }

        this.fileLogger = new FileLogger({
            logDir,
            filename: this.config.filename || 'runtime.log'
        });
    }
    
    write(logEntry: LogEntry) {
        if (!this.fileLogger) {
            return;
        }
        const { timestamp, level, message, source, data } = logEntry;
        
        let logLine = `[${timestamp}] [${level.toUpperCase()}] [${source}] ${message}`;
        
        if (data) {
            logLine += ` | Data: ${safeObjectStringify(data)}`;
        }
        
        this.fileLogger.log(logLine);
    }
}

let globalLogger: UnifiedLogger | null = null;

function getUnifiedLogger() {
    if (!globalLogger) {
        const config = getLoggingConfig();
        globalLogger = new UnifiedLogger(config);
    }
    return globalLogger;
}

const logger = new Proxy<Record<string, unknown>>(
    {},
    {
        get(_target, prop) {
            const resolvedLogger = getUnifiedLogger() as unknown as Record<string, unknown>;
            const value = resolvedLogger[prop as keyof typeof resolvedLogger];
            if (typeof value === 'function') {
                return value.bind(resolvedLogger);
            }
            return value;
        }
    }
) as unknown as UnifiedLogger;

export {
    logger,
    getUnifiedLogger,
    initializeLoggingConfig,
    getLoggingConfig,
    getDebugMode,
    setDebugMode
};
