const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const selfsigned = require('selfsigned');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../src/core/secrets');
const { TWITCH } = require('../../../src/core/endpoints');
const { safeSetTimeout } = require('../../../src/utils/timeout-validator');
const {
    generateSelfSignedCert,
    findAvailablePort,
    buildAuthUrl,
    startCallbackServer,
    renderCallbackHtml,
    exchangeCodeForTokens,
    openBrowser,
    runOAuthFlow
} = require('../../../src/auth/oauth-flow');

describe('oauth-flow behavior', () => {
    let tempDir;
    let tokenStorePath;
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const fetchLocal = (options) => new Promise((resolve, reject) => {
        const req = https.request({ ...options, agent: httpsAgent }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                clearTimeout(timeoutId);
                resolve({ statusCode: res.statusCode, body: data });
            });
        });
        const timeoutId = safeSetTimeout(() => {
            req.destroy(new Error('request timeout'));
        }, 2000);
        req.on('error', (error) => {
            clearTimeout(timeoutId);
            reject(error);
        });
        req.end();
    });

    beforeEach(async () => {
        _resetForTesting();
        secrets.twitch.clientSecret = 'test-client-secret';
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oauth-flow-'));
        tokenStorePath = path.join(tempDir, 'token-store.json');
    });

    afterEach(async () => {
        restoreAllMocks();
        _resetForTesting();
        initializeStaticSecrets();
        if (tempDir) {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
        }
    });

    it('exports oauth-flow helpers', () => {
        expect(typeof generateSelfSignedCert).toBe('function');
        expect(typeof findAvailablePort).toBe('function');
        expect(typeof buildAuthUrl).toBe('function');
        expect(typeof startCallbackServer).toBe('function');
        expect(typeof renderCallbackHtml).toBe('function');
        expect(typeof exchangeCodeForTokens).toBe('function');
        expect(typeof openBrowser).toBe('function');
        expect(typeof runOAuthFlow).toBe('function');
    });

    it('buildAuthUrl uses Twitch authorize endpoint and required params', () => {
        const authUrl = buildAuthUrl(
            'test-client-id',
            'https://example.test/callback',
            ['test-scope-one', 'test-scope-two']
        );

        const parsed = new URL(authUrl);
        const params = parsed.searchParams;

        expect(`${parsed.origin}${parsed.pathname}`).toBe(TWITCH.OAUTH.AUTHORIZE);
        expect(params.get('client_id')).toBe('test-client-id');
        expect(params.get('redirect_uri')).toBe('https://example.test/callback');
        expect(params.get('response_type')).toBe('code');
        expect(params.get('scope')).toBe('test-scope-one test-scope-two');
        expect(params.get('state').startsWith('cb_')).toBe(true);
    });

    it('renderCallbackHtml returns headings for all outcomes', () => {
        const successHtml = renderCallbackHtml('success');
        const failedHtml = renderCallbackHtml('failed', { error: 'test-error' });
        const invalidHtml = renderCallbackHtml('invalid');
        const serverHtml = renderCallbackHtml('server');

        expect(successHtml).toContain('Authentication Successful!');
        expect(failedHtml).toContain('Authentication Failed');
        expect(invalidHtml).toContain('Invalid Callback');
        expect(serverHtml).toContain('Server Error');
    });

    it('startCallbackServer resolves authorization code', async () => {
        const { server, waitForCode, port, redirectUri } = await startCallbackServer({
            port: 3000,
            autoFindPort: true,
            logger: noOpLogger
        });

        await fetchLocal({
            hostname: 'localhost',
            port,
            path: '/?code=test-auth-code',
            method: 'GET'
        });

        const code = await waitForCode;

        expect(code).toBe('test-auth-code');
        expect(redirectUri).toBe(`https://localhost:${port}`);
        server.close();
    });

    it('startCallbackServer rejects OAuth errors', async () => {
        const { server, waitForCode, port } = await startCallbackServer({
            port: 3000,
            autoFindPort: true,
            logger: noOpLogger
        });

        const errorPromise = waitForCode.catch((error) => error);
        await fetchLocal({
            hostname: 'localhost',
            port,
            path: '/?error=access_denied&error_description=test-error',
            method: 'GET'
        });

        const error = await errorPromise;
        expect(error.message).toContain('OAuth error: access_denied');
        server.close();
    });

    it('startCallbackServer rejects invalid callbacks', async () => {
        const { server, waitForCode, port } = await startCallbackServer({
            port: 3000,
            autoFindPort: true,
            logger: noOpLogger
        });

        const errorPromise = waitForCode.catch((error) => error);
        await fetchLocal({
            hostname: 'localhost',
            port,
            path: '/',
            method: 'GET'
        });

        const error = await errorPromise;
        expect(error.message).toContain('Invalid callback');
        server.close();
    });

    it('exchangeCodeForTokens parses Twitch response', async () => {
        const attrs = [{ name: 'commonName', value: 'localhost' }];
        const pems = selfsigned.generate(attrs, { days: 1, keySize: 2048, algorithm: 'sha256' });
        const server = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
            req.on('data', () => {});
            req.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    access_token: 'test-access-token',
                    refresh_token: 'test-refresh-token',
                    expires_in: 3600
                }));
            });
        });

        await new Promise((resolve) => server.listen(0, resolve));
        const port = server.address().port;
        const originalUrl = TWITCH.OAUTH.TOKEN;
        TWITCH.OAUTH.TOKEN = `https://localhost:${port}/oauth2/token`;
        const httpsRequest = (options, callback) => https.request({ ...options, agent: httpsAgent }, callback);

        try {
            const tokens = await exchangeCodeForTokens('test-code', {
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret',
                redirectUri: 'https://example.test/callback',
                logger: noOpLogger,
                httpsRequest
            });

            expect(tokens).toMatchObject({
                accessToken: 'test-access-token',
                refreshToken: 'test-refresh-token',
                expiresIn: 3600
            });
        } finally {
            TWITCH.OAUTH.TOKEN = originalUrl;
            server.close();
        }
    });

    it('exchangeCodeForTokens rejects invalid responses', async () => {
        const attrs = [{ name: 'commonName', value: 'localhost' }];
        const pems = selfsigned.generate(attrs, { days: 1, keySize: 2048, algorithm: 'sha256' });
        const server = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ access_token: 'test-access-token' }));
        });

        await new Promise((resolve) => server.listen(0, resolve));
        const port = server.address().port;
        const originalUrl = TWITCH.OAUTH.TOKEN;
        TWITCH.OAUTH.TOKEN = `https://localhost:${port}/oauth2/token`;
        const httpsRequest = (options, callback) => https.request({ ...options, agent: httpsAgent }, callback);

        try {
            await expect(
                exchangeCodeForTokens('test-code', {
                    clientId: 'test-client-id',
                    clientSecret: 'test-client-secret',
                    redirectUri: 'https://example.test/callback',
                    logger: noOpLogger,
                    httpsRequest
                })
            ).rejects.toThrow('Token exchange failed');
        } finally {
            TWITCH.OAUTH.TOKEN = originalUrl;
            server.close();
        }
    });

    it('openBrowser respects skipBrowserOpen', () => {
        expect(() => openBrowser('https://example.test', noOpLogger, { skipBrowserOpen: true })).not.toThrow();
    });

    it('runOAuthFlow persists tokens and returns camelCase values', async () => {
        const startCallbackServer = createMockFn().mockResolvedValue({
            server: { close: createMockFn() },
            waitForCode: Promise.resolve('test-auth-code'),
            redirectUri: 'https://example.test/callback'
        });
        const exchangeCodeForTokens = createMockFn().mockResolvedValue({
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresIn: 3600
        });
        const openBrowser = createMockFn();

        const result = await runOAuthFlow(
            {
                clientId: 'test-client-id',
                tokenStorePath,
                logger: noOpLogger
            },
            {
                startCallbackServer,
                exchangeCodeForTokens,
                openBrowser
            }
        );

        expect(result).toMatchObject({
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresIn: 3600
        });

        const stored = JSON.parse(await fs.promises.readFile(tokenStorePath, 'utf8'));
        expect(stored.twitch.accessToken).toBe('test-access-token');
        expect(stored.twitch.refreshToken).toBe('test-refresh-token');
    });

    it('runOAuthFlow returns null when exchange returns null', async () => {
        const startCallbackServer = createMockFn().mockResolvedValue({
            server: { close: createMockFn() },
            waitForCode: Promise.resolve('test-auth-code'),
            redirectUri: 'https://example.test/callback'
        });
        const exchangeCodeForTokens = createMockFn().mockResolvedValue(null);
        const openBrowser = createMockFn();

        const result = await runOAuthFlow(
            {
                clientId: 'test-client-id',
                tokenStorePath,
                logger: noOpLogger
            },
            {
                startCallbackServer,
                exchangeCodeForTokens,
                openBrowser
            }
        );

        expect(result).toBeNull();
    });

    it('runOAuthFlow returns null when accessToken is missing', async () => {
        const startCallbackServer = createMockFn().mockResolvedValue({
            server: { close: createMockFn() },
            waitForCode: Promise.resolve('test-auth-code'),
            redirectUri: 'https://example.test/callback'
        });
        const exchangeCodeForTokens = createMockFn().mockResolvedValue({
            refreshToken: 'test-refresh-token'
        });
        const openBrowser = createMockFn();

        const result = await runOAuthFlow(
            {
                clientId: 'test-client-id',
                tokenStorePath,
                logger: noOpLogger
            },
            {
                startCallbackServer,
                exchangeCodeForTokens,
                openBrowser
            }
        );

        expect(result).toBeNull();
    });

    it('runOAuthFlow throws when clientId is missing', async () => {
        await expect(
            runOAuthFlow({ tokenStorePath, logger: noOpLogger })
        ).rejects.toThrow('clientId');
    });

    it('runOAuthFlow throws when tokenStorePath is missing', async () => {
        await expect(
            runOAuthFlow({ clientId: 'test-client-id', logger: noOpLogger })
        ).rejects.toThrow('tokenStorePath');
    });
});
