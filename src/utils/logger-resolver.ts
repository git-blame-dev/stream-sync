import { validateLoggerInterface } from './dependency-validator';

type LoggerMethod = (message: unknown, source?: string, data?: unknown) => void;

type NormalizedLogger = Record<string, unknown> & {
    debug: LoggerMethod;
    info: LoggerMethod;
    warn: LoggerMethod;
    error: LoggerMethod;
    console: LoggerMethod;
};

function normalizeLoggerMethods(logger: Record<string, unknown>): NormalizedLogger {
    const requiredMethods = ['debug', 'info', 'warn', 'error', 'console'] as const;
    const normalized = Object.assign(Object.create(Object.getPrototypeOf(logger)), logger) as Record<string, unknown>;

    for (const method of requiredMethods) {
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
    const selectedCandidate = candidates.find(Boolean);
    if (!selectedCandidate || typeof selectedCandidate !== 'object') {
        throw new Error(`${moduleName} requires a logger dependency`);
    }

    const normalizedLogger = normalizeLoggerMethods(selectedCandidate as Record<string, unknown>);
    validateLoggerInterface(normalizedLogger);
    return normalizedLogger;
}

export {
    normalizeLoggerMethods,
    resolveLogger
};
