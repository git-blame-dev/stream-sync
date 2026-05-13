import type { LogLevel, LogThreshold } from './types';

const LOG_THRESHOLDS: readonly LogThreshold[] = ['debug', 'info', 'warn', 'error'];

function isLogThreshold(value: unknown): value is LogThreshold {
    return typeof value === 'string' && (LOG_THRESHOLDS as readonly string[]).includes(value);
}

function shouldLogAtThreshold(level: LogLevel, threshold: LogThreshold): boolean {
    if (level === 'console') {
        return false;
    }

    if (level === 'emergency') {
        return true;
    }

    return LOG_THRESHOLDS.indexOf(level) >= LOG_THRESHOLDS.indexOf(threshold);
}

export { LOG_THRESHOLDS, isLogThreshold, shouldLogAtThreshold };
