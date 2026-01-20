
const fs = require('fs');
const path = require('path');
const { formatTimestampCompact } = require('../utils/text-processing');
const { FileLogger } = require('../utils/file-logger');

function safeObjectStringify(obj, maxDepth = 3) {
    if (obj instanceof Error) {
        return JSON.stringify({ message: obj.message, stack: obj.stack, name: obj.name }, null, 2);
    }
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
    
    try {
        // Use JSON.stringify with replacer to handle circular references and depth
        return JSON.stringify(obj, (key, value) => {
            // Handle circular references
            if (typeof value === 'object' && value !== null) {
                // Simple depth tracking using stack inspection
                const stack = new Error().stack;
                const depth = (stack.match(/safeObjectStringify/g) || []).length;
                if (depth > maxDepth) {
                    return '[Object: max depth reached]';
                }
            }
            return value;
        });
    } catch (err) {
        // Fallback for circular references or other JSON.stringify errors
        if (err && err.message && err.message.includes('circular')) {
            return '[Object: circular reference detected]';
        }
        // For any other errors, return a safe representation
        const constructorName = obj && obj.constructor && obj.constructor.name
            ? obj.constructor.name
            : 'Unknown';
        return `[Object: ${constructorName} - stringify failed${err && err.message ? `: ${err.message}` : ''}]`;
    }
}

// Config validation function - should be injected by the application
let validateLoggingConfig = null;

// Default test config - used when running in test environment without explicit initialization
const DEFAULT_TEST_CONFIG = {
    console: { enabled: false },
    file: { enabled: false, directory: './logs' },
    debug: { enabled: false },
    platforms: { tiktok: { enabled: true }, twitch: { enabled: true }, youtube: { enabled: true } },
    chat: { enabled: false, separateFiles: true, directory: './logs' }
};

function setConfigValidator(validator) {
    if (typeof validator === 'function') {
        validateLoggingConfig = validator;
    } else {
        throw new Error('Config validator must be a function');
    }
}

function getValidateLoggingConfig() {
    if (!validateLoggingConfig) {
        if (process.env.NODE_ENV === 'test') {
            validateLoggingConfig = () => DEFAULT_TEST_CONFIG;
            return validateLoggingConfig;
        }
        throw new Error('Logging config validator not set. Call setConfigValidator() before using logging system.');
    }
    return validateLoggingConfig;
}

// Global logging configuration
let globalLoggingConfig = null;

function initializeLoggingConfig(appConfig) {
    const validateFn = getValidateLoggingConfig();
    globalLoggingConfig = validateFn(appConfig);
    return globalLoggingConfig;
}

function getLoggingConfig() {
    if (!globalLoggingConfig) {
        const validateFn = getValidateLoggingConfig();
        if (typeof validateFn !== 'function') {
            // Use process.stderr.write for critical system messages to avoid circular dependency
            process.stderr.write(`validateLoggingConfig is not a function: ${typeof validateFn}\n`);
            // Fallback to default config
            return {
                console: { enabled: true, level: 'info' },
                file: { enabled: true, level: 'debug', directory: './logs' },
                debug: { enabled: false },
                platforms: { twitch: { enabled: true }, youtube: { enabled: true }, tiktok: { enabled: true } },
                chat: { enabled: true, separateFiles: true, directory: './logs' }
            };
        }
        return validateFn();
    }
    return globalLoggingConfig;
}

const loggingConfig = {
    debugMode: false,
};

function getDebugMode() {
    return loggingConfig.debugMode;
}

function setDebugMode(enabled) {
    loggingConfig.debugMode = !!enabled;
}

// Store original console functions at module level for console override pattern
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

let consoleOverrideEnabled = false;
let programLogInitialized = false;

function ensureLogDirectory(dirPath) {
    if (!dirPath) {
        return false;
    }
    const logPath = dirPath;

    try {
        if (!fs.existsSync(logPath)) {
            fs.mkdirSync(logPath, { recursive: true });
        }
        return true;
    } catch (err) {
        // Use original console.error to avoid recursive calls, but only if not in test environment
        if (process.env.NODE_ENV !== 'test') {
            try {
                originalConsoleError(`[Logging System] Error creating log directory: ${err && err.message ? err.message : 'Unknown error'}`);
            } catch {
                // Ignore console errors in test environment to prevent EPIPE
            }
        }
        return false;
    }
}

function getFileLogDirectory() {
    let config;
    try {
        config = getLoggingConfig();
    } catch {
        return null;
    }

    if (!config || !config.file || !config.file.enabled) {
        return null;
    }

    return config.file.directory || null;
}

function getChatLogDirectory() {
    let config;
    try {
        config = getLoggingConfig();
    } catch {
        return null;
    }

    if (!config || !config.file || !config.file.enabled) {
        return null;
    }
    if (!config.chat || !config.chat.enabled || !config.chat.separateFiles) {
        return null;
    }

    return config.chat.directory || null;
}

function logProgram(message) {
    const logDir = getFileLogDirectory();
    if (!logDir) {
        return;
    }

    // Initialize program log directory if not already done
    if (!programLogInitialized) {
        if (!ensureLogDirectory(logDir)) {
            return;
        }
        programLogInitialized = true;
    }
    
    // Check if message already contains a timestamp (to avoid double timestamps)
    // This regex matches both ISO timestamps and the format used by UnifiedLogger
    const hasTimestamp = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]|^\[\d{2}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\]/.test(message);
    
    let logEntry;
    if (hasTimestamp) {
        // Message already has timestamp, just add newline
        logEntry = `${message}\n`;
    } else {
        // Add timestamp to message
        const timestamp = formatTimestamp();
        logEntry = `[${timestamp}] ${message}\n`;
    }
    
    try {
        // Write to program log file synchronously to ensure immediate persistence
        fs.appendFileSync(path.join(logDir, 'program-log.txt'), logEntry);
    } catch (err) {
        // Use original console.error to avoid recursive calls, but only if not in test environment
        if (process.env.NODE_ENV !== 'test') {
            try {
                originalConsoleError(`[Logging System] Error writing to program log: ${err && err.message ? err.message : 'Unknown error'}`);
            } catch {
                // Ignore console errors in test environment to prevent EPIPE
            }
        }
    }
}

function initializeConsoleOverride() {
    if (consoleOverrideEnabled) {
        return; // Already initialized
    }
    
    // Override console.log to include file logging
    console.log = function(...args) {
        // Call original console.log first
        originalConsoleLog.apply(console, args);
        
        // Then log to file
        logProgram(args.join(' '));
    };
    
    // Override console.error to include file logging
    console.error = function(...args) {
        // Call original console.error first
        originalConsoleError.apply(console, args);
        
        // Then log to file with ERROR prefix
        logProgram(`ERROR: ${args.join(' ')}`);
    };
    
    consoleOverrideEnabled = true;
    
    // Log initialization (using original console to avoid recursion during startup)
}

function restoreConsole() {
    if (!consoleOverrideEnabled) {
        return; // Already restored
    }
    
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    consoleOverrideEnabled = false;
    
    // Log restoration using original console
    originalConsoleLog('[Logging System] Console override restored to original functions');
}

function isConsoleOverrideEnabled() {
    return consoleOverrideEnabled;
}



class UnifiedLogger {
    constructor(config = {}, dependencies = {}) {
        this.config = config;
        this.outputs = {
            console: new ConsoleOutputter(),
            file: new FileOutputter(config.file)
        };
        
    }
    
    ensureLogDirectory() {
        const logPath = this.config && this.config.file
            ? this.config.file.directory
            : null;
        if (!logPath) {
            return;
        }
        if (!fs.existsSync(logPath)) {
            fs.mkdirSync(logPath, { recursive: true });
        }
    }
    
    log(level, message, source = 'system', data = null) {
        const timestamp = formatTimestamp();
        
        // Ensure message is always a string
        const safeMessage = typeof message === 'string' ? message : safeObjectStringify(message);
        
        // Ensure source is always a string
        const safeSource = typeof source === 'string' ? source : safeObjectStringify(source);
        
        const logEntry = {
            timestamp,
            level,
            message: safeMessage,
            source: safeSource,
            data,
            debugMode: getDebugMode()
        };
        
        // Output to configured destinations
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
        
        // Always show 'console', 'warn', and 'error' on the console
        if (destination === 'console' && (level === 'console' || level === 'warn' || level === 'error')) {
            return true;
        }
        
        // If debug mode is enabled globally, show all debug logs
        if (level === 'debug' && getDebugMode()) {
            return true;
        }
        
        const levels = ['debug', 'info', 'console', 'warn', 'error', 'emergency'];
        const messageLevel = levels.indexOf(level);
        const configLevel = levels.indexOf(config.level || 'info');
        return messageLevel >= configLevel;
    }
    
    // Standard logging methods with consistent parameter order
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
        // Write directly to process.stdout/stderr to bypass console override and avoid double timestamps
        if (level === 'error' || level === 'emergency') {
            process.stderr.write(output + '\n');
        } else {
            process.stdout.write(output + '\n');
        }
        

    }
}

class FileOutputter {
    constructor(config) {
        this.config = config || {};
        const logDir = this.config.directory;
        if (!this.config.enabled || !logDir) {
            this.fileLogger = null;
            return;
        }

        this.fileLogger = new FileLogger({
            logDir,
            filename: this.config.filename || 'runtime.log',
            maxSize: this.config.maxSize ?? 10 * 1024 * 1024, // 10MB
            maxFiles: this.config.maxFiles ?? 5
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



// Global logger instance
let globalLogger = null;

function initializeUnifiedLogger(config, dependencies = {}) {
    if (!globalLogger) {
        globalLogger = new UnifiedLogger(config, dependencies);
    }
    return globalLogger;
}

function getUnifiedLogger() {
    if (!globalLogger) {
        const config = getLoggingConfig();
        globalLogger = new UnifiedLogger(config, {});
    }
    return globalLogger;
}

function getLogger() {
    return getUnifiedLogger();
}

function sanitizeUsername(username) {
    if (!username) return '';
    
    // Remove invalid Windows filename characters and control characters
    return username
        .replace(/[<>:"|?*\\/]/g, '') // Remove invalid Windows characters
        .replace(/[\x00-\x1f\x7f]/g, '') // Remove control characters
        .replace(/\s+/g, '_') // Replace spaces with underscores
        .substring(0, 50); // Limit length to prevent extremely long filenames
}

function formatPlatformName(platform) {
    if (!platform) return 'unknown';
    
    const platformMap = {
        'twitch': 'Twitch',
        'youtube': 'YouTube',
        'tiktok': 'TikTok',
        'streamelements': 'StreamElements'
    };
    
    return platformMap[platform.toLowerCase()] || platform;
}

function logChatMessagePlatform(timestamp, username, message, platform) {
    const logger = getUnifiedLogger();
    const platformName = formatPlatformName(platform);
    
    logger.info(
        `Chat: ${username}: ${message}`,
        platformName,
        {
            username,
            message,
            timestamp,
            platform
        }
    );
}

function logChatMessage(platform, username, message, timestamp = null, options = {}) {
    const logger = getUnifiedLogger();
    const platformName = formatPlatformName(platform);
    const msgTimestamp = timestamp || new Date().toISOString();
    
    // Log to main log file
    logger.info(
        `Chat: ${username}: ${message}`,
        platformName,
        {
            username,
            message,
            timestamp: msgTimestamp,
            platform,
            ...options
        }
    );
    
    // Always log to platform-specific chat file
    logChatMessageToFile(platform, username, message, msgTimestamp);
}

function logChatMessageToFile(platform, username, message, timestamp) {
    try {
        const logDir = getChatLogDirectory();
        if (!logDir) {
            return;
        }
        if (!ensureLogDirectory(logDir)) {
            return;
        }
        
        // Sanitize username for filename
        const sanitizedUsername = sanitizeUsername(username);
        if (!sanitizedUsername) {
            return;
        }
        
        // Create platform-specific filename
        const filename = `${platform}-chat-${sanitizedUsername}.txt`;
        const filepath = path.join(logDir, filename);
        
        // Format log entry
        const logEntry = `[${timestamp}] ${username}: ${message}\n`;
        
        // Write to platform-specific file
        fs.appendFileSync(filepath, logEntry);
        
    } catch (err) {
        // Use original console.error to avoid recursive calls
        originalConsoleError(`[Logging System] Error writing chat message to file: ${err && err.message ? err.message : 'Unknown error'}`);
    }
}

function formatTimestamp(date = new Date()) {
    return formatTimestampCompact(date);
}

// Export unified logging interface
module.exports = {
    // Main logger instance (lazy-loaded)
    get logger() { return getUnifiedLogger(); },
    
    // Factory functions
    getLogger,
    getUnifiedLogger,
    initializeUnifiedLogger,
    
    // Configuration
    initializeLoggingConfig,
    getLoggingConfig,
    setConfigValidator,
    
    // Debug mode
    getDebugMode,
    setDebugMode,
    
    // Console override
    initializeConsoleOverride,
    restoreConsole,
    isConsoleOverrideEnabled,
    ensureLogDirectory,
    logProgram,
    
    // Chat logging
    logChatMessage,
    logChatMessagePlatform,
    
    // Utility functions
    formatPlatformName,
    formatTimestamp,
    sanitizeUsername,
    safeObjectStringify
};
