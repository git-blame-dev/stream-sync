function isDebugModeEnabled() {
    return process.argv.includes('--debug') || process.env.EMERGENCY_DEBUG === '1';
}

let _unifiedLogger = null;
let _logger = null;

const getLazyLogger = () => {
    if (!_logger) {
        _logger = require('../core/logging').logger;
    }
    return _logger;
};

const getLazyUnifiedLogger = () => {
    if (!_unifiedLogger) {
        _unifiedLogger = require('../core/logging').getUnifiedLogger();
    }
    return _unifiedLogger;
};

function safeObjectStringify(obj, maxDepth = 3) {
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
    } catch (error) {
        // Fallback for circular references or other JSON.stringify errors
        if (error.message.includes('circular')) {
            return '[Object: circular reference detected]';
        }
        // For any other errors, return a safe representation
        return `[Object: ${obj.constructor?.name || 'Unknown'} - stringify failed]`;
    }
}

function formatLogParams(...params) {
    return params.map(param => {
        if (typeof param === 'string') return param;
        return safeObjectStringify(param);
    }).join(' ');
}

const noopLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
};

function createNoopLogger() {
    return noopLogger;
}

function getLoggerOrNoop(logger) {
    return logger || noopLogger;
}

module.exports = { 
    isDebugModeEnabled,
    getLazyLogger,
    getLazyUnifiedLogger,
    safeObjectStringify,
    formatLogParams,
    createNoopLogger,
    getLoggerOrNoop
}; 
