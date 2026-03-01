const { createPlatformErrorHandler } = require('./platform-error-handler');

const installedParserApis = new WeakSet();

function createNoOpLogger() {
    const noOp = () => {};
    return {
        debug: noOp,
        info: noOp,
        warn: noOp,
        error: noOp
    };
}

function resolveLogger(logger) {
    if (!logger || typeof logger.warn !== 'function' || typeof logger.error !== 'function') {
        return createNoOpLogger();
    }

    return logger;
}

function toOneLine(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatExpected(expected) {
    if (Array.isArray(expected)) {
        return toOneLine(expected.join(' | '));
    }

    if (typeof expected === 'string') {
        return toOneLine(expected);
    }

    return '';
}

function formatContextDetail(context) {
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

function buildParserWarningPayload(context) {
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

function buildParserWarningMessage(payload) {
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

function handleAdapterError(errorHandler, message, error, payload) {
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

function installYouTubeParserLogAdapter(options = {}) {
    const logger = resolveLogger(options.logger);
    const youtubeModule = options.youtubeModule;
    const parserApi = youtubeModule && youtubeModule.Parser;

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
    const parserWarningHandler = (context = {}) => {
        try {
            const payload = buildParserWarningPayload(context);
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

module.exports = {
    installYouTubeParserLogAdapter
};
