
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createMockLogger } = require('../../helpers/mock-factories');

const { TwitchOAuthHandler } = require('../../../src/auth/oauth-handler');

describe('TwitchOAuthHandler behavior', () => {
    let logger;
    const originalEnv = { ...process.env };

    beforeEach(() => {
        logger = createMockLogger();
    });

    afterEach(() => {
        restoreAllMocks();
        process.env = { ...originalEnv };
    });

    it('generates auth URL with configured client ID', () => {
        const handler = new TwitchOAuthHandler({ clientId: 'test-client-abc' }, { port: 3000, logger });

        const url = handler.generateAuthUrl();

        expect(url).toContain('client_id=test-client-abc');
        expect(url).toContain('redirect_uri=');
        expect(url).toContain('response_type=code');
        expect(url).toContain('scope=');
    });

    it('caches self-signed certificates', () => {
        const handler = new TwitchOAuthHandler({ clientId: 'test-client-abc' }, { logger });

        const first = handler.generateSelfSignedCert();
        const second = handler.generateSelfSignedCert();

        expect(first).toBe(second);
        expect(first).toBeDefined();
    });

    it('serves successful callback response and resolves tokens', async () => {
        const handler = new TwitchOAuthHandler({ clientId: 'test-client-abc' }, { logger });
        handler.server = { close: createMockFn() };
        spyOn(handler, 'exchangeCodeForTokens').mockResolvedValue({
            access_token: 'test-access-token-x',
            refresh_token: 'test-refresh-token-y'
        });
        const res = {
            statusCode: null,
            body: null,
            writeHead: function(status) { this.statusCode = status; },
            end: function(body) { this.body = body; }
        };

        const tokens = await new Promise((resolve, reject) =>
            handler.handleCallback({}, res, { code: 'test-auth-code' }, resolve, reject)
        );

        expect(tokens).toEqual({
            access_token: 'test-access-token-x',
            refresh_token: 'test-refresh-token-y'
        });
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('Authentication Successful');
        expect(handler.server.close).toHaveBeenCalled();
    });

    it('returns user-friendly OAuth error response and rejects with context', async () => {
        const handler = new TwitchOAuthHandler({ clientId: 'test-client-abc' }, { logger });
        handler.server = { close: createMockFn() };
        const res = {
            statusCode: null,
            body: null,
            writeHead: function(status) { this.statusCode = status; },
            end: function(body) { this.body = body; }
        };

        await expect(
            new Promise((resolve, reject) =>
                handler.handleCallback(
                    {},
                    res,
                    { error: 'access_denied', error_description: 'declined' },
                    resolve,
                    reject
                )
            )
        ).rejects.toThrow('access_denied');

        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Authentication Failed');
        expect(handler.server.close).toHaveBeenCalled();
    });

    it('returns invalid callback messaging when no code or error present', async () => {
        const handler = new TwitchOAuthHandler({ clientId: 'test-client-abc' }, { logger });
        handler.server = { close: createMockFn() };
        const res = {
            statusCode: null,
            body: null,
            writeHead: function(status) { this.statusCode = status; },
            end: function(body) { this.body = body; }
        };

        await expect(
            new Promise((resolve, reject) =>
                handler.handleCallback({}, res, {}, resolve, reject)
            )
        ).rejects.toThrow('Invalid callback');

        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Invalid Callback');
        expect(handler.server.close).toHaveBeenCalled();
    });

    it('skips browser opening in test environment', () => {
        process.env.NODE_ENV = 'test';
        process.env.TWITCH_DISABLE_AUTH = 'true';
        const handler = new TwitchOAuthHandler({ clientId: 'test-client-abc' }, { logger });

        handler.openBrowser('https://example.com');
    });

    it('closes callback server and returns null when OAuth flow fails after start', async () => {
        const handler = new TwitchOAuthHandler({ clientId: 'test-client-abc' }, { logger });
        handler.server = { close: createMockFn() };
        spyOn(handler, 'startCallbackServer').mockRejectedValue(new Error('server failed'));
        handler.displayOAuthInstructions = createMockFn();

        const result = await handler.runOAuthFlow();

        expect(result).toBeNull();
        expect(handler.server.close).toHaveBeenCalled();
    });

    it('mentions the token store in OAuth instructions', () => {
        const instructionLines = [];
        const handler = new TwitchOAuthHandler(
            { clientId: 'test-client-abc' },
            {
                logger: {
                    ...logger,
                    console: (message) => {
                        instructionLines.push(message);
                    }
                }
            }
        );
        spyOn(handler, 'openBrowser').mockImplementation(() => {});

        handler.displayOAuthInstructions('https://auth.example/authorize');

        const output = instructionLines.join('\n');
        expect(output).toContain('token store');
        expect(output).not.toContain('.env');
    });
});
