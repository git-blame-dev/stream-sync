
const { getUnifiedLogger } = require('../core/logging');
const { config: appConfig } = require('../core/config');

const resolveTimeout = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

class HttpClient {
    constructor(config = {}) {
        this.logger = config.logger || getUnifiedLogger();
        this.axios = config.axios || require('axios');
        this.defaultTimeout = resolveTimeout(config.timeout, appConfig.http.defaultTimeoutMs);
        this.reachabilityTimeoutMs = resolveTimeout(
            config.reachabilityTimeoutMs,
            appConfig.http.reachabilityTimeoutMs
        );
        this.userAgents = Array.isArray(config.userAgents)
            ? config.userAgents.slice()
            : appConfig.http.userAgents.slice();
        this.currentUserAgentIndex = 0;
    }

    getNextUserAgent() {
        if (this.userAgents.length === 0) {
            return '';
        }
        const userAgent = this.userAgents[this.currentUserAgentIndex];
        this.currentUserAgentIndex = (this.currentUserAgentIndex + 1) % this.userAgents.length;
        return userAgent;
    }

    async get(url, options = {}) {
        const config = {
            timeout: resolveTimeout(options.timeout, this.defaultTimeout),
            headers: {
                'User-Agent': options.userAgent || this.getNextUserAgent(),
                ...options.headers
            },
            ...options
        };

        try {
            this.logger.debug(`HTTP GET: ${url}`, 'http-client');
            const response = await this.axios.get(url, config);
            this.logger.debug(`HTTP GET Success: ${url} (${response.status})`, 'http-client');
            return response;
        } catch (error) {
            this.logger.debug(`HTTP GET Error: ${url} - ${error.message}`, 'http-client');
            throw error;
        }
    }

    async post(url, data = {}, options = {}) {
        const config = {
            timeout: resolveTimeout(options.timeout, this.defaultTimeout),
            headers: {
                'User-Agent': options.userAgent || this.getNextUserAgent(),
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };

        try {
            this.logger.debug(`HTTP POST: ${url}`, 'http-client');
            const response = await this.axios.post(url, data, config);
            this.logger.debug(`HTTP POST Success: ${url} (${response.status})`, 'http-client');
            return response;
        } catch (error) {
            this.logger.debug(`HTTP POST Error: ${url} - ${error.message}`, 'http-client');
            throw error;
        }
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
}

function createHttpClient(config) {
    return new HttpClient(config);
}

module.exports = { HttpClient, createHttpClient };
