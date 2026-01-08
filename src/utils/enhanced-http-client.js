
const { validateLoggerInterface } = require('./dependency-validator');
const { createRetrySystem } = require('./retry-system');
const { config: appConfig } = require('../core/config');

const resolveTimeout = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

class EnhancedHttpClient {
    constructor(config = {}) {
        // Use dependency injection for better testability
        this.axios = config.axios || require('axios');
        
        this.logger = this._resolveLogger(config.logger);

        this.defaultTimeout = resolveTimeout(config.timeout, appConfig.http.enhancedTimeoutMs);
        this.reachabilityTimeoutMs = resolveTimeout(
            config.reachabilityTimeoutMs,
            appConfig.http.enhancedReachabilityTimeoutMs
        );
        this.retrySystem = config.retrySystem || createRetrySystem({ logger: this.logger });
        
        // User agent rotation for scraping resilience
        this.userAgents = Array.isArray(config.userAgents)
            ? config.userAgents.slice()
            : appConfig.http.userAgents.slice();
        this.currentUserAgentIndex = 0;
    }

    buildAuthHeaders(authToken, authType = 'bearer') {
        if (!authToken) {
            return {};
        }

        const headers = {};
        if (authType === 'oauth') {
            headers.Authorization = `OAuth ${authToken}`;
        } else {
            headers.Authorization = `Bearer ${authToken}`;
        }
        
        return headers;
    }

    getNextUserAgent() {
        if (this.userAgents.length === 0) {
            return '';
        }
        const userAgent = this.userAgents[this.currentUserAgentIndex];
        this.currentUserAgentIndex = (this.currentUserAgentIndex + 1) % this.userAgents.length;
        return userAgent;
    }

    buildRequestConfig(options = {}) {
        const { authToken, authType, headers, operationContext, ...axiosOptions } = options;
        const authHeaders = this.buildAuthHeaders(authToken, authType);
        
        // Use streaming-optimized timeout if operation context is provided
        let timeout = resolveTimeout(axiosOptions.timeout, this.defaultTimeout);
        if (operationContext) {
            timeout = this.getStreamingOptimizedTimeout(operationContext, axiosOptions.timeout);
        }
        
        return {
            timeout,
            headers: {
                'User-Agent': axiosOptions.userAgent || this.getNextUserAgent(),
                ...authHeaders,
                ...headers // Use the extracted headers, not axiosOptions.headers
            },
            ...axiosOptions
        };
    }

    getStreamingOptimizedTimeout(context, explicitTimeout) {
        // If explicit timeout provided, use it
        const resolvedTimeout = resolveTimeout(explicitTimeout, null);
        if (resolvedTimeout !== null) {
            return resolvedTimeout;
        }

        try {
            const AuthConstants = require('./auth-constants').AuthConstants;
            const criticality = AuthConstants.determineOperationCriticality(context);
            const operationType = context.operationType || 'tokenValidation';
            return AuthConstants.getStreamingOptimizedTimeout(criticality, operationType);
        } catch (error) {
            // Fallback to default if auth constants not available
            this.logger.debug?.('Failed to get streaming timeout, using default', error.message);
            return this.defaultTimeout;
        }
    }

    async executeRequest(method, url, data, options = {}) {
        const {
            platform,
            disableRetry = false,
            maxRetries,
            ...requestOptions
        } = options;
        const config = this.buildRequestConfig(requestOptions);
        
        const makeRequest = async () => {
            this.logger.debug(`HTTP ${method}: ${url}`, 'enhanced-http-client');
            
            let response;
            switch (method.toUpperCase()) {
                case 'GET':
                    response = await this.axios.get(url, config);
                    break;
                case 'POST':
                    // Set default content type for POST requests only if not already set
                    const hasContentType = Object.keys(config.headers).some(key => 
                        key.toLowerCase() === 'content-type'
                    );
                    if (!hasContentType) {
                        config.headers['Content-Type'] = 'application/json';
                    }
                    
                    // Handle form data encoding for application/x-www-form-urlencoded
                    let postData = data;
                    const contentType = Object.keys(config.headers).find(key => 
                        key.toLowerCase() === 'content-type'
                    );
                    if (contentType && config.headers[contentType] === 'application/x-www-form-urlencoded' && 
                        data && typeof data === 'object' && !(data instanceof URLSearchParams)) {
                        postData = new URLSearchParams(data).toString();
                    }
                    
                    response = await this.axios.post(url, postData, config);
                    break;
                case 'PUT':
                    // Set default content type for PUT requests only if not already set
                    const hasPutContentType = Object.keys(config.headers).some(key => 
                        key.toLowerCase() === 'content-type'
                    );
                    if (!hasPutContentType) {
                        config.headers['Content-Type'] = 'application/json';
                    }
                    response = await this.axios.put(url, data, config);
                    break;
                case 'DELETE':
                    response = await this.axios.delete(url, config);
                    break;
                default:
                    throw new Error(`Unsupported HTTP method: ${method}`);
            }
            
            // Ensure response has axios-compatible structure for compatibility
            if (response && typeof response === 'object' && !response.status) {
                // Handle cases where response might not be a proper axios response
                response.status = response.statusCode || 200;
                response.statusText = response.statusText || 'OK';
                response.headers = response.headers || {};
                response.config = response.config || {};
            }
            
            this.logger.debug(`HTTP ${method} Success: ${url} (${response.status})`, 'enhanced-http-client');
            return response;
        };

        // Use retry system if platform is specified
        if (platform && !disableRetry) {
            return await this.retrySystem.executeWithRetry(platform, makeRequest, maxRetries);
        } else {
            // Direct request without retry
            try {
                return await makeRequest();
            } catch (error) {
                this.logger.debug(`HTTP ${method} Error: ${url} - ${error.message}`, 'enhanced-http-client');
                throw error;
            }
        }
    }

    async get(url, options = {}) {
        return await this.executeRequest('GET', url, null, options);
    }

    async post(url, data = {}, options = {}) {
        return await this.executeRequest('POST', url, data, options);
    }

    async put(url, data = {}, options = {}) {
        return await this.executeRequest('PUT', url, data, options);
    }

    async delete(url, options = {}) {
        return await this.executeRequest('DELETE', url, null, options);
    }

    async isReachable(url, options = {}) {
        try {
            const response = await this.get(url, {
                ...options,
                timeout: resolveTimeout(options.timeout, this.reachabilityTimeoutMs)
            });
            return response.status >= 200 && response.status < 400;
        } catch {
            return false;
        }
    }

    _resolveLogger(logger) {
        const candidates = [];

        if (logger) {
            candidates.push(logger);
        }

        if (global.__TEST_LOGGER__) {
            candidates.push(global.__TEST_LOGGER__);
        }

        try {
            const logging = require('../core/logging');
            const unified = typeof logging.getUnifiedLogger === 'function'
                ? logging.getUnifiedLogger()
                : logging.logger;
            if (unified) {
                candidates.push(unified);
            }
        } catch {
            // Logging might not be initialized yet; continue to other candidates
        }

        const selected = candidates.find(Boolean);
        if (!selected) {
            throw new Error('EnhancedHttpClient requires a logger dependency');
        }

        const normalized = this._normalizeLoggerMethods(selected);
        validateLoggerInterface(normalized);
        return normalized;
    }

    _normalizeLoggerMethods(logger) {
        const required = ['debug', 'info', 'warn', 'error'];
        const normalized = { ...logger };
        required.forEach((method) => {
            if (typeof normalized[method] !== 'function') {
                normalized[method] = () => {};
            }
        });
        return normalized;
    }
}

function createEnhancedHttpClient(config) {
    return new EnhancedHttpClient(config);
}

module.exports = { EnhancedHttpClient, createEnhancedHttpClient };
