import type { AppLogger } from '../core/logger/types';
import { sanitizeLogText } from '../core/logger/safe-log-serializer';
import { createPlatformErrorHandler } from './platform-error-handler';

const YOUTUBE_TEXT_TAG = '[YOUTUBEJS][Text]:';
const MISMATCH_WARNING_PATTERN = /^Unable to find matching run for (style|command|attachment) run\. Skipping\.\.\.$/;
const ADAPTER_MARKER = Symbol.for('stream-sync.youtube-log-adapter');

type AdapterLogger = Pick<AppLogger, 'warn' | 'error'> & Partial<Pick<AppLogger, 'debug' | 'info'>>;

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

function getMismatchWarningType(args: readonly unknown[]): MismatchWarningType | null {
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
    const inputData = normalizedPayload?.input_data ?? null;
    const styleRuns = inputData?.styleRuns;
    const commandRuns = inputData?.commandRuns;
    const attachmentRuns = inputData?.attachmentRuns;
    const content = inputData && typeof inputData.content === 'string'
        ? inputData.content
        : '';

    return {
        warningType,
        contentLength: content.length,
        styleRunCount: Array.isArray(styleRuns) ? styleRuns.length : 0,
        commandRunCount: Array.isArray(commandRuns) ? commandRuns.length : 0,
        attachmentRunCount: Array.isArray(attachmentRuns) ? attachmentRuns.length : 0,
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
            'youtube-log-adapter',
            payload,
            message,
            'youtube-log-adapter'
        );
        return;
    }

    errorHandler.logOperationalError(message, 'youtube-log-adapter', payload);
}

function installYouTubeLogAdapter(options: { logger?: unknown } = {}): AdapterInstallResult {
    const logger = options.logger;
    if (!hasValidLoggerInterface(logger)) {
        return {
            installed: false,
            reason: 'logger-unavailable'
        };
    }

    const errorHandler = createPlatformErrorHandler(logger, 'youtube-log-adapter');
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

    const methods = ['warn', 'error', 'info', 'debug'] as const;
    const originals = new Map<typeof methods[number], typeof runtimeConsole.warn>();
    try {
        for (const method of methods) {
            const passthrough = runtimeConsole[method];
            if (typeof passthrough !== 'function') continue;
            const wrapped = (...args: unknown[]) => {
                const tag = args[0];
                if (typeof tag !== 'string' || !tag.startsWith('[YOUTUBEJS]')) {
                    return passthrough.apply(runtimeConsole, args);
                }
                try {
                    const warningType = method === 'warn' ? getMismatchWarningType(args) : null;
                    if (warningType) {
                        const metadata = buildWarningMetadata(warningType, args[2]);
                        logger.warn(buildWarningMessage(metadata), 'youtube-text', metadata);
                    } else {
                        const component = /^\[YOUTUBEJS\]\[([a-z0-9_-]{1,64})\]:$/i.exec(tag)?.[1] ?? 'unknown';
                        // SDK objects can contain complete provider responses. Retain only
                        // its primary diagnostic string, never arbitrary argument objects.
                        const diagnostic = typeof args[1] === 'string' ? args[1] : 'YouTube SDK diagnostic';
                        const message = toOneLine(sanitizeLogText(diagnostic)).slice(0, 4096);
                        if (method === 'error') {
                            errorHandler.logOperationalError(message, 'youtube-sdk', { errorType: component, fieldCount: args.length - 1 });
                        } else {
                            const emit = logger[method] ?? logger.warn;
                            emit.call(logger, message, 'youtube-sdk', { component, argumentCount: args.length - 1 });
                        }
                    }
                } catch {
                    // Never restore the raw provider payload on the error path.
                    try { errorHandler.logOperationalError('Failed to normalize YouTube SDK diagnostic', 'youtube-log-adapter'); }
                    catch { passthrough.call(runtimeConsole, '[YouTube] Diagnostic output failed'); }
                }
                return undefined;
            };
            Object.defineProperty(wrapped, ADAPTER_MARKER, { value: true });
            originals.set(method, passthrough);
            runtimeConsole[method] = wrapped;
        }
    } catch (error) {
        for (const [method, original] of originals) {
            try { runtimeConsole[method] = original; } catch { /* A locked console method was not replaced. */ }
        }
        handleAdapterError(errorHandler, 'Failed to install YouTube SDK log adapter', error, null);
        return { installed: false, reason: 'install-failed' };
    }

    return {
        installed: true,
        reason: 'installed'
    };
}

export { installYouTubeLogAdapter };
