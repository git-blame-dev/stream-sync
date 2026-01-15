
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, spyOn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/utils/auth-constants', () => ({
    TWITCH_OAUTH_SCOPES: ['scope1', 'scope2'],
    OAUTH_SERVER_CONFIG: {
        DEFAULT_PORT: 3000,
        PORT_RANGE: { START: 3000, END: 3002 },
        SSL_OPTIONS: { DAYS: 1, KEY_SIZE: 1024, ALGORITHM: 'rsa' }
    },
    TWITCH_ENDPOINTS: {
        OAUTH: { AUTHORIZE: 'https://auth.example/authorize' }
    },
    TOKEN_REFRESH_CONFIG: {}
}));

mockModule('selfsigned', () => ({
    generate: createMockFn(() => ({ private: 'key', cert: 'cert' }))
}));

mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: createMockFn(() => ({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn()
    }))
}));

describe('TwitchOAuthHandler behavior', () => {
    let TwitchOAuthHandler;
    let createPlatformErrorHandler;
    let createServerMock;
    let execMock;
    let logger;
    const originalEnv = { ...process.env };

    beforeEach(() => {
        resetModules();
        createServerMock = createMockFn();
        mockModule('net', () => ({
            createServer: createServerMock
        }));
        execMock = createMockFn();
        mockModule('child_process', () => ({
            exec: execMock
        }));
        logger = { info: createMockFn(), warn: createMockFn(), error: createMockFn(), debug: createMockFn(), console: createMockFn() };
        ({ createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler'));
        ({ TwitchOAuthHandler } = require('../../../src/auth/oauth-handler'));
    });

    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        process.env = { ...originalEnv };
        clearAllMocks();
    });

    it('generates auth URL with configured client and scopes', () => {
        const handler = new TwitchOAuthHandler({ clientId: 'abc' }, { port: 3000, logger });

        const url = handler.generateAuthUrl();

        expect(url).toContain('client_id=abc');
        expect(url).toContain('scope=scope1+scope2');
        expect(url).toContain('redirect_uri=https%3A%2F%2Flocalhost%3A3000');
    });

    it('caches self-signed certificates', () => {
        const handler = new TwitchOAuthHandler({ clientId: 'abc' }, { logger });

        const first = handler.generateSelfSignedCert();
        const second = handler.generateSelfSignedCert();

        expect(first).toBe(second);
    });

    it('finds next available port after EADDRINUSE', async () => {
        const server1 = {
            on: createMockFn(),
            listen: createMockFn((port, cb) => {
                const errHandler = server1.on.mock.calls.find(c => c[0] === 'error')?.[1];
                errHandler && errHandler(Object.assign(new Error('in use'), { code: 'EADDRINUSE' }));
            }),
            close: createMockFn(),
            address: createMockFn(() => ({ port: 3000 }))
        };
        const server2 = {
            on: createMockFn(),
            listen: createMockFn((port, cb) => { server2._port = port; cb(); }),
            close: createMockFn((cb) => cb && cb()),
            address: createMockFn(() => ({ port: server2._port || 3001 }))
        };
        createServerMock
            .mockReturnValueOnce(server1)
            .mockReturnValueOnce(server2);
        const handler = new TwitchOAuthHandler({ clientId: 'abc' }, { logger });

        const port = await handler.findAvailablePort(3000);

        expect(port).toBe(3001);
        expect(server2.listen).toHaveBeenCalled();
    });

    it('rejects when findAvailablePort receives non-EADDRINUSE error', async () => {
        resetModules();
        mockModule('net', () => ({
            createServer: () => ({
                on: (event, handler) => {
                    if (event === 'error') {
                        setImmediate(() => handler(Object.assign(new Error('boom'), { code: 'OTHER' })));
                    }
                },
                listen: () => {},
                close: () => {}
            })
        }));
        ({ TwitchOAuthHandler } = require('../../../src/auth/oauth-handler'));

        await expect(new TwitchOAuthHandler({ clientId: 'abc' }, { logger }).findAvailablePort(3000)).rejects.toThrow('boom');
    });

    it('initializes platform error handler with provided logger', () => {
        const mockLogger = { info: createMockFn(), warn: createMockFn(), error: createMockFn(), debug: createMockFn() };

        const handler = new TwitchOAuthHandler({ clientId: 'abc' }, { logger: mockLogger });

        expect(createPlatformErrorHandler).toHaveBeenCalledWith(mockLogger, 'oauth-handler');
        expect(handler.errorHandler).toBe(createPlatformErrorHandler.mock.results[0].value);
    });

    it('serves successful callback response and resolves tokens', async () => {
        const handler = new TwitchOAuthHandler({ clientId: 'abc' }, { logger });
        handler.server = { close: createMockFn() };
        spyOn(handler, 'exchangeCodeForTokens').mockResolvedValue({ access_token: 'x', refresh_token: 'y' });
        const res = { statusCode: null, body: null, writeHead: function (status) { this.statusCode = status; }, end: function (body) { this.body = body; } };

        const tokens = await new Promise((resolve, reject) => handler.handleCallback({}, res, { code: 'ok' }, resolve, reject));

        expect(tokens).toEqual({ access_token: 'x', refresh_token: 'y' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('Authentication Successful');
        expect(handler.server.close).toHaveBeenCalled();
    });

    it('returns user-friendly OAuth error response and rejects with context', async () => {
        const handler = new TwitchOAuthHandler({ clientId: 'abc' }, { logger });
        handler.server = { close: createMockFn() };
        const res = { statusCode: null, body: null, writeHead: function (status) { this.statusCode = status; }, end: function (body) { this.body = body; } };

        await expect(new Promise((resolve, reject) => handler.handleCallback({}, res, { error: 'access_denied', error_description: 'declined' }, resolve, reject))).rejects.toThrow('access_denied');

        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Authentication Failed');
        expect(handler.server.close).toHaveBeenCalled();
    });

    it('returns invalid callback messaging when no code or error present', async () => {
        const handler = new TwitchOAuthHandler({ clientId: 'abc' }, { logger });
        handler.server = { close: createMockFn() };
        const res = { statusCode: null, body: null, writeHead: function (status) { this.statusCode = status; }, end: function (body) { this.body = body; } };

        await expect(new Promise((resolve, reject) => handler.handleCallback({}, res, {}, resolve, reject))).rejects.toThrow('Invalid callback');

        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('Invalid Callback');
        expect(handler.server.close).toHaveBeenCalled();
    });

    it('skips browser opening in test or disabled environments', () => {
        process.env.NODE_ENV = 'test';
        process.env.TWITCH_DISABLE_AUTH = 'true';
        const logger = { info: createMockFn(), warn: createMockFn(), error: createMockFn(), debug: createMockFn() };
        const handler = new TwitchOAuthHandler({ clientId: 'abc' }, { logger });

        handler.openBrowser('https://example.com');

        expect(execMock).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalled();
    });

    it('closes callback server and returns null when OAuth flow fails after start', async () => {
        const handler = new TwitchOAuthHandler({ clientId: 'abc' }, { logger });
        handler.server = { close: createMockFn() };
        spyOn(handler, 'startCallbackServer').mockRejectedValue(new Error('server failed'));
        handler.displayOAuthInstructions = createMockFn();

        await expect(handler.runOAuthFlow()).resolves.toBeNull();
        expect(handler.server.close).toHaveBeenCalled();
    });

    it('persists tokens to the token store', async () => {
        resetModules();
        const tokenStorePath = '/tmp/token-store.json';
        const readFile = createMockFn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
        const writeFile = createMockFn().mockResolvedValue();
        const rename = createMockFn().mockResolvedValue();

        mockModule('fs', () => ({
            promises: { readFile, writeFile, rename },
            existsSync: createMockFn(() => true),
            readFileSync: createMockFn()
        }));
        mockModule('net', () => ({ createServer: createMockFn() }));
        mockModule('child_process', () => ({ exec: createMockFn() }));

        let updatePromise;
        jest.isolateModules(() => {
            const { TwitchOAuthHandler: IsolatedHandler } = require('../../../src/auth/oauth-handler');
            const handler = new IsolatedHandler({ clientId: 'abc', tokenStorePath }, { logger });
            updatePromise = handler.persistTokens({ access_token: 'newAccess', refresh_token: 'newRefresh' });
        });
        await updatePromise;

        expect(writeFile).toHaveBeenCalledTimes(1);
        const writeArgs = writeFile.mock.calls[0];
        expect(writeArgs[0]).toBe(`${tokenStorePath}.tmp`);
        const updatedContent = JSON.parse(writeArgs[1]);
        expect(updatedContent.twitch.accessToken).toBe('newAccess');
        expect(updatedContent.twitch.refreshToken).toBe('newRefresh');
        expect(rename).toHaveBeenCalledTimes(1);
        expect(rename.mock.calls[0][0]).toBe(`${tokenStorePath}.tmp`);
        expect(rename.mock.calls[0][1]).toBe(tokenStorePath);
    });

    it('mentions the token store (not .env) in OAuth instructions', () => {
        const instructionLines = [];
        const handler = new TwitchOAuthHandler(
            { clientId: 'abc' },
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
