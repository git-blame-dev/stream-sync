import { createPlatformErrorHandler } from './platform-error-handler';

type LoggerLike = {
    debug?: (message: unknown, source?: string, data?: unknown) => void;
    info?: (message: unknown, source?: string, data?: unknown) => void;
    warn?: (message: unknown, source?: string, data?: unknown) => void;
    error?: (message: unknown, source?: string, data?: unknown) => void;
};

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

function toOneLine(value: unknown): string {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatExpected(expected: unknown): string {
    if (Array.isArray(expected)) {
        return toOneLine(expected.join(' | '));
    }

    if (typeof expected === 'string') {
        return toOneLine(expected);
    }

    return '';
}

function formatContextDetail(context: ParserWarningContext): string {
    if (context.error instanceof Error) {
        return toOneLine(context.error.message);
    }

    if (typeof context.error === 'string') {
        return toOneLine(context.error);
    }

    if (typeof context.failed === 'number' && typeof context.total === 'number') {
        return `${context.failed}/${context.total} mutation items failed`;
    }

    if (Array.isArray(context.titles) && context.titles.length > 0) {
        return `titles=${toOneLine(context.titles.join(', '))}`;
    }

    return '';
}

function buildParserWarningPayload(context: ParserWarningContext): ParserWarningPayload {
    const errorType = toOneLine(context.error_type || 'unknown');
    const className = toOneLine(context.classname || 'unknown');
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
    if (currentFrame) {
        currentFrame.warnings.push(payload);
    }
}

function handleAdapterError(
    errorHandler: ReturnType<typeof createPlatformErrorHandler>,
    message: string,
    error: unknown,
    payload: Record<string, unknown>
): void {
    if (error instanceof Error) {
        errorHandler.handleEventProcessingError(
            error,
            'youtube-parser-adapter',
            payload,
            message,
            'youtube-parser-log-adapter'
        );
        return;
    }

    errorHandler.logOperationalError(message, 'youtube-parser-log-adapter', payload);
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
        try {
            const payload = buildParserWarningPayload(context);
            appendWarningToActiveCollectors(payload);
            const message = buildParserWarningMessage(payload);
            logger.warn(message, 'youtube-parser', payload);
        } catch (error) {
            handleAdapterError(
                errorHandler,
                'Failed to normalize YouTube parser warning',
                error,
                { contextType: typeof context.error_type === 'string' ? context.error_type : 'unknown' }
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
    const frame: WarningCollectorFrame = { warnings: [] };
    warningCollectorStack.push(frame);

    try {
        const result = run();
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
