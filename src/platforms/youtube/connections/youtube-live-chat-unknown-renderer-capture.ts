import { types } from 'node:util';
import { collectParserWarningsDuring, type ParserWarningPayload } from '../../../utils/youtube-parser-log-adapter';
import type { UnknownRecord } from '../../../utils/record-contracts';

type ExecuteArgs = UnknownRecord & {
    continuation?: string;
    parse?: boolean;
};
type OptionalExecuteArgs = ExecuteArgs | undefined;
type ExecuteResult = Promise<unknown>;

type ActionsLike = {
    execute: (endpoint: string, args?: OptionalExecuteArgs) => ExecuteResult;
};

type ParserLike = {
    parseResponse: (data: unknown) => unknown;
};

type UnknownRendererLogEntry = {
    videoId: string | null;
    endpoint: string;
    parserWarnings: ParserWarningPayload[];
    matchedRenderers: Array<{
        className: string;
        rawKey: string;
        path: string;
        renderer: unknown;
        containerPath?: string;
        container?: unknown;
        actionPath?: string;
        action?: unknown;
    }>;
    responseMetadata: {
        actionCount: number;
        hasContinuation: boolean;
        captureTraversal: { visitedNodes: number; truncated: boolean };
    };
};

type InstallYouTubeLiveChatUnknownRendererCaptureOptions = {
    actions: ActionsLike;
    parser: ParserLike;
    videoId: string;
    initialContinuation?: string | null;
    isEnabled?: () => boolean;
    logUnknownRenderer: (entry: UnknownRendererLogEntry) => Promise<void>;
};

type WrappedState = {
    originalExecute: (endpoint: string, args?: OptionalExecuteArgs) => ExecuteResult;
    continuationOwners: Map<string, string>;
    // Keep registration identity separate from live tokens: retiring a token must
    // not make concurrent multi-video requests look like a single-video client.
    registeredVideoIds: Set<string>;
    isEnabled: () => boolean;
    parser: ParserLike;
    logUnknownRenderer: (entry: UnknownRendererLogEntry) => Promise<void>;
};

type RawExecuteResponse = {
    data: unknown;
};

type TraversalAncestor = {
    path: string;
    value: unknown;
};

const wrappedActions = new WeakMap<ActionsLike, WrappedState>();
const MAX_CAPTURE_DEPTH = 12;
const MAX_CAPTURE_NODES = 1000;
const MAX_CONTAINER_ENTRIES = 100;
const MAX_MATCHES = 100;
const MAX_WARNINGS = 100;
const MAX_PATH_LENGTH = 4096;

function ownValue(value: unknown, key: string): unknown {
    if (!value || typeof value !== 'object' || types.isProxy(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function captureEnabled(state: Pick<WrappedState, 'isEnabled'>): boolean {
    try { return state.isEnabled() === true; }
    catch { return false; }
}

function isRecord(value: unknown): value is UnknownRecord {
    return !!value && typeof value === 'object' && !types.isProxy(value) && !Array.isArray(value);
}

function isRawExecuteResponse(value: unknown): value is RawExecuteResponse {
    if (!isRecord(value)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'data');
    return !!descriptor && 'value' in descriptor;
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
    const value = ownValue(record, key);
    return typeof value === 'string' && value.length <= MAX_PATH_LENGTH && value.trim() ? value : null;
}

function getInitialContinuation(initialContinuation?: string | null): string | null {
    return typeof initialContinuation === 'string' && initialContinuation.length <= MAX_PATH_LENGTH && initialContinuation.trim()
        ? initialContinuation
        : null;
}

function getActionCount(rawData: unknown): number {
    const liveChatContinuation = getRawLiveChatContinuation(rawData);
    if (!liveChatContinuation) {
        return 0;
    }

    const actions = ownValue(liveChatContinuation, 'actions');
    const length = Array.isArray(actions) ? ownValue(actions, 'length') : undefined;
    return typeof length === 'number' ? length : 0;
}

function getRawLiveChatContinuation(rawData: unknown): UnknownRecord | null {
    if (!isRecord(rawData)) {
        return null;
    }

    const continuationContents = ownValue(rawData, 'continuationContents');
    if (!isRecord(continuationContents)) {
        return null;
    }

    const live = ownValue(continuationContents, 'liveChatContinuation');
    if (isRecord(live)) {
        return live;
    }

    const replay = ownValue(continuationContents, 'liveChatReplayContinuation');
    if (isRecord(replay)) {
        return replay;
    }

    return null;
}

function getNextContinuationToken(parsedResponse: unknown): string | null {
    if (!isRecord(parsedResponse)) {
        return null;
    }

    const continuationContents = ownValue(parsedResponse, 'continuation_contents');
    if (!isRecord(continuationContents)) {
        return null;
    }

    const continuation = ownValue(continuationContents, 'continuation');
    if (!isRecord(continuation)) {
        return null;
    }

    return getString(continuation, 'token');
}

function shouldCaptureExpandedContext(className: string): boolean {
    return className === 'GiftMessageView';
}

function findActionAncestor(ancestors: TraversalAncestor[]): TraversalAncestor | null {
    for (let index = ancestors.length - 1; index >= 0; index -= 1) {
        const ancestor = ancestors[index];
        if (!ancestor) {
            continue;
        }

        if (/\.actions\[\d+\]$/.test(ancestor.path)) {
            return ancestor;
        }
    }

    return null;
}

function collectMatchedRenderers(rawData: unknown, classNames: Set<string>) {
    const matches: UnknownRendererLogEntry['matchedRenderers'] = [];
    const ancestors: TraversalAncestor[] = [];
    const ancestorValues = new WeakSet<object>();
    let visitedNodes = 0;
    let truncated = false;
    const visit = (value: unknown, path: string, depth: number): void => {
        visitedNodes++;
        if (!value || typeof value !== 'object' || types.isProxy(value) || ancestorValues.has(value)) return;
        if (depth >= MAX_CAPTURE_DEPTH) { truncated = true; return; }
        ancestorValues.add(value);
        ancestors.push({ path, value });
        try {
            let count = 0;
            // Native own-key discovery is not interruptible. Subsequent reads and
            // traversal are bounded and never invoke accessors or proxy traps.
            for (const rawKey of Object.keys(value)) {
                if (++count > MAX_CONTAINER_ENTRIES || visitedNodes >= MAX_CAPTURE_NODES || matches.length >= MAX_MATCHES) {
                    truncated = true;
                    break;
                }
                if (rawKey.length > MAX_PATH_LENGTH) { truncated = true; continue; }
                const childPath = Array.isArray(value) ? `${path}[${rawKey}]` : `${path}.${rawKey}`;
                if (childPath.length > MAX_PATH_LENGTH) { truncated = true; continue; }
                const descriptor = Object.getOwnPropertyDescriptor(value, rawKey);
                if (!descriptor || !('value' in descriptor)) continue;
                const child: unknown = descriptor.value;
                const className = normalizeRendererKey(rawKey);
                if (classNames.has(className) && child !== undefined) {
                    const match: UnknownRendererLogEntry['matchedRenderers'][number] = {
                        className,
                        rawKey,
                        path: childPath,
                        renderer: child
                    };

                    if (shouldCaptureExpandedContext(className)) {
                        match.containerPath = path;
                        match.container = value;

                        const actionAncestor = findActionAncestor(ancestors);
                        if (actionAncestor) {
                            match.actionPath = actionAncestor.path;
                            match.action = actionAncestor.value;
                        }
                    }

                    matches.push(match);
                }
                visit(child, childPath, depth + 1);
            }
        } finally {
            ancestors.pop();
            ancestorValues.delete(value);
        }
    };
    visit(rawData, '$', 0);
    return { matches, visitedNodes, truncated };
}

async function captureUnknownRenderers(
    state: WrappedState,
    rawData: unknown,
    parsedResponse: unknown,
    endpoint: string,
    videoId: string | null,
    warnings: ParserWarningPayload[]
): Promise<void> {
    const classNotFoundWarnings = warnings.slice(0, MAX_WARNINGS).filter((warning) => warning.errorType === 'class_not_found' && warning.className.length <= MAX_PATH_LENGTH);
    if (!classNotFoundWarnings.length) {
        return;
    }

    const classNames = new Set(classNotFoundWarnings.map((warning) => warning.className));
    const { matches: matchedRenderers, ...captureTraversal } = collectMatchedRenderers(rawData, classNames);
    if (warnings.length > MAX_WARNINGS) captureTraversal.truncated = true;

    await state.logUnknownRenderer({
        videoId,
        endpoint,
        parserWarnings: classNotFoundWarnings,
        matchedRenderers,
        responseMetadata: {
            actionCount: getActionCount(rawData),
            hasContinuation: !!getNextContinuationToken(parsedResponse),
            captureTraversal
        }
    });
}

function resolveVideoId(state: WrappedState, args: OptionalExecuteArgs): string | null {
    if (!args || !isRecord(args)) {
        return null;
    }

    const continuation = getString(args, 'continuation');
    if (!continuation) {
        return null;
    }

    return state.continuationOwners.get(continuation) || null;
}

function resolveFallbackVideoId(state: WrappedState): string | null {
    const knownVideoIds = state.registeredVideoIds;
    if (knownVideoIds.size !== 1) {
        return null;
    }

    const firstVideoId = knownVideoIds.values().next();
    return firstVideoId.done ? null : firstVideoId.value;
}

function registerContinuationOwner(state: WrappedState, continuation: string | null, videoId: string): void {
    if (!continuation) {
        return;
    }

    state.continuationOwners.set(continuation, videoId);
}

function shouldCapture(endpoint: string, args: OptionalExecuteArgs): args is ExecuteArgs {
    return isLiveChatEndpoint(endpoint) && isRecord(args) && ownValue(args, 'parse') === true;
}

function installYouTubeLiveChatUnknownRendererCapture(
    options: InstallYouTubeLiveChatUnknownRendererCaptureOptions
): void {
    const initialContinuation = getInitialContinuation(options.initialContinuation);
    const existingState = wrappedActions.get(options.actions);
    if (existingState) {
        existingState.parser = options.parser;
        existingState.logUnknownRenderer = options.logUnknownRenderer;
        existingState.isEnabled = options.isEnabled ?? (() => true);
        existingState.registeredVideoIds.add(options.videoId);
        if (captureEnabled(existingState)) registerContinuationOwner(existingState, initialContinuation, options.videoId);
        return;
    }

    const state: WrappedState = {
        originalExecute: options.actions.execute.bind(options.actions),
        continuationOwners: new Map<string, string>(),
        registeredVideoIds: new Set([options.videoId]),
        isEnabled: options.isEnabled ?? (() => true),
        parser: options.parser,
        logUnknownRenderer: options.logUnknownRenderer
    };

    if (captureEnabled(state)) registerContinuationOwner(state, initialContinuation, options.videoId);

    options.actions.execute = async (endpoint: string, args?: OptionalExecuteArgs) => {
        if (!captureEnabled(state) || !shouldCapture(endpoint, args)) {
            return state.originalExecute(endpoint, args);
        }
        const videoId = resolveVideoId(state, args) || resolveFallbackVideoId(state);
        const consumedContinuation = getString(args, 'continuation');
        // Capture identity before awaiting/retiring, including concurrent polls.
        if (consumedContinuation) state.continuationOwners.delete(consumedContinuation);
        const rawResponse = await state.originalExecute(endpoint, {
            ...args,
            parse: false
        });
        if (!isRawExecuteResponse(rawResponse)) {
            return rawResponse;
        }

        // A request already sent with parse:false still needs exactly one SDK parse
        // if capture was disabled while awaiting the HTTP response.
        if (!captureEnabled(state)) return state.parser.parseResponse(rawResponse.data);
        const { result: parsedResponse, warnings } = collectParserWarningsDuring(() => state.parser.parseResponse(rawResponse.data));
        try {
            if (captureEnabled(state)) {
                if (videoId) registerContinuationOwner(state, getNextContinuationToken(parsedResponse), videoId);
                await captureUnknownRenderers(state, rawResponse.data, parsedResponse, endpoint, videoId, warnings);
            }
        } catch {
            // Diagnostic failures must not reject/retry a successfully parsed chat poll.
        }

        return parsedResponse;
    };

    wrappedActions.set(options.actions, state);
}

export {
    installYouTubeLiveChatUnknownRendererCapture,
    type InstallYouTubeLiveChatUnknownRendererCaptureOptions
};
