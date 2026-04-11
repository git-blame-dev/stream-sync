import { exec } from 'node:child_process';
import fs from 'node:fs';
import * as https from 'node:https';
import * as querystring from 'node:querystring';
import * as selfsigned from 'selfsigned';
import { TWITCH } from '../core/endpoints';
import { secrets } from '../core/secrets';
import { TOKEN_REFRESH_CONFIG, OAUTH_SERVER_CONFIG } from '../utils/auth-constants';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { resolveLogger } from '../utils/logger-resolver';
import { saveTokens } from '../utils/token-store';
import { safeSetTimeout } from '../utils/timeout-validator';
import { TWITCH_OAUTH_SCOPES } from './twitch-oauth-scopes';

type OAuthLogger = ReturnType<typeof resolveLogger> & {
    console?: (message: string, context?: string, payload?: unknown) => void;
};

type OAuthTokenResponse = {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number | null;
};

let cachedCerts: { key: string; cert: string } | null = null;

const createOAuthFlowErrorHandler = (logger) => createPlatformErrorHandler(logger, 'oauth-flow');

const getErrorCode = (error: unknown): string | number | null => {
    if (!error || typeof error !== 'object' || !('code' in error)) {
        return null;
    }
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') {
        return code;
    }
    return null;
};

const getErrorMessage = (error: unknown): string => {
    return error instanceof Error ? error.message : String(error);
};

const logConsole = (logger: OAuthLogger, message: string, context = 'oauth-flow') => {
    if (typeof logger.console === 'function') {
        logger.console(message, context);
        return;
    }
    logger.info(message, context);
};

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

function renderCallbackHtml(status: string, details: { error?: string; description?: string } = {}) {
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
    const resolvedLogger: OAuthLogger = resolveLogger(logger, 'oauth-flow');
    const handler = createOAuthFlowErrorHandler(resolvedLogger);

    let resolveCode: (value: string) => void;
    let rejectCode: (reason: unknown) => void;
    const waitForCode = new Promise<string>((resolve, reject) => {
        resolveCode = resolve;
        rejectCode = reject;
    });

    let server: https.Server;
    let boundPort = port;
    const timeoutId = safeSetTimeout(() => {
        safeCloseServer(server);
        rejectCode(new Error(`OAuth flow timed out after ${TOKEN_REFRESH_CONFIG.OAUTH_TIMEOUT_MS / 60000} minutes`));
    }, TOKEN_REFRESH_CONFIG.OAUTH_TIMEOUT_MS);

    const options = generateSelfSignedCert();
    server = https.createServer({ key: options.key, cert: options.cert }, (req, res) => {
        const requestUrl = new URL(req.url || '/', `https://localhost:${port || OAUTH_SERVER_CONFIG.DEFAULT_PORT}`);

        if (requestUrl.pathname === '/' || requestUrl.pathname === '/callback') {
            const code = requestUrl.searchParams.get('code');
            if (code) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(renderCallbackHtml('success'));
                clearTimeout(timeoutId);
                server.close();
                resolveCode(code);
                return;
            }

            const oauthError = requestUrl.searchParams.get('error');
            if (oauthError) {
                const oauthErrorDescription = requestUrl.searchParams.get('error_description') || undefined;
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(renderCallbackHtml('failed', {
                    error: oauthError,
                    description: oauthErrorDescription
                }));
                clearTimeout(timeoutId);
                server.close();
                rejectCode(new Error(`OAuth error: ${oauthError} - ${oauthErrorDescription || 'Unknown error'}`));
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

    const listenOnPort = async (candidatePort: number) => {
        await new Promise<void>((resolve, reject) => {
            const onError = (error: unknown) => {
                server.off('listening', onListening);
                reject(error);
            };
            const onListening = () => {
                server.off('error', onError);
                resolve(undefined);
            };

            server.once('error', onError);
            server.once('listening', onListening);

            try {
                server.listen(candidatePort);
            } catch (error) {
                server.off('error', onError);
                server.off('listening', onListening);
                reject(error);
            }
        });
    };

    try {
        if (autoFindPort) {
            if (port === 0) {
                await listenOnPort(0);
            } else {
                let candidatePort = port;
                while (true) {
                    try {
                        await listenOnPort(candidatePort);
                        break;
                    } catch (error) {
                        if (getErrorCode(error) === 'EADDRINUSE' && candidatePort < OAUTH_SERVER_CONFIG.PORT_RANGE.END) {
                            candidatePort += 1;
                            continue;
                        }
                        throw error;
                    }
                }
            }
        } else {
            await listenOnPort(port);
        }
    } catch (error) {
        clearTimeout(timeoutId);
        safeCloseServer(server);
        throw error;
    }

    const serverAddress = server.address();
    boundPort = serverAddress && typeof serverAddress === 'object' ? serverAddress.port : port;
    const redirectUri = `https://localhost:${boundPort}`;
    resolvedLogger.info(`OAuth callback server started on port ${boundPort}`, 'oauth-flow');

    server.on('error', (error) => {
        clearTimeout(timeoutId);
        handler.handleEventProcessingError(error, 'oauth-flow', { port: boundPort }, 'OAuth callback server error');
        rejectCode(error);
    });

    return { server, waitForCode, port: boundPort, redirectUri };
}

async function exchangeCodeForTokens(
    code,
    {
        clientId,
        clientSecret,
        redirectUri,
        logger,
        httpsRequest
    }: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        logger: unknown;
        httpsRequest?: typeof https.request;
    }
): Promise<OAuthTokenResponse> {
    const resolvedLogger = logger as OAuthLogger;
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
                    reject(new Error(`Failed to parse token response: ${getErrorMessage(error)}`));
                }
            });
        });

        req.on('error', (error) => {
            handler.handleEventProcessingError(error, 'oauth-flow', null, 'Token exchange request failed');
            reject(new Error(`Token exchange request failed: ${getErrorMessage(error)}`));
        });

        req.write(postData);
        req.end();
    });
}

function displayOAuthInstructions(authUrl, logger, { scopes = TWITCH_OAUTH_SCOPES, tokenStorePath = null } = {}) {
    const resolvedLogger: OAuthLogger = resolveLogger(logger, 'oauth-flow');

    logConsole(resolvedLogger, '\n' + '='.repeat(80));
    logConsole(resolvedLogger, 'TWITCH AUTHENTICATION REQUIRED');
    logConsole(resolvedLogger, '='.repeat(80));

    logConsole(resolvedLogger, '\nATTEMPTING AUTOMATIC BROWSER OPENING...');
    logConsole(resolvedLogger, 'Your browser should open automatically to complete authentication.');
    logConsole(resolvedLogger, 'If it doesn\'t open automatically, please copy and paste this URL:');
    logConsole(resolvedLogger, `\n${authUrl}\n`);

    logConsole(resolvedLogger, 'WHAT WILL HAPPEN:');
    logConsole(resolvedLogger, '1. Browser opens to Twitch OAuth page');
    logConsole(resolvedLogger, '2. Log in with your Twitch account');
    logConsole(resolvedLogger, '3. Review and authorize the requested permissions');
    logConsole(resolvedLogger, '4. You\'ll be redirected back to a success page');
    if (tokenStorePath) {
        logConsole(resolvedLogger, `5. Tokens will be saved to the token store (${tokenStorePath})`);
    } else {
        logConsole(resolvedLogger, '5. Tokens will be saved to the token store');
    }
    logConsole(resolvedLogger, '6. The application will continue automatically');

    logConsole(resolvedLogger, '\nREQUIRED PERMISSIONS:');
    scopes.forEach(scope => {
        logConsole(resolvedLogger, `   - ${scope}`);
    });

    logConsole(resolvedLogger, '\nFUTURE PREVENTION:');
    logConsole(resolvedLogger, 'Once you authorize, the bot will automatically refresh tokens');
    logConsole(resolvedLogger, 'before they expire, preventing this issue from happening again.');

    logConsole(resolvedLogger, '\n' + '='.repeat(80));
    logConsole(resolvedLogger, 'WAITING FOR AUTHENTICATION...');
    logConsole(resolvedLogger, 'Please complete the authentication in your browser.');
    logConsole(resolvedLogger, '='.repeat(80));
}

function openBrowser(authUrl, logger, { skipBrowserOpen = false } = {}) {
    const resolvedLogger: OAuthLogger = resolveLogger(logger, 'oauth-flow');
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
            if (!isWsl || getErrorCode(error) !== 1) {
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
    const resolvedLogger: OAuthLogger = resolveLogger(logger, 'oauth-flow');
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
        displayOAuthInstructions(authUrl, resolvedLogger, { scopes, tokenStorePath });
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
        const expiresIn = Number(tokens.expiresIn);
        const expiresAt = Number.isFinite(expiresIn)
            ? Date.now() + (expiresIn * 1000)
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

export {
    generateSelfSignedCert,
    buildAuthUrl,
    startCallbackServer,
    renderCallbackHtml,
    exchangeCodeForTokens,
    openBrowser,
    runOAuthFlow
};
