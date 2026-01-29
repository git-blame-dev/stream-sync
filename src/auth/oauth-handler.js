
const { TWITCH_OAUTH_SCOPES, OAUTH_SERVER_CONFIG, TWITCH_ENDPOINTS, TOKEN_REFRESH_CONFIG } = require('../utils/auth-constants');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { validateLoggerInterface } = require('../utils/dependency-validator');

const https = require('https');
const url = require('url');
const TokenRefreshUtility = require('../utils/token-refresh-utility');
const { exec } = require('child_process');
const { safeSetTimeout } = require('../utils/timeout-validator');
const { secrets } = require('../core/secrets');

class TwitchOAuthHandler {
    constructor(config, options = {}) {
        this.config = config;
        this.server = null;
        validateLoggerInterface(options.logger);
        this.logger = options.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'oauth-handler');
        this.port = options.port || OAUTH_SERVER_CONFIG.DEFAULT_PORT;
        this.redirectUri = `https://localhost:${this.port}`;
        this.sslCerts = null;
        this._autoFindPort = options.autoFindPort === true;
        this._skipBrowserOpen = options.skipBrowserOpen === true;
        this.scopes = TWITCH_OAUTH_SCOPES;
    }

    generateSelfSignedCert() {
        if (this.sslCerts) {
            return this.sslCerts;
        }
        
        const selfsigned = require('selfsigned');
        const attrs = [{ name: 'commonName', value: 'localhost' }];
        const options = {
            days: OAUTH_SERVER_CONFIG.SSL_OPTIONS.DAYS,
            keySize: OAUTH_SERVER_CONFIG.SSL_OPTIONS.KEY_SIZE,
            algorithm: OAUTH_SERVER_CONFIG.SSL_OPTIONS.ALGORITHM
        };
        
        const pems = selfsigned.generate(attrs, options);
        
        this.sslCerts = {
            key: pems.private,
            cert: pems.cert
        };
        
        return this.sslCerts;
    }

    async findAvailablePort(startPort = OAUTH_SERVER_CONFIG.DEFAULT_PORT) {
        return new Promise((resolve, reject) => {
            const net = require('net');
            const server = net.createServer();
            
            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    if (startPort < OAUTH_SERVER_CONFIG.PORT_RANGE.END) {
                        this.findAvailablePort(startPort + 1).then(resolve).catch(reject);
                    } else {
                        reject(new Error(`No available ports found in range ${OAUTH_SERVER_CONFIG.PORT_RANGE.START}-${OAUTH_SERVER_CONFIG.PORT_RANGE.END}`));
                    }
                } else {
                    reject(err);
                }
            });
            
            server.listen(startPort, () => {
                const port = server.address().port;
                server.close(() => {
                    resolve(port);
                });
            });
        });
    }

    generateAuthUrl() {
        const params = new URLSearchParams({
            client_id: this.config.clientId,
            redirect_uri: this.redirectUri,
            response_type: 'code',
            scope: this.scopes.join(' '),
            state: 'cb_' + Date.now().toString(36) // Shorter state for CSRF protection
        });

        return `${TWITCH_ENDPOINTS.OAUTH.AUTHORIZE}?${params.toString()}`;
    }

    async startCallbackServer() {
        if (this._autoFindPort) {
            this.port = await this.findAvailablePort(this.port);
            this.redirectUri = `https://localhost:${this.port}`;
        }
        
        return new Promise((resolve, reject) => {
            const options = {
                key: this.generateSelfSignedCert().key,
                cert: this.generateSelfSignedCert().cert
            };

            this.server = https.createServer(options, (req, res) => {
                const parsedUrl = url.parse(req.url, true);

                if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/callback') {
                    this.handleCallback(req, res, parsedUrl.query, resolve, reject);
                } else {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Not Found');
                }
            });

            this.server.listen(this.port, (err) => {
                if (err) {
                    reject(new Error(`Failed to start callback server: ${err.message}`));
                } else {
                    this.logger.info(`OAuth callback server started on port ${this.port}`, 'oauth-handler');
                }
            });

            // Set timeout to prevent hanging using centralized configuration
            safeSetTimeout(() => {
                if (this.server) {
                    this.server.close();
                    reject(new Error(`OAuth flow timed out after ${TOKEN_REFRESH_CONFIG.OAUTH_TIMEOUT_MS / 60000} minutes`));
                }
            }, TOKEN_REFRESH_CONFIG.OAUTH_TIMEOUT_MS);
        });
    }

    async handleCallback(req, res, query, resolve, reject) {
        try {
            if (query.code) {
                this.logger.info('Received authorization code, exchanging for tokens...', 'oauth-handler');

                const tokens = await this.exchangeCodeForTokens(query.code);

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                            <h1 style="color: #9146FF;">Authentication Successful!</h1>
                            <p>Your Twitch tokens have been obtained and saved.</p>
                            <p style="color: #666;">You can close this window and return to your terminal.</p>
                            <p><strong>The application will now restart automatically.</strong></p>
                        </body>
                    </html>
                `);

                this.server.close();
                resolve(tokens);

            } else if (query.error) {
                this._logOAuthError(`OAuth error: ${query.error}`);

                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                            <h1 style="color: #FF0000;">Authentication Failed</h1>
                            <p>Error: ${query.error}</p>
                            <p>${query.error_description || 'Unknown error occurred'}</p>
                            <p>Please try again or check your configuration.</p>
                        </body>
                    </html>
                `);

                this.server.close();
                reject(new Error(`OAuth error: ${query.error} - ${query.error_description || 'Unknown error'}`));
            } else {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                            <h1 style="color: #FF0000;">Invalid Callback</h1>
                            <p>No authorization code received.</p>
                            <p>Please try the authentication process again.</p>
                        </body>
                    </html>
                `);
                
                this.server.close();
                reject(new Error('Invalid callback - no authorization code received'));
            }
        } catch (error) {
            this._logOAuthError(`Error handling callback: ${error.message}`, error);
            
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`
                <html>
                    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                        <h1 style="color: #FF0000;">Server Error</h1>
                        <p>An error occurred while processing your authentication.</p>
                        <p>Please try again or check the terminal for details.</p>
                    </body>
                </html>
            `);
            
            this.server.close();
            reject(error);
        }
    }

    async exchangeCodeForTokens(code) {
        const https = require('https');
        const querystring = require('querystring');
        
        const postData = querystring.stringify({
            client_id: this.config.clientId,
            client_secret: secrets.twitch.clientSecret,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: this.redirectUri
        });

        return new Promise((resolve, reject) => {
            const urlParts = new URL(TWITCH_ENDPOINTS.OAUTH.TOKEN);
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

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        
                        if (response.access_token && response.refresh_token) {
                            this.logger.info('Successfully exchanged code for tokens', 'oauth-handler');
                            resolve(response);
                        } else {
                            this._logOAuthError('Invalid token response', null, 'oauth-handler', response);
                            reject(new Error(`Token exchange failed: ${response.error || 'Unknown error'}`));
                        }
                    } catch (error) {
                        this._logOAuthError('Failed to parse token response', error);
                        reject(new Error(`Failed to parse token response: ${error.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                this._logOAuthError('Token exchange request failed', error);
                reject(new Error(`Token exchange request failed: ${error.message}`));
            });

            req.write(postData);
            req.end();
        });
    }

    async persistTokens(tokens) {
        try {
            if (!this.config.tokenStorePath) {
                throw new Error('tokenStorePath is required to persist OAuth tokens');
            }

            const tokenUtility = new TokenRefreshUtility({
                logger: this.logger,
                tokenStorePath: this.config.tokenStorePath
            });
            const expiresAt = tokens.expires_in ? Date.now() + (tokens.expires_in * 1000) : null;
            const success = await tokenUtility.persistTokens(tokens.access_token, tokens.refresh_token, expiresAt);

            if (success) {
                this.logger.info('Token store updated successfully with new tokens', 'oauth-handler');
            } else {
                this.logger.warn('Token refresh succeeded but token store update failed', 'oauth-handler');
                throw new Error('Token store update failed');
            }

        } catch (error) {
            this._logOAuthError('Failed to persist tokens to token store', error);
            throw new Error(`Failed to persist tokens to token store: ${error.message}`);
        }
    }

    openBrowser(url) {
        const disableAuth = (process.env.TWITCH_DISABLE_AUTH || '').toLowerCase();
        if (disableAuth === 'true' || this._skipBrowserOpen) {
            this.logger.info('Skipping automatic browser opening', 'oauth-handler');
            this.logger.info('Please copy the authorization URL manually if you still need to authenticate.', 'oauth-handler');
            return;
        }

        const platform = process.platform;
        let command;

        // Detect WSL2 environment
        const isWSL = process.env.WSL_DISTRO_NAME || 
                     process.env.WSLENV || 
                     require('fs').existsSync('/proc/version') && 
                     require('fs').readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');

        switch (platform) {
            case 'win32':
                // Windows start command requires empty title parameter before URL
                command = `start "" "${url}"`;
                break;
            case 'darwin':
                command = `open "${url}"`;
                break;
            default: // linux and others
                if (isWSL) {
                    // WSL2: Use PowerShell for better URL handling with long parameters
                    command = `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command "Start-Process '${url}'"`;
                } else {
                    // Regular Linux
                    command = `xdg-open "${url}"`;
                }
                break;
        }

        exec(command, (error) => {
            if (error) {
                // In WSL2, Windows commands may return error code 1 even when successful
                // Only log as warning if it's not WSL2 or if it's a different error
                if (!isWSL || error.code !== 1) {
                    this.logger.warn('Failed to open browser automatically', 'oauth-handler', error);
                } else {
                    // In WSL2, error code 1 is often normal - browser still opens
                    this.logger.debug('WSL2 browser command completed (exit code 1 is normal)', 'oauth-handler');
                }
            }
        });
    }

    async runOAuthFlow() {
        try {
            const authUrl = this.generateAuthUrl();
            const tokenPromise = this.startCallbackServer();
            this.displayOAuthInstructions(authUrl);
            const tokens = await tokenPromise;
            await this.persistTokens(tokens);

            return tokens;
            
        } catch (error) {
            if (this.server) {
                this.server.close(() => {
                    this.server = null;
                });
            }
            this._logOAuthError(`OAuth flow failed: ${error.message}`, error);
            return null;
        }
    }

    displayOAuthInstructions(authUrl) {
        this.logger.console('\n' + '='.repeat(80), 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.logger.console('TWITCH AUTHENTICATION REQUIRED', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.logger.console('='.repeat(80), 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        
        this.logger.console('\nAUTOMATIC BROWSER OPENING...', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.logger.console('Your browser should open automatically to complete authentication.', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.logger.console('If it doesn\'t open automatically, please copy and paste this URL:', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.logger.console(`\n${authUrl}\n`, 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        
        this.logger.console('WHAT WILL HAPPEN:', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.logger.console('1. Browser opens to Twitch OAuth page', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.logger.console('2. Log in with your Twitch account', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.logger.console('3. Review and authorize the requested permissions', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.logger.console('4. You\'ll be redirected back to a success page', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        if (this.config.tokenStorePath) {
            this.logger.console(`5. Tokens will be saved to the token store (${this.config.tokenStorePath})`, 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        } else {
            this.logger.console('5. Tokens will be saved to the token store (set twitch.tokenStorePath in config)', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        }
        this.logger.console('6. The application will restart automatically', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        
        this.logger.console('\nREQUIRED PERMISSIONS:', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.scopes.forEach(scope => {
            this.logger.console(`   - ${scope}`, 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        });
        
        this.logger.console('\nFUTURE PREVENTION:', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.logger.console('Once you authorize, the bot will automatically refresh tokens', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.logger.console('before they expire, preventing this issue from happening again.', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        
        this.logger.console('\n' + '='.repeat(80), 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.logger.console('WAITING FOR AUTHENTICATION...', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.logger.console('Please complete the authentication in your browser.', 'oauth-handler'); // USER_INTERFACE: Authentication prompt
        this.logger.console('='.repeat(80), 'oauth-handler'); // USER_INTERFACE: Authentication prompt

        this.openBrowser(authUrl);
    }

    cleanup() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.server = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    _logOAuthError(message, error = null, eventType = 'oauth-handler', payload = null) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, payload, message);
        } else if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'oauth-handler', payload || error);
        }
    }
}

module.exports = {
    TwitchOAuthHandler
};
