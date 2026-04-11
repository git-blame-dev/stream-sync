import { collectParserWarningsDuring, type ParserWarningPayload } from '../../../utils/youtube-parser-log-adapter';

type UnknownRecord = Record<string, unknown>;

type ExecuteArgs = UnknownRecord | undefined;
type ExecuteResult = Promise<unknown>;

type ActionsLike = {
    execute: (endpoint: string, args?: ExecuteArgs) => ExecuteResult;
};

type ParserLike = {
    parseResponse: (data: unknown) => unknown;
};

type UnknownRendererLogEntry = {
    videoId: string;
    endpoint: string;
    parserWarnings: ParserWarningPayload[];
    matchedRenderers: Array<{
        className: string;
        rawKey: string;
        path: string;
        renderer: unknown;
    }>;
    responseMetadata: {
        actionCount: number;
        hasContinuation: boolean;
    };
};

type InstallYouTubeLiveChatUnknownRendererCaptureOptions = {
    actions: ActionsLike;
    parser: ParserLike;
    videoId: string;
    initialContinuation?: string | null;
    logUnknownRenderer: (entry: UnknownRendererLogEntry) => Promise<void>;
};

type WrappedState = {
    originalExecute: (endpoint: string, args?: ExecuteArgs) => ExecuteResult;
    continuationOwners: Map<string, string>;
    parser: ParserLike;
    logUnknownRenderer: (entry: UnknownRendererLogEntry) => Promise<void>;
};

type RawExecuteResponse = {
    data: unknown;
};

const wrappedActions = new WeakMap<ActionsLike, WrappedState>();

function isRecord(value: unknown): value is UnknownRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRawExecuteResponse(value: unknown): value is RawExecuteResponse {
    return isRecord(value) && 'data' in value;
}

function isLiveChatEndpoint(endpoint: string): boolean {
    return endpoint === 'live_chat/get_live_chat' || endpoint === 'live_chat/get_live_chat_replay';
}

function normalizeRendererKey(rawKey: string): string {
    return (rawKey.charAt(0).toUpperCase() + rawKey.slice(1))
        .replace(/Renderer|Model/g, '')
        .replace(/Radio/g, 'Mix')
        .trim();
}

function getString(record: UnknownRecord, key: string): string | null {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value : null;
}

function getInitialContinuation(initialContinuation?: string | null): string | null {
    return typeof initialContinuation === 'string' && initialContinuation.trim()
        ? initialContinuation
        : null;
}

function getActionCount(rawData: unknown): number {
    const liveChatContinuation = getRawLiveChatContinuation(rawData);
    if (!liveChatContinuation) {
        return 0;
    }

    const actions = liveChatContinuation.actions;
    return Array.isArray(actions) ? actions.length : 0;
}

function getRawLiveChatContinuation(rawData: unknown): UnknownRecord | null {
    if (!isRecord(rawData)) {
        return null;
    }

    const continuationContents = rawData.continuationContents;
    if (!isRecord(continuationContents)) {
        return null;
    }

    if (isRecord(continuationContents.liveChatContinuation)) {
        return continuationContents.liveChatContinuation;
    }

    if (isRecord(continuationContents.liveChatReplayContinuation)) {
        return continuationContents.liveChatReplayContinuation;
    }

    return null;
}

function getNextContinuationToken(parsedResponse: unknown): string | null {
    if (!isRecord(parsedResponse)) {
        return null;
    }

    const continuationContents = parsedResponse.continuation_contents;
    if (!isRecord(continuationContents)) {
        return null;
    }

    const continuation = continuationContents.continuation;
    if (!isRecord(continuation)) {
        return null;
    }

    return getString(continuation, 'token');
}

function collectMatchedRenderers(rawData: unknown, classNames: Set<string>) {
    const matches: UnknownRendererLogEntry['matchedRenderers'] = [];

    const visit = (value: unknown, path: string) => {
        if (Array.isArray(value)) {
            value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
            return;
        }

        if (!isRecord(value)) {
            return;
        }

        for (const [rawKey, child] of Object.entries(value)) {
            const childPath = `${path}.${rawKey}`;
            if (classNames.has(normalizeRendererKey(rawKey)) && child !== undefined) {
                matches.push({
                    className: normalizeRendererKey(rawKey),
                    rawKey,
                    path: childPath,
                    renderer: child
                });
            }

            visit(child, childPath);
        }
    };

    visit(rawData, '$');
    return matches;
}

async function captureUnknownRenderers(
    state: WrappedState,
    rawData: unknown,
    parsedResponse: unknown,
    endpoint: string,
    videoId: string,
    warnings: ParserWarningPayload[]
): Promise<void> {
    const classNotFoundWarnings = warnings.filter((warning) => warning.errorType === 'class_not_found');
    if (!classNotFoundWarnings.length) {
        return;
    }

    const classNames = new Set(classNotFoundWarnings.map((warning) => warning.className));
    const matchedRenderers = collectMatchedRenderers(rawData, classNames);

    await state.logUnknownRenderer({
        videoId,
        endpoint,
        parserWarnings: classNotFoundWarnings,
        matchedRenderers,
        responseMetadata: {
            actionCount: getActionCount(rawData),
            hasContinuation: !!getNextContinuationToken(parsedResponse)
        }
    });
}

function resolveVideoId(state: WrappedState, args: ExecuteArgs): string | null {
    if (!args || !isRecord(args)) {
        return null;
    }

    const continuation = getString(args, 'continuation');
    if (!continuation) {
        return null;
    }

    return state.continuationOwners.get(continuation) || null;
}

function registerContinuationOwner(state: WrappedState, continuation: string | null, videoId: string): void {
    if (!continuation) {
        return;
    }

    state.continuationOwners.set(continuation, videoId);
}

function shouldCapture(endpoint: string, args: ExecuteArgs): args is UnknownRecord {
    return isLiveChatEndpoint(endpoint) && isRecord(args) && args.parse === true;
}

function installYouTubeLiveChatUnknownRendererCapture(
    options: InstallYouTubeLiveChatUnknownRendererCaptureOptions
): void {
    const initialContinuation = getInitialContinuation(options.initialContinuation);
    const existingState = wrappedActions.get(options.actions);
    if (existingState) {
        existingState.parser = options.parser;
        existingState.logUnknownRenderer = options.logUnknownRenderer;
        registerContinuationOwner(existingState, initialContinuation, options.videoId);
        return;
    }

    const state: WrappedState = {
        originalExecute: options.actions.execute.bind(options.actions),
        continuationOwners: new Map<string, string>(),
        parser: options.parser,
        logUnknownRenderer: options.logUnknownRenderer
    };

    registerContinuationOwner(state, initialContinuation, options.videoId);

    options.actions.execute = async (endpoint: string, args?: ExecuteArgs) => {
        if (!shouldCapture(endpoint, args)) {
            return state.originalExecute(endpoint, args);
        }

        const rawResponse = await state.originalExecute(endpoint, {
            ...args,
            parse: false
        });
        if (!isRawExecuteResponse(rawResponse)) {
            return rawResponse;
        }

        const { result: parsedResponse, warnings } = collectParserWarningsDuring(() => state.parser.parseResponse(rawResponse.data));
        const videoId = resolveVideoId(state, args) || options.videoId;
        registerContinuationOwner(state, getNextContinuationToken(parsedResponse), videoId);
        await captureUnknownRenderers(state, rawResponse.data, parsedResponse, endpoint, videoId, warnings);

        return parsedResponse;
    };

    wrappedActions.set(options.actions, state);
}

export {
    installYouTubeLiveChatUnknownRendererCapture,
    type InstallYouTubeLiveChatUnknownRendererCaptureOptions
};
