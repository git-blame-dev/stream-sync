const { describe, test, expect } = require('bun:test');
const { createMockFn } = require('../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../helpers/mock-factories');
const { EventEmitter } = require('events');

const { createTwitchEventSubWsLifecycle } = require('../../../../src/platforms/twitch/eventsub/ws-lifecycle');

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
});
