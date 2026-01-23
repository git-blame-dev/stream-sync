const { describe, test, expect } = require('bun:test');
const { createMockFn } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { EventEmitter } = require('events');

const { createTwitchEventSubWsLifecycle } = require('../../../../../src/platforms/twitch/connections/ws-lifecycle');

class MockWebSocket extends EventEmitter {
    constructor(url) {
        super();
        this.url = url;
        this.readyState = 0;
        this.pong = createMockFn();
        this.close = createMockFn(() => {
            this.readyState = 3;
        });
    }
}

describe('Twitch EventSub WS lifecycle', () => {
    const createState = (overrides = {}) => ({
        logger: noOpLogger,
        authManager: { getState: createMockFn(() => 'READY') },
        config: { accessToken: 'testAccessToken', clientId: 'testClientId' },
        userId: 'testUserId',
        ws: null,
        welcomeTimer: null,
        connectionStartTime: null,
        sessionId: null,
        _isConnected: false,
        subscriptionsReady: false,
        subscriptions: new Map(),
        isInitialized: true,
        retryAttempts: 0,
        maxRetryAttempts: 10,
        retryDelay: 5000,
        reconnectTimeout: null,
        emit: createMockFn(),
        handleWebSocketMessage: createMockFn(async () => {}),
        _validateConnectionForSubscriptions: createMockFn(() => true),
        _setupEventSubscriptions: createMockFn(async () => {}),
        _scheduleReconnect: createMockFn(),
        _reconnect: createMockFn(),
        _logEventSubError: createMockFn(),
        ...overrides
    });

    test('connectWebSocket resolves after subscriptions are ready and emits eventSubConnected', async () => {
        const safeSetTimeout = createMockFn(() => null);
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: (fn) => fn()
        });

        const state = createState({
            _setupEventSubscriptions: createMockFn(async () => ({ failures: [] }))
        });
        const connectPromise = lifecycle.connectWebSocket(state);

        state.ws.readyState = 1;
        state.ws.emit('open');
        state.ws.emit(
            'message',
            Buffer.from(JSON.stringify({
                metadata: { message_type: 'session_welcome' },
                payload: {
                    session: {
                        id: 'test-session-123',
                        keepalive_timeout_seconds: 30,
                        status: 'connected',
                        connected_at: '2024-01-01T00:00:00Z'
                    }
                }
            }))
        );

        await connectPromise;

        expect(state.sessionId).toBe('test-session-123');
        expect(state._isConnected).toBe(true);
        expect(state.subscriptionsReady).toBe(true);
        expect(state.emit.mock.calls.some(([event, payload]) => event === 'eventSubConnected' && payload.sessionId === 'test-session-123')).toBe(true);
    });

    test('connectWebSocket rejects on connection timeout when no welcome message arrives', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: (fn) => {
                fn();
                return null;
            },
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {}
        });

        const state = createState();
        await expect(lifecycle.connectWebSocket(state)).rejects.toThrow('Connection timeout - no welcome message');
    });

    test('connectWebSocket emits failure event when subscription setup fails', async () => {
        const safeSetTimeout = createMockFn(() => null);
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: (fn) => fn()
        });

        const state = createState({
            _setupEventSubscriptions: createMockFn(async () => ({ failures: [{ subscription: 'Follows' }] }))
        });
        const connectPromise = lifecycle.connectWebSocket(state);

        state.ws.readyState = 1;
        state.ws.emit('open');
        state.ws.emit(
            'message',
            Buffer.from(JSON.stringify({
                metadata: { message_type: 'session_welcome' },
                payload: {
                    session: {
                        id: 'test-session-456',
                        keepalive_timeout_seconds: 30,
                        status: 'connected',
                        connected_at: '2024-01-01T00:00:00Z'
                    }
                }
            }))
        );

        await expect(connectPromise).rejects.toThrow('EventSub subscription setup failed');
        expect(state.subscriptionsReady).toBe(false);
        expect(state.emit.mock.calls.some(([event, payload]) => event === 'eventSubSubscriptionFailed' && payload.sessionId === 'test-session-456')).toBe(true);
    });

    test('scheduleReconnect disables initialization when max attempts exceeded', () => {
        const safeSetTimeout = createMockFn();
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {},
            random: () => 0
        });

        const state = createState({ retryAttempts: 1, maxRetryAttempts: 1, isInitialized: true });
        lifecycle.scheduleReconnect(state);

        expect(state.isInitialized).toBe(false);
        expect(safeSetTimeout).not.toHaveBeenCalled();
    });

    test('scheduleReconnect schedules reconnect attempt when retries remain', () => {
        const safeSetTimeout = createMockFn((fn) => {
            fn();
            return 'timeout-id';
        });
        const reconnectSpy = createMockFn();
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {},
            random: () => 0
        });

        const state = createState({
            retryAttempts: 0,
            maxRetryAttempts: 2,
            retryDelay: 1000,
            _reconnect: reconnectSpy
        });

        lifecycle.scheduleReconnect(state);

        expect(state.reconnectTimeout).toBe('timeout-id');
        expect(reconnectSpy).toHaveBeenCalled();
    });

    test('handleReconnectRequest stores reconnect_url for next connection', () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: createMockFn(),
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {},
            random: () => 0
        });

        const state = createState();
        lifecycle.handleReconnectRequest(state, {
            session: {
                reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?token=test-reconnect-token'
            }
        });

        expect(state.reconnectUrl).toBe('wss://eventsub.wss.twitch.tv/ws?token=test-reconnect-token');
        expect(state._scheduleReconnect).toHaveBeenCalled();
    });

    test('throws when WebSocketCtor is not provided', () => {
        expect(() => createTwitchEventSubWsLifecycle({
            safeSetTimeout: () => {},
            safeDelay: async () => {},
            validateTimeout: (v) => v
        })).toThrow('WebSocketCtor is required');
    });

    test('throws when timeout utilities are not provided', () => {
        expect(() => createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket
        })).toThrow('timeout utilities are required');
    });

    test('connectWebSocket closes ws and rejects on timeout when ws is open', async () => {
        let timeoutCallback;
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: (fn) => {
                timeoutCallback = fn;
                return 'timeout-id';
            },
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {}
        });

        const state = createState();
        const connectPromise = lifecycle.connectWebSocket(state);

        state.ws.readyState = 1;
        timeoutCallback();

        await expect(connectPromise).rejects.toThrow('Connection timeout - no welcome message');
        expect(state.ws.close).toHaveBeenCalled();
    });

    test('connectWebSocket rejects with invalid session ID', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: (fn) => fn()
        });

        const state = createState();
        const connectPromise = lifecycle.connectWebSocket(state);

        state.ws.readyState = 1;
        state.ws.emit('open');
        state.ws.emit('message', Buffer.from(JSON.stringify({
            metadata: { message_type: 'session_welcome' },
            payload: { session: { id: '   ' } }
        })));

        await expect(connectPromise).rejects.toThrow('Invalid session ID');
    });

    test('connectWebSocket rejects when connection validation fails', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: (fn) => fn()
        });

        const state = createState({
            _validateConnectionForSubscriptions: createMockFn(() => false)
        });
        const connectPromise = lifecycle.connectWebSocket(state);

        state.ws.readyState = 1;
        state.ws.emit('open');
        state.ws.emit('message', Buffer.from(JSON.stringify({
            metadata: { message_type: 'session_welcome' },
            payload: { session: { id: 'test-session-789' } }
        })));

        await expect(connectPromise).rejects.toThrow('EventSub subscription setup failed');
        expect(state.emit).toHaveBeenCalledWith('eventSubSubscriptionFailed', expect.objectContaining({
            reason: 'connection-validation'
        }));
    });

    test('connectWebSocket rejects when subscription setup throws', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: (fn) => fn()
        });

        const state = createState({
            _setupEventSubscriptions: createMockFn(async () => { throw new Error('API error'); })
        });
        const connectPromise = lifecycle.connectWebSocket(state);

        state.ws.readyState = 1;
        state.ws.emit('open');
        state.ws.emit('message', Buffer.from(JSON.stringify({
            metadata: { message_type: 'session_welcome' },
            payload: { session: { id: 'test-session-error' } }
        })));

        await expect(connectPromise).rejects.toThrow('EventSub subscription setup failed');
        expect(state.subscriptionsReady).toBe(false);
    });

    test('connectWebSocket rejects on message parse error', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {}
        });

        const state = createState();
        const connectPromise = lifecycle.connectWebSocket(state);

        state.ws.readyState = 1;
        state.ws.emit('open');
        state.ws.emit('message', Buffer.from('not valid json'));

        await expect(connectPromise).rejects.toThrow();
        expect(state._logEventSubError).toHaveBeenCalledWith(
            'Error parsing WebSocket message',
            expect.any(Error),
            'ws-parse',
            expect.objectContaining({ rawData: 'not valid json' })
        );
    });

    test('connectWebSocket rejects on WebSocket error before connection resolved', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {}
        });

        const state = createState();
        const connectPromise = lifecycle.connectWebSocket(state);

        const wsError = new Error('Connection refused');
        wsError.code = 'ECONNREFUSED';
        state.ws.emit('error', wsError);

        await expect(connectPromise).rejects.toThrow('Connection refused');
    });

    test('connectWebSocket handles ping by sending pong', () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {}
        });

        const state = createState();
        lifecycle.connectWebSocket(state);

        const pingData = Buffer.from('ping-data');
        state.ws.emit('ping', pingData);

        expect(state.ws.pong).toHaveBeenCalledWith(pingData);
    });

    test('connectWebSocket handles pong event', () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {}
        });

        const state = createState();
        lifecycle.connectWebSocket(state);

        expect(() => state.ws.emit('pong')).not.toThrow();
    });

    test('connectWebSocket rejects on abnormal close during handshake', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {}
        });

        const state = createState();
        const connectPromise = lifecycle.connectWebSocket(state);

        state.ws.emit('close', 1006, 'abnormal');

        await expect(connectPromise).rejects.toThrow('Connection closed abnormally during initial handshake');
    });

    test('connectWebSocket emits eventSubDisconnected on close with various codes', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: (fn) => fn()
        });

        const state = createState({
            _setupEventSubscriptions: createMockFn(async () => ({ failures: [] }))
        });
        const connectPromise = lifecycle.connectWebSocket(state);

        state.ws.readyState = 1;
        state.ws.emit('open');
        state.ws.emit('message', Buffer.from(JSON.stringify({
            metadata: { message_type: 'session_welcome' },
            payload: { session: { id: 'close-test-session' } }
        })));

        await connectPromise;

        state.ws.emit('close', 1000, 'normal closure');

        expect(state.emit).toHaveBeenCalledWith('eventSubDisconnected', expect.objectContaining({
            code: 1000,
            abnormal: false
        }));
        expect(state._isConnected).toBe(false);
        expect(state.sessionId).toBe(null);
    });

    test('connectWebSocket schedules reconnect on abnormal close when initialized', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: (fn) => fn()
        });

        const state = createState({
            _setupEventSubscriptions: createMockFn(async () => ({ failures: [] })),
            isInitialized: true
        });
        const connectPromise = lifecycle.connectWebSocket(state);

        state.ws.readyState = 1;
        state.ws.emit('open');
        state.ws.emit('message', Buffer.from(JSON.stringify({
            metadata: { message_type: 'session_welcome' },
            payload: { session: { id: 'reconnect-test-session' } }
        })));

        await connectPromise;

        state.ws.emit('close', 4003, 'connection unused');

        expect(state._scheduleReconnect).toHaveBeenCalled();
    });

    test('connectWebSocket handles various Twitch close codes', async () => {
        const closeCodes = [
            { code: 1001, reason: 'going away' },
            { code: 4000, reason: 'internal server error' },
            { code: 4001, reason: 'client sent inbound traffic' },
            { code: 4002, reason: 'client failed ping-pong' },
            { code: 4004, reason: 'reconnect grace time expired' },
            { code: 4005, reason: 'network timeout' },
            { code: 4006, reason: 'network error' },
            { code: 9999, reason: 'unknown code' }
        ];

        for (const { code } of closeCodes) {
            const lifecycle = createTwitchEventSubWsLifecycle({
                WebSocketCtor: MockWebSocket,
                safeSetTimeout: () => null,
                safeDelay: async () => {},
                validateTimeout: (value) => value,
                setImmediateFn: (fn) => fn()
            });

            const state = createState({
                _setupEventSubscriptions: createMockFn(async () => ({ failures: [] })),
                isInitialized: true
            });
            const connectPromise = lifecycle.connectWebSocket(state);

            state.ws.readyState = 1;
            state.ws.emit('open');
            state.ws.emit('message', Buffer.from(JSON.stringify({
                metadata: { message_type: 'session_welcome' },
                payload: { session: { id: `session-${code}` } }
            })));

            await connectPromise;
            state.ws.emit('close', code, 'test reason');

            expect(state.emit).toHaveBeenCalledWith('eventSubDisconnected', expect.objectContaining({
                code,
                abnormal: true
            }));
        }
    });

    test('scheduleReconnect clears existing timeout before scheduling new one', () => {
        let clearedTimeout = null;
        const originalClearTimeout = global.clearTimeout;
        global.clearTimeout = (id) => { clearedTimeout = id; };

        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => 'new-timeout',
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {},
            random: () => 0
        });

        const state = createState({
            reconnectTimeout: 'existing-timeout',
            retryAttempts: 0,
            maxRetryAttempts: 5
        });

        lifecycle.scheduleReconnect(state);

        expect(clearedTimeout).toBe('existing-timeout');
        global.clearTimeout = originalClearTimeout;
    });

    test('reconnect skips when not initialized', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {}
        });

        const state = createState({ isInitialized: false });
        await lifecycle.reconnect(state);

        expect(state.retryAttempts).toBe(0);
    });

    test('reconnect throws when AuthManager is not ready', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {}
        });

        const state = createState({
            isInitialized: true,
            authManager: { getState: () => 'PENDING' }
        });

        await lifecycle.reconnect(state);

        expect(state._logEventSubError).toHaveBeenCalledWith(
            'Cannot reconnect - AuthManager not ready',
            null,
            'reconnect-auth'
        );
    });

    test('reconnect closes existing WebSocket before reconnecting', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {}
        });

        const existingWs = new MockWebSocket('wss://test');
        existingWs.readyState = 1;

        const state = createState({
            isInitialized: true,
            ws: existingWs,
            _connectWebSocket: createMockFn(async () => {})
        });

        await lifecycle.reconnect(state);

        expect(existingWs.close).toHaveBeenCalledWith(1000, 'Reconnecting');
    });

    test('reconnect schedules retry on failure when attempts remain', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {}
        });

        const state = createState({
            isInitialized: true,
            retryAttempts: 0,
            maxRetryAttempts: 3,
            _connectWebSocket: createMockFn(async () => { throw new Error('Connection failed'); })
        });

        await lifecycle.reconnect(state);

        expect(state._scheduleReconnect).toHaveBeenCalled();
        expect(state.retryAttempts).toBe(1);
    });

    test('reconnect abandons and disables initialization after max attempts', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {}
        });

        const state = createState({
            isInitialized: true,
            retryAttempts: 2,
            maxRetryAttempts: 3,
            _connectWebSocket: createMockFn(async () => { throw new Error('Connection failed'); })
        });

        await lifecycle.reconnect(state);

        expect(state.isInitialized).toBe(false);
        expect(state._logEventSubError).toHaveBeenCalledWith(
            'EventSub reconnection abandoned after maximum attempts',
            null,
            'reconnect-abandoned'
        );
    });

    test('reconnect resets retry attempts on success', async () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {}
        });

        const state = createState({
            isInitialized: true,
            retryAttempts: 2,
            maxRetryAttempts: 5,
            _connectWebSocket: createMockFn(async () => {})
        });

        await lifecycle.reconnect(state);

        expect(state.retryAttempts).toBe(0);
    });

    test('handleReconnectRequest ignores payload without reconnect_url', () => {
        const lifecycle = createTwitchEventSubWsLifecycle({
            WebSocketCtor: MockWebSocket,
            safeSetTimeout: () => null,
            safeDelay: async () => {},
            validateTimeout: (value) => value,
            setImmediateFn: () => {}
        });

        const state = createState();
        lifecycle.handleReconnectRequest(state, { session: {} });

        expect(state.reconnectUrl).toBeUndefined();
        expect(state._scheduleReconnect).not.toHaveBeenCalled();
    });
});
