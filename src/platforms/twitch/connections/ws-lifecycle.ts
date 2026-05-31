import crypto from 'node:crypto';

type LifecycleLogger = {
  debug?: (message: string, scope?: string, payload?: unknown) => void;
  info?: (message: string, scope?: string, payload?: unknown) => void;
  warn?: (message: string, scope?: string, payload?: unknown) => void;
};

type LifecycleWebSocket = {
  readyState: number;
  on: (eventName: string, handler: (...args: unknown[]) => void) => void;
  close: (code?: number, reason?: string) => void;
};

type LifecycleState = {
  logger?: LifecycleLogger;
  _logEventSubError?: (message: string, error?: unknown, eventType?: string, payload?: Record<string, unknown>) => void;
  emit?: (eventName: string, payload?: unknown) => void;
  handleWebSocketMessage?: (message: Record<string, unknown>) => Promise<void> | void;
  _validateConnectionForSubscriptions?: () => boolean;
  _setupEventSubscriptions?: (validationAlreadyDone?: boolean) => Promise<{ failures?: unknown[]; aborted?: boolean; abortReason?: string } | null | void>;
  _scheduleReconnect?: () => void;
  _deleteAllSubscriptions?: (options: { sessionId?: string | null }) => Promise<void>;
  _connectWebSocket?: () => Promise<void>;
  _reconnect?: () => Promise<void>;
  connectionStartTime?: number | null;
  reconnectUrl?: string | null;
  ws?: LifecycleWebSocket | null;
  sessionId?: string | null;
  disconnectedSessionId?: string | null;
  welcomeTimer?: ReturnType<typeof setTimeout> | null;
  twitchAuth?: { isReady?: () => boolean } | null;
  userId?: string;
  config?: { clientId?: string };
  _isConnected: boolean;
  subscriptionsReady: boolean;
  isInitialized: boolean;
  subscriptions?: { clear?: () => void };
  reconnectTimeout?: ReturnType<typeof setTimeout> | null;
  retryAttempts: number;
  maxRetryAttempts: number;
  retryDelay: number;
};

type WsLifecycleOptions = {
  WebSocketCtor?: new (url: string) => LifecycleWebSocket;
  safeSetTimeout?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  safeDelay?: (timeoutMs: number, minMs: number, tag?: string) => Promise<void>;
  validateTimeout?: (timeoutMs: number, minMs: number) => number;
  now?: () => number;
  random?: () => number;
  setImmediateFn?: (handler: () => void | Promise<void>) => void;
};

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const getRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' ? value as Record<string, unknown> : null;

const getString = (record: Record<string, unknown> | null | undefined, key: string): string | null => {
    const value = record?.[key];
    return typeof value === 'string' ? value : null;
};

const getSession = (message: Record<string, unknown>): Record<string, unknown> | null => {
    const payload = getRecord(message.payload);
    return getRecord(payload?.session);
};

const getByteLength = (value: unknown): number => {
    if (typeof value === 'string') {
        return value.length;
    }
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
        return value.byteLength;
    }
    const withLength = getRecord(value);
    const length = withLength?.length;
    return typeof length === 'number' ? length : 0;
};

function stripUrlQueryAndFragment(value: string): string {
    try {
        const parsed = new URL(value);
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return value;
    }
}

function createTwitchEventSubWsLifecycle(options: WsLifecycleOptions = {}) {
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

  const connectWebSocket = (state: LifecycleState): Promise<void> => {
        return new Promise((resolve, reject) => {
            state.logger?.debug?.('Connecting to EventSub WebSocket...', 'twitch');

      const logError = typeof state._logEventSubError === 'function'
        ? (message: string, error?: unknown, eventType?: string, payload?: Record<string, unknown>) => state._logEventSubError?.(message, error, eventType, payload)
        : () => {};
      const emit = typeof state.emit === 'function'
        ? (eventName: string, payload?: unknown) => state.emit?.(eventName, payload)
        : () => {};
      const handleWebSocketMessage = typeof state.handleWebSocketMessage === 'function'
        ? (message: Record<string, unknown>) => state.handleWebSocketMessage?.(message)
        : async () => {};

            let connectionResolved = false;
            let connectionTimeout: ReturnType<typeof setTimeout> | null = null;
            let receivedWelcome = false;

            try {
                state.connectionStartTime = now();

                const websocketUrl = state.reconnectUrl || 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';
                const ws = new WebSocketCtor(websocketUrl);
                state.ws = ws;

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

                ws.on('open', () => {
                    state.logger?.info?.('EventSub WebSocket connection opened successfully.', 'twitch');
                    state.logger?.info?.('Waiting for welcome message from Twitch...', 'twitch');

                    state.logger?.info?.('WebSocket connection details', 'twitch', {
                        url: 'wss://eventsub.wss.twitch.tv/ws',
                        readyState: ws.readyState,
                        hasTwitchAuth: !!state.twitchAuth,
                        authReady: state.twitchAuth?.isReady?.(),
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

      ws.on('message', async (data: unknown) => {
        try {
          const rawData = String(data);
          const parsedMessage: unknown = JSON.parse(rawData);
          const message = getRecord(parsedMessage);
          if (!message) {
              throw new Error('WebSocket message payload must be an object');
          }
                        const metadata = getRecord(message.metadata);
                        const session = getSession(message);
                        if (metadata?.message_type === 'session_welcome') {
                            receivedWelcome = true;
                        }

                        await handleWebSocketMessage(message);

                        if (metadata?.message_type === 'session_welcome' && !state.sessionId && !connectionResolved) {
                            if (connectionTimeout) {
                                clearTimeout(connectionTimeout);
                            }
                            if (state.welcomeTimer) {
                                clearTimeout(state.welcomeTimer);
                            }

                            const sessionId = getString(session, 'id');
                            if (!sessionId || sessionId.trim() === '') {
                                logError('Invalid session ID received', null, 'invalid-session');
                                connectionResolved = true;
                                reject(new Error('Invalid session ID'));
                                return;
                            }

                            const isReconnectHandoff = !!state.reconnectUrl;
                            state.sessionId = sessionId;
                            state._isConnected = true;
                            state.reconnectUrl = null;
                            state.logger?.info?.('EventSub session established', 'twitch', {
                                hasSessionId: true,
                                keepaliveTimeout: session?.keepalive_timeout_seconds ?? null
                            });

                            emit('eventSubConnected', {
                                sessionId: state.sessionId
                            });

                            if (isReconnectHandoff) {
                                state.subscriptionsReady = true;
                                connectionResolved = true;
                                resolve();
                                return;
                            }

                            setImmediateFn(async () => {
                                if (connectionResolved) {
                                    return;
                                }

                                try {
                                    const isConnectionValid = state._validateConnectionForSubscriptions?.();
                                    if (!isConnectionValid) {
                                        logError('Connection validation failed before subscription setup', null, 'connection-validation');
                                        state.subscriptionsReady = false;
                                        emit('eventSubSubscriptionFailed', {
                                            sessionId: state.sessionId,
                                            reason: 'connection-validation'
                                        });
                                        if (state._isConnected && state.isInitialized) {
                                            state._scheduleReconnect?.();
                                        }
                                        connectionResolved = true;
                                        reject(new Error('Connection validation failed before subscription setup'));
                                        return;
                                    }

                                    const result = await state._setupEventSubscriptions?.(true);
                                    if (connectionResolved || !state._isConnected || !state.sessionId) {
                                        return;
                                    }
                                    if (result?.aborted) {
                                        state.subscriptionsReady = false;
                                        logError('Subscription setup aborted', null, 'subscription-setup-aborted', {
                                            abortReason: result.abortReason
                                        });
                                        emit('eventSubSubscriptionFailed', {
                                            sessionId: state.sessionId,
                                            reason: result.abortReason
                                        });
                                        connectionResolved = true;
                                        reject(new Error(`Subscription setup aborted: ${result.abortReason || 'unknown'}`));
                                        return;
                                    }
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
                                        if (state._isConnected && state.isInitialized) {
                                            state._scheduleReconnect?.();
                                        }
                                        connectionResolved = true;
                                        reject(new Error('Subscription setup completed with failures'));
                                        return;
                                    }

                                    state.subscriptionsReady = true;
                                    connectionResolved = true;
                                    resolve();
                                } catch (error) {
                                    if (connectionResolved) {
                                        return;
                                    }
                                    state.subscriptionsReady = false;
                                    logError('Error during subscription setup', error, 'subscription-setup');
                                    emit('eventSubSubscriptionFailed', {
                                        sessionId: state.sessionId,
                                        error: getErrorMessage(error)
                                    });
                                    if (state._isConnected && state.isInitialized) {
                                        state._scheduleReconnect?.();
                                    }
                                    connectionResolved = true;
                                    reject(error);
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
                            rawDataLength: String(data).length
                        });
                        reject(error);
                    }
                });

                ws.on('error', (error: unknown) => {
                    if (!connectionResolved) {
                        connectionResolved = true;
                        if (connectionTimeout) {
                            clearTimeout(connectionTimeout);
                        }
                        reject(error);
                    }
                    logError('EventSub WebSocket error', error, 'ws-error', {
                        code: getRecord(error)?.code,
                        errno: getRecord(error)?.errno
                    });
                });

                ws.on('ping', (data: unknown) => {
                    state.logger?.debug?.('EventSub ping received', 'twitch', {
                        payloadLength: getByteLength(data)
                    });
                });

                ws.on('pong', () => {
                    state.logger?.debug?.('EventSub pong received', 'twitch');
                });

      ws.on('close', (code: unknown, reason: unknown) => {
                    if (state.welcomeTimer) {
                        clearTimeout(state.welcomeTimer);
                    }

                    if (!connectionResolved) {
                        connectionResolved = true;
                        if (connectionTimeout) {
                            clearTimeout(connectionTimeout);
                        }

                        const closeCode = typeof code === 'number' ? code : 0;
                        const startupPhase = state.sessionId || receivedWelcome
                            ? 'EventSub subscription setup'
                            : 'initial handshake';
                        const startupError = closeCode === 1006
                            ? new Error(`Connection closed abnormally during ${startupPhase}`)
                            : new Error(state.sessionId || receivedWelcome
                                ? 'Connection closed before EventSub subscription setup completed'
                                : 'Connection closed before EventSub startup completed');
                        (startupError as Error & { closeCode?: number }).closeCode = closeCode;
                        reject(startupError);
                    }

                    const isCurrentSocket = state.ws === ws;
                    const closedSessionId = isCurrentSocket ? state.sessionId : null;
                    if (isCurrentSocket) {
                        state._isConnected = false;
                        state.subscriptionsReady = false;
                        state.sessionId = null;
                    }

                    const connectionDuration = state.connectionStartTime ? now() - state.connectionStartTime : 'unknown';

                    let closeReason = 'unknown';
                    const closeCode = typeof code === 'number' ? code : 0;
                    switch (closeCode) {
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
                            closeReason = `code ${closeCode}`;
                    }

                    state.logger?.warn?.(
                        `EventSub WebSocket closed after ${connectionDuration}ms: ${closeReason} - ${String(reason || 'no reason')}`,
                        'twitch'
                    );

                    if (!isCurrentSocket) {
                        state.logger?.debug?.('Ignoring stale EventSub WebSocket close after reconnect handoff', 'twitch');
                        return;
                    }

                    state.subscriptions?.clear?.();

                    const willReconnect = closeCode !== 1000 && !!state.isInitialized;
                    if (willReconnect && closedSessionId) {
                        state.disconnectedSessionId = closedSessionId;
                    }

                    emit('eventSubDisconnected', {
                        code: closeCode,
                        reason: String(reason || ''),
                        abnormal: closeCode !== 1000,
                        willReconnect,
                        terminal: false
                    });

                    if (willReconnect) {
                        if (closeCode === 1006) {
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

  const handleReconnectRequest = (state: LifecycleState, payload: Record<string, unknown> | null | undefined): void => {
        const session = getRecord(payload?.session);
        const reconnectUrl = getString(session, 'reconnect_url');
        if (reconnectUrl) {
            state.logger?.info?.('EventSub requesting reconnection to new URL', 'twitch', {
                reconnectUrl: stripUrlQueryAndFragment(reconnectUrl),
                hasReconnectUrl: true
            });
            state.reconnectUrl = reconnectUrl;
            state._scheduleReconnect?.();
        }
    };

  const scheduleReconnect = (state: LifecycleState): void => {
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
            state.emit?.('eventSubDisconnected', {
                code: null,
                reason: 'max reconnect attempts exceeded',
                abnormal: true,
                willReconnect: false,
                terminal: true
            });
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

  const reconnect = async (state: LifecycleState): Promise<void> => {
        if (!state.isInitialized) {
            state.logger?.debug?.('Skipping reconnect - EventSub not initialized', 'twitch');
            return;
        }

        state.retryAttempts++;
        const isReconnectHandoff = !!state.reconnectUrl && !!state.sessionId && state.ws?.readyState === 1;
        const handoffWebSocket = isReconnectHandoff ? state.ws : null;
        const previousSessionId = state.sessionId || state.disconnectedSessionId;

        try {
            state.logger?.info?.(
                `Attempting EventSub reconnection (${state.retryAttempts}/${state.maxRetryAttempts})`,
                'twitch'
            );

            if (!state.twitchAuth || !state.twitchAuth.isReady?.()) {
                state._logEventSubError?.('Cannot reconnect - Twitch auth not ready', null, 'reconnect-auth');
                throw new Error('Twitch auth not ready for reconnection');
            }

            if (state.ws && !isReconnectHandoff) {
                try {
                    if (state.ws.readyState === 1) {
                        state.ws.close(1000, 'Reconnecting');
                    }
                } catch (error) {
                    state.logger?.debug?.('Error closing WebSocket during reconnect', 'twitch', {
                        error: getErrorMessage(error)
                    });
                }
                state.ws = null;
            }

            if (!isReconnectHandoff && previousSessionId && typeof state._deleteAllSubscriptions === 'function') {
                try {
                    await state._deleteAllSubscriptions({ sessionId: previousSessionId });
                    if (state.disconnectedSessionId === previousSessionId) {
                        state.disconnectedSessionId = null;
                    }
                } catch (error) {
                    state._logEventSubError?.(
                        'Failed to clean up previous session subscriptions before reconnect',
                        error,
                        'reconnect-cleanup',
                        { sessionId: previousSessionId }
                    );
                }
            }

            state.sessionId = null;
            if (!isReconnectHandoff) {
                state._isConnected = false;
                state.subscriptions?.clear?.();
            }

            if (!isReconnectHandoff) {
                await safeDelay(
                    validateTimeout(1000, 1000),
                    1000,
                    'twitchEventSub:cleanup-delay'
                );
            }

            await state._connectWebSocket?.();

            if (handoffWebSocket?.readyState === 1) {
                try {
                    handoffWebSocket.close(1000, 'Reconnect handoff complete');
                } catch (error) {
                    state.logger?.debug?.('Error closing old WebSocket after reconnect handoff', 'twitch', {
                        error: getErrorMessage(error)
                    });
                }
            }

            state.retryAttempts = 0;
            state.logger?.info?.('EventSub reconnection successful', 'twitch');
        } catch (error) {
            if (isReconnectHandoff && handoffWebSocket?.readyState === 1) {
                state.ws = handoffWebSocket;
                state.sessionId = previousSessionId || null;
                state._isConnected = true;
                state.subscriptionsReady = true;
            }

            state._logEventSubError?.(
                `EventSub reconnection failed (attempt ${state.retryAttempts}/${state.maxRetryAttempts})`,
                null,
                'reconnect-failed',
                {
                    message: getErrorMessage(error),
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
                state.emit?.('eventSubDisconnected', {
                    code: null,
                    reason: 'reconnect attempts exhausted',
                    abnormal: true,
                    willReconnect: false,
                    terminal: true
                });
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

export { createTwitchEventSubWsLifecycle };
