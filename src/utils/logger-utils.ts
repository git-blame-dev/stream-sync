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
    if (obj instanceof Error) {
        return JSON.stringify({ message: obj.message, stack: obj.stack, name: obj.name }, null, 2);
    }
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
    
    try {
        return JSON.stringify(obj, (key, value) => {
            if (typeof value === 'object' && value !== null) {
                const stack = new Error().stack;
                const depth = (stack.match(/safeObjectStringify/g) || []).length;
                if (depth > maxDepth) {
                    return '[Object: max depth reached]';
                }
            }
            return value;
        });
    } catch (err) {
        if (err && err.message && err.message.includes('circular')) {
            return '[Object: circular reference detected]';
        }
        const constructorName = obj && obj.constructor && obj.constructor.name
            ? obj.constructor.name
            : 'Unknown';
        return `[Object: ${constructorName} - stringify failed${err && err.message ? `: ${err.message}` : ''}]`;
    }
}

module.exports = { 
    isDebugModeEnabled,
    getLazyLogger,
    getLazyUnifiedLogger,
    safeObjectStringify
};
