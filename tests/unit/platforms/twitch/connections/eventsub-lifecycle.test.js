const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const testClock = require('../../../../helpers/test-clock');
const { safeSetTimeout, safeDelay } = require('../../../../../src/utils/timeout-validator');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../../../src/core/secrets');

const TwitchEventSub = require('../../../../../src/platforms/twitch-eventsub');

class MockWebSocket {
    constructor() {
        this.readyState = 1;
        this.listeners = {};
    }
    close() {}
    removeAllListeners() {
        this.listeners = {};
    }
}

class MockChatFileLoggingService {
    logRawPlatformData() {}
}

const createTwitchAuth = (overrides = {}) => ({
    isReady: () => ('ready' in overrides ? overrides.ready : true),
    refreshTokens: createMockFn().mockResolvedValue(true),
    getUserId: () => overrides.userId || 'test-user-123',
    ...overrides
});

const createEventSub = (configOverrides = {}, depsOverrides = {}) => {
    return new TwitchEventSub(
        { dataLoggingEnabled: false, broadcasterId: 'test-broadcaster', clientId: 'test-client-id', ...configOverrides },
        {
            logger: noOpLogger,
            twitchAuth: createTwitchAuth(),
            axios: { post: createMockFn(), get: createMockFn(), delete: createMockFn() },
            WebSocketCtor: MockWebSocket,
            ChatFileLoggingService: MockChatFileLoggingService,
            ...depsOverrides
        }
    );
};

describe('TwitchEventSub lifecycle', () => {
    let eventSub;

    afterEach(async () => {
        if (eventSub) {
            await eventSub.cleanup().catch(() => {});
            eventSub = null;
        }
        _resetForTesting();
        initializeStaticSecrets();
    });

    describe('periodic cleanup', () => {
        it('updates lastCleanup timestamp when cleanup runs', () => {
            eventSub = createEventSub();
            eventSub.memoryUsage.lastCleanup = 0;

            eventSub._performPeriodicCleanup();

            expect(eventSub.memoryUsage.lastCleanup).toBeGreaterThan(0);
        });
    });

    describe('message ID deduplication', () => {
        it('prunes message IDs older than TTL', () => {
            eventSub = createEventSub();
            const now = testClock.now();
            eventSub.recentMessageIds.set('old-msg', now - 10 * 60 * 1000);
            eventSub.recentMessageIds.set('new-msg', now - 1000);

            eventSub._pruneMessageIds(now);

            expect(eventSub.recentMessageIds.has('old-msg')).toBe(false);
            expect(eventSub.recentMessageIds.has('new-msg')).toBe(true);
        });

        it('returns false for missing message_id in metadata', () => {
            eventSub = createEventSub();

            const result = eventSub._isDuplicateMessageId({});

            expect(result).toBe(false);
        });

        it('returns false for null metadata', () => {
            eventSub = createEventSub();

            const result = eventSub._isDuplicateMessageId(null);

            expect(result).toBe(false);
        });

        it('triggers pruning when message ID count exceeds max', () => {
            eventSub = createEventSub();
            eventSub.maxMessageIds = 3;
            const now = testClock.now();
            eventSub.recentMessageIds.set('msg-1', now - 10 * 60 * 1000);
            eventSub.recentMessageIds.set('msg-2', now - 1000);
            eventSub.recentMessageIds.set('msg-3', now - 500);

            eventSub._isDuplicateMessageId({ message_id: 'msg-4' });

            expect(eventSub.recentMessageIds.has('msg-1')).toBe(false);
            expect(eventSub.recentMessageIds.has('msg-4')).toBe(true);
        });
    });

    describe('initialization error handling', () => {
        it('increments retry attempts and schedules retry on initialization failure', async () => {
            eventSub = createEventSub();
            eventSub.maxRetryAttempts = 3;
            eventSub.retryDelay = 100;
            let initializeCalled = false;
            eventSub.initialize = () => { initializeCalled = true; };

            eventSub._handleInitializationError(new Error('test error'));

            expect(eventSub.retryAttempts).toBe(1);
            expect(eventSub.isInitialized).toBe(false);
            expect(eventSub._isConnected).toBe(false);
            expect(eventSub.reconnectTimeout).not.toBeNull();

            await safeDelay(150);
            expect(initializeCalled).toBe(true);
        });

        it('stops retrying after max attempts exceeded', () => {
            eventSub = createEventSub();
            eventSub.maxRetryAttempts = 2;
            eventSub.retryAttempts = 2;

            eventSub._handleInitializationError(new Error('final error'));

            expect(eventSub.retryAttempts).toBe(3);
            expect(eventSub.reconnectTimeout).toBeNull();
        });
    });

    describe('cleanup', () => {
        it('clears all timers and resets state', async () => {
            const mockAxios = {
                get: createMockFn().mockResolvedValue({ data: { data: [] } }),
                delete: createMockFn()
            };
            eventSub = createEventSub({}, { axios: mockAxios });
            eventSub.reconnectTimeout = safeSetTimeout(() => {}, 10000);
            eventSub.welcomeTimer = safeSetTimeout(() => {}, 10000);
            eventSub.isInitialized = true;
            eventSub._isConnected = true;
            eventSub.subscriptionsReady = true;
            eventSub.sessionId = 'test-session';
            eventSub.subscriptions.set('sub-1', { id: 'sub-1' });

            await eventSub.cleanup();

            expect(eventSub.reconnectTimeout).toBeNull();
            expect(eventSub.welcomeTimer).toBeNull();
            expect(eventSub.cleanupInterval).toBeNull();
            expect(eventSub.isInitialized).toBe(false);
            expect(eventSub._isConnected).toBe(false);
            expect(eventSub.subscriptionsReady).toBe(false);
            expect(eventSub.sessionId).toBeNull();
            expect(eventSub.subscriptions.size).toBe(0);
        });

        it('closes WebSocket and removes listeners', async () => {
            const mockAxios = {
                get: createMockFn().mockResolvedValue({ data: { data: [] } }),
                delete: createMockFn()
            };
            eventSub = createEventSub({}, { axios: mockAxios });
            const closeCalled = [];
            const removeListenersCalled = [];
            eventSub.ws = {
                readyState: 1,
                close: (code, reason) => closeCalled.push({ code, reason }),
                removeAllListeners: () => removeListenersCalled.push(true)
            };

            await eventSub.cleanup();

            expect(closeCalled.length).toBe(1);
            expect(closeCalled[0].code).toBe(1000);
            expect(removeListenersCalled.length).toBe(1);
            expect(eventSub.ws).toBeNull();
        });

        it('handles WebSocket close errors gracefully', async () => {
            const mockAxios = {
                get: createMockFn().mockResolvedValue({ data: { data: [] } }),
                delete: createMockFn()
            };
            eventSub = createEventSub({}, { axios: mockAxios });
            eventSub.ws = {
                readyState: 1,
                close: () => { throw new Error('close failed'); },
                removeAllListeners: () => {}
            };

            await eventSub.cleanup();

            expect(eventSub.ws).toBeNull();
        });
    });

    describe('WebSocket message handling', () => {
        it('does not throw on session_welcome message', async () => {
            eventSub = createEventSub();

            await expect(eventSub.handleWebSocketMessage({
                metadata: { message_type: 'session_welcome' },
                payload: {
                    session: {
                        id: 'test-session-123',
                        keepalive_timeout_seconds: 30,
                        status: 'connected',
                        connected_at: '2024-01-01T00:00:00Z'
                    }
                }
            })).resolves.toBeUndefined();
        });

        it('does not throw on session_keepalive message', async () => {
            eventSub = createEventSub();

            await expect(eventSub.handleWebSocketMessage({
                metadata: { message_type: 'session_keepalive' },
                payload: {}
            })).resolves.toBeUndefined();
        });

        it('does not throw on unknown message type', async () => {
            eventSub = createEventSub();

            await expect(eventSub.handleWebSocketMessage({
                metadata: { message_type: 'unknown_type' },
                payload: {}
            })).resolves.toBeUndefined();
        });

        it('delegates session_reconnect to wsLifecycle handler', async () => {
            eventSub = createEventSub();
            let reconnectCalled = false;
            eventSub.wsLifecycle = {
                ...eventSub.wsLifecycle,
                handleReconnectRequest: () => { reconnectCalled = true; }
            };

            await eventSub.handleWebSocketMessage({
                metadata: { message_type: 'session_reconnect' },
                payload: { session: { reconnect_url: 'wss://new-url' } }
            });

            expect(reconnectCalled).toBe(true);
        });
    });

    describe('status methods', () => {
        it('isActive returns true when fully connected and subscribed', () => {
            eventSub = createEventSub();
            eventSub.isInitialized = true;
            eventSub._isConnected = true;
            eventSub.subscriptionsReady = true;

            expect(eventSub.isActive()).toBe(true);
        });

        it('isActive returns false when not fully ready', () => {
            eventSub = createEventSub();
            eventSub.isInitialized = true;
            eventSub._isConnected = false;
            eventSub.subscriptionsReady = true;

            expect(eventSub.isActive()).toBe(false);
        });

        it('isConnected checks WebSocket readyState', () => {
            eventSub = createEventSub();
            eventSub._isConnected = true;
            eventSub.ws = { readyState: 1 };

            expect(eventSub.isConnected()).toBe(true);

            eventSub.ws = { readyState: 3 };
            expect(eventSub.isConnected()).toBe(false);
        });
    });

    describe('event routing delegation', () => {
        it('delegates chat message events to event router', () => {
            eventSub = createEventSub();
            const routedEvents = [];
            eventSub.eventRouter = {
                ...eventSub.eventRouter,
                handleChatMessageEvent: (event) => routedEvents.push(event)
            };

            eventSub._handleChatMessageEvent({ text: 'test' });

            expect(routedEvents.length).toBe(1);
            expect(routedEvents[0].text).toBe('test');
        });

        it('delegates follow events to event router', () => {
            eventSub = createEventSub();
            const routedEvents = [];
            eventSub.eventRouter = {
                ...eventSub.eventRouter,
                handleFollowEvent: (event) => routedEvents.push(event)
            };

            eventSub._handleFollowEvent({ user_name: 'testuser' });

            expect(routedEvents.length).toBe(1);
        });

        it('delegates paypiggy events to event router', () => {
            eventSub = createEventSub();
            const routedEvents = [];
            eventSub.eventRouter = {
                ...eventSub.eventRouter,
                handlePaypiggyEvent: (event) => routedEvents.push(event)
            };

            eventSub._handlePaypiggyEvent({ tier: '1000' });

            expect(routedEvents.length).toBe(1);
        });

        it('delegates raid events to event router', () => {
            eventSub = createEventSub();
            const routedEvents = [];
            eventSub.eventRouter = {
                ...eventSub.eventRouter,
                handleRaidEvent: (event) => routedEvents.push(event)
            };

            eventSub._handleRaidEvent({ viewers: 100 });

            expect(routedEvents.length).toBe(1);
        });

        it('delegates bits events to event router', () => {
            eventSub = createEventSub();
            const routedEvents = [];
            eventSub.eventRouter = {
                ...eventSub.eventRouter,
                handleBitsUseEvent: (event) => routedEvents.push(event)
            };

            eventSub._handleBitsUseEvent({ bits: 500 });

            expect(routedEvents.length).toBe(1);
        });

        it('delegates gift paypiggy events to event router', () => {
            eventSub = createEventSub();
            const routedEvents = [];
            eventSub.eventRouter = {
                ...eventSub.eventRouter,
                handlePaypiggyGiftEvent: (event) => routedEvents.push(event)
            };

            eventSub._handlePaypiggyGiftEvent({ total: 5 });

            expect(routedEvents.length).toBe(1);
        });

        it('delegates paypiggy message events to event router', () => {
            eventSub = createEventSub();
            const routedEvents = [];
            eventSub.eventRouter = {
                ...eventSub.eventRouter,
                handlePaypiggyMessageEvent: (event) => routedEvents.push(event)
            };

            eventSub._handlePaypiggyMessageEvent({ message: 'test' });

            expect(routedEvents.length).toBe(1);
        });

        it('delegates stream online events to event router', () => {
            eventSub = createEventSub();
            const routedEvents = [];
            eventSub.eventRouter = {
                ...eventSub.eventRouter,
                handleStreamOnlineEvent: (event) => routedEvents.push(event)
            };

            eventSub._handleStreamOnlineEvent({ started_at: '2024-01-01' });

            expect(routedEvents.length).toBe(1);
        });

        it('delegates stream offline events to event router', () => {
            eventSub = createEventSub();
            const routedEvents = [];
            eventSub.eventRouter = {
                ...eventSub.eventRouter,
                handleStreamOfflineEvent: (event) => routedEvents.push(event)
            };

            eventSub._handleStreamOfflineEvent({});

            expect(routedEvents.length).toBe(1);
        });
    });

    describe('sendMessage', () => {
        it('throws when message is empty', async () => {
            eventSub = createEventSub();

            await expect(eventSub.sendMessage('')).rejects.toThrow('non-empty message');
            await expect(eventSub.sendMessage('   ')).rejects.toThrow('non-empty message');
        });

        it('throws when Twitch auth is missing', async () => {
            eventSub = createEventSub();
            eventSub.twitchAuth = null;

            await expect(eventSub.sendMessage('test')).rejects.toThrow('Twitch auth');
        });

        it('throws when user ID is not available', async () => {
            eventSub = createEventSub({}, {
                twitchAuth: { ...createTwitchAuth(), getUserId: () => null }
            });

            await expect(eventSub.sendMessage('test')).rejects.toThrow('user ID');
        });

        it('throws when client ID is not available', async () => {
            eventSub = createEventSub({ clientId: null }, {
                twitchAuth: createTwitchAuth()
            });

            await expect(eventSub.sendMessage('test')).rejects.toThrow('clientId');
        });

        it('sends message via API and returns success', async () => {
            const postCalls = [];
            const mockAxios = {
                post: createMockFn().mockImplementation((url, payload, config) => {
                    postCalls.push({ url, payload, config });
                    return Promise.resolve({});
                }),
                get: createMockFn(),
                delete: createMockFn()
            };
            secrets.twitch.accessToken = 'test-token';
            eventSub = createEventSub({}, { axios: mockAxios });

            const result = await eventSub.sendMessage('Hello stream!');

            expect(result.success).toBe(true);
            expect(result.platform).toBe('twitch');
            expect(postCalls.length).toBe(1);
            expect(postCalls[0].payload.message).toBe('Hello stream!');
        });

        it('retries once after refresh on 401', async () => {
            let callCount = 0;
            const mockAxios = {
                post: createMockFn().mockImplementation(() => {
                    callCount += 1;
                    if (callCount === 1) {
                        const error = new Error('Unauthorized');
                        error.response = { status: 401 };
                        return Promise.reject(error);
                    }
                    return Promise.resolve({});
                }),
                get: createMockFn(),
                delete: createMockFn()
            };
            const refreshedToken = 'refreshed-token';
            const twitchAuth = createTwitchAuth({
                refreshTokens: createMockFn().mockImplementation(async () => {
                    secrets.twitch.accessToken = refreshedToken;
                    return true;
                })
            });
            secrets.twitch.accessToken = 'expired-token';
            eventSub = createEventSub({}, { axios: mockAxios, twitchAuth });

            const result = await eventSub.sendMessage('Retry message');

            expect(result.success).toBe(true);
            expect(mockAxios.post.mock.calls.length).toBe(2);
        });

        it('handles API error and throws', async () => {
            const mockAxios = {
                post: createMockFn().mockRejectedValue(new Error('API error')),
                get: createMockFn(),
                delete: createMockFn()
            };
            eventSub = createEventSub({}, { axios: mockAxios });

            await expect(eventSub.sendMessage('test')).rejects.toThrow('send failed');
        });
    });

    describe('connection validation', () => {
        it('returns false when session ID is empty', () => {
            eventSub = createEventSub();
            eventSub.sessionId = '   ';
            eventSub._isConnected = true;
            eventSub.ws = { readyState: 1 };
            eventSub.isInitialized = true;

            expect(eventSub._validateConnectionForSubscriptions()).toBe(false);
        });

        it('returns false when not connected', () => {
            eventSub = createEventSub();
            eventSub.sessionId = 'test-session';
            eventSub._isConnected = false;
            eventSub.ws = { readyState: 1 };
            eventSub.isInitialized = true;

            expect(eventSub._validateConnectionForSubscriptions()).toBe(false);
        });

        it('returns false when WebSocket is missing', () => {
            eventSub = createEventSub();
            eventSub.sessionId = 'test-session';
            eventSub._isConnected = true;
            eventSub.ws = null;
            eventSub.isInitialized = true;

            expect(eventSub._validateConnectionForSubscriptions()).toBe(false);
        });

        it('returns false when not initialized', () => {
            eventSub = createEventSub();
            eventSub.sessionId = 'test-session';
            eventSub._isConnected = true;
            eventSub.ws = { readyState: 1 };
            eventSub.isInitialized = false;

            expect(eventSub._validateConnectionForSubscriptions()).toBe(false);
        });

        it('returns false when Twitch auth is not ready', () => {
            eventSub = createEventSub({}, {
                twitchAuth: createTwitchAuth({ ready: false })
            });
            eventSub.sessionId = 'test-session';
            eventSub._isConnected = true;
            eventSub.ws = { readyState: 1 };
            eventSub.isInitialized = true;

            expect(eventSub._validateConnectionForSubscriptions()).toBe(false);
        });

        it('returns false when token provider is missing', () => {
            secrets.twitch.accessToken = null;
            eventSub = createEventSub({ clientId: 'test-client-id' }, {
                twitchAuth: createTwitchAuth()
            });
            eventSub.sessionId = 'test-session';
            eventSub._isConnected = true;
            eventSub.ws = { readyState: 1 };
            eventSub.isInitialized = true;

            expect(eventSub._validateConnectionForSubscriptions()).toBe(false);
        });
    });

    describe('raw data logging', () => {
        it('delegates to chat file logging service', async () => {
            const logCalls = [];
            const mockLoggingService = {
                logRawPlatformData: (platform, type, data, config) => {
                    logCalls.push({ platform, type, data, config });
                }
            };
            eventSub = createEventSub();
            eventSub.chatFileLoggingService = mockLoggingService;

            await eventSub.logRawPlatformData('chat', { message: 'test' });

            expect(logCalls.length).toBe(1);
            expect(logCalls[0].platform).toBe('twitch');
            expect(logCalls[0].type).toBe('chat');
        });
    });

    describe('error logging', () => {
        it('handles Error instances via error handler', () => {
            const handledErrors = [];
            eventSub = createEventSub();
            eventSub.errorHandler = {
                handleEventProcessingError: (err, type, payload, msg) => {
                    handledErrors.push({ err, type, payload, msg });
                },
                logOperationalError: () => {}
            };

            eventSub._logEventSubError('test message', new Error('test error'), 'test-type', { data: 'test' });

            expect(handledErrors.length).toBe(1);
            expect(handledErrors[0].type).toBe('test-type');
        });

        it('logs operational errors for non-Error objects', () => {
            const loggedErrors = [];
            eventSub = createEventSub();
            eventSub.errorHandler = {
                handleEventProcessingError: () => {},
                logOperationalError: (msg, ctx, payload) => {
                    loggedErrors.push({ msg, ctx, payload });
                }
            };

            eventSub._logEventSubError('test message', { info: 'not an error' }, 'test-type');

            expect(loggedErrors.length).toBe(1);
            expect(loggedErrors[0].msg).toBe('test message');
        });
    });

    describe('subscription revocation', () => {
        it('skips resubscription when not initialized', async () => {
            eventSub = createEventSub();
            eventSub.isInitialized = false;
            let resubCalled = false;
            eventSub._setupEventSubscriptions = async () => { resubCalled = true; };

            await eventSub._handleSubscriptionRevocation({ type: 'channel.follow', id: 'sub-1', status: 'revoked' });

            expect(resubCalled).toBe(false);
        });

        it('skips resubscription when subscription type is missing', async () => {
            eventSub = createEventSub();
            eventSub.isInitialized = true;
            let resubCalled = false;
            eventSub._setupEventSubscriptions = async () => { resubCalled = true; };

            await eventSub._handleSubscriptionRevocation({ id: 'sub-1', status: 'revoked' });

            expect(resubCalled).toBe(false);
        });

        it('marks subscriptions not ready after revocation and resubscribes', async () => {
            eventSub = createEventSub();
            eventSub.isInitialized = true;
            eventSub.subscriptionsReady = true;
            eventSub.sessionId = 'test-session';
            eventSub._setupEventSubscriptions = async () => ({ failures: [] });

            await eventSub._handleSubscriptionRevocation({ type: 'channel.follow', id: 'sub-1', status: 'revoked' });

            expect(eventSub.subscriptionsReady).toBe(true);
        });

        it('keeps subscriptions not ready when resubscription fails', async () => {
            eventSub = createEventSub();
            eventSub.isInitialized = true;
            eventSub.subscriptionsReady = true;
            eventSub.sessionId = 'test-session';
            eventSub._setupEventSubscriptions = async () => ({ failures: [{ type: 'channel.follow' }] });

            await eventSub._handleSubscriptionRevocation({ type: 'channel.follow', id: 'sub-1', status: 'revoked' });

            expect(eventSub.subscriptionsReady).toBe(false);
        });

        it('handles resubscription errors gracefully', async () => {
            eventSub = createEventSub();
            eventSub.isInitialized = true;
            eventSub.subscriptionsReady = true;
            eventSub.sessionId = 'test-session';
            eventSub._setupEventSubscriptions = async () => { throw new Error('resubscribe failed'); };

            await eventSub._handleSubscriptionRevocation({ type: 'channel.follow', id: 'sub-1', status: 'revoked' });

            expect(eventSub.subscriptionsReady).toBe(false);
        });
    });

    describe('wsLifecycle delegation', () => {
        it('delegates scheduleReconnect to wsLifecycle', () => {
            eventSub = createEventSub();
            let scheduleCalled = false;
            eventSub.wsLifecycle = {
                ...eventSub.wsLifecycle,
                scheduleReconnect: () => { scheduleCalled = true; }
            };

            eventSub._scheduleReconnect();

            expect(scheduleCalled).toBe(true);
        });

        it('delegates reconnect to wsLifecycle', async () => {
            eventSub = createEventSub();
            let reconnectCalled = false;
            eventSub.wsLifecycle = {
                ...eventSub.wsLifecycle,
                reconnect: async () => { reconnectCalled = true; }
            };

            await eventSub._reconnect();

            expect(reconnectCalled).toBe(true);
        });

        it('delegates connectWebSocket to wsLifecycle', async () => {
            eventSub = createEventSub();
            let connectCalled = false;
            eventSub.wsLifecycle = {
                ...eventSub.wsLifecycle,
                connectWebSocket: async () => { connectCalled = true; }
            };

            await eventSub._connectWebSocket();

            expect(connectCalled).toBe(true);
        });
    });
});
