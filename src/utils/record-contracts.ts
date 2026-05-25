export type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toRecord(value: unknown): UnknownRecord | null {
    return isRecord(value) ? value : null;
}

function asRecord(value: unknown): UnknownRecord | null {
    return toRecord(value);
}

function getString(record: UnknownRecord, key: string): string | null {
    const value = record[key];
    return typeof value === 'string' ? value : null;
}

function getNumber(record: UnknownRecord, key: string): number | null {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getBoolean(record: UnknownRecord, key: string): boolean | null {
    const value = record[key];
    return typeof value === 'boolean' ? value : null;
}

function getArray(record: UnknownRecord, key: string): readonly unknown[] | null {
    const value = record[key];
    return Array.isArray(value) ? value : null;
}

function getRecord(record: UnknownRecord, key: string): UnknownRecord | null {
    return toRecord(record[key]);
}

function stringifyPrimitive(value: string | number | boolean | bigint | symbol): string {
    try {
        return String(value);
    } catch {
        return '[unprintable value]';
    }
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message || error.name || 'Unknown error';
    }

    if (error === null) {
        return 'null';
    }

    if (error === undefined) {
        return 'undefined';
    }

    switch (typeof error) {
        case 'string':
        case 'number':
        case 'boolean':
        case 'bigint':
        case 'symbol':
            return stringifyPrimitive(error);
        default:
            break;
    }

    const record = toRecord(error);
    if (record) {
        const message = getString(record, 'message');
        if (message) {
            return message;
        }

        const errorMessage = getString(record, 'error');
        if (errorMessage) {
            return errorMessage;
        }
    }

    return 'Unknown error';
}

function getErrorDetails(error: unknown): UnknownRecord {
    const message = getErrorMessage(error);

    if (error instanceof Error) {
        return omitUndefined({
            message,
            name: error.name || undefined,
            cause: error.cause === undefined ? undefined : getErrorMessage(error.cause),
        });
    }

    const record = toRecord(error);
    if (record) {
        return omitUndefined({
            message,
            name: getString(record, 'name') ?? undefined,
            code: getString(record, 'code') ?? getNumber(record, 'code') ?? undefined,
            statusCode: getNumber(record, 'statusCode') ?? undefined,
        });
    }

    return { message };
}

function omitUndefined(record: UnknownRecord): UnknownRecord {
    return Object.fromEntries(
        Object.entries(record).filter(([, value]) => value !== undefined),
    );
}

export {
    asRecord,
    getArray,
    getBoolean,
    getErrorDetails,
    getErrorMessage,
    getNumber,
    getRecord,
    getString,
    isRecord,
    omitUndefined,
    toRecord
};
