const crypto = require('crypto');

function createTwitchEventSubWsLifecycle(options = {}) {
    const {
        WebSocketCtor,
        safeSetTimeout,
        safeDelay,
        validateTimeout,
        now = () => Date.now(),
        random = () => crypto.randomInt(0, 1000) / 1000,
        setImmediateFn = setImmediate
    } = options;

    if (typeof WebSocketCtor !== 'function') {
        throw new Error('WebSocketCtor is required');
    }
    if (typeof safeSetTimeout !== 'function' || typeof safeDelay !== 'function' || typeof validateTimeout !== 'function') {
        throw new Error('timeout utilities are required');
    }

    const connectWebSocket = (state) => {
        return new Promise((resolve, reject) => {
            state.logger?.debug?.('Connecting to EventSub WebSocket...', 'twitch');

            const logError = typeof state._logEventSubError === 'function' ? (...args) => state._logEventSubError(...args) : () => {};
            const emit = typeof state.emit === 'function' ? (...args) => state.emit(...args) : () => {};
            const handleWebSocketMessage = typeof state.handleWebSocketMessage === 'function'
                ? (...args) => state.handleWebSocketMessage(...args)
                : async () => {};

            let connectionResolved = false;
            let connectionTimeout;

            try {
                state.connectionStartTime = now();

                const websocketUrl = state.reconnectUrl || 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';
                state.ws = new WebSocketCtor(websocketUrl);

                connectionTimeout = safeSetTimeout(() => {
                    if (!connectionResolved && !state.sessionId) {
                        connectionResolved = true;
                        logError('EventSub connection timeout - no welcome message received', null, 'connection-timeout');
                        if (state.ws && state.ws.readyState === 1) {
                            state.ws.close();
                        }
                        reject(new Error('Connection timeout - no welcome message'));
                    }
                }, 15000);

                state.ws.on('open', () => {
                    state.logger?.info?.('EventSub WebSocket connection opened successfully.', 'twitch');
                    state.logger?.info?.('Waiting for welcome message from Twitch...', 'twitch');

                    state.logger?.info?.('WebSocket connection details', 'twitch', {
                        url: 'wss://eventsub.wss.twitch.tv/ws',
                        readyState: state.ws.readyState,
                        hasAuthManager: !!state.authManager,
                        authState: state.authManager?.getState?.(),
                        hasAccessToken: !!state.config?.accessToken,
                        tokenLength: state.config?.accessToken?.length || 0,
                        userId: state.userId,
                        clientId: state.config?.clientId
                    });

                    state.welcomeTimer = safeSetTimeout(() => {
                        if (!state.sessionId) {
                            state.logger?.warn?.(
                                'No welcome message received after 5 seconds; connection may be rejected by Twitch.',
                                'twitch'
                            );
                        }
                    }, 5000);
                });

                state.ws.on('message', async (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        await handleWebSocketMessage(message);

                        if (message.metadata.message_type === 'session_welcome' && !state.sessionId && !connectionResolved) {
                            connectionResolved = true;
                            if (connectionTimeout) {
                                clearTimeout(connectionTimeout);
                            }
                            if (state.welcomeTimer) {
                                clearTimeout(state.welcomeTimer);
                            }

                            state.sessionId = message.payload.session.id;
                            state._isConnected = true;
                            state.reconnectUrl = null;
                            state.logger?.info?.(`EventSub session established: ${state.sessionId}`, 'twitch');

                            if (!state.sessionId || state.sessionId.trim() === '') {
                                logError('Invalid session ID received', null, 'invalid-session');
                                reject(new Error('Invalid session ID'));
                                return;
                            }

                            setImmediateFn(async () => {
                                try {
                                    await safeDelay(
                                        validateTimeout(2000, 2000),
                                        2000,
                                        'twitchEventSub:welcome-wait'
                                    );

                                    const isConnectionValid = state._validateConnectionForSubscriptions?.();
                                    if (!isConnectionValid) {
                                        logError('Connection validation failed before subscription setup', null, 'connection-validation');
                                        state.subscriptionsReady = false;
                                        emit('eventSubSubscriptionFailed', {
                                            sessionId: state.sessionId,
                                            reason: 'connection-validation'
                                        });
                                        reject(new Error('EventSub subscription setup failed'));
                                        return;
                                    }

                                    const result = await state._setupEventSubscriptions?.(true);
                                    const failures = result?.failures || [];
                                    if (failures.length > 0) {
                                        state.subscriptionsReady = false;
                                        logError('Subscription setup completed with failures', null, 'subscription-setup-failed', {
                                            failures
                                        });
                                        emit('eventSubSubscriptionFailed', {
                                            sessionId: state.sessionId,
                                            failures
                                        });
                                        reject(new Error('EventSub subscription setup failed'));
                                        return;
                                    }

                                    state.subscriptionsReady = true;
                                    emit('eventSubConnected', {
                                        sessionId: state.sessionId
                                    });
                                    resolve();
                                } catch (error) {
                                    state.subscriptionsReady = false;
                                    logError('Error during subscription setup', error, 'subscription-setup');
                                    emit('eventSubSubscriptionFailed', {
                                        sessionId: state.sessionId,
                                        error: error.message
                                    });
                                    reject(new Error('EventSub subscription setup failed'));
                                }
                            });
                        }
                    } catch (error) {
                        if (!connectionResolved) {
                            connectionResolved = true;
                            if (connectionTimeout) {
                                clearTimeout(connectionTimeout);
                            }
                        }
                        logError('Error parsing WebSocket message', error, 'ws-parse', {
                            rawData: data.toString()
                        });
                        reject(error);
                    }
                });

                state.ws.on('error', (error) => {
                    if (!connectionResolved) {
                        connectionResolved = true;
                        if (connectionTimeout) {
                            clearTimeout(connectionTimeout);
                        }
                        reject(error);
                    }
                    logError('EventSub WebSocket error', error, 'ws-error', {
                        code: error.code,
                        errno: error.errno
                    });
                });

                state.ws.on('ping', (data) => {
                    state.logger?.debug?.('EventSub ping received, sending pong', 'twitch');
                    if (typeof state.ws.pong === 'function') {
                        state.ws.pong(data);
                    }
                });

                state.ws.on('pong', () => {
                    state.logger?.debug?.('EventSub pong received', 'twitch');
                });

                state.ws.on('close', (code, reason) => {
                    if (state.welcomeTimer) {
                        clearTimeout(state.welcomeTimer);
                    }

                    if (!connectionResolved) {
                        connectionResolved = true;
                        if (connectionTimeout) {
                            clearTimeout(connectionTimeout);
                        }

                        if (code === 1006) {
                            reject(new Error('Connection closed abnormally during initial handshake'));
                            return;
                        }
                    }

                    state._isConnected = false;
                    state.subscriptionsReady = false;
                    state.sessionId = null;

                    const connectionDuration = state.connectionStartTime ? now() - state.connectionStartTime : 'unknown';

                    let closeReason = 'unknown';
                    switch (code) {
                        case 1000:
                            closeReason = 'normal closure';
                            break;
                        case 1001:
                            closeReason = 'going away';
                            break;
                        case 1006:
                            closeReason = 'abnormal closure (no close frame)';
                            break;
                        case 4000:
                            closeReason = 'internal server error';
                            break;
                        case 4001:
                            closeReason = 'client sent inbound traffic';
                            break;
                        case 4002:
                            closeReason = 'client failed ping-pong';
                            break;
                        case 4003:
                            closeReason = 'connection unused';
                            break;
                        case 4004:
                            closeReason = 'reconnect grace time expired';
                            break;
                        case 4005:
                            closeReason = 'network timeout';
                            break;
                        case 4006:
                            closeReason = 'network error';
                            break;
                        default:
                            closeReason = `code ${code}`;
                    }

                    state.logger?.warn?.(
                        `EventSub WebSocket closed after ${connectionDuration}ms: ${closeReason} - ${reason?.toString() || 'no reason'}`,
                        'twitch'
                    );

                    state.subscriptions?.clear?.();

                    emit('eventSubDisconnected', {
                        code,
                        reason: reason?.toString(),
                        abnormal: code !== 1000
                    });

                    if (code !== 1000 && state.isInitialized) {
                        if (code === 1006) {
                            state.logger?.warn?.('Abnormal closure detected, will retry with increased delay', 'twitch');
                        }
                        state._scheduleReconnect?.();
                    }
                });
            } catch (error) {
                if (!connectionResolved) {
                    connectionResolved = true;
                    if (connectionTimeout) {
                        clearTimeout(connectionTimeout);
                    }
                }
                logError('Failed to create WebSocket connection', error, 'ws-connect');
                reject(error);
            }
        });
    };

    const handleReconnectRequest = (state, payload) => {
        if (payload?.session?.reconnect_url) {
            state.logger?.info?.('EventSub requesting reconnection to new URL', 'twitch', {
                reconnectUrl: payload.session.reconnect_url
            });
            state.reconnectUrl = payload.session.reconnect_url;
            state._scheduleReconnect?.();
        }
    };

    const scheduleReconnect = (state) => {
        if (state.reconnectTimeout) {
            clearTimeout(state.reconnectTimeout);
        }

        if (state.retryAttempts >= state.maxRetryAttempts) {
            state._logEventSubError?.(
                `EventSub max reconnection attempts (${state.maxRetryAttempts}) exceeded`,
                null,
                'reconnect-max'
            );
            state.isInitialized = false;
            return;
        }

        const baseDelay = state.retryDelay * Math.pow(2, state.retryAttempts);
        const jitter = random() * 1000;
        const delay = Math.min(baseDelay + jitter, 30000);

        state.logger?.info?.(
            `Scheduling EventSub reconnection in ${Math.round(delay)}ms (attempt ${state.retryAttempts + 1}/${state.maxRetryAttempts})`,
            'twitch'
        );

        state.reconnectTimeout = safeSetTimeout(() => {
            state._reconnect?.();
        }, validateTimeout(delay, 5000));
    };

    const reconnect = async (state) => {
        if (!state.isInitialized) {
            state.logger?.debug?.('Skipping reconnect - EventSub not initialized', 'twitch');
            return;
        }

        state.retryAttempts++;

        try {
            state.logger?.info?.(
                `Attempting EventSub reconnection (${state.retryAttempts}/${state.maxRetryAttempts})`,
                'twitch'
            );

            if (!state.authManager || state.authManager.getState?.() !== 'READY') {
                state._logEventSubError?.('Cannot reconnect - AuthManager not ready', null, 'reconnect-auth');
                throw new Error('AuthManager not ready for reconnection');
            }

            if (state.ws) {
                try {
                    if (state.ws.readyState === 1) {
                        state.ws.close(1000, 'Reconnecting');
                    }
                } catch (error) {
                    state.logger?.debug?.('Error closing WebSocket during reconnect', 'twitch', {
                        error: error?.message || String(error)
                    });
                }
                state.ws = null;
            }

            state.sessionId = null;
            state._isConnected = false;
            state.subscriptions?.clear?.();

            await safeDelay(
                validateTimeout(1000, 1000),
                1000,
                'twitchEventSub:cleanup-delay'
            );

            await state._connectWebSocket?.();

            state.retryAttempts = 0;
            state.logger?.info?.('EventSub reconnection successful', 'twitch');
        } catch (error) {
            state._logEventSubError?.(
                `EventSub reconnection failed (attempt ${state.retryAttempts}/${state.maxRetryAttempts})`,
                null,
                'reconnect-failed',
                {
                    message: error.message,
                    willRetry: state.retryAttempts < state.maxRetryAttempts
                }
            );

            if (state.retryAttempts < state.maxRetryAttempts) {
                state._scheduleReconnect?.();
            } else {
                state._logEventSubError?.(
                    'EventSub reconnection abandoned after maximum attempts',
                    null,
                    'reconnect-abandoned'
                );
                state.isInitialized = false;
            }
        }
    };

    return {
        connectWebSocket,
        handleReconnectRequest,
        scheduleReconnect,
        reconnect
    };
}

module.exports = {
    createTwitchEventSubWsLifecycle
};
