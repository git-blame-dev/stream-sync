import { createPlatformErrorHandler } from './platform-error-handler';

const YOUTUBE_TEXT_TAG = '[YOUTUBEJS][Text]:';
const MISMATCH_WARNING_PATTERN = /^Unable to find matching run for (style|command|attachment) run\. Skipping\.\.\.$/;
const ADAPTER_MARKER = Symbol.for('stream-sync.youtube-text-log-adapter');

type AdapterLogger = {
    warn: (message: string, source?: string, data?: unknown) => void;
    error: (message: string, source?: string, data?: unknown) => void;
};

type MismatchWarningType = 'style' | 'command' | 'attachment';

type YouTubeTextInputData = {
    content?: unknown;
    styleRuns?: unknown;
    commandRuns?: unknown;
    attachmentRuns?: unknown;
};

type YouTubeTextWarningPayload = {
    input_data?: YouTubeTextInputData;
    parsed_runs?: unknown;
};

type WarningMetadata = {
    warningType: MismatchWarningType;
    contentLength: number;
    styleRunCount: number;
    commandRunCount: number;
    attachmentRunCount: number;
    parsedRunCount: number;
};

type AdapterInstallResult = {
    installed: boolean;
    reason: 'logger-unavailable' | 'console-warn-unavailable' | 'already-installed' | 'install-failed' | 'installed';
};

function hasValidLoggerInterface(logger: unknown): logger is AdapterLogger {
    return !!logger
        && typeof (logger as { warn?: unknown }).warn === 'function'
        && typeof (logger as { error?: unknown }).error === 'function';
}

function toOneLine(value: unknown): string {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getMismatchWarningType(args: unknown[]): MismatchWarningType | null {
    if (args.length < 2) {
        return null;
    }

    const [tag, message] = args;
    if (tag !== YOUTUBE_TEXT_TAG || typeof message !== 'string') {
        return null;
    }

    const normalizedMessage = toOneLine(message);
    const match = normalizedMessage.match(MISMATCH_WARNING_PATTERN);
    return match ? (match[1] as MismatchWarningType) : null;
}

function buildWarningMetadata(warningType: MismatchWarningType, payload: unknown): WarningMetadata {
    const normalizedPayload = payload && typeof payload === 'object'
        ? (payload as YouTubeTextWarningPayload)
        : null;
    const inputData = normalizedPayload?.input_data;
    const content = inputData && typeof inputData.content === 'string'
        ? inputData.content
        : '';

    return {
        warningType,
        contentLength: content.length,
        styleRunCount: Array.isArray(inputData && inputData.styleRuns) ? inputData.styleRuns.length : 0,
        commandRunCount: Array.isArray(inputData && inputData.commandRuns) ? inputData.commandRuns.length : 0,
        attachmentRunCount: Array.isArray(inputData && inputData.attachmentRuns) ? inputData.attachmentRuns.length : 0,
        parsedRunCount: Array.isArray(normalizedPayload?.parsed_runs) ? normalizedPayload.parsed_runs.length : 0
    };
}

function buildWarningMessage(metadata: WarningMetadata): string {
    return toOneLine(
        `YouTube text run mismatch warning (${metadata.warningType}) | contentLength=${metadata.contentLength} | parsedRuns=${metadata.parsedRunCount}`
    );
}

function handleAdapterError(
    errorHandler: ReturnType<typeof createPlatformErrorHandler>,
    message: string,
    error: unknown,
    payload: Record<string, unknown> | null
): void {
    if (error instanceof Error) {
        errorHandler.handleEventProcessingError(
            error,
            'youtube-text-log-adapter',
            payload,
            message,
            'youtube-text-log-adapter'
        );
        return;
    }

    errorHandler.logOperationalError(message, 'youtube-text-log-adapter', payload);
}

function installYouTubeTextLogAdapter(options: { logger?: unknown } = {}): AdapterInstallResult {
    const logger = options.logger;
    if (!hasValidLoggerInterface(logger)) {
        return {
            installed: false,
            reason: 'logger-unavailable'
        };
    }

    const errorHandler = createPlatformErrorHandler(logger, 'youtube-text-log-adapter');
    const runtimeConsole = globalThis.console;

    if (!runtimeConsole || typeof runtimeConsole.warn !== 'function') {
        return {
            installed: false,
            reason: 'console-warn-unavailable'
        };
    }

    if (Reflect.get(runtimeConsole.warn, ADAPTER_MARKER) === true) {
        return {
            installed: false,
            reason: 'already-installed'
        };
    }

    const passthroughWarn = runtimeConsole.warn;
    const wrappedWarn = (...args: unknown[]) => {
        try {
            const warningType = getMismatchWarningType(args);
            if (!warningType) {
                return passthroughWarn.apply(runtimeConsole, args);
            }

            const metadata = buildWarningMetadata(warningType, args[2]);
            logger.warn(buildWarningMessage(metadata), 'youtube-text', metadata);
            return undefined;
        } catch (error) {
            handleAdapterError(
                errorHandler,
                'Failed to normalize YouTube Text warning',
                error,
                { argCount: args.length }
            );
            return passthroughWarn.apply(runtimeConsole, args);
        }
    };

    // youtubei.js Text mismatch warnings include large payload objects; collapse only known variants to one line.
    try {
        Object.defineProperty(wrappedWarn, ADAPTER_MARKER, {
            value: true,
            enumerable: false,
            configurable: false,
            writable: false
        });
        runtimeConsole.warn = wrappedWarn;
    } catch (error) {
        handleAdapterError(
            errorHandler,
            'Failed to install YouTube Text warning adapter',
            error,
            null
        );
        return {
            installed: false,
            reason: 'install-failed'
        };
    }

    return {
        installed: true,
        reason: 'installed'
    };
}

export { installYouTubeTextLogAdapter };
