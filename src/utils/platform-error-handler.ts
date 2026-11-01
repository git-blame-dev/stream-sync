import { logger as globalLogger } from '../core/logging';
import type { AppLogger } from '../core/logger/types';
import { sanitizeLogText } from '../core/logger/safe-log-serializer';
import {
    getErrorDetails,
    getErrorMessage,
    isRecord,
    omitUndefined,
    toRecord,
    type UnknownRecord,
} from './record-contracts';

type LoggerLike = Pick<AppLogger, 'warn' | 'error'>;
const REQUIRED_PLATFORM_ERROR_LOGGER_METHODS = ['warn', 'error'] as const;

function hasErrorLogger(logger: unknown): logger is LoggerLike {
    return isRecord(logger)
        && REQUIRED_PLATFORM_ERROR_LOGGER_METHODS.every((method) => typeof logger[method] === 'function');
}

function assertErrorLogger(logger: unknown, platformName: string): asserts logger is LoggerLike {
    if (!hasErrorLogger(logger)) {
        const loggerRecord = toRecord(logger) ?? {};
        const missingMethods = REQUIRED_PLATFORM_ERROR_LOGGER_METHODS.filter((method) => typeof loggerRecord[method] !== 'function');
        throw new Error(`${platformName} requires a logger dependency with ${missingMethods.map((method) => `${method}()`).join(', ')}`);
    }
}

function resolveErrorLogger(logger: unknown, platformName: string): LoggerLike {
    if (logger === null || logger === undefined) {
        return globalLogger;
    }

    assertErrorLogger(logger, platformName);
    return logger;
}

function resolveErrorMessage(error: unknown): string {
    return sanitizeDiagnosticText(getErrorMessage(error));
}

function sanitizeDiagnosticText(text: string): string {
    return sanitizeLogText(text).slice(0, 4096);
}

function sanitizeErrorDetails(error: unknown): UnknownRecord {
    const record = toRecord(error);
    // Select scalar diagnostics only: Error's details otherwise include its cause.
    const details = getErrorDetails({
        message: getErrorMessage(error),
        name: record?.name,
        code: record?.code,
        statusCode: record?.statusCode,
    });
    return Object.fromEntries(
        Object.entries(details).map(([key, value]) => [
            key,
            typeof value === 'string' ? sanitizeDiagnosticText(value) : value,
        ]),
    );
}

function buildErrorMetadata(error: unknown): UnknownRecord {
    const errorDetails = sanitizeErrorDetails(error);
    return omitUndefined({
        error: resolveErrorMessage(error),
        errorType: errorDetails.name,
        errorDetails,
    });
}

function summarizeEventData(eventData: unknown): UnknownRecord | null {
    const eventRecord = toRecord(eventData);
    if (!eventRecord) {
        if (Array.isArray(eventData)) {
            return {
                fieldCount: eventData.length,
                hasMessage: false,
                hasRawData: false,
                hasPayload: false,
            };
        }

        return null;
    }

    const keys = Object.keys(eventRecord).sort();
    return {
        fieldCount: keys.length,
        hasMessage: keys.includes('message'),
        hasRawData: keys.includes('rawData'),
        hasPayload: keys.includes('payload')
    };
}

function isCuratedOperationalSummaryKey(key: string): boolean {
    return /^(?:has[A-Z][A-Za-z0-9]*|is[A-Z][A-Za-z0-9]*|[a-z][A-Za-z0-9]*Present|fieldCount|error|errorType|statusCode|code)$/.test(key);
}

function summarizeCuratedOperationalPayload(payload: UnknownRecord): UnknownRecord | null {
    const entries = Object.entries(payload);
    if (!entries.every(([key]) => isCuratedOperationalSummaryKey(key))) {
        return null;
    }
    if (!entries.every(([, value]) => value === null || ['boolean', 'number', 'string'].includes(typeof value))) {
        return null;
    }

    return Object.fromEntries(entries.map(([key, value]) => [
        key,
        typeof value === 'string' ? sanitizeDiagnosticText(value) : value
    ]));
}

function summarizeOperationalPayload(payload: unknown): UnknownRecord | null {
    const record = toRecord(payload);
    if (!record) {
        if (Array.isArray(payload)) {
            return {
                fieldCount: payload.length,
                hasMessage: false,
                hasRawData: false,
                hasPayload: false,
            };
        }

        return null;
    }

    const curatedPayload = summarizeCuratedOperationalPayload(record);
    if (curatedPayload) {
        return curatedPayload;
    }

    const keys = Object.keys(record).sort();
    return {
        fieldCount: keys.length,
        hasMessage: keys.includes('message'),
        hasRawData: keys.includes('rawData'),
        hasPayload: keys.includes('payload')
    };
}

class PlatformErrorHandler {
    logger: LoggerLike;
    platformName: string;

    constructor(logger: unknown, platformName: string) {
        this.logger = resolveErrorLogger(logger, platformName);
        this.platformName = platformName;
    }

    handleInitializationError(error: unknown, context = 'initialization'): never {
        this.logger.error(sanitizeDiagnosticText(`Failed to initialize ${this.platformName} platform during ${context}`), sanitizeDiagnosticText(this.platformName), buildErrorMetadata(error));
        throw error;
    }

    handleEventProcessingError(
        error: unknown,
        eventType: string,
        eventData: unknown = null,
        message: string | null = null,
        logContext: string | null = null
    ): void {
        const logMessage = message || `Error processing ${eventType} event`;
        const contextName = logContext || this.platformName;
        const metadata = omitUndefined({
            error: resolveErrorMessage(error),
            errorDetails: sanitizeErrorDetails(error),
            eventType: sanitizeDiagnosticText(eventType),
            eventDataSummary: summarizeEventData(eventData) ?? undefined,
        });
        this.logger.error(sanitizeDiagnosticText(logMessage), sanitizeDiagnosticText(contextName), metadata);
    }

    handleConnectionError(error: unknown, action = 'connection', message: string | null = null): void {
        const logMessage = message || `${this.platformName} ${action} failed: ${resolveErrorMessage(error)}`;
        this.logger.error(sanitizeDiagnosticText(logMessage), sanitizeDiagnosticText(this.platformName), buildErrorMetadata(error));
    }

    handleServiceUnavailableError(serviceName: string, error: unknown): void {
        this.logger.warn(sanitizeDiagnosticText(`${serviceName} service unavailable, using fallback behavior`), sanitizeDiagnosticText(this.platformName), buildErrorMetadata(error));
    }

    handleMessageSendError(error: unknown, context = 'message sending', message: string | null = null): void {
        const logMessage = message || `Failed to send message via ${this.platformName} during ${context}`;
        this.logger.error(sanitizeDiagnosticText(logMessage), sanitizeDiagnosticText(this.platformName), buildErrorMetadata(error));
    }

    logOperationalError(message: string, context = this.platformName, payload: unknown = null): void {
        const payloadSummary = summarizeOperationalPayload(payload);
        if (payloadSummary) {
            this.logger.error(sanitizeDiagnosticText(message), sanitizeDiagnosticText(context), { payloadSummary });
        } else if (context !== undefined) {
            this.logger.error(sanitizeDiagnosticText(message), sanitizeDiagnosticText(context));
        } else {
            this.logger.error(sanitizeDiagnosticText(message));
        }
    }

    handleAuthenticationError(reason: string): void {
        this.logger.error(sanitizeDiagnosticText(`Cannot proceed - ${this.platformName} authentication ${reason}`), sanitizeDiagnosticText(this.platformName));
    }

    handleCleanupError(error: unknown, resource: string, message: string | null = null): void {
        const logMessage = message || `Failed to cleanup ${resource} during ${this.platformName} shutdown`;
        this.logger.warn(sanitizeDiagnosticText(logMessage), sanitizeDiagnosticText(this.platformName), {
            error: resolveErrorMessage(error),
            resource: sanitizeDiagnosticText(resource)
        });
    }

    handleDataLoggingError(error: unknown, dataType: string, message: string | null = null, context?: { platform: string; eventType: string }): void {
        const logMessage = message || `Error logging ${dataType} data: ${resolveErrorMessage(error)}`;
        const source = sanitizeDiagnosticText(`${this.platformName}-platform`);
        const safeMessage = sanitizeDiagnosticText(logMessage);
        if (context) {
            this.logger.error(safeMessage, source, {
                platform: sanitizeDiagnosticText(context.platform), eventType: sanitizeDiagnosticText(context.eventType),
            });
        } else {
            this.logger.error(safeMessage, source);
        }
    }
}

function createPlatformErrorHandler(logger: unknown, platformName: string): PlatformErrorHandler {
    return new PlatformErrorHandler(logger, platformName);
}

export {
    PlatformErrorHandler,
    createPlatformErrorHandler,
    summarizeOperationalPayload
};
