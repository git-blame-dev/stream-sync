const { formatTimestampCompact } = require('../utils/text-processing');
const { safeObjectStringify } = require('../utils/logger-utils');
const { FileLogger } = require('../utils/file-logger');

let globalLoggingConfig = null;

function initializeLoggingConfig(appConfig) {
    globalLoggingConfig = appConfig.logging;
    return globalLoggingConfig;
}

function getLoggingConfig() {
    if (!globalLoggingConfig) {
        const { DEFAULT_LOGGING_CONFIG } = require('./config-builders');
        return DEFAULT_LOGGING_CONFIG;
    }
    return globalLoggingConfig;
}

let debugMode = false;

function getDebugMode() {
    return debugMode;
}

function setDebugMode(enabled) {
    debugMode = !!enabled;
}

class UnifiedLogger {
    constructor(config = {}) {
        this.config = config;
        this.outputs = {
            console: new ConsoleOutputter(),
            file: new FileOutputter(config.file)
        };
    }
    
    log(level, message, source = 'system', data = null) {
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
        
        if (this.outputs.console && this.shouldOutput(level, 'console')) {
            this.outputs.console.write(logEntry);
        }
        
        if (this.outputs.file && this.shouldOutput(level, 'file')) {
            this.outputs.file.write(logEntry);
        }
    }
    
    shouldOutput(level, destination) {
        const config = this.config[destination];
        if (!config || !config.enabled) return false;
        if (destination === 'file' && !config.directory) {
            return false;
        }
        
        if (destination === 'console' && (level === 'console' || level === 'warn' || level === 'error')) {
            return true;
        }
        
        if (level === 'debug' && getDebugMode()) {
            return true;
        }
        
        const levels = ['debug', 'info', 'console', 'warn', 'error', 'emergency'];
        const messageLevel = levels.indexOf(level);
        const configLevel = levels.indexOf(config.level || 'info');
        return messageLevel >= configLevel;
    }
    
    info(message, source = 'system', data = null) {
        this.log('info', message, source, data);
    }
    
    warn(message, source = 'system', data = null) {
        this.log('warn', message, source, data);
    }
    
    error(message, source = 'system', data = null) {
        this.log('error', message, source, data);
    }
    
    debug(message, source = 'system', data = null) {
        this.log('debug', message, source, data);
    }

    emergency(message, source = 'system', data = null) {
        this.log('emergency', message, source, data);
    }

    console(message, source = 'system', data = null) {
        this.log('console', message, source, data);
    }
}

class ConsoleOutputter {
    write(logEntry) {
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
    constructor(config) {
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
    
    write(logEntry) {
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

let globalLogger = null;

function getUnifiedLogger() {
    if (!globalLogger) {
        const config = getLoggingConfig();
        globalLogger = new UnifiedLogger(config);
    }
    return globalLogger;
}

module.exports = {
    get logger() { return getUnifiedLogger(); },
    getUnifiedLogger,
    initializeLoggingConfig,
    getLoggingConfig,
    getDebugMode,
    setDebugMode
};
