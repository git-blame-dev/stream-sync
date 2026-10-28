import * as axios from 'axios';

import { AuthConstants } from './auth-constants';
import { createHttpRetryExecutor, type RetryExecutor } from './http-retry-executor';
import { resolveLogger } from './logger-resolver';
import { withOperationDeadline } from './timeout-wrapper';
import { config as appConfig } from '../core/config';
import { DEFAULT_ENHANCED_TIMEOUT_MS } from '../core/config-schema';
import { sanitizeLogText } from '../core/logger/safe-log-serializer';
import { validateTimeout } from './timeout-validator';

type HttpClientAdapter = {
    get: (url: string, config: Record<string, unknown>) => Promise<Record<string, unknown>>;
    post: (url: string, data: unknown, config: Record<string, unknown>) => Promise<Record<string, unknown>>;
    put: (url: string, data: unknown, config: Record<string, unknown>) => Promise<Record<string, unknown>>;
    delete: (url: string, config: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const axiosModule = (axios as typeof axios & { default?: typeof axios }).default || axios;
const axiosClient: HttpClientAdapter = {
    get: (url: string, config: Record<string, unknown>) => axiosModule.get(url, config),
    post: (url: string, data: unknown, config: Record<string, unknown>) => axiosModule.post(url, data, config),
    put: (url: string, data: unknown, config: Record<string, unknown>) => axiosModule.put(url, data, config),
    delete: (url: string, config: Record<string, unknown>) => axiosModule.delete(url, config),
};

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type EnhancedHttpClientConfig = {
    axios?: HttpClientAdapter;
    logger?: unknown;
    timeout?: unknown;
    reachabilityTimeoutMs?: unknown;
    retryExecutor?: RetryExecutor;
    userAgents?: string[];
};

type RequestOptions = Record<string, unknown> & {
    authToken?: string;
    authType?: string | null | undefined;
    headers?: Record<string, string>;
    operationContext?: {
        operationType?: string;
        [key: string]: unknown;
    };
    userAgent?: string;
    timeout?: unknown;
    platform?: string;
    retryScope?: string;
    disableRetry?: boolean;
    maxAttempts?: number;
    idempotentRequest?: boolean;
    overallBudgetMs?: number;
    parentAbortSignal?: AbortSignal;
    signal?: AbortSignal;
};

type OperationContextInput = {
    operationType?: string;
    userInitiated?: boolean;
    streamingActive?: boolean;
    viewerCount?: number;
    userWaiting?: boolean;
};

function normalizeOperationContext(context: RequestOptions['operationContext'] | undefined): OperationContextInput | undefined {
    if (!context) {
        return undefined;
    }
    return {
        ...(typeof context.operationType === 'string' ? { operationType: context.operationType } : {}),
        ...(typeof context.userInitiated === 'boolean' ? { userInitiated: context.userInitiated } : {}),
        ...(typeof context.streamingActive === 'boolean' ? { streamingActive: context.streamingActive } : {}),
        ...(typeof context.viewerCount === 'number' ? { viewerCount: context.viewerCount } : {}),
        ...(typeof context.userWaiting === 'boolean' ? { userWaiting: context.userWaiting } : {})
    };
}

type HttpRuntimeConfig = {
    enhancedTimeoutMs?: unknown;
    enhancedReachabilityTimeoutMs?: unknown;
    userAgents?: unknown;
};

const resolveTimeout = (value: unknown, fallback: number): number => {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0 ? validateTimeout(parsed) : fallback;
};

const getDiagnosticErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'HTTP request failed';

const getHttpRuntimeConfig = (): HttpRuntimeConfig => {
    const httpConfig = (appConfig as { http?: unknown }).http;
    return httpConfig && typeof httpConfig === 'object' ? httpConfig as HttpRuntimeConfig : {};
};

const getConfiguredUserAgents = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
};

const prepareRequestBody = (data: unknown, headers: Record<string, string>): unknown => {
    const contentTypeEntries = Object.entries(headers).filter(([key]) => key.trim().toLowerCase() === 'content-type');
    const contentType = contentTypeEntries.at(-1)?.[1] ?? 'application/json';
    for (const [key] of contentTypeEntries) delete headers[key];
    headers['Content-Type'] = contentType;
    if (!contentType.trim().toLowerCase().startsWith('application/x-www-form-urlencoded') || data === null || typeof data !== 'object') {
        return data;
    }
    const prototype = Object.getPrototypeOf(data);
    if (prototype !== Object.prototype && prototype !== null) return data;
    return new URLSearchParams(Object.entries(data as Record<string, unknown>)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => [key, String(value)])).toString();
};

class EnhancedHttpClient {
    axios: NonNullable<EnhancedHttpClientConfig['axios']>;
    logger: ReturnType<typeof resolveLogger>;
    defaultTimeout: number;
    reachabilityTimeoutMs: number;
    retryExecutor: RetryExecutor;
    userAgents: string[];
    currentUserAgentIndex: number;

    constructor(config: EnhancedHttpClientConfig = {}) {
        this.axios = config.axios || axiosClient;
        this.logger = resolveLogger(config.logger, 'EnhancedHttpClient');
        const httpConfig = getHttpRuntimeConfig();
        this.defaultTimeout = resolveTimeout(config.timeout, resolveTimeout(httpConfig.enhancedTimeoutMs, DEFAULT_ENHANCED_TIMEOUT_MS));
        this.reachabilityTimeoutMs = resolveTimeout(config.reachabilityTimeoutMs, resolveTimeout(httpConfig.enhancedReachabilityTimeoutMs, 5_000));
        this.retryExecutor = config.retryExecutor || createHttpRetryExecutor({ logger: this.logger });
        this.userAgents = getConfiguredUserAgents(Array.isArray(config.userAgents) ? config.userAgents : httpConfig.userAgents);
        this.currentUserAgentIndex = 0;
    }

    buildAuthHeaders(authToken: string | undefined, authType: string | null = 'bearer'): Record<string, string> {
        const scheme = authType == null ? 'bearer' : typeof authType === 'string' ? authType.trim().toLowerCase() : '';
        if (!['bearer', 'oauth', 'app'].includes(scheme)) throw new TypeError('Unsupported auth type');
        if (!authToken) {
            return {};
        }

        if (scheme === 'oauth') {
            return { Authorization: `OAuth ${authToken}` };
        }

        return { Authorization: `Bearer ${authToken}` };
    }

    getNextUserAgent(): string {
        if (this.userAgents.length === 0) {
            return '';
        }

        const userAgent = this.userAgents[this.currentUserAgentIndex];
        this.currentUserAgentIndex = (this.currentUserAgentIndex + 1) % this.userAgents.length;
        return userAgent ?? '';
    }

    buildRequestConfig(options: RequestOptions = {}): Record<string, unknown> {
        const {
            authToken, authType, headers, operationContext,
            overallBudgetMs: _overallBudgetMs, parentAbortSignal: _parentAbortSignal,
            platform: _platform, retryScope: _retryScope, disableRetry: _disableRetry,
            maxAttempts: _maxAttempts, idempotentRequest: _idempotentRequest,
            userAgent, ...axiosOptions
        } = options;
        const authHeaders = this.buildAuthHeaders(authToken, authType);

        let timeout = resolveTimeout(axiosOptions.timeout, this.defaultTimeout);
        if (operationContext) {
            timeout = this.getStreamingOptimizedTimeout(normalizeOperationContext(operationContext), axiosOptions.timeout);
        }

        const resolvedUserAgent = typeof userAgent === 'string' ? userAgent.trim() : this.getNextUserAgent();
        const ownsUserAgent = typeof userAgent === 'string' || resolvedUserAgent.length > 0;
        const requestHeaders = Object.fromEntries(Object.entries(headers ?? {}).filter(([name, value]) => {
            const normalizedName = name.trim().toLowerCase();
            if (normalizedName === 'authorization' && authHeaders.Authorization) return false;
            if (normalizedName === 'user-agent') return !ownsUserAgent && typeof value === 'string' && value.trim().length > 0;
            return true;
        }));
        if (authHeaders.Authorization) requestHeaders.Authorization = authHeaders.Authorization;
        if (resolvedUserAgent) requestHeaders['User-Agent'] = resolvedUserAgent;

        return {
            ...axiosOptions,
            ...(authHeaders.Authorization ? { auth: null } : {}),
            timeout,
            headers: requestHeaders
        };
    }

    private validateUrlAuthentication(url: string, options: RequestOptions): void {
        if (!options.authToken) return;
        const baseURL = options.baseURL;
        // Match Axios buildFullPath/combineURLs before WHATWG URL normalization.
        const effectiveUrl = typeof baseURL === 'string' && baseURL &&
            (!/^([a-z][a-z\d+\-.]*:)?\/\//i.test(url) || options.allowAbsoluteUrls === false)
            ? `${baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
            : url;
        for (const candidate of [url, baseURL, effectiveUrl]) {
            if (typeof candidate !== 'string') continue;
            let parsed: URL;
            try {
                parsed = new URL(candidate);
            } catch {
                continue;
            }
            if (parsed.username || parsed.password) throw new TypeError('Conflicting URL authentication');
        }
    }

    getStreamingOptimizedTimeout(context: OperationContextInput | undefined, explicitTimeout: unknown): number {
        const resolvedTimeout = resolveTimeout(explicitTimeout, Number.NaN);
        if (Number.isFinite(resolvedTimeout) && resolvedTimeout > 0) {
            return resolvedTimeout;
        }

        try {
            const criticality = AuthConstants.determineOperationCriticality(context ?? {});
            const operationType = typeof context?.operationType === 'string' ? context.operationType : 'tokenValidation';
            return resolveTimeout(AuthConstants.getStreamingOptimizedTimeout(criticality, operationType), this.defaultTimeout);
        } catch (error) {
            const message = getDiagnosticErrorMessage(error);
            this.logger.debug('Failed to get streaming timeout, using default', 'enhanced-http-client', sanitizeLogText(message));
            return this.defaultTimeout;
        }
    }

    async executeRequest(method: HttpMethod, url: string, data: unknown, options: RequestOptions = {}): Promise<Record<string, unknown>> {
        const {
            platform,
            retryScope,
            disableRetry = false,
            maxAttempts,
            idempotentRequest = false,
            maxRetries,
            overallBudgetMs,
            parentAbortSignal,
            signal: requestSignal,
            ...requestOptions
        } = options;

        if (maxRetries !== undefined) {
            throw new Error('maxRetries is not supported; use maxAttempts');
        }

        const parentSignal = parentAbortSignal && requestSignal
            ? AbortSignal.any([parentAbortSignal, requestSignal])
            : parentAbortSignal ?? requestSignal;
        parentSignal?.throwIfAborted();
        if (requestOptions.responseType === 'stream') {
            throw new Error("EnhancedHttpClient does not support responseType 'stream': its operation lifetime must include response body consumption");
        }
        return withOperationDeadline(async ({ signal, remainingBudgetMs }) => {
            const config = this.buildRequestConfig({ ...requestOptions, signal });
            this.validateUrlAuthentication(url, requestOptions);

            const makeRequest = async (): Promise<Record<string, unknown>> => {
                signal.throwIfAborted();
                this.logger.debug(sanitizeLogText(`HTTP ${method}: ${url}`), 'enhanced-http-client');
                let response: Record<string, unknown>;

                switch (method) {
                    case 'GET':
                        response = await this.axios.get(url, config);
                        break;
                    case 'POST': {
                        const headers = (config.headers || {}) as Record<string, string>;
                        const postData = prepareRequestBody(data, headers);
                        response = await this.axios.post(url, postData, config);
                        break;
                    }
                    case 'PUT': {
                        const headers = (config.headers || {}) as Record<string, string>;
                        const putData = prepareRequestBody(data, headers);
                        response = await this.axios.put(url, putData, config);
                        break;
                    }
                    case 'DELETE':
                        response = await this.axios.delete(url, config);
                        break;
                }

                if (response && typeof response === 'object' && typeof response.status !== 'number') {
                    const statusCode = typeof response.statusCode === 'number' ? response.statusCode : 200;
                    response.status = statusCode;
                    response.statusText = typeof response.statusText === 'string' ? response.statusText : 'OK';
                    response.headers = response.headers || {};
                    response.config = response.config || {};
                }

                this.logger.debug(sanitizeLogText(`HTTP ${method} Success: ${url} (${String(response.status)})`), 'enhanced-http-client');
                return response;
            };

            const retryOwner = retryScope || platform;
            const retryAllowed = method !== 'POST' || idempotentRequest;
            try {
                if (retryOwner && !disableRetry && retryAllowed) {
                    return await this.retryExecutor.executeWithRetry(retryOwner, makeRequest, maxAttempts, { signal, remainingBudgetMs });
                }
                return await makeRequest();
            } catch (error) {
                try {
                    const message = getDiagnosticErrorMessage(error);
                    this.logger.debug(sanitizeLogText(`HTTP ${method} Error: ${url} - ${message}`), 'enhanced-http-client');
                } catch {
                    // Terminal diagnostics must not replace the original request failure.
                }
                throw error;
            }
        }, { budgetMs: overallBudgetMs, parentAbortSignal: parentSignal, operationName: `HTTP ${method}` });
    }

    async get(url: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
        return this.executeRequest('GET', url, null, options);
    }

    async post(url: string, data: unknown = {}, options: RequestOptions = {}): Promise<Record<string, unknown>> {
        return this.executeRequest('POST', url, data, options);
    }

    async put(url: string, data: unknown = {}, options: RequestOptions = {}): Promise<Record<string, unknown>> {
        return this.executeRequest('PUT', url, data, options);
    }

    async delete(url: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
        return this.executeRequest('DELETE', url, null, options);
    }

    async isReachable(url: string, options: RequestOptions = {}): Promise<boolean> {
        try {
            const response = await this.get(url, {
                ...options,
                timeout: resolveTimeout(options.timeout, this.reachabilityTimeoutMs)
            });
            const status = typeof response.status === 'number' ? response.status : 0;
            return status >= 200 && status < 400;
        } catch {
            return false;
        }
    }
}

function createEnhancedHttpClient(config?: EnhancedHttpClientConfig): EnhancedHttpClient {
    return new EnhancedHttpClient(config);
}

export {
    EnhancedHttpClient,
    createEnhancedHttpClient
};
