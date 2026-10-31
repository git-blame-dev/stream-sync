import * as axiosModule from 'axios';
import { withOperationDeadline, type OperationDeadlineContext } from '../../../utils/timeout-wrapper';
import type { AxiosResponse } from 'axios';
import { safeDelay } from '../../../utils/timeout-validator';
import { extractHttpErrorDetails } from '../../../utils/http-error-utils';
import { validateLoggerInterface } from '../../../utils/dependency-validator';
import { secrets } from '../../../core/secrets';

const STARTUP_CLEANUP_DELETE_CONCURRENCY = 3;
const STARTUP_STALE_WEBSOCKET_STATUS = 'websocket_disconnected';
const CLEANUP_PAGE_LIMIT = 100;
const CLEANUP_CURSOR_MAX_LENGTH = 4096;

type LoggerLike = {
  info: (message: string, scope?: string, payload?: unknown) => void;
  warn: (message: string, scope?: string, payload?: unknown) => void;
  debug: (message: string, scope?: string, payload?: unknown) => void;
};

type TwitchAuthLike = {
  refreshTokens: () => Promise<boolean>;
};

type AxiosClientLike = {
  get: <T = unknown>(url: string, config?: unknown) => Promise<AxiosResponse<T>>;
  post: <T = unknown>(url: string, data?: unknown, config?: unknown) => Promise<AxiosResponse<T>>;
  delete: <T = unknown>(url: string, config?: unknown) => Promise<AxiosResponse<T>>;
};

type AxiosMethodName = keyof AxiosClientLike;

type SubscriptionDefinition = {
  name: string;
  type: string;
  version: string;
  getCondition: (input: { userId: string; broadcasterId: string }) => Record<string, unknown>;
};

type SubscriptionManagerOptions = {
  logger?: LoggerLike;
  twitchAuth?: TwitchAuthLike;
  config?: Record<string, unknown>;
  subscriptions?: Map<string, Record<string, unknown>>;
  axios?: AxiosClientLike;
  getClientId?: () => string | null;
  validateConnectionForSubscriptions?: () => boolean;
  logError?: (message: string, error?: unknown, eventType?: string, payload?: Record<string, unknown>) => void;
  now?: () => number;
  onSubscriptionCreated?: () => void;
};

type SubscriptionErrorDetails = {
  code: string;
  message: string;
  status: number | null;
  isCritical: boolean;
  isRetryable: boolean;
  details: Record<string, unknown>;
};

type SubscriptionSetupResult = {
  successful: number;
  total: number;
  failures: Array<{ subscription: string; error: SubscriptionErrorDetails }>;
  timestamp: number;
  aborted?: boolean;
  abortReason?: 'connection-lost' | 'auth-missing';
};

type EventSubRemoteSubscription = {
  id: string;
  status: string;
  type: string;
  transport?: {
    method?: string;
    session_id?: string;
  };
};

type EventSubSubscriptionResponse = {
  data: EventSubRemoteSubscription[];
  pagination?: { cursor?: string };
};

const getRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' ? value as Record<string, unknown> : null;

const getMember = (value: unknown, key: string): unknown => {
    if ((value && typeof value === 'object') || typeof value === 'function') {
        return (value as Record<string, unknown>)[key];
    }

    return undefined;
};

const isAxiosClientLike = (value: unknown): value is AxiosClientLike => (
    typeof getMember(value, 'get') === 'function'
    && typeof getMember(value, 'post') === 'function'
    && typeof getMember(value, 'delete') === 'function'
);

const hasAnyAxiosMethod = (value: unknown): boolean => (
    typeof getMember(value, 'get') === 'function'
    || typeof getMember(value, 'post') === 'function'
    || typeof getMember(value, 'delete') === 'function'
);

const createMissingAxiosMethod = (methodName: AxiosMethodName): AxiosClientLike[AxiosMethodName] => {
    return async () => {
        throw new Error(`TwitchEventSub subscription manager axios client is missing ${methodName}`);
    };
};

const resolveAxiosMethod = (candidate: unknown, methodName: AxiosMethodName): AxiosClientLike[AxiosMethodName] => {
    const method = getMember(candidate, methodName);
    if (typeof method === 'function') {
        return method.bind(candidate) as AxiosClientLike[AxiosMethodName];
    }

    return createMissingAxiosMethod(methodName);
};

const resolveAxiosClient = (candidate: unknown): AxiosClientLike => {
    if (isAxiosClientLike(candidate)) {
        return candidate;
    }

    const defaultExport = getMember(candidate, 'default');
    if (isAxiosClientLike(defaultExport)) {
        return defaultExport;
    }

    const partialClient = hasAnyAxiosMethod(candidate)
        ? candidate
        : defaultExport;
    if (hasAnyAxiosMethod(partialClient)) {
        return {
            get: resolveAxiosMethod(partialClient, 'get'),
            post: resolveAxiosMethod(partialClient, 'post'),
            delete: resolveAxiosMethod(partialClient, 'delete')
        };
    }

    throw new Error('TwitchEventSub subscription manager requires an axios-compatible HTTP client');
};

const getAxiosErrorResponse = (error: unknown): { status?: number; data?: unknown } | null => {
    const response = getRecord(error)?.response;
    return response && typeof response === 'object' ? response as { status?: number; data?: unknown } : null;
};

const getSubscriptionResponseData = (response: AxiosResponse<EventSubSubscriptionResponse>): EventSubRemoteSubscription[] => response.data.data;

const getFirstSubscription = (response: AxiosResponse<EventSubSubscriptionResponse>): EventSubRemoteSubscription => {
    const [subscription] = getSubscriptionResponseData(response);
    if (!subscription) {
        throw new Error('Twitch EventSub response did not include subscription data');
    }
    return subscription;
};

function createTwitchEventSubSubscriptionManager(options: SubscriptionManagerOptions = {}) {
    const {
        logger,
        twitchAuth,
        subscriptions,
        axios: injectedAxios,
        getClientId,
        validateConnectionForSubscriptions,
        logError,
        onSubscriptionCreated,
        now = () => Date.now()
    } = options;

    const axios = resolveAxiosClient(injectedAxios ?? axiosModule);

    const safeLogger = (() => {
        if (!logger) {
            throw new Error('TwitchEventSub subscription manager requires a logger dependency');
        }
        validateLoggerInterface(logger);
        return logger;
    })();
    const report = (diagnostic: () => void) => {
        try { diagnostic(); }
        catch { /* Diagnostics cannot replace subscription failures or interrupt remote cleanup. */ }
    };
    const safeLogError: NonNullable<SubscriptionManagerOptions['logError']> = (...args) => report(() => logError?.(...args));
    const safeGetClientId = typeof getClientId === 'function' ? getClientId : () => null;
    if (!twitchAuth) {
        throw new Error('TwitchEventSub subscription manager requires twitchAuth');
    }
    if (!subscriptions) {
        throw new Error('TwitchEventSub subscription manager requires subscriptions');
    }
    const safeSubscriptions = subscriptions;
    const safeValidateConnection = typeof validateConnectionForSubscriptions === 'function'
        ? validateConnectionForSubscriptions
        : () => false;

  const parseSubscriptionError = (error: unknown, subscription: SubscriptionDefinition): SubscriptionErrorDetails => {
        const httpDetails = extractHttpErrorDetails(error);

        const response = getAxiosErrorResponse(error);
        const errorData = getRecord(response?.data);
        if (errorData) {
            const errorCode = typeof errorData.error === 'string' ? errorData.error : 'HTTP_ERROR';
            const errorMessage = typeof errorData.message === 'string' ? errorData.message : httpDetails.message;

            const status = response?.status;
            const isCritical = typeof status === 'number'
                ? status === 401 || status === 403
                : ['Unauthorized', 'Forbidden'].includes(errorCode);
            const isRetryable = typeof status === 'number'
                ? status === 429 || (status >= 500 && status <= 599)
                : ['Too Many Requests', 'Internal Server Error'].includes(errorCode);

            return {
                code: errorCode,
                message: errorMessage,
                status: typeof response?.status === 'number' ? response.status : null,
                isCritical,
                isRetryable,
                details: httpDetails
            };
        }

        return {
            code: httpDetails.code || (/deadline|timeout/i.test(httpDetails.message) ? 'ETIMEDOUT' : 'NETWORK_ERROR'),
            message: httpDetails.message,
            status: response?.status ?? null,
            isCritical: response?.status === 401 || response?.status === 403,
            isRetryable: typeof response?.status === 'number'
                ? response.status === 429 || (response.status >= 500 && response.status <= 599)
                : httpDetails.code !== 'EVENTSUB_RETRY_AFTER_EXCEEDS_BUDGET',
            details: httpDetails
        };
    };

    const getAuthHeaders = async () => ({
        'Authorization': `Bearer ${secrets.twitch.accessToken}`,
        'Client-Id': safeGetClientId(),
        'Content-Type': 'application/json'
    });

    const getTimestamp = () => now();

    const ensureAuthReady = async () => {
        const clientId = safeGetClientId();
        const accessToken = secrets.twitch.accessToken;

        if (!clientId || !accessToken) {
            safeLogError('Missing authentication tokens for EventSub subscriptions', null, 'subscription-auth-missing', {
                hasClientId: !!clientId,
                hasAccessToken: !!accessToken
            });
            return false;
        }

        return true;
    };

  // Each request and the complete operation are bounded. No generic HTTP retry wraps POST.
    const request = async <T>(method: AxiosMethodName, context: OperationDeadlineContext, payload?: unknown, id?: string, cursor?: string): Promise<AxiosResponse<T>> => {
        context.signal.throwIfAborted();
        return withOperationDeadline(async ({ signal, remainingBudgetMs }) => {
            const execute = async () => {
                signal.throwIfAborted();
                const headers = await getAuthHeaders();
                signal.throwIfAborted();
                const url = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');
                if (id) url.searchParams.set('id', id);
                if (cursor) url.searchParams.set('after', cursor);
                const config = { headers, signal, timeout: Math.max(1, Math.ceil(remainingBudgetMs())) };
                if (method === 'post') return axios.post<T>(url.toString(), payload, config);
                if (method === 'delete') return axios.delete<T>(url.toString(), config);
                return axios.get<T>(url.toString(), config);
            };
            try { return await execute(); }
            catch (error) {
                signal.throwIfAborted();
                if (getAxiosErrorResponse(error)?.status !== 401) throw error;
                // TwitchAuth remains the sole refresh owner/coordinator.
                const refreshed = await twitchAuth.refreshTokens();
                signal.throwIfAborted();
                if (!refreshed || !secrets.twitch.accessToken) throw error;
                return execute();
            }
        }, { parentAbortSignal: context.signal, budgetMs: Math.min(5000, context.remainingBudgetMs()), operationName: `Twitch EventSub ${method}` });
    };

    const setupEventSubscriptions = async ({ requiredSubscriptions, userId, broadcasterId, sessionId,
        subscriptionDelay, validationAlreadyDone = false, operationContext }: {
        requiredSubscriptions: SubscriptionDefinition[];
        userId: string;
        broadcasterId: string;
        sessionId: string | null;
        subscriptionDelay: number;
        validationAlreadyDone?: boolean;
        operationContext?: OperationDeadlineContext | undefined;
    }): Promise<SubscriptionSetupResult> => withOperationDeadline(async (overall) => {
        const context: OperationDeadlineContext = {
            signal: overall.signal,
            remainingBudgetMs: () => Math.min(overall.remainingBudgetMs(), operationContext?.remainingBudgetMs() ?? Infinity)
        };
        const valid = () => !context.signal.aborted && safeValidateConnection();
        report(() => safeLogger.debug('Setting up EventSub subscriptions', 'twitch', { total: requiredSubscriptions.length }));
        const failures: SubscriptionSetupResult['failures'] = [];
        let successful = 0;
        const result = (abortReason?: 'connection-lost' | 'auth-missing'): SubscriptionSetupResult => ({
            successful, total: requiredSubscriptions.length, failures, timestamp: now(),
            ...(abortReason ? { aborted: true, abortReason } : {})
        });
        if (!validationAlreadyDone && !valid()) return result('connection-lost');
        if (!(await ensureAuthReady())) return result('auth-missing');
        for (const subscription of requiredSubscriptions) {
            context.signal.throwIfAborted();
            if (!valid()) return result('connection-lost');
            const payload = { type: subscription.type, version: subscription.version,
                condition: subscription.getCondition({ userId, broadcasterId }),
                transport: { method: 'websocket', session_id: sessionId } };
            try {
                let response: AxiosResponse<EventSubSubscriptionResponse>;
                for (;;) {
                    try { response = await request<EventSubSubscriptionResponse>('post', context, payload); break; }
                    catch (error) {
                        context.signal.throwIfAborted();
                        const status = getAxiosErrorResponse(error)?.status;
                        // Only an explicit rejection can be retried. A timeout/network failure has an ambiguous outcome.
                        if (status !== 429) throw error;
                        const headers = getRecord(getRecord(error)?.response)?.headers as Record<string, unknown> | undefined;
                        const retryAfter = headers?.['retry-after'];
                        const seconds = Number(retryAfter);
                        const dateDelay = typeof retryAfter === 'string' ? Date.parse(retryAfter) - now() : 0;
                        const delay = Math.max(1000, Number.isFinite(seconds) ? seconds * 1000 : (Number.isFinite(dateDelay) ? dateDelay : 0));
                        if (delay >= context.remainingBudgetMs()) throw Object.assign(new Error('EventSub Retry-After exceeds remaining operation budget'), { code: 'EVENTSUB_RETRY_AFTER_EXCEEDS_BUDGET' });
                        await safeDelay(delay, 1, 'twitchEventSub:subscription-retry', context.signal);
                        if (!valid()) return result('connection-lost');
                    }
                }
                context.signal.throwIfAborted();
                if (!valid()) return result('connection-lost');
                const subData = getFirstSubscription(response);
                safeSubscriptions.set(subData.id, { ...subscription, id: subData.id, status: subData.status, sessionId });
                successful++;
                onSubscriptionCreated?.();
                if (subscriptionDelay > 0 && successful < requiredSubscriptions.length) {
                    await safeDelay(subscriptionDelay, 1, 'twitchEventSub:subscription-delay', context.signal);
                }
            } catch (error) {
                context.signal.throwIfAborted();
                const details = parseSubscriptionError(error, subscription);
                if (!valid()) { failures.push({ subscription: subscription.name, error: details }); return result('connection-lost'); }
                failures.push({ subscription: subscription.name, error: details });
                safeLogError(`Failed to create EventSub subscription (type ${subscription.type}, status ${details.status ?? 'unknown'}, retryable ${details.isRetryable})`, error, 'subscription-create', { type: subscription.type });
                if (details.message.toLowerCase().includes('websocket session has already disconnected')) return result('connection-lost');
                if (details.isCritical || !details.isRetryable) break;
            }
        }
        return result();
    }, { budgetMs: 30000, parentAbortSignal: operationContext?.signal, operationName: 'Twitch EventSub subscription setup' });

    type CleanupOptions = { sessionId?: string | null; operationContext?: OperationDeadlineContext };
    const cleanupRemote = async ({ sessionId, operationContext }: CleanupOptions, startup: boolean) => {
        try {
            await withOperationDeadline(async (overall) => {
                const context: OperationDeadlineContext = {
                    signal: overall.signal,
                    remainingBudgetMs: () => Math.min(overall.remainingBudgetMs(), operationContext?.remainingBudgetMs() ?? Infinity)
                };
                if (!(await ensureAuthReady())) return;
                // Never target every active session when the caller has no owned session ID.
                if (!startup && !sessionId) return;
                const listed: EventSubRemoteSubscription[] = [];
                const cursors = new Set<string>();
                let cursor: string | undefined;
                for (let page = 0; page < CLEANUP_PAGE_LIMIT; page++) {
                    const response = await request<EventSubSubscriptionResponse>('get', context, undefined, undefined, cursor);
                    context.signal.throwIfAborted();
                    const body = getRecord(response.data);
                    if (!Array.isArray(body?.data)) throw new Error('Invalid EventSub cleanup page');
                    for (const value of body.data) {
                        const sub = getRecord(value);
                        if (!sub || typeof sub.id !== 'string' || !sub.id.trim()) throw new Error('Invalid EventSub cleanup subscription');
                        listed.push(value as EventSubRemoteSubscription);
                    }
                    if (body.pagination === undefined) break;
                    const pagination = getRecord(body.pagination);
                    if (!pagination || Array.isArray(pagination)) throw new Error('Invalid EventSub cleanup pagination');
                    if (pagination.cursor === undefined) break;
                    if (typeof pagination.cursor !== 'string' || !pagination.cursor.trim()
                        || pagination.cursor.length > CLEANUP_CURSOR_MAX_LENGTH) throw new Error('Invalid EventSub cleanup cursor');
                    cursor = pagination.cursor;
                    if (cursors.has(cursor)) throw new Error('Repeated EventSub cleanup cursor');
                    cursors.add(cursor);
                    if (page + 1 === CLEANUP_PAGE_LIMIT) throw new Error('EventSub cleanup page limit exceeded');
                }
                const subscriptions = listed.filter(sub => sub.transport?.method === 'websocket'
                    && (sessionId ? sub.transport.session_id === sessionId : sub.status === STARTUP_STALE_WEBSOCKET_STATUS));
                let nextIndex = 0;
                const worker = async () => {
                    while (nextIndex < subscriptions.length) {
                        context.signal.throwIfAborted();
                        const subscription = subscriptions[nextIndex++];
                        if (!subscription) return;
                        try {
                            await request('delete', context, undefined, subscription.id);
                            context.signal.throwIfAborted();
                            // Local release is owned by the session lifecycle, never by late DELETE results.
                        } catch {
                            context.signal.throwIfAborted();
                            safeLogError('Failed to delete EventSub subscription', new Error('EventSub DELETE failed'), 'subscription-delete');
                        }
                    }
                };
                await Promise.all(Array.from({ length: Math.min(STARTUP_CLEANUP_DELETE_CONCURRENCY, subscriptions.length) }, worker));
            }, { budgetMs: Math.min(5000, operationContext?.remainingBudgetMs() ?? 5000),
                parentAbortSignal: operationContext?.signal, operationName: 'Twitch EventSub cleanup' });
        } catch (error) {
            if (!operationContext?.signal.aborted) {
                const reasons = new Set([
                    'Invalid EventSub cleanup page', 'Invalid EventSub cleanup subscription',
                    'Invalid EventSub cleanup pagination', 'Invalid EventSub cleanup cursor',
                    'Repeated EventSub cleanup cursor', 'EventSub cleanup page limit exceeded'
                ]);
                const reason = error instanceof Error && reasons.has(error.message) ? error.message : 'EventSub cleanup request failed';
                safeLogError('EventSub remote cleanup incomplete', new Error(reason), 'eventsub-cleanup');
            }
        }
    };
    const cleanupAllWebSocketSubscriptions = (options: CleanupOptions = {}) => cleanupRemote(options, true);
    const deleteAllSubscriptions = (options: CleanupOptions = {}) => cleanupRemote(options, false);
    return { setupEventSubscriptions, parseSubscriptionError, cleanupAllWebSocketSubscriptions, deleteAllSubscriptions, getTimestamp };
}
export { createTwitchEventSubSubscriptionManager };
