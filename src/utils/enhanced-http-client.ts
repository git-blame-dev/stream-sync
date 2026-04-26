const axios = require('axios') as {
    get: (url: string, config: Record<string, unknown>) => Promise<Record<string, unknown>>;
    post: (url: string, data: unknown, config: Record<string, unknown>) => Promise<Record<string, unknown>>;
    put: (url: string, data: unknown, config: Record<string, unknown>) => Promise<Record<string, unknown>>;
    delete: (url: string, config: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

import { resolveLogger } from './logger-resolver';
import { createRetrySystem, type RetrySystem } from './retry-system';
import { config as appConfig } from '../core/config';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type EnhancedHttpClientConfig = {
    axios?: {
        get: (url: string, config: Record<string, unknown>) => Promise<Record<string, unknown>>;
        post: (url: string, data: unknown, config: Record<string, unknown>) => Promise<Record<string, unknown>>;
        put: (url: string, data: unknown, config: Record<string, unknown>) => Promise<Record<string, unknown>>;
        delete: (url: string, config: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
    logger?: unknown;
    timeout?: unknown;
    reachabilityTimeoutMs?: unknown;
    retrySystem?: RetrySystem;
    userAgents?: string[];
};

type RequestOptions = Record<string, unknown> & {
    authToken?: string;
    authType?: string;
    headers?: Record<string, string>;
    operationContext?: {
        operationType?: string;
        [key: string]: unknown;
    };
    userAgent?: string;
    timeout?: unknown;
    platform?: string;
    disableRetry?: boolean;
    maxRetries?: number;
};

const resolveTimeout = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

class EnhancedHttpClient {
    axios: NonNullable<EnhancedHttpClientConfig['axios']>;
    logger: ReturnType<typeof resolveLogger>;
    defaultTimeout: number;
    reachabilityTimeoutMs: number;
    retrySystem: RetrySystem;
    userAgents: string[];
    currentUserAgentIndex: number;

    constructor(config: EnhancedHttpClientConfig = {}) {
        this.axios = config.axios || axios;
        this.logger = resolveLogger(config.logger, 'EnhancedHttpClient');
        this.defaultTimeout = resolveTimeout(config.timeout, appConfig.http.enhancedTimeoutMs);
        this.reachabilityTimeoutMs = resolveTimeout(config.reachabilityTimeoutMs, appConfig.http.enhancedReachabilityTimeoutMs);
        this.retrySystem = config.retrySystem || createRetrySystem({ logger: this.logger });
        this.userAgents = Array.isArray(config.userAgents)
            ? config.userAgents.slice()
            : appConfig.http.userAgents.slice();
        this.currentUserAgentIndex = 0;
    }

    buildAuthHeaders(authToken: string | undefined, authType = 'bearer'): Record<string, string> {
        if (!authToken) {
            return {};
        }

        if (authType === 'oauth') {
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
        return userAgent;
    }

    buildRequestConfig(options: RequestOptions = {}): Record<string, unknown> {
        const { authToken, authType, headers, operationContext, ...axiosOptions } = options;
        const authHeaders = this.buildAuthHeaders(authToken, authType);

        let timeout = resolveTimeout(axiosOptions.timeout, this.defaultTimeout);
        if (operationContext) {
            timeout = this.getStreamingOptimizedTimeout(operationContext, axiosOptions.timeout);
        }

        return {
            timeout,
            headers: {
                'User-Agent': typeof axiosOptions.userAgent === 'string' ? axiosOptions.userAgent : this.getNextUserAgent(),
                ...authHeaders,
                ...(headers || {})
            },
            ...axiosOptions
        };
    }

    getStreamingOptimizedTimeout(context: RequestOptions['operationContext'], explicitTimeout: unknown): number {
        const resolvedTimeout = resolveTimeout(explicitTimeout, Number.NaN);
        if (Number.isFinite(resolvedTimeout) && resolvedTimeout > 0) {
            return resolvedTimeout;
        }

        try {
            const { AuthConstants } = require('./auth-constants') as {
                AuthConstants: {
                    determineOperationCriticality: (ctx: unknown) => unknown;
                    getStreamingOptimizedTimeout: (criticality: unknown, operationType: string) => number;
                };
            };
            const criticality = AuthConstants.determineOperationCriticality(context);
            const operationType = typeof context?.operationType === 'string' ? context.operationType : 'tokenValidation';
            return AuthConstants.getStreamingOptimizedTimeout(criticality, operationType);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.debug('Failed to get streaming timeout, using default', 'enhanced-http-client', message);
            return this.defaultTimeout;
        }
    }

    async executeRequest(method: HttpMethod, url: string, data: unknown, options: RequestOptions = {}): Promise<Record<string, unknown>> {
        const {
            platform,
            disableRetry = false,
            maxRetries,
            ...requestOptions
        } = options;

        const config = this.buildRequestConfig(requestOptions);

        const makeRequest = async (): Promise<Record<string, unknown>> => {
            this.logger.debug(`HTTP ${method}: ${url}`, 'enhanced-http-client');
            let response: Record<string, unknown>;

            switch (method) {
                case 'GET':
                    response = await this.axios.get(url, config);
                    break;
                case 'POST': {
                    const headers = (config.headers || {}) as Record<string, string>;
                    const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
                    if (!hasContentType) {
                        headers['Content-Type'] = 'application/json';
                    }

                    let postData = data;
                    const contentTypeHeaderKey = Object.keys(headers).find((key) => key.toLowerCase() === 'content-type');
                    if (
                        contentTypeHeaderKey
                        && headers[contentTypeHeaderKey] === 'application/x-www-form-urlencoded'
                        && data
                        && typeof data === 'object'
                        && !(data instanceof URLSearchParams)
                    ) {
                        postData = new URLSearchParams(data as Record<string, string>).toString();
                    }

                    response = await this.axios.post(url, postData, config);
                    break;
                }
                case 'PUT': {
                    const headers = (config.headers || {}) as Record<string, string>;
                    const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
                    if (!hasContentType) {
                        headers['Content-Type'] = 'application/json';
                    }

                    response = await this.axios.put(url, data, config);
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

            this.logger.debug(`HTTP ${method} Success: ${url} (${String(response.status)})`, 'enhanced-http-client');
            return response;
        };

        if (platform && !disableRetry) {
            return this.retrySystem.executeWithRetry(platform, makeRequest, maxRetries);
        }

        try {
            return await makeRequest();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.debug(`HTTP ${method} Error: ${url} - ${message}`, 'enhanced-http-client');
            throw error;
        }
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
