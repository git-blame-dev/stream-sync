const https = require('https');
const url = require('url');
const querystring = require('querystring');
const { exec } = require('child_process');
const fs = require('fs');
const { TWITCH } = require('../core/endpoints');
const { secrets } = require('../core/secrets');
const { saveTokens } = require('../utils/token-store');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { resolveLogger } = require('../utils/logger-resolver');
const { safeSetTimeout } = require('../utils/timeout-validator');
const { TOKEN_REFRESH_CONFIG, OAUTH_SERVER_CONFIG } = require('../utils/auth-constants');
const { TWITCH_OAUTH_SCOPES } = require('./twitch-oauth-scopes');

let cachedCerts = null;

const createOAuthFlowErrorHandler = (logger) => createPlatformErrorHandler(logger, 'oauth-flow');

const safeCloseServer = (server) => {
    if (!server || typeof server.close !== 'function') {
        return;
    }
    server.close();
};

function generateSelfSignedCert() {
    if (cachedCerts) {
        return cachedCerts;
    }

    const selfsigned = require('selfsigned');
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const options = {
        days: OAUTH_SERVER_CONFIG.SSL_OPTIONS.DAYS,
        keySize: OAUTH_SERVER_CONFIG.SSL_OPTIONS.KEY_SIZE,
        algorithm: OAUTH_SERVER_CONFIG.SSL_OPTIONS.ALGORITHM
    };

    const pems = selfsigned.generate(attrs, options);
    cachedCerts = {
        key: pems.private,
        cert: pems.cert
    };

    return cachedCerts;
}

function findAvailablePort(startPort = OAUTH_SERVER_CONFIG.DEFAULT_PORT) {
    return new Promise((resolve, reject) => {
        const net = require('net');
        const server = net.createServer();

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                if (startPort < OAUTH_SERVER_CONFIG.PORT_RANGE.END) {
                    findAvailablePort(startPort + 1).then(resolve).catch(reject);
                } else {
                    reject(new Error(`No available ports found in range ${OAUTH_SERVER_CONFIG.PORT_RANGE.START}-${OAUTH_SERVER_CONFIG.PORT_RANGE.END}`));
                }
            } else {
                reject(err);
            }
        });

        server.listen(startPort, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
    });
}

function buildAuthUrl(clientId, redirectUri, scopes = TWITCH_OAUTH_SCOPES) {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        state: `cb_${Date.now().toString(36)}`
    });

    return `${TWITCH.OAUTH.AUTHORIZE}?${params.toString()}`;
}

function renderCallbackHtml(status, details = {}) {
    if (status === 'success') {
        return `
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #9146FF;">Authentication Successful!</h1>
                    <p>Your Twitch tokens have been obtained and saved.</p>
                    <p style="color: #666;">You can close this window and return to your terminal.</p>
                    <p><strong>The application will now restart automatically.</strong></p>
                </body>
            </html>
        `;
    }

    if (status === 'failed') {
        return `
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #FF0000;">Authentication Failed</h1>
                    <p>Error: ${details.error || 'Unknown error'}</p>
                    <p>${details.description || 'Unknown error occurred'}</p>
                    <p>Please try again or check your configuration.</p>
                </body>
            </html>
        `;
    }

    if (status === 'invalid') {
        return `
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #FF0000;">Invalid Callback</h1>
                    <p>No authorization code received.</p>
                    <p>Please try the authentication process again.</p>
                </body>
            </html>
        `;
    }

    return `
        <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #FF0000;">Server Error</h1>
                <p>An error occurred while processing your authentication.</p>
                <p>Please try again or check the terminal for details.</p>
            </body>
        </html>
    `;
}

async function startCallbackServer({ port = OAUTH_SERVER_CONFIG.DEFAULT_PORT, autoFindPort = false, logger }) {
    const resolvedLogger = resolveLogger(logger, 'oauth-flow');
    const handler = createOAuthFlowErrorHandler(resolvedLogger);
    const actualPort = autoFindPort ? await findAvailablePort(port) : port;
    const redirectUri = `https://localhost:${actualPort}`;

    let resolveCode;
    let rejectCode;
    const waitForCode = new Promise((resolve, reject) => {
        resolveCode = resolve;
        rejectCode = reject;
    });

    let server;
    const timeoutId = safeSetTimeout(() => {
        safeCloseServer(server);
        rejectCode(new Error(`OAuth flow timed out after ${TOKEN_REFRESH_CONFIG.OAUTH_TIMEOUT_MS / 60000} minutes`));
    }, TOKEN_REFRESH_CONFIG.OAUTH_TIMEOUT_MS);

    const options = generateSelfSignedCert();
    server = https.createServer({ key: options.key, cert: options.cert }, (req, res) => {
        const parsedUrl = url.parse(req.url, true);

        if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/callback') {
            const query = parsedUrl.query || {};
            if (query.code) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(renderCallbackHtml('success'));
                clearTimeout(timeoutId);
                server.close();
                resolveCode(query.code);
                return;
            }

            if (query.error) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(renderCallbackHtml('failed', {
                    error: query.error,
                    description: query.error_description
                }));
                clearTimeout(timeoutId);
                server.close();
                rejectCode(new Error(`OAuth error: ${query.error} - ${query.error_description || 'Unknown error'}`));
                return;
            }

            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(renderCallbackHtml('invalid'));
            clearTimeout(timeoutId);
            server.close();
            rejectCode(new Error('Invalid callback - no authorization code received'));
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    });

    server.on('error', (error) => {
        clearTimeout(timeoutId);
        handler.handleEventProcessingError(error, 'oauth-flow', { port: actualPort }, 'OAuth callback server error');
        rejectCode(error);
    });

    await new Promise((resolve, reject) => {
        server.listen(actualPort, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolvedLogger.info(`OAuth callback server started on port ${actualPort}`, 'oauth-flow');
            resolve();
        });
    });

    return { server, waitForCode, port: actualPort, redirectUri };
}

async function exchangeCodeForTokens(code, { clientId, clientSecret, redirectUri, logger, httpsRequest }) {
    const resolvedLogger = resolveLogger(logger, 'oauth-flow');
    const handler = createOAuthFlowErrorHandler(resolvedLogger);
    const postData = querystring.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
    });

    const requestImpl = httpsRequest || https.request;

    return await new Promise((resolve, reject) => {
        const urlParts = new URL(TWITCH.OAUTH.TOKEN);
        const options = {
            hostname: urlParts.hostname,
            port: urlParts.port || 443,
            path: urlParts.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = requestImpl(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (response.access_token && response.refresh_token) {
                        resolve({
                            accessToken: response.access_token,
                            refreshToken: response.refresh_token,
                            expiresIn: Number.isFinite(response.expires_in) ? response.expires_in : null
                        });
                        return;
                    }

                    handler.logOperationalError('Invalid token response', 'oauth-flow', response);
                    reject(new Error(`Token exchange failed: ${response.error || 'Unknown error'}`));
                } catch (error) {
                    handler.handleEventProcessingError(error, 'oauth-flow', null, 'Failed to parse token response');
                    reject(new Error(`Failed to parse token response: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => {
            handler.handleEventProcessingError(error, 'oauth-flow', null, 'Token exchange request failed');
            reject(new Error(`Token exchange request failed: ${error.message}`));
        });

        req.write(postData);
        req.end();
    });
}

function openBrowser(authUrl, logger, { skipBrowserOpen = false } = {}) {
    const resolvedLogger = resolveLogger(logger, 'oauth-flow');
    if (skipBrowserOpen) {
        resolvedLogger.info('Skipping automatic browser opening', 'oauth-flow');
        resolvedLogger.info('Please copy the authorization URL manually if you still need to authenticate.', 'oauth-flow');
        return;
    }

    const platform = process.platform;
    const isWsl = !!(
        process.env.WSL_DISTRO_NAME
        || process.env.WSLENV
        || (fs.existsSync('/proc/version')
            && fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft'))
    );

    let command;
    if (platform === 'win32') {
        command = `start "" "${authUrl}"`;
    } else if (platform === 'darwin') {
        command = `open "${authUrl}"`;
    } else if (isWsl) {
        command = `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command "Start-Process '${authUrl}'"`;
    } else {
        command = `xdg-open "${authUrl}"`;
    }

    exec(command, (error) => {
        if (error) {
            if (!isWsl || error.code !== 1) {
                resolvedLogger.warn('Failed to open browser automatically', 'oauth-flow', error);
            } else {
                resolvedLogger.debug('WSL browser command completed with exit code 1', 'oauth-flow');
            }
        }
    });
}

async function runOAuthFlow(
    { clientId, tokenStorePath, logger, port = OAUTH_SERVER_CONFIG.DEFAULT_PORT, autoFindPort = false, skipBrowserOpen = false, scopes = TWITCH_OAUTH_SCOPES },
    {
        startCallbackServer: startCallbackServerImpl = startCallbackServer,
        exchangeCodeForTokens: exchangeCodeForTokensImpl = exchangeCodeForTokens,
        openBrowser: openBrowserImpl = openBrowser
    } = {}
) {
    const resolvedLogger = resolveLogger(logger, 'oauth-flow');
    const handler = createOAuthFlowErrorHandler(resolvedLogger);

    if (!clientId) {
        throw new Error('clientId is required for OAuth flow');
    }
    if (!tokenStorePath) {
        throw new Error('tokenStorePath is required for OAuth flow');
    }
    if (!secrets.twitch.clientSecret) {
        throw new Error('clientSecret is required for OAuth flow');
    }

    let serverRef;
    try {
        const { server, waitForCode, redirectUri } = await startCallbackServerImpl({
            port,
            autoFindPort,
            logger: resolvedLogger
        });
        serverRef = server;

        const authUrl = buildAuthUrl(clientId, redirectUri, scopes);
        openBrowserImpl(authUrl, resolvedLogger, { skipBrowserOpen });

        const code = await waitForCode;
        const tokenResponse = await exchangeCodeForTokensImpl(code, {
            clientId,
            clientSecret: secrets.twitch.clientSecret,
            redirectUri,
            logger: resolvedLogger
        });

        const tokens = tokenResponse;
        if (!tokens || !tokens.accessToken) {
            throw new Error('OAuth flow did not return accessToken');
        }
        const expiresAt = Number.isFinite(tokens.expiresIn)
            ? Date.now() + (tokens.expiresIn * 1000)
            : null;

        await saveTokens(
            { tokenStorePath, logger: resolvedLogger },
            {
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresAt
            }
        );

        safeCloseServer(serverRef);
        return {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn
        };
    } catch (error) {
        safeCloseServer(serverRef);
        handler.handleEventProcessingError(error, 'oauth-flow', null, 'OAuth flow failed');
        return null;
    }
}

module.exports = {
    generateSelfSignedCert,
    findAvailablePort,
    buildAuthUrl,
    startCallbackServer,
    renderCallbackHtml,
    exchangeCodeForTokens,
    openBrowser,
    runOAuthFlow
};
