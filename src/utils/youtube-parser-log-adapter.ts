import type { AppLogger } from '../core/logger/types';
import { types } from 'node:util';

import { createPlatformErrorHandler } from './platform-error-handler';
import { sanitizeLogText } from '../core/logger/safe-log-serializer';
import { mapQuotedLogText, replaceWebUrls } from '../core/logger/web-url-pattern';
import { asRecord } from './record-contracts';

type LoggerLike = Partial<Pick<AppLogger, 'debug' | 'info' | 'warn' | 'error'>>;

type ParserWarningContext = {
    error_type?: unknown;
    classname?: unknown;
    expected?: unknown;
    error?: unknown;
    failed?: unknown;
    total?: unknown;
    titles?: unknown;
};

type ParserApiLike = {
    setParserErrorHandler: (handler: (context?: ParserWarningContext) => void) => void;
};

type YouTubeParserModuleLike = {
    Parser?: ParserApiLike;
};

type InstallYouTubeParserLogAdapterOptions = {
    logger?: LoggerLike;
    youtubeModule?: YouTubeParserModuleLike;
};

type InstallYouTubeParserLogAdapterResult = {
    installed: boolean;
    reason: 'installed' | 'already-installed' | 'parser-api-unavailable' | 'install-failed';
};

type ParserWarningPayload = {
    errorType: string;
    className: string;
    expected: string;
    detail: string;
};

type WarningCollectorFrame = {
    warnings: ParserWarningPayload[];
};

const installedParserApis = new WeakSet<ParserApiLike>();
const warningCollectorStack: WarningCollectorFrame[] = [];
const MAX_WARNINGS = 100;
const MAX_DIAGNOSTIC_LENGTH = 256;

function createNoOpLogger(): Required<LoggerLike> {
    const noOp = () => {};
    return {
        debug: noOp,
        info: noOp,
        warn: noOp,
        error: noOp
    };
}

function resolveLogger(logger?: LoggerLike): Required<LoggerLike> {
    if (!logger || typeof logger.warn !== 'function' || typeof logger.error !== 'function') {
        return createNoOpLogger();
    }

    return {
        debug: typeof logger.debug === 'function' ? logger.debug.bind(logger) : createNoOpLogger().debug,
        info: typeof logger.info === 'function' ? logger.info.bind(logger) : createNoOpLogger().info,
        warn: logger.warn.bind(logger),
        error: logger.error.bind(logger)
    };
}

function toOneLine(value: string): string {
    return value
        .replace(/\s+/g, ' ')
        .trim();
}

function omitDiagnosticLocations(value: string, depth = 0): string {
    if (!/[:@"']/.test(value)) return value;
    const withoutUrls = mapQuotedLogText(value, (candidate, closed) => {
        if (!closed || depth >= 12) return '[Location omitted]';
        const quote = candidate[0]!;
        if (quote === '"') {
            try {
                return JSON.stringify(omitDiagnosticLocations(JSON.parse(candidate) as string, depth + 1));
            } catch {
                // Non-JSON quotes still delimit structural diagnostics.
            }
        }
        return quote + omitDiagnosticLocations(candidate.slice(1, -1), depth + 1) + quote;
    }, plain => replaceWebUrls(plain, () => '[URL omitted]'));
    // Structural classifications do not need address-bearing tokens. Scanning
    // whole tokens also avoids repeated email-pattern backtracking on long labels.
    return withoutUrls.replace(/\S+/g, token => token.includes('@') ? '[Email omitted]' : token);
}

function boundedDiagnostic(value: unknown, fallback = ''): string {
    if (typeof value !== 'string') return fallback;
    return toOneLine(omitDiagnosticLocations(sanitizeLogText(value))).slice(0, MAX_DIAGNOSTIC_LENGTH);
}

function formatExpected(expected: unknown): string {
    if (Array.isArray(expected)) {
        const normalized = new Map<string, string>();
        return boundedDiagnostic(expected.slice(0, 100)
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => {
                const cached = normalized.get(entry);
                if (cached !== undefined) return cached;
                const diagnostic = boundedDiagnostic(entry);
                normalized.set(entry, diagnostic);
                return diagnostic;
            }).join(' | '));
    }

    if (typeof expected === 'string') {
        return boundedDiagnostic(expected);
    }

    return '';
}

function formatContextDetail(context: ParserWarningContext): string {
    if (context.error instanceof Error) {
        return `error=${boundedDiagnostic(context.error.name, 'Error')}`.slice(0, MAX_DIAGNOSTIC_LENGTH);
    }

    if (typeof context.error === 'string') {
        return `errorMessageLength=${context.error.length}`;
    }

    if (typeof context.failed === 'number' && Number.isFinite(context.failed)
        && typeof context.total === 'number' && Number.isFinite(context.total)) {
        return `${context.failed}/${context.total} mutation items failed`;
    }

    if (Array.isArray(context.titles) && context.titles.length > 0) {
        return `titleCount=${context.titles.length}`;
    }

    return '';
}

function buildParserWarningPayload(context: ParserWarningContext): ParserWarningPayload {
    const errorType = boundedDiagnostic(context.error_type, 'unknown') || 'unknown';
    const className = boundedDiagnostic(context.classname, 'unknown') || 'unknown';
    const expected = formatExpected(context.expected);
    const detail = formatContextDetail(context);

    return {
        errorType,
        className,
        expected,
        detail
    };
}

function buildParserWarningMessage(payload: ParserWarningPayload): string {
    const parts = [
        `YouTube parser warning (${payload.errorType})`,
        `class=${payload.className}`
    ];

    if (payload.expected) {
        parts.push(`expected=${payload.expected}`);
    }

    if (payload.detail) {
        parts.push(`detail=${payload.detail}`);
    }

    return toOneLine(parts.join(' | '));
}

function appendWarningToActiveCollectors(payload: ParserWarningPayload): void {
    const currentFrame = warningCollectorStack[warningCollectorStack.length - 1];
    if (currentFrame && currentFrame.warnings.length < MAX_WARNINGS) {
        currentFrame.warnings.push(payload);
    }
}

function handleAdapterError(
    errorHandler: ReturnType<typeof createPlatformErrorHandler>,
    message: string,
    error: unknown,
    payload: Record<string, unknown>
): void {
    errorHandler.logOperationalError(message, 'youtube-parser-log-adapter', {
        ...payload,
        errorType: error instanceof Error ? boundedDiagnostic(error.name, 'Error') : typeof error
    });
}

function installYouTubeParserLogAdapter(
    options: InstallYouTubeParserLogAdapterOptions = {}
): InstallYouTubeParserLogAdapterResult {
    const logger = resolveLogger(options.logger);
    const parserApi = options.youtubeModule?.Parser;

    if (!parserApi || typeof parserApi.setParserErrorHandler !== 'function') {
        return {
            installed: false,
            reason: 'parser-api-unavailable'
        };
    }

    if (installedParserApis.has(parserApi)) {
        return {
            installed: false,
            reason: 'already-installed'
        };
    }

    const errorHandler = createPlatformErrorHandler(logger, 'youtube-parser-log-adapter');
    const parserWarningHandler = (context: ParserWarningContext = {}) => {
        const warningContext = asRecord(context) ?? {};
        try {
            const payload = buildParserWarningPayload(warningContext);
            appendWarningToActiveCollectors(payload);
            const message = buildParserWarningMessage(payload);
            logger.warn(message, 'youtube-parser', payload);
        } catch (error) {
            handleAdapterError(
                errorHandler,
                'Failed to normalize YouTube parser warning',
                error,
                { errorType: boundedDiagnostic(warningContext.error_type, 'unknown') }
            );
        }
    };

    try {
        parserApi.setParserErrorHandler(parserWarningHandler);
    } catch (error) {
        handleAdapterError(
            errorHandler,
            'Failed to install YouTube parser warning adapter',
            error,
            { reason: 'set-parser-error-handler-failed' }
        );

        return {
            installed: false,
            reason: 'install-failed'
        };
    }

    installedParserApis.add(parserApi);

    return {
        installed: true,
        reason: 'installed'
    };
}

function collectParserWarningsDuring<T>(run: () => T): { result: T; warnings: ParserWarningPayload[] } {
    if (types.isAsyncFunction(run)) {
        throw new TypeError('collectParserWarningsDuring only supports synchronous callbacks');
    }
    const frame: WarningCollectorFrame = { warnings: [] };
    warningCollectorStack.push(frame);

    try {
        const result = run();
        if (result !== null && (typeof result === 'object' || typeof result === 'function')
            && typeof (result as unknown as PromiseLike<unknown>).then === 'function') {
            // A non-async callback may already have started work; retire its rejection,
            // but do not claim that this synchronous collector observed its completion.
            void Promise.resolve(result).catch(() => {});
            throw new TypeError('collectParserWarningsDuring only supports synchronous callbacks');
        }
        return {
            result,
            warnings: [...frame.warnings]
        };
    } finally {
        warningCollectorStack.pop();
    }
}

export {
    collectParserWarningsDuring,
    installYouTubeParserLogAdapter,
    type InstallYouTubeParserLogAdapterOptions,
    type InstallYouTubeParserLogAdapterResult,
    type ParserWarningPayload
};
