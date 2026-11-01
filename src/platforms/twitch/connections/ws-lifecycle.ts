import type { AppLogger } from '../../../core/logger/types';
import crypto from 'node:crypto';
import type { OperationDeadlineContext } from '../../../utils/timeout-wrapper';

type LifecycleLogger = Partial<Pick<AppLogger<string>, 'debug' | 'info' | 'warn'>>;

type LifecycleWebSocket = {
  readyState: number;
  on: (eventName: string, handler: (...args: unknown[]) => void) => void;
  close: (code?: number, reason?: string) => void;
  terminate?: () => void;
  removeAllListeners?: (eventName?: string) => void;
};

type LifecycleState = {
  logger?: LifecycleLogger;
  _logEventSubError?: (message: string, error?: unknown, eventType?: string, payload?: Record<string, unknown>) => void;
  emit?: (eventName: string, payload?: unknown) => void;
  handleWebSocketMessage?: (message: Record<string, unknown>) => Promise<void> | void;
  _validateConnectionForSubscriptions?: () => boolean;
  _setupEventSubscriptions?: (validationAlreadyDone?: boolean) => Promise<{ failures?: unknown[]; aborted?: boolean; abortReason?: string } | null | void>;
  _scheduleReconnect?: () => void;
  _deleteAllSubscriptions?: (options: { sessionId?: string | null; operationContext?: OperationDeadlineContext }) => Promise<void>;
  _connectWebSocket?: () => Promise<void>;
  _reconnect?: () => Promise<void>;
  connectionStartTime?: number | null;
  reconnectUrl?: string | null;
  ws?: LifecycleWebSocket | null;
  sessionId?: string | null;
  disconnectedSessionId?: string | null;
  welcomeTimer?: ReturnType<typeof setTimeout> | null;
  twitchAuth?: { isReady?: () => boolean } | null;
  userId?: string;
  config?: { clientId?: string };
  _isConnected: boolean;
  subscriptionsReady: boolean;
  isInitialized: boolean;
  subscriptions?: { clear?: () => void };
  reconnectTimeout?: ReturnType<typeof setTimeout> | null;
  retryAttempts: number;
  maxRetryAttempts: number;
  retryDelay: number;
};

type WsLifecycleOptions = {
  WebSocketCtor?: new (url: string, options?: { maxPayload: number }) => LifecycleWebSocket;
  safeSetTimeout?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  safeDelay?: (timeoutMs: number, minMs: number, tag?: string, signal?: AbortSignal) => Promise<void>;
  validateTimeout?: (timeoutMs: number, minMs: number) => number;
  now?: () => number;
  random?: () => number;
  setImmediateFn?: (handler: () => void | Promise<void>) => void;
};

type Session = {
    socket: LifecycleWebSocket;
    controller: AbortController;
    sessionId: string | null;
    firstSubscriptionAt: number;
    firstSubscriptionCreated: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    startupTimer: ReturnType<typeof setTimeout> | null;
    reject: (error: unknown) => void;
    settled: boolean;
    handoff: boolean;
    connectionAttempt: number;
    startedAt: number;
    lastMessageAt: number | null;
    keepaliveTimeoutMs: number | null;
    keepaliveDueAt: number | null;
    readyAt: number | null;
};
type LossCause = 'socket-close' | 'socket-error' | 'welcome-timeout' | 'first-subscription-timeout'
    | 'keepalive-timeout' | 'message-or-setup-failure';
type Owner = {
    disposed: boolean;
    generation: number;
    nextConnectionAttempt: number;
    unstableLosses: number;
    active: Session | null;
    pending: Session | null;
    operation: { controller: AbortController; kind: 'reconnect' | 'repair' } | null;
};

// Application admission limit, not a Twitch protocol maximum.
const MAX_EVENTSUB_WS_MESSAGE_BYTES = 1024 * 1024;
const KEEPALIVE_GRACE_MS = 5000;
const STABLE_SESSION_MS = 120000;

const TRANSPORT_ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'TimeoutError', 'AggregateError']);
const TRANSPORT_ERROR_CODES = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
    'ECONNABORTED', 'EPIPE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_SSL_WRONG_VERSION_NUMBER'
]);

function normalizeWebSocketError(value: unknown): Error {
    if (value instanceof Error) return value;
    // Bun's ws adapter can emit an ErrorEvent; Node's ws emits the Error directly.
    try {
        const nested = value && typeof value === 'object' ? (value as { error?: unknown }).error : undefined;
        if (nested instanceof Error) return nested;
    } catch { /* An unusable envelope must still retire its transport. */ }
    return new Error('EventSub WebSocket transport error');
}

function transportErrorCategory(error: unknown): { errorName: string; errorCode: string | null } {
    try {
        const value = error as { name?: unknown; code?: unknown } | null;
        const name = value?.name;
        const code = value?.code;
        return {
            errorName: typeof name === 'string' && TRANSPORT_ERROR_NAMES.has(name) ? name : 'unknown',
            errorCode: typeof code === 'string' && TRANSPORT_ERROR_CODES.has(code) ? code : null
        };
    } catch { return { errorName: 'unknown', errorCode: null }; }
}

function parseWebSocketMessage(data: unknown): Record<string, unknown> {
    const checkSize = (size: number) => {
        if (size > MAX_EVENTSUB_WS_MESSAGE_BYTES) throw new Error('EventSub frame size limit exceeded');
    };
    let text: string;
    if (typeof data === 'string') {
        checkSize(Buffer.byteLength(data, 'utf8'));
        text = data;
    } else {
        let bytes: Buffer | Uint8Array;
        if (Buffer.isBuffer(data)) {
            checkSize(data.byteLength);
            bytes = data;
        } else if (data instanceof ArrayBuffer) {
            checkSize(data.byteLength);
            bytes = new Uint8Array(data);
        } else if (Array.isArray(data)) {
            let size = 0;
            for (const chunk of data) {
                if (!Buffer.isBuffer(chunk)) throw new Error('Unsupported EventSub frame type');
                size += chunk.byteLength;
                checkSize(size);
            }
            bytes = Buffer.concat(data, size);
        } else throw new Error('Unsupported EventSub frame type');
        try {
            // Preserve a BOM so JSON.parse rejects it, as it does for native ws text.
            text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        } catch { throw new Error('Invalid EventSub frame UTF-8'); }
    }
    let message: unknown;
    try { message = JSON.parse(text); }
    catch { throw new Error('Invalid EventSub frame JSON'); }
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid EventSub frame root');
    return message as Record<string, unknown>;
}

function createTwitchEventSubWsLifecycle(options: WsLifecycleOptions = {}) {
    const { WebSocketCtor, safeSetTimeout, safeDelay, validateTimeout,
        now = () => performance.now(), random = () => crypto.randomInt(0, 1000) / 1000 } = options;
    if (!WebSocketCtor) throw new Error('WebSocketCtor is required');
    if (!safeSetTimeout || !safeDelay || !validateTimeout) throw new Error('timeout utilities are required');
    const report = (state: LifecycleState, message: string, error?: unknown, eventType?: string, payload?: Record<string, unknown>) => {
        try { state._logEventSubError?.(message, error, eventType, payload); }
        catch { /* Reporting cannot own session progress or retirement. */ }
    };
    const notify = (state: LifecycleState, eventName: string, payload: unknown) => {
        try { state.emit?.(eventName, payload); }
        catch (error) { report(state, 'EventSub observer failed', error, 'eventsub-observer'); }
    };
    const owners = new WeakMap<LifecycleState, Owner>();
    const owner = (state: LifecycleState): Owner => {
        let value = owners.get(state);
        if (!value) {
            value = { disposed: false, generation: 0, nextConnectionAttempt: 0, unstableLosses: 0, active: null, pending: null, operation: null };
            owners.set(state, value);
        }
        return value;
    };
    const current = (state: LifecycleState, session: Session) => {
        const value = owner(state);
        return !value.disposed && !session.controller.signal.aborted
            && (value.active === session || value.pending === session);
    };
    const clearTimers = (session: Session) => {
        if (session.timer) clearTimeout(session.timer);
        if (session.startupTimer) clearTimeout(session.startupTimer);
        session.timer = session.startupTimer = null;
    };
    const retire = (session: Session | null, reason: unknown = new Error('EventSub session retired')) => {
        if (!session || session.controller.signal.aborted) return;
        clearTimers(session);
        session.controller.abort(reason);
        if (!session.settled) { session.settled = true; session.reject(session.controller.signal.reason); }
        closeTransport(session.socket);
    };
    const closeTransport = (socket: LifecycleWebSocket) => {
        // ws emits an asynchronous error when terminated while CONNECTING. Keep a sink until close.
        socket.removeAllListeners?.();
        if (socket.readyState === 3) return;
        socket.on('error', () => {});
        socket.on('close', () => socket.removeAllListeners?.());
        try {
            if (socket.terminate) socket.terminate();
            else socket.close(1000, 'Session retired');
        } catch { /* A retired transport cannot affect its replacement. */ }
    };
    const operationContext = (state: LifecycleState): OperationDeadlineContext | undefined => {
        const session = owner(state).active;
        if (!session) return undefined;
        return {
            signal: session.controller.signal,
            remainingBudgetMs: () => session.firstSubscriptionCreated ? Infinity : Math.max(0, session.firstSubscriptionAt - now())
        };
    };
    const subscriptionCreated = (state: LifecycleState) => {
        const session = owner(state).active;
        if (!session || !current(state, session)) return;
        session.firstSubscriptionCreated = true;
        if (session.startupTimer) clearTimeout(session.startupTimer);
        session.startupTimer = null;
    };
    const lose = (state: LifecycleState, session: Session, error: unknown, cause: LossCause, code: number | null = null) => {
        if (!current(state, session)) return;
        const phase = session.settled ? 'ready' : session.sessionId ? 'setting-up' : 'startup';
        const observedAt = now();
        const elapsed = (since: number | null) => since === null || !Number.isFinite(since) || !Number.isFinite(observedAt)
            ? null : Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(observedAt - since)));
        const value = owner(state);
        const wasActive = value.active === session;
        if (wasActive && session.readyAt !== null) value.unstableLosses = Math.min(value.unstableLosses + 1, 16);
        if (wasActive) {
            value.active = null;
            state.disconnectedSessionId = session.sessionId;
            state.ws = null;
            state.sessionId = null;
            state._isConnected = false;
            state.subscriptionsReady = false;
        } else {
            value.pending = null;
            if (state.ws === session.socket) state.ws = null;
        }
        retire(session, error);
        const activeSurvives = !wasActive && !!value.active;
        const failure = error as { code?: unknown; response?: { status?: number } };
        const recoveryBlocked = failure?.code === 'EVENTSUB_RETRY_AFTER_EXCEEDS_BUDGET';
        const authorizationFailure = failure?.response?.status === 401 || failure?.response?.status === 403;
        if (!activeSurvives && (recoveryBlocked || authorizationFailure)) state.isInitialized = false;
        const willReconnect = state.isInitialized && !value.disposed;
        try {
            state.logger?.warn?.('EventSub session lost', 'twitch', {
                cause, phase, closeCode: code === null ? null : Number.isInteger(code) && code >= 1000 && code <= 4999 ? code : 0,
                willReconnect: willReconnect || !!value.pending,
                terminal: recoveryBlocked || authorizationFailure,
                connectionAttempt: session.connectionAttempt,
                sessionAgeMs: elapsed(session.startedAt),
                silenceMs: elapsed(session.lastMessageAt),
                keepaliveTimeoutMs: session.keepaliveTimeoutMs,
                deadlineLatenessMs: cause === 'keepalive-timeout' ? elapsed(session.keepaliveDueAt) : null,
                ...(cause === 'socket-error' ? transportErrorCategory(error) : {})
            });
        } catch { /* Diagnostics cannot interrupt loss notification or recovery. */ }
        if (activeSurvives) return;
        notify(state, 'eventSubDisconnected', { code, reason: error instanceof Error ? error.message : String(error),
            abnormal: code !== 1000, willReconnect: willReconnect || !!value.pending, terminal: recoveryBlocked || authorizationFailure, recoveryBlocked, authorizationFailure });
        // An old transport closing during a handoff does not invalidate the pending migrated session.
        if (willReconnect && !value.pending && !value.operation) state._scheduleReconnect?.();
    };
    const connectWebSocket = (state: LifecycleState): Promise<void> => {
        const value = owner(state);
        if (value.disposed) return Promise.reject(new Error('EventSub disposed'));
        if (value.pending) return Promise.reject(new Error('EventSub connection already pending'));
        if (value.active && !state.reconnectUrl) return Promise.reject(new Error('EventSub session already active'));
        const handoff = !!state.reconnectUrl;
        return new Promise<void>((resolve, reject) => {
            let socket: LifecycleWebSocket;
            try { socket = new WebSocketCtor(state.reconnectUrl || 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30', { maxPayload: MAX_EVENTSUB_WS_MESSAGE_BYTES }); }
            catch (error) { reject(error); return; }
            const session: Session = { socket, controller: new AbortController(), sessionId: null,
                firstSubscriptionAt: Infinity, firstSubscriptionCreated: false, timer: null, startupTimer: null,
                settled: false, handoff, reject, connectionAttempt: ++value.nextConnectionAttempt,
                startedAt: now(), lastMessageAt: null, keepaliveTimeoutMs: null, keepaliveDueAt: null, readyAt: null };
            value.pending = session;
            if (!handoff) state.ws = socket;
            state.connectionStartTime = now();
            session.startupTimer = safeSetTimeout(() => lose(state, session, new Error('Connection timeout - no welcome message'), 'welcome-timeout'), 15000);
            const ready = () => {
                if (!current(state, session) || session.settled) return;
                session.settled = true;
                session.readyAt = now();
                state.subscriptionsReady = true;
                resolve();
                notify(state, 'eventSubConnected', { sessionId: session.sessionId });
            };
            let silenceMs = 0;
            const checkWatchdog = (deadline: number) => {
                if (!current(state, session) || session.keepaliveDueAt !== deadline) return;
                const remaining = deadline - now();
                if (remaining > 0) {
                    session.timer = safeSetTimeout(() => checkWatchdog(deadline), remaining);
                    return;
                }
                lose(state, session, new Error('EventSub keepalive silence timeout'), 'keepalive-timeout');
            };
            const resetWatchdog = () => {
                if (!silenceMs || !current(state, session)) return;
                if (session.timer) clearTimeout(session.timer);
                session.lastMessageAt = now();
                session.keepaliveTimeoutMs = silenceMs;
                const deadline = session.lastMessageAt + silenceMs + KEEPALIVE_GRACE_MS;
                session.keepaliveDueAt = deadline;
                if (session.readyAt !== null && session.lastMessageAt - session.readyAt >= STABLE_SESSION_MS) {
                    value.unstableLosses = 0;
                }
                session.timer = safeSetTimeout(() => checkWatchdog(deadline), silenceMs + KEEPALIVE_GRACE_MS);
            };
            socket.on('message', async (data: unknown) => {
                if (!current(state, session)) return;
                try {
                    const message = parseWebSocketMessage(data);
                    const metadata = message.metadata as Record<string, unknown> | undefined;
                    const type = metadata?.message_type;
                    if (type === 'session_welcome') {
                        if (session.sessionId || value.pending !== session) return;
                        const payload = message.payload as Record<string, unknown> | undefined;
                        const welcome = payload?.session as Record<string, unknown> | undefined;
                        const id = welcome?.id;
                        if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid session ID');
                        if (session.startupTimer) clearTimeout(session.startupTimer);
                        silenceMs = typeof welcome?.keepalive_timeout_seconds === 'number' && Number.isFinite(welcome.keepalive_timeout_seconds) && welcome.keepalive_timeout_seconds > 0 && welcome.keepalive_timeout_seconds <= 2147483
                            ? welcome.keepalive_timeout_seconds * 1000 : 10000;
                        session.sessionId = id;
                        session.firstSubscriptionAt = now() + silenceMs;
                        const previous = value.active;
                        value.active = session;
                        value.pending = null;
                        state.ws = socket;
                        state.sessionId = id;
                        state._isConnected = true;
                        try { state.logger?.debug?.('EventSub session established', 'twitch', { hasSessionId: true, keepaliveTimeout: welcome?.keepalive_timeout_seconds ?? null }); }
                        catch (error) { report(state, 'EventSub session reporting failed', error, 'eventsub-observer'); }
                        state.reconnectUrl = null;
                        resetWatchdog();
                        if (handoff) {
                            subscriptionCreated(state);
                            retire(previous);
                            ready();
                            return;
                        }
                        session.startupTimer = safeSetTimeout(() => lose(state, session, new Error('EventSub first subscription deadline exceeded'), 'first-subscription-timeout'), silenceMs);
                        if (state._validateConnectionForSubscriptions?.() === false) throw Object.assign(new Error('Connection validation failed before subscription setup'), { reason: 'connection-validation' });
                        const result = await state._setupEventSubscriptions?.(true);
                        if (!current(state, session)) return;
                        if (result?.aborted) throw Object.assign(new Error(`Subscription setup aborted: ${result.abortReason || 'unknown'}`), { reason: result.abortReason });
                        if (result?.failures?.length) {
                            type SetupFailure = { error?: { code?: string; status?: number | null; message?: string; details?: { code?: string } } };
                            const failures = result.failures as SetupFailure[];
                            // A later terminal rejection governs recovery even after an earlier transient failure.
                            const failure = (failures.find(({ error }) => error?.status === 401 || error?.status === 403
                                || (error?.details?.code || error?.code) === 'EVENTSUB_RETRY_AFTER_EXCEEDS_BUDGET') ?? failures[0])?.error;
                            throw Object.assign(new Error(`Subscription setup completed with failures${failure?.message ? `: ${failure.message}` : ''}`), {
                                code: failure?.details?.code || failure?.code,
                                response: failure?.status ? { status: failure.status } : undefined
                            });
                        }
                        subscriptionCreated(state);
                        ready();
                        return;
                    }
                    if (value.active !== session) return;
                    if (type === 'session_keepalive' || type === 'notification') resetWatchdog();
                    // Only notifications remain valid on the old session during a pending handoff.
                    if (value.pending?.handoff && type !== 'notification' && type !== 'session_keepalive' && type !== 'revocation') return;
                    await state.handleWebSocketMessage?.(message);
                } catch (error) {
                    if (!current(state, session)) return;
                    lose(state, session, error, 'message-or-setup-failure');
                    report(state, 'EventSub message/setup failed', error, 'ws-message');
                    notify(state, 'eventSubSubscriptionFailed', { sessionId: session.sessionId, reason: (error as { reason?: unknown })?.reason, error: error instanceof Error ? error.message : String(error) });
                }
            });
            socket.on('error', (error: unknown) => lose(state, session, normalizeWebSocketError(error), 'socket-error'));
            socket.on('close', (code: unknown) => {
                const closeCode = typeof code === 'number' ? code : 0;
                const phase = session.settled ? 'EventSub session' : session.sessionId ? 'EventSub subscription setup' : 'initial handshake';
                const error = new Error(closeCode === 1006 ? `Connection closed abnormally during ${phase}`
                    : session.settled ? 'EventSub session closed' : session.sessionId ? 'Connection closed before EventSub subscription setup completed' : 'Connection closed before EventSub startup completed') as Error & { closeCode: number };
                error.closeCode = closeCode;
                lose(state, session, error, 'socket-close', error.closeCode);
            });
        });
    };
    const scheduleReconnect = (state: LifecycleState): void => {
        const value = owner(state);
        if (value.disposed || !state.isInitialized || value.operation || value.pending || state.reconnectTimeout) return;
        if (state.retryAttempts >= state.maxRetryAttempts) {
            state.isInitialized = false;
            notify(state, 'eventSubDisconnected', { reason: 'max reconnect attempts exceeded', abnormal: true, willReconnect: false, terminal: true });
            return;
        }
        // Short-lived ready sessions affect backoff, not the consecutive setup-failure limit.
        const exponent = Math.max(state.retryAttempts, value.unstableLosses - 1);
        const ceiling = Math.min(state.retryDelay * Math.pow(2, exponent), 30000);
        const delay = ceiling * (0.5 + random() * 0.5);
        state.reconnectTimeout = safeSetTimeout(() => {
            state.reconnectTimeout = null;
            void state._reconnect?.();
        }, validateTimeout(delay, 1));
    };
    const reconnect = async (state: LifecycleState): Promise<void> => {
        const value = owner(state);
        if (value.disposed || !state.isInitialized || value.operation || value.pending) return;
        if (state.reconnectTimeout) clearTimeout(state.reconnectTimeout);
        state.reconnectTimeout = null;
        const operation = { controller: new AbortController(), kind: 'reconnect' as const };
        const generation = ++value.generation;
        value.operation = operation;
        const valid = () => !value.disposed && value.generation === generation && !operation.controller.signal.aborted;
        const handoff = !!state.reconnectUrl;
        if (!handoff) state.retryAttempts++;
        try {
            if (!state.twitchAuth?.isReady?.()) {
                report(state, 'Cannot reconnect - Twitch auth not ready', null, 'reconnect-auth');
                throw new Error('Twitch auth not ready for reconnection');
            }
            if (!handoff) {
                const sessionId = state.sessionId || state.disconnectedSessionId;
                const previous = value.active;
                const transport = state.ws;
                value.active = null;
                state.ws = null;
                state.sessionId = null;
                state._isConnected = state.subscriptionsReady = false;
                state.subscriptions?.clear?.();
                retire(previous);
                if (transport && transport !== previous?.socket) closeTransport(transport);
                if (sessionId) {
                    try { await state._deleteAllSubscriptions?.({ sessionId, operationContext: { signal: operation.controller.signal, remainingBudgetMs: () => 5000 } }); }
                    catch (error) { if (valid()) report(state, 'Failed to clean up previous session subscriptions before reconnect', error, 'reconnect-cleanup'); }
                }
                if (!valid()) return;
                await safeDelay(1000, 1, 'twitchEventSub:cleanup-delay', operation.controller.signal);
                if (!valid()) return;
            }
            await state._connectWebSocket?.();
            if (!valid()) return;
            state.retryAttempts = 0;
            state.disconnectedSessionId = null;
        } catch (error) {
            if (!valid()) return;
            state.reconnectUrl = null;
            if (handoff && value.active) {
                state.subscriptionsReady = false;
                notify(state, 'eventSubDisconnected', { reason: 'EventSub planned handoff failed', abnormal: true, willReconnect: true, terminal: false });
            }
            report(state, 'EventSub reconnection failed', error, 'reconnect-failed');
        } finally {
            if (value.operation === operation) value.operation = null;
            if (valid() && state.isInitialized && !state.subscriptionsReady) {
                if (state.retryAttempts >= state.maxRetryAttempts) {
                    report(state, 'EventSub reconnection abandoned after maximum attempts', null, 'reconnect-abandoned');
                    scheduleReconnect(state);
                } else state._scheduleReconnect?.();
            }
        }
    };
    const handleReconnectRequest = (state: LifecycleState, payload: Record<string, unknown> | null | undefined): void => {
        const value = owner(state);
        const session = payload?.session as Record<string, unknown> | undefined;
        const url = session?.reconnect_url;
        if (value.disposed || value.pending || typeof url !== 'string' || !url) return;
        if (value.operation?.kind === 'repair') {
            revokeSubscriptions(state, false, 'handoff interrupted subscription repair');
            return;
        }
        if (value.operation) return;
        if (value.active && !value.active.settled) {
            lose(state, value.active, new Error('Connection closed abnormally during EventSub subscription setup'), 'message-or-setup-failure');
            return;
        }
        if (state.reconnectTimeout) clearTimeout(state.reconnectTimeout);
        state.reconnectTimeout = null;
        state.reconnectUrl = url;
        try {
            const publicUrl = new URL(url);
            publicUrl.search = '';
            publicUrl.hash = '';
            state.logger?.info?.('EventSub requesting reconnection to new URL', 'twitch', { reconnectUrl: publicUrl.toString(), hasReconnectUrl: true });
        } catch { /* Invalid URLs are rejected by the transport. */ }
        // Planned migration is immediate and does not consume the failure allowance.
        void state._reconnect?.();
    };
    const dispose = (state: LifecycleState, permanent = true, reason = new Error('EventSub session retired')) => {
        const value = owner(state);
        value.disposed = permanent;
        value.generation++;
        value.operation?.controller.abort(new Error('EventSub operation retired'));
        value.operation = null;
        if (state.reconnectTimeout) clearTimeout(state.reconnectTimeout);
        state.reconnectTimeout = null;
        const active = value.active;
        const pending = value.pending;
        const transport = state.ws;
        value.active = value.pending = null;
        state.ws = null;
        state.sessionId = null;
        state._isConnected = state.subscriptionsReady = false;
        retire(active, reason);
        retire(pending, reason);
        if (transport && transport !== active?.socket && transport !== pending?.socket) closeTransport(transport);
    };
    const revokeSubscriptions = (state: LifecycleState, terminal: boolean, status: unknown) => {
        const sessionId = state.sessionId;
        const initialized = state.isInitialized;
        // Revocation invalidates the complete readiness claim, including any in-flight handoff.
        dispose(state, terminal, new Error(terminal ? 'EventSub subscription authorization/status revoked' : 'Subscription setup aborted: connection-lost'));
        state.subscriptions?.clear?.();
        state.reconnectUrl = null;
        state.disconnectedSessionId = sessionId ?? null;
        state.isInitialized = initialized && !terminal;
        notify(state, 'eventSubDisconnected', { reason: `subscription revoked: ${String(status)}`,
            willReconnect: !terminal, terminal, authorizationFailure: terminal });
        if (initialized && !terminal) scheduleReconnect(state);
    };
    const repairSubscriptions = async (state: LifecycleState, status: unknown, repair: () => Promise<void>) => {
        const value = owner(state);
        if (value.disposed) return;
        if (!state.isInitialized || value.pending || value.operation) {
            revokeSubscriptions(state, false, status);
            return;
        }
        const operation = { controller: new AbortController(), kind: 'repair' as const };
        const generation = ++value.generation;
        const sessionId = state.sessionId;
        value.operation = operation;
        const valid = () => !value.disposed && value.generation === generation && !operation.controller.signal.aborted;
        state.subscriptionsReady = false;
        notify(state, 'eventSubDisconnected', { reason: `subscription revoked: ${String(status)}`, willReconnect: true, terminal: false });
        try {
            await repair();
            if (!valid() || state.sessionId !== sessionId) return;
            state.subscriptionsReady = true;
            notify(state, 'eventSubConnected', { sessionId });
        } catch (error) {
            if (!valid()) return;
            report(state, 'EventSub revocation repair failed', error, 'subscription-resubscribe');
            const failure = error as { code?: unknown; response?: { status?: number } };
            const recoveryBlocked = failure?.code === 'EVENTSUB_RETRY_AFTER_EXCEEDS_BUDGET';
            const authorizationFailure = failure?.response?.status === 401 || failure?.response?.status === 403;
            if (recoveryBlocked || authorizationFailure) {
                dispose(state);
                state.isInitialized = false;
                notify(state, 'eventSubDisconnected', { reason: 'EventSub subscription repair failed', willReconnect: false, terminal: true, recoveryBlocked, authorizationFailure });
            }
        } finally {
            if (value.operation === operation) value.operation = null;
            if (valid() && !state.subscriptionsReady) scheduleReconnect(state);
        }
    };
    const isDisposed = (state: LifecycleState) => owner(state).disposed;
    const operationGeneration = (state: LifecycleState) => owner(state).generation;
    return { isDisposed, repairSubscriptions, operationGeneration, revokeSubscriptions, connectWebSocket, handleReconnectRequest, scheduleReconnect, reconnect, dispose, operationContext, subscriptionCreated };
}
export { createTwitchEventSubWsLifecycle };
