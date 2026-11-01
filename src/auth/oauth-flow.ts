import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import * as https from 'node:https';
import type { IncomingMessage } from 'node:http';
import * as querystring from 'node:querystring';
import * as selfsigned from 'selfsigned';
import { TWITCH } from '../core/endpoints';
import { secrets } from '../core/secrets';
import { TOKEN_REFRESH_CONFIG, OAUTH_SERVER_CONFIG } from '../utils/auth-constants';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { resolveLogger } from '../utils/logger-resolver';
import { saveTokens } from '../utils/token-store';
import { withOperationDeadline } from '../utils/timeout-wrapper';
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

type OAuthFlowOptions = {
    clientId: string;
    tokenStorePath: string;
    logger?: unknown;
    port?: number;
    autoFindPort?: boolean;
    skipBrowserOpen?: boolean;
    scopes?: readonly string[];
    persistTokens?: boolean;
    signal?: AbortSignal;
};

type CallbackServerBootstrapResult = {
    server: https.Server;
    waitForCode: Promise<string>;
    port: number;
    redirectUri: string;
    cancel?: () => void;
};

type RunOAuthFlowDependencies = {
    startCallbackServer?: (options: {
        port?: number;
        autoFindPort?: boolean;
        logger: OAuthLogger;
        expectedState?: string;
        signal?: AbortSignal;
    }) => Promise<CallbackServerBootstrapResult>;
    exchangeCodeForTokens?: typeof exchangeCodeForTokens;
    openBrowser?: typeof openBrowser;
};

type BrowserCommandDependencies = {
    platform?: NodeJS.Platform | undefined;
    env?: NodeJS.ProcessEnv | undefined;
    procVersion?: string | null | undefined;
    readProcVersion?: (() => string | null) | undefined;
};

type BrowserOpenOptions = {
    skipBrowserOpen?: boolean;
    execCommand?: typeof execFile;
} & BrowserCommandDependencies;

const HTML_ESCAPE_MAP: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

const CALLBACK_HTML_HEADERS = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache'
};

const createOAuthFlowErrorHandler = (logger: OAuthLogger) => createPlatformErrorHandler(logger, 'oauth-flow');

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

const logConsole = (logger: OAuthLogger, message: string, context = 'oauth-flow') => {
    if (typeof logger.console === 'function') {
        logger.console(message, context);
        return;
    }
    logger.info(message, context);
};

const safeCloseServer = (server: { close?: () => void; closeAllConnections?: () => void } | null | undefined, force = false) => {
    if (!server || typeof server.close !== 'function') {
        return;
    }
    if (force) {
        // Bun's close() drops its transport reference, so force-close must come first.
        try { server.closeAllConnections?.(); } catch { /* Cleanup is best effort. */ }
    }
    try { server.close(); } catch { /* Cleanup must not replace the flow outcome. */ }
};

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] || char);
}

function generateOAuthState() {
    return crypto.randomBytes(32).toString('base64url');
}

function safeReadProcVersion() {
    try {
        if (!fs.existsSync('/proc/version')) {
            return null;
        }
        return fs.readFileSync('/proc/version', 'utf8');
    } catch {
        return null;
    }
}

function isWslEnvironment({ env = process.env, procVersion, readProcVersion = safeReadProcVersion }: BrowserCommandDependencies = {}) {
    if (env.WSL_DISTRO_NAME || env.WSLENV) {
        return true;
    }

    const version = procVersion ?? readProcVersion();
    return typeof version === 'string' && version.toLowerCase().includes('microsoft');
}

function summarizeInvalidTokenResponse(response: Record<string, unknown>): Record<string, unknown> {
    return {
        hasAccessToken: typeof response.access_token === 'string' && response.access_token.length > 0,
        hasRefreshToken: typeof response.refresh_token === 'string' && response.refresh_token.length > 0,
        hasExpiresIn: response.expires_in !== undefined,
        errorDescriptionPresent: typeof response.error_description === 'string' && response.error_description.length > 0
    };
}

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

function buildAuthUrl(clientId: string, redirectUri: string, scopes: readonly string[] = TWITCH_OAUTH_SCOPES, state = generateOAuthState()) {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        state
    });

    return `${TWITCH.OAUTH.AUTHORIZE}?${params.toString()}`;
}

function renderCallbackHtml(status: string, details: { error?: string; description?: string } = {}) {
    const error = escapeHtml(details.error || 'Unknown error');
    const description = escapeHtml(details.description || 'Unknown error occurred');

    if (status === 'success') {
        return `
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #9146FF;">Authorization received</h1>
                    <p>Completing token exchange and validation in the application.</p>
                    <p style="color: #666;">You can close this window and return to your terminal.</p>
                </body>
            </html>
        `;
    }

    if (status === 'failed') {
        return `
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #FF0000;">Authentication Failed</h1>
                    <p>Error: ${error}</p>
                    <p>${description}</p>
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

async function startCallbackServer({ port = OAUTH_SERVER_CONFIG.DEFAULT_PORT, autoFindPort = false, logger, expectedState = generateOAuthState(), signal }: { port?: number; autoFindPort?: boolean; logger?: unknown; expectedState?: string; signal?: AbortSignal }): Promise<CallbackServerBootstrapResult> {
    signal?.throwIfAborted();
    const resolvedLogger: OAuthLogger = resolveLogger(logger, 'oauth-flow') as OAuthLogger;

    let resolveCode: (value: string) => void = () => {};
    let rejectCode: (reason: unknown) => void = () => {};
    const waitForCode = new Promise<string>((resolve, reject) => {
        resolveCode = resolve;
        rejectCode = reject;
    });
    void waitForCode.catch(() => {});

    let server: https.Server;
    let boundPort = port;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let flushTimeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let retired = false;
    let flushingSuccess = false;
    let detachResponseListeners = () => {};
    let closeTransport: (force: boolean) => void = () => {};
    const settle = (error?: Error, code?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (error) rejectCode(error);
        else resolveCode(code!);
    };
    const retire = () => {
        if (retired) return;
        retired = true;
        signal?.removeEventListener('abort', onAbort);
        flushingSuccess = false;
        clearTimeout(flushTimeout);
        detachResponseListeners();
        detachResponseListeners = () => {};
        closeTransport(true);
        server.off('close', onServerClose);
        server.off('error', onServerError);
    };
    const finish = (error?: Error) => {
        settle(error);
        retire();
    };
    const onAbort = () => finish(new Error('OAuth callback cancelled'));
    const onServerClose = () => finish(new Error('OAuth callback server closed'));
    const onServerError = (error: Error) => finish(error);

    const options = generateSelfSignedCert();
    server = https.createServer({ key: options.key, cert: options.cert }, (req, res) => {
        const rejectRequest = (status = 400) => {
            res.writeHead(status, CALLBACK_HTML_HEADERS);
            res.end(renderCallbackHtml('invalid'));
        };
        if (settled || req.method !== 'GET' || req.headers.host !== `localhost:${boundPort}` || !req.url || req.url.length > 8192 || !req.url.startsWith('/') || req.url.startsWith('//')) {
            rejectRequest();
            return;
        }
        let requestUrl: URL;
        try { requestUrl = new URL(req.url, `https://localhost:${boundPort}`); }
        catch { rejectRequest(); return; }
        const params = requestUrl.searchParams;
        if ([...params].some(([key, value]) => !['state', 'code', 'error', 'error_description', 'scope'].includes(key) || value.length > 4096 || params.getAll(key).length !== 1)) {
            rejectRequest(); return;
        }

        if (requestUrl.pathname === '/' || requestUrl.pathname === '/callback') {
            if (!expectedState || requestUrl.searchParams.get('state') !== expectedState) {
                res.writeHead(400, CALLBACK_HTML_HEADERS);
                res.end(renderCallbackHtml('invalid'));
                return;
            }

            const code = requestUrl.searchParams.get('code');
            if (code && !params.has('error')) {
                // Keep the transport reference until the complete response is handed
                // off. Then force-retire unrelated incomplete connections as well.
                flushingSuccess = true;
                const onResponseComplete = () => {
                    flushingSuccess = false;
                    retire();
                };
                res.once('finish', onResponseComplete);
                res.once('close', onResponseComplete);
                res.once('error', onResponseComplete);
                detachResponseListeners = () => {
                    res.off('finish', onResponseComplete);
                    res.off('close', onResponseComplete);
                    res.off('error', onResponseComplete);
                };
                // A stalled response cannot retain the listener or sockets forever.
                flushTimeout = safeSetTimeout(onResponseComplete, 2000);
                settle(undefined, code);
                res.writeHead(200, { ...CALLBACK_HTML_HEADERS, Connection: 'close' });
                res.end(renderCallbackHtml('success'));
                return;
            }

            const oauthError = requestUrl.searchParams.get('error');
            if (oauthError && !params.has('code')) {
                res.writeHead(400, CALLBACK_HTML_HEADERS);
                res.end(renderCallbackHtml('failed', {
                    error: 'Provider rejected authorization',
                    description: 'Return to the application and retry authorization.'
                }));
                finish(new Error('OAuth error: provider rejected authorization'));
                return;
            }

            res.writeHead(400, CALLBACK_HTML_HEADERS);
            res.end(renderCallbackHtml('invalid'));
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    });

    const nativeClose = server.close.bind(server);
    closeTransport = (force) => safeCloseServer({
        close: nativeClose,
        closeAllConnections: server.closeAllConnections.bind(server)
    }, force);
    const cancel = () => {
        settle(new Error('OAuth callback server closed by owner'));
        if (!flushingSuccess) retire();
    };
    // Retain legacy owner-close semantics without waiting for active sockets to drain.
    server.close = ((callback?: (error?: Error) => void) => {
        if (retired) return nativeClose(callback);
        if (callback) server.once('close', callback);
        cancel();
        return server;
    }) as typeof server.close;

    signal?.addEventListener('abort', onAbort, { once: true });
    const listenOnPort = async (candidatePort: number) => {
        signal?.throwIfAborted();
        await new Promise<void>((resolve, reject) => {
            const onCancelled = () => {
                server.off('error', onError);
                server.off('listening', onListening);
                reject(new Error('OAuth callback cancelled'));
            };
            const onError = (error: unknown) => {
                signal?.removeEventListener('abort', onCancelled);
                server.off('listening', onListening);
                reject(error);
            };
            const onListening = () => {
                signal?.removeEventListener('abort', onCancelled);
                server.off('error', onError);
                resolve(undefined);
            };

            signal?.addEventListener('abort', onCancelled, { once: true });
            server.once('error', onError);
            server.once('listening', onListening);

            try {
                server.listen({ port: candidatePort, host: '127.0.0.1', ...(signal ? { signal } : {}) });
            } catch (error) {
                signal?.removeEventListener('abort', onCancelled);
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
        finish(error instanceof Error ? error : new Error('OAuth callback startup failed'));
        throw error;
    }

    signal?.throwIfAborted();
    const serverAddress = server.address();
    boundPort = serverAddress && typeof serverAddress === 'object' ? serverAddress.port : port;
    const redirectUri = `https://localhost:${boundPort}`;
    timeoutId = safeSetTimeout(() => finish(new Error('OAuth flow timed out')), TOKEN_REFRESH_CONFIG.OAUTH_TIMEOUT_MS);
    server.once('close', onServerClose);
    try { resolvedLogger.info(`OAuth callback server started on port ${boundPort}`, 'oauth-flow'); } catch { /* Diagnostics are best effort. */ }

    server.on('error', onServerError);

    return { server, waitForCode, port: boundPort, redirectUri, cancel };
}

async function exchangeCodeForTokens(
    code: string,
    {
        clientId,
        clientSecret,
        redirectUri,
        logger,
        httpsRequest,
        timeoutMs = 30_000,
        maxResponseBytes = 64 * 1024,
        signal
    }: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        logger: unknown;
        httpsRequest?: typeof https.request;
        timeoutMs?: number;
        maxResponseBytes?: number;
        signal?: AbortSignal;
    }
): Promise<OAuthTokenResponse> {
    signal?.throwIfAborted();
    const resolvedLogger: OAuthLogger = resolveLogger(logger, 'oauth-flow') as OAuthLogger;
    const postData = querystring.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
    });

    const requestImpl = httpsRequest || https.request;

    return await new Promise<OAuthTokenResponse>((resolve, reject) => {
        let settled = false;
        let req: ReturnType<typeof https.request> | undefined;
        let responseStream: IncomingMessage | undefined;
        const fail = (message: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            signal?.removeEventListener('abort', onAbort);
            reject(new Error(message));
            try { responseStream?.destroy(); } catch { /* best effort */ }
            try { req?.destroy(); } catch { /* best effort */ }
        };
        const onAbort = () => fail('Token exchange cancelled');
        const deadline = safeSetTimeout(() => fail('Token exchange timed out'), timeoutMs);
        signal?.addEventListener('abort', onAbort, { once: true });
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

        try {
        req = requestImpl(options, (res) => {
            responseStream = res;
            if (settled) { res.destroy(); return; }
            const chunks: Buffer[] = [];
            let bytes = 0;
            res.on('data', (chunk) => {
                bytes += Buffer.byteLength(chunk);
                if (bytes > maxResponseBytes) { fail('Token exchange response exceeded limit'); return; }
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            res.on('error', () => fail('Token exchange response failed'));
            res.on('aborted', () => fail('Token exchange response aborted'));
            res.on('close', () => { if (!res.complete) fail('Token exchange response closed'); });
            res.on('end', () => {
                if (settled) return;
                try {
                    const response = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    if (res.statusCode === 200 && response && typeof response.access_token === 'string' && response.access_token.trim() && typeof response.refresh_token === 'string' && response.refresh_token.trim()) {
                        settled = true;
                        clearTimeout(deadline);
                        signal?.removeEventListener('abort', onAbort);
                        resolve({
                            accessToken: response.access_token,
                            refreshToken: response.refresh_token,
                            expiresIn: Number.isFinite(response.expires_in) ? response.expires_in : null
                        });
                        return;
                    }

                    try { resolvedLogger.warn('Invalid token response', 'oauth-flow', summarizeInvalidTokenResponse(response || {})); } catch { /* Diagnostics cannot prevent settlement. */ }
                    fail('Token exchange failed: invalid response');
                } catch {
                    fail('Failed to parse token response');
                }
            });
        });

        if (settled) { req.destroy(); return; }
        req.on('error', () => {
            fail('Token exchange request failed');
        });

        req.write(postData);
        req.end();
        } catch { fail('Token exchange request failed'); }
    });
}

function displayOAuthInstructions(authUrl: string, logger: unknown, { scopes = TWITCH_OAUTH_SCOPES, tokenStorePath = null }: { scopes?: readonly string[]; tokenStorePath?: string | null } = {}) {
    const resolvedLogger: OAuthLogger = resolveLogger(logger, 'oauth-flow') as OAuthLogger;

    resolvedLogger.info('Twitch authorization required; follow the instructions in the terminal', 'oauth-flow');
    logConsole(resolvedLogger, '\n' + '='.repeat(80));
    logConsole(resolvedLogger, 'TWITCH AUTHENTICATION REQUIRED');
    logConsole(resolvedLogger, '='.repeat(80));

    logConsole(resolvedLogger, '\nATTEMPTING AUTOMATIC BROWSER OPENING...');
    logConsole(resolvedLogger, 'Your browser should open automatically to complete authentication.');
    logConsole(resolvedLogger, 'If it doesn\'t open automatically, please copy and paste the URL shown in the terminal:');
    // This generated authorization link is an interactive action, not a diagnostic.
    // Keep state and request parameters out of file/operator history.
    try { process.stdout.write(`\n${authUrl}\n\n`); }
    catch { resolvedLogger.warn('Unable to display authorization link in the terminal', 'oauth-flow'); }

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

function resolveBrowserOpenCommand(authUrl: string, { platform = process.platform, env = process.env, procVersion, readProcVersion }: BrowserCommandDependencies = {}) {
    const isWsl = platform === 'linux' && isWslEnvironment({ env, procVersion, readProcVersion });

    if (platform === 'win32' || isWsl) {
        const script = `Start-Process -FilePath '${authUrl.replace(/'/g, "''")}'`;
        return {
            command: isWsl ? '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : 'powershell.exe',
            args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
            isWsl
        };
    }

    if (platform === 'darwin') {
        return { command: 'open', args: [authUrl], isWsl: false };
    }

    return { command: 'xdg-open', args: [authUrl], isWsl: false };
}

function openBrowser(authUrl: string, logger: unknown, { skipBrowserOpen = false, execCommand = execFile, platform, env, procVersion, readProcVersion }: BrowserOpenOptions = {}) {
    const resolvedLogger: OAuthLogger = resolveLogger(logger, 'oauth-flow') as OAuthLogger;
    if (skipBrowserOpen) {
        resolvedLogger.info('Skipping automatic browser opening', 'oauth-flow');
        resolvedLogger.info('Please copy the authorization URL manually if you still need to authenticate.', 'oauth-flow');
        return;
    }

    const { command, args, isWsl } = resolveBrowserOpenCommand(authUrl, { platform, env, procVersion, readProcVersion });

    const reportOpenFailure = (error: unknown) => {
        try {
            if (error) {
                if (!isWsl || getErrorCode(error) !== 1) {
                    resolvedLogger.warn('Failed to open browser automatically; use the authorization URL in the terminal.', 'oauth-flow');
                } else {
                    resolvedLogger.debug('WSL browser command completed with exit code 1', 'oauth-flow');
                }
            }
        } catch { /* Manual authorization remains available if diagnostics fail. */ }
    };
    try { execCommand(command, args, reportOpenFailure); }
    catch (error) { reportOpenFailure(error); }
}

async function runOAuthFlow(
    { clientId, tokenStorePath, logger, port = OAUTH_SERVER_CONFIG.DEFAULT_PORT, autoFindPort = false, skipBrowserOpen = false, scopes = TWITCH_OAUTH_SCOPES, persistTokens = true, signal }: OAuthFlowOptions,
    {
        startCallbackServer: startCallbackServerImpl = startCallbackServer,
        exchangeCodeForTokens: exchangeCodeForTokensImpl = exchangeCodeForTokens,
        openBrowser: openBrowserImpl = openBrowser
    }: RunOAuthFlowDependencies = {}
) {
    const resolvedLogger: OAuthLogger = resolveLogger(logger, 'oauth-flow') as OAuthLogger;
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

    let serverRef: https.Server | null = null;
    let cancelCallback: (() => void) | undefined;
    let callbackCancelled = false;
    const cancelOwnedCallback = () => {
        if (callbackCancelled) return;
        callbackCancelled = true;
        if (cancelCallback) {
            try { cancelCallback(); } catch { /* Cleanup must preserve the result. */ }
        } else {
            safeCloseServer(serverRef, true);
        }
    };
    try {
        signal?.throwIfAborted();
        const state = generateOAuthState();
        const { server, waitForCode, redirectUri, cancel } = await startCallbackServerImpl({
            port,
            autoFindPort,
            logger: resolvedLogger,
            expectedState: state,
            ...(signal ? { signal } : {})
        });
        serverRef = server;
        cancelCallback = cancel;
        signal?.addEventListener('abort', cancelOwnedCallback, { once: true });
        signal?.throwIfAborted();

        const authUrl = buildAuthUrl(clientId, redirectUri, scopes, state);
        displayOAuthInstructions(authUrl, resolvedLogger, { scopes, tokenStorePath });
        signal?.throwIfAborted();
        openBrowserImpl(authUrl, resolvedLogger, { skipBrowserOpen });

        const code = await withOperationDeadline(() => waitForCode, {
            ...(signal ? { parentAbortSignal: signal } : {}),
            budgetMs: TOKEN_REFRESH_CONFIG.OAUTH_TIMEOUT_MS, operationName: 'OAuth callback'
        });
        signal?.throwIfAborted();
        const tokenResponse = await exchangeCodeForTokensImpl(code, {
            clientId,
            clientSecret: secrets.twitch.clientSecret,
            redirectUri,
            logger: resolvedLogger,
            ...(signal ? { signal } : {})
        });

        signal?.throwIfAborted();
        const tokens = tokenResponse;
        if (!tokens || !tokens.accessToken) {
            throw new Error('OAuth flow did not return accessToken');
        }
        const expiresIn = Number(tokens.expiresIn);
        const expiresAt = Number.isFinite(expiresIn)
            ? Date.now() + (expiresIn * 1000)
            : null;

        if (persistTokens) {
            await saveTokens(
                { tokenStorePath, logger: resolvedLogger },
                {
                    accessToken: tokens.accessToken,
                    ...(tokens.refreshToken === undefined ? {} : { refreshToken: tokens.refreshToken }),
                    expiresAt
                }
            );
        }

        signal?.throwIfAborted();
        return {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn
        };
    } catch (error) {
        try { handler.handleEventProcessingError(error, 'oauth-flow', null, 'OAuth flow failed'); } catch { /* Preserve failure outcome. */ }
        return null;
    } finally {
        signal?.removeEventListener('abort', cancelOwnedCallback);
        cancelOwnedCallback();
    }
}

export {
    generateSelfSignedCert,
    buildAuthUrl,
    startCallbackServer,
    renderCallbackHtml,
    resolveBrowserOpenCommand,
    exchangeCodeForTokens,
    openBrowser,
    runOAuthFlow
};
