describe('EnhancedHttpClient behavior', () => {
    const createLogger = () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    });

    afterEach(() => {
        jest.resetModules();
        jest.restoreAllMocks();
    });

    test('rotates user agents and uses streaming timeout when auth constants are available', () => {
        jest.doMock('../../../src/utils/auth-constants', () => ({
            AuthConstants: {
                determineOperationCriticality: jest.fn(() => 'critical'),
                getStreamingOptimizedTimeout: jest.fn(() => 1234)
            }
        }));

        const axios = { get: jest.fn().mockResolvedValue({ status: 200 }) };
        const logger = createLogger();

        let EnhancedHttpClient;
        jest.isolateModules(() => {
            ({ EnhancedHttpClient } = require('../../../src/utils/enhanced-http-client'));
        });

        const client = new EnhancedHttpClient({ axios, logger });
        client.userAgents = ['agent-a', 'agent-b'];

        const firstConfig = client.buildRequestConfig({ operationContext: { operationType: 'tokenValidation' } });
        const secondConfig = client.buildRequestConfig({ operationContext: { operationType: 'tokenValidation' } });

        expect(firstConfig.timeout).toBe(1234);
        expect(firstConfig.headers['User-Agent']).toBe('agent-a');
        expect(secondConfig.headers['User-Agent']).toBe('agent-b');
    });

    test('falls back to default timeout when auth constants cannot be loaded', () => {
        jest.doMock('../../../src/utils/auth-constants', () => {
            throw new Error('auth constants missing');
        });

        const axios = { get: jest.fn().mockResolvedValue({ status: 200 }) };
        const logger = createLogger();

        let EnhancedHttpClient;
        jest.isolateModules(() => {
            ({ EnhancedHttpClient } = require('../../../src/utils/enhanced-http-client'));
        });

        const client = new EnhancedHttpClient({ axios, logger });
        const config = client.buildRequestConfig({ operationContext: { operationType: 'tokenValidation' } });

        expect(config.timeout).toBe(3000);
        expect(logger.debug).toHaveBeenCalled();
    });

    test('wraps requests with retry system when platform is provided', async () => {
        const axios = { get: jest.fn().mockResolvedValue({ status: 204 }) };
        const logger = createLogger();
        let executedThroughRetry = false;

        const retrySystem = {
            executeWithRetry: jest.fn(async (_platform, handler) => {
                executedThroughRetry = true;
                return handler();
            })
        };

        const { EnhancedHttpClient } = require('../../../src/utils/enhanced-http-client');
        const client = new EnhancedHttpClient({ axios, logger, retrySystem });

        const response = await client.get('https://example.com', { platform: 'twitch' });

        expect(executedThroughRetry).toBe(true);
        expect(response.status).toBe(204);
    });

    test('respects disableRetry and surfaces request errors with logging', async () => {
        const axios = { get: jest.fn().mockRejectedValue(new Error('boom')) };
        const logger = createLogger();
        const retrySystem = {
            executeWithRetry: jest.fn(async (_platform, handler) => handler())
        };

        const { EnhancedHttpClient } = require('../../../src/utils/enhanced-http-client');
        const client = new EnhancedHttpClient({ axios, logger, retrySystem });

        await expect(client.get('https://example.com', { platform: 'twitch', disableRetry: true }))
            .rejects.toThrow('boom');
        expect(retrySystem.executeWithRetry).not.toHaveBeenCalled();
        expect(logger.debug).toHaveBeenCalled();
    });

    test('encodes urlencoded post bodies without mutating headers', async () => {
        let postedBody;
        let postedConfig;
        const axios = {
            post: jest.fn(async (_url, body, config) => {
                postedBody = body;
                postedConfig = config;
                return { status: 201 };
            })
        };
        const logger = createLogger();
        const { EnhancedHttpClient } = require('../../../src/utils/enhanced-http-client');
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

    test('returns false when reachability check fails', async () => {
        const axios = { get: jest.fn().mockRejectedValue(new Error('network')) };
        const logger = createLogger();
        const { EnhancedHttpClient } = require('../../../src/utils/enhanced-http-client');
        const client = new EnhancedHttpClient({ axios, logger });

        const reachable = await client.isReachable('https://example.com');

        expect(reachable).toBe(false);
    });
});
