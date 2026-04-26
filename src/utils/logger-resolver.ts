import { validateLoggerInterface } from './dependency-validator';

type LoggerMethod = (message: unknown, source?: string, data?: unknown) => void;
type LoggerRecord = Record<string, unknown>;
const REQUIRED_LOGGER_METHODS = ['debug', 'info', 'warn', 'error', 'console'] as const;

type NormalizedLogger = LoggerRecord & {
    debug: LoggerMethod;
    info: LoggerMethod;
    warn: LoggerMethod;
    error: LoggerMethod;
    console: LoggerMethod;
};

function isLoggerRecord(candidate: unknown): candidate is LoggerRecord {
    return typeof candidate === 'object' && candidate !== null;
}

function normalizeLoggerMethods(logger: LoggerRecord): NormalizedLogger {
    const normalized = Object.assign(Object.create(Object.getPrototypeOf(logger)), logger) as LoggerRecord;

    for (const method of REQUIRED_LOGGER_METHODS) {
        if (typeof normalized[method] !== 'function') {
            normalized[method] = () => {};
        }
    }

    return normalized as NormalizedLogger;
}

function gatherCandidates(candidate: unknown): unknown[] {
    const candidates: unknown[] = [];

    if (candidate) {
        candidates.push(candidate);
    }

    try {
        const loggingModule = require('../core/logging') as {
            getUnifiedLogger?: () => unknown;
            logger?: unknown;
        };

        if (loggingModule.getUnifiedLogger) {
            const unifiedLogger = loggingModule.getUnifiedLogger();
            if (unifiedLogger) {
                candidates.push(unifiedLogger);
            }
        }

        if (loggingModule.logger) {
            candidates.push(loggingModule.logger);
        }
    } catch {
        return candidates;
    }

    return candidates;
}

function resolveLogger(candidate: unknown = null, moduleName = 'logger'): NormalizedLogger {
    const candidates = gatherCandidates(candidate);
    const selectedCandidate = candidates.find(isLoggerRecord);
    if (!selectedCandidate) {
        throw new Error(`${moduleName} requires a logger dependency`);
    }

    const normalizedLogger = normalizeLoggerMethods(selectedCandidate);
    validateLoggerInterface(normalizedLogger);
    return normalizedLogger;
}

export {
    normalizeLoggerMethods,
    resolveLogger
};
