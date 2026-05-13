import * as loggingModule from '../core/logging';

type LoggerModule = {
    logger: unknown;
    getUnifiedLogger: () => unknown;
};

function getLoggingModule(): LoggerModule {
    return loggingModule as LoggerModule;
}

function isDebugModeEnabled() {
    return process.argv.includes('--debug') || process.env.EMERGENCY_DEBUG === '1';
}

let _unifiedLogger: unknown = null;
let _logger: unknown = null;

const getLazyLogger = () => {
    if (!_logger) {
        _logger = getLoggingModule().logger;
    }
    return _logger;
};

const getLazyUnifiedLogger = () => {
    if (!_unifiedLogger) {
        _unifiedLogger = getLoggingModule().getUnifiedLogger();
    }
    return _unifiedLogger;
};

export {
    isDebugModeEnabled,
    getLazyLogger,
    getLazyUnifiedLogger
};
