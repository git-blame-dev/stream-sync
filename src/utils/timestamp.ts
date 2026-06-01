type TimestampNumericUnit = 'milliseconds' | 'seconds' | 'microseconds';

interface TimestampParseOptions {
    allowDateString?: boolean;
    allowDateObject?: boolean;
    requirePositive?: boolean;
    requireIntegerNumericString?: boolean;
    numericUnit?: TimestampNumericUnit;
    inferSecondsBelow?: number;
    inferMicrosecondsThreshold?: number;
    inferMicrosecondsThresholdInclusive?: boolean;
    microsecondRounding?: 'floor' | 'round';
}

function isIsoTimestamp(value: unknown): boolean {
    if (typeof value !== 'string') {
        return false;
    }
    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
    if (!isoPattern.test(value)) {
        return false;
    }
    const parsed = Date.parse(value);
    return !Number.isNaN(parsed);
}

function getSystemTimestampISO(): string {
    // eslint-disable-next-line no-restricted-syntax -- canonical implementation
    return new Date().toISOString();
}

function parseNumericTimestamp(value: unknown, options: TimestampParseOptions): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const numericValue = Number(trimmed);
    if (!Number.isFinite(numericValue)) {
        return null;
    }

    if (options.requireIntegerNumericString && !Number.isInteger(numericValue)) {
        return null;
    }

    return numericValue;
}

function applyTimestampUnit(value: number, options: TimestampParseOptions): number {
    const microsecondRounding = options.microsecondRounding ?? 'floor';
    if (options.numericUnit === 'seconds') {
        return value * 1000;
    }
    if (options.numericUnit === 'microseconds') {
        return microsecondRounding === 'round'
            ? Math.round(value / 1000)
            : Math.floor(value / 1000);
    }
    if (options.numericUnit === 'milliseconds') {
        return value;
    }

    const inferSecondsBelow = options.inferSecondsBelow;
    if (inferSecondsBelow !== undefined && value < inferSecondsBelow) {
        return value * 1000;
    }

    const inferMicrosecondsThreshold = options.inferMicrosecondsThreshold;
    if (inferMicrosecondsThreshold !== undefined) {
        const isMicroseconds = options.inferMicrosecondsThresholdInclusive === true
            ? value >= inferMicrosecondsThreshold
            : value > inferMicrosecondsThreshold;
        if (isMicroseconds) {
            return microsecondRounding === 'round'
                ? Math.round(value / 1000)
                : Math.floor(value / 1000);
        }
    }

    return value;
}

function parseTimestampMs(value: unknown, options: TimestampParseOptions = {}): number | null {
    if (value instanceof Date) {
        if (!options.allowDateObject) {
            return null;
        }
        const dateMs = value.getTime();
        if (Number.isNaN(dateMs)) {
            return null;
        }
        return options.requirePositive === true && dateMs <= 0 ? null : dateMs;
    }

    const numericValue = parseNumericTimestamp(value, options);
    if (numericValue !== null) {
        if (options.requirePositive === true && numericValue <= 0) {
            return null;
        }
        return applyTimestampUnit(numericValue, options);
    }

    if (typeof value !== 'string' || options.allowDateString !== true) {
        return null;
    }

    const parsedDate = Date.parse(value.trim());
    if (Number.isNaN(parsedDate)) {
        return null;
    }

    if (options.requirePositive === true && parsedDate <= 0) {
        return null;
    }

    return parsedDate;
}

function parseTimestampISO(value: unknown, options: TimestampParseOptions = {}): string | null {
    const millis = parseTimestampMs(value, options);
    if (millis === null) {
        return null;
    }

    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export type { TimestampNumericUnit, TimestampParseOptions };
export { isIsoTimestamp, getSystemTimestampISO, parseTimestampMs, parseTimestampISO };
