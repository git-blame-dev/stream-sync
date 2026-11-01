import { createPlatformErrorHandler } from './platform-error-handler';
import { normalizeLoggerMethods } from './logger-resolver';
import { sanitizeLogText } from '../core/logger/safe-log-serializer';
import type { AppLogger } from '../core/logger/types';

const YOUTUBE_TEXT_TAG = '[YOUTUBEJS][Text]:';
const MISMATCH_WARNING_PATTERN = /^Unable to find matching run for (style|command|attachment) run\. Skipping\.\.\.$/;
const ADAPTER_MARKER = Symbol.for('stream-sync.youtube-log-adapter');

type AdapterLogger = AppLogger;
type AdapterState = { logger: AdapterLogger };
const SDK_TAG = /^\[YOUTUBEJS\](?:\[([A-Za-z0-9_.-]{1,80})\])?:$/;

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

function installYouTubeLogAdapter(options: { logger?: unknown } = {}): AdapterInstallResult {
    let logger: AdapterLogger;
    try { logger = normalizeLoggerMethods(options.logger as Record<string, unknown>, 'youtube-sdk'); }
    catch { return { installed: false, reason: 'logger-unavailable' }; }
    const runtimeConsole = globalThis.console;
    if (!runtimeConsole || typeof runtimeConsole.warn !== 'function') {
        return { installed: false, reason: 'console-warn-unavailable' };
    }
    const previous: unknown = Reflect.get(runtimeConsole.warn, ADAPTER_MARKER);
    if (previous && typeof previous === 'object' && 'logger' in previous) {
        (previous as AdapterState).logger = logger;
        return { installed: false, reason: 'already-installed' };
    }
    const state: AdapterState = { logger };
    const installed: (() => void)[] = [];
    try {
        for (const method of ['warn', 'error', 'info', 'debug'] as const) {
            const original = runtimeConsole[method];
            if (typeof original !== 'function') continue;
            const wrapped = (...args: unknown[]) => {
                const tag = typeof args[0] === 'string' ? SDK_TAG.exec(args[0]) : null;
                if (!tag) return original.apply(runtimeConsole, args);
                try {
                    const warningType = method === 'warn' ? getMismatchWarningType(args) : null;
                    if (warningType) {
                        const metadata = buildWarningMetadata(warningType, args[2]);
                        state.logger.warn(buildWarningMessage(metadata), 'youtube-text', metadata);
                    } else {
                        // Provider payload objects never reach normal diagnostic logs.
                        const detail = typeof args[1] === 'string' ? toOneLine(sanitizeLogText(args[1])).slice(0, 512) : 'Diagnostic received';
                        const message = `YouTube SDK ${method}: ${detail}`;
                        const metadata = { component: tag[1] ?? 'unknown', argumentCount: args.length - 1 };
                        if (method === 'error') {
                            const error = args.slice(1).find(value => value instanceof Error);
                            createPlatformErrorHandler(state.logger, 'youtube-sdk').handleEventProcessingError(
                                error ?? detail, metadata.component, null, message, 'youtube-sdk'
                            );
                        } else state.logger[method](message, 'youtube-sdk', metadata);
                    }
                } catch {
                    // A broken sink must not leak the original provider arguments.
                    try {
                        createPlatformErrorHandler(state.logger, 'youtube-sdk').logOperationalError('Failed to normalize YouTube SDK diagnostic', 'youtube-sdk');
                    } catch { /* Diagnostic failures must not interrupt provider work. */ }
                }
                return undefined;
            };
            Object.defineProperty(wrapped, ADAPTER_MARKER, { value: state });
            runtimeConsole[method] = wrapped;
            installed.push(() => { runtimeConsole[method] = original; });
        }
    } catch {
        for (const restore of installed.reverse()) {
            try { restore(); } catch { /* Restore other console methods independently. */ }
        }
        try { createPlatformErrorHandler(logger, 'youtube-sdk').logOperationalError('Failed to install YouTube SDK logging adapter', 'youtube-sdk'); }
        catch { /* Optional adapter installation cannot prevent platform startup. */ }
        return { installed: false, reason: 'install-failed' };
    }
    return { installed: true, reason: 'installed' };
}

export { installYouTubeLogAdapter };
