const { describe, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { EnhancedHttpClient } = require('../../../src/utils/enhanced-http-client');

describe('EnhancedHttpClient behavior', () => {
    const createLogger = () => ({
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn()
    });

    afterEach(() => {
        restoreAllMocks();
    });

    it('rotates user agents across requests', () => {
        const axios = { get: createMockFn().mockResolvedValue({ status: 200 }) };
        const logger = createLogger();

        const client = new EnhancedHttpClient({ axios, logger });
        client.userAgents = ['testAgentA', 'testAgentB'];

        const firstConfig = client.buildRequestConfig({});
        const secondConfig = client.buildRequestConfig({});
        const thirdConfig = client.buildRequestConfig({});

        expect(firstConfig.headers['User-Agent']).toBe('testAgentA');
        expect(secondConfig.headers['User-Agent']).toBe('testAgentB');
        expect(thirdConfig.headers['User-Agent']).toBe('testAgentA');
    });

    it('uses explicit timeout when provided', () => {
        const axios = { get: createMockFn().mockResolvedValue({ status: 200 }) };
        const logger = createLogger();

        const client = new EnhancedHttpClient({ axios, logger });
        const config = client.buildRequestConfig({ timeout: 5000 });

        expect(config.timeout).toBe(5000);
    });

    it('uses default timeout when no explicit timeout provided', () => {
        const axios = { get: createMockFn().mockResolvedValue({ status: 200 }) };
        const logger = createLogger();

        const client = new EnhancedHttpClient({ axios, logger, timeout: 3000 });
        const config = client.buildRequestConfig({});

        expect(config.timeout).toBe(3000);
    });

    it('wraps requests with retry system when platform is provided', async () => {
        const axios = { get: createMockFn().mockResolvedValue({ status: 204 }) };
        const logger = createLogger();
        let executedThroughRetry = false;

        const retrySystem = {
            executeWithRetry: createMockFn(async (_platform, handler) => {
                executedThroughRetry = true;
                return handler();
            })
        };

        const client = new EnhancedHttpClient({ axios, logger, retrySystem });
        const response = await client.get('https://example.com', { platform: 'twitch' });

        expect(executedThroughRetry).toBe(true);
        expect(response.status).toBe(204);
    });

    it('bypasses retry system when disableRetry is true', async () => {
        const axios = { get: createMockFn().mockRejectedValue(new Error('testNetworkError')) };
        const logger = createLogger();
        const retrySystem = {
            executeWithRetry: createMockFn(async (_platform, handler) => handler())
        };

        const client = new EnhancedHttpClient({ axios, logger, retrySystem });

        await expect(client.get('https://example.com', { platform: 'twitch', disableRetry: true }))
            .rejects.toThrow('testNetworkError');
        expect(retrySystem.executeWithRetry).not.toHaveBeenCalled();
    });

    it('encodes urlencoded post bodies', async () => {
        let postedBody;
        let postedConfig;
        const axios = {
            post: createMockFn(async (_url, body, config) => {
                postedBody = body;
                postedConfig = config;
                return { status: 201 };
            })
        };
        const logger = createLogger();
        const client = new EnhancedHttpClient({ axios, logger });

        const response = await client.post('https://example.com', { a: 1, b: 'two' }, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        expect(typeof postedBody).toBe('string');
        expect(postedBody).toContain('a=1');
        expect(postedBody).toContain('b=two');
        expect(postedConfig.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
        expect(response.status).toBe(201);
    });

    it('returns false when reachability check fails', async () => {
        const axios = { get: createMockFn().mockRejectedValue(new Error('testNetworkFailure')) };
        const logger = createLogger();
        const client = new EnhancedHttpClient({ axios, logger });

        const reachable = await client.isReachable('https://example.com');

        expect(reachable).toBe(false);
    });

    it('builds auth headers for bearer tokens', () => {
        const axios = { get: createMockFn() };
        const logger = createLogger();
        const client = new EnhancedHttpClient({ axios, logger });

        const bearerHeaders = client.buildAuthHeaders('testToken123', 'bearer');
        const oauthHeaders = client.buildAuthHeaders('testToken456', 'oauth');

        expect(bearerHeaders.Authorization).toBe('Bearer testToken123');
        expect(oauthHeaders.Authorization).toBe('OAuth testToken456');
    });
});
