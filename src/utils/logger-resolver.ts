import { getUnifiedLogger, logger as globalLogger } from '../core/logging';
import type { AppLogger, LogMethod } from '../core/logger/types';
import { validateLoggerInterface } from './dependency-validator';

type LoggerRecord = Record<string, unknown>;
const REQUIRED_LOGGER_METHODS = ['debug', 'info', 'warn', 'error'] as const;

type NormalizedLogger = LoggerRecord & AppLogger;

function isLoggerRecord(candidate: unknown): candidate is LoggerRecord {
    return typeof candidate === 'object' && candidate !== null;
}

function isLoggerMethod(value: unknown): value is LogMethod {
    return typeof value === 'function';
}

function assertLoggerMethods(logger: LoggerRecord, moduleName: string): asserts logger is NormalizedLogger {
    const missingMethods = REQUIRED_LOGGER_METHODS.filter((method) => !isLoggerMethod(logger[method]));
    if (missingMethods.length > 0) {
        throw new Error(`${moduleName} logger is missing required methods: ${missingMethods.map((method) => `${method}()`).join(', ')}`);
    }
}

function normalizeLoggerMethods(logger: LoggerRecord, moduleName = 'logger'): NormalizedLogger {
    assertLoggerMethods(logger, moduleName);
    return logger;
}

function gatherCandidates(candidate: unknown): unknown[] {
    const candidates: unknown[] = [];

    if (candidate) {
        candidates.push(candidate);
    }

    try {
        const unifiedLogger = getUnifiedLogger();
        if (unifiedLogger) {
            candidates.push(unifiedLogger);
        }

        if (globalLogger) {
            candidates.push(globalLogger);
        }
    } catch {
        return candidates;
    }

    return candidates;
}

function resolveLogger(candidate: unknown = null, moduleName = 'logger'): NormalizedLogger {
    if (candidate !== null && candidate !== undefined && !isLoggerRecord(candidate)) {
        throw new Error(`${moduleName} logger dependency must be an object, received ${typeof candidate}`);
    }

    const candidates = gatherCandidates(candidate);
    const selectedCandidate = candidates.find(isLoggerRecord);
    if (!selectedCandidate) {
        throw new Error(`${moduleName} requires a logger dependency`);
    }

    const normalizedLogger = normalizeLoggerMethods(selectedCandidate, moduleName);
    validateLoggerInterface(normalizedLogger);
    return normalizedLogger;
}

export {
    normalizeLoggerMethods,
    resolveLogger
};
