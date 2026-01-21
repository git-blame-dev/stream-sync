const { describe, it, expect, beforeEach } = require('bun:test');
const { createMockFn } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');

const TwitchEventSub = require('../../../../../src/platforms/twitch-eventsub');

class MockWebSocket {
    constructor() {
        this.readyState = 1;
    }
    close() {}
    send() {}
}

describe('TwitchEventSub behavior', () => {
    let mockAuthManager;
    let MockChatFileLoggingService;
    let mockDependencies;

    beforeEach(() => {
        mockAuthManager = {
            getState: () => 'READY',
            getUserId: () => 'testUser123',
            getAccessToken: async () => 'testAccessToken',
            getClientId: () => 'testClientId',
            getScopes: async () => ['user:read:chat'],
            authState: { executeWhenReady: async (fn) => fn() },
            twitchAuth: { triggerOAuthFlow: createMockFn() }
        };
        MockChatFileLoggingService = class { constructor() {} };
        mockDependencies = {
            logger: noOpLogger,
            authManager: mockAuthManager,
            ChatFileLoggingService: MockChatFileLoggingService,
            WebSocketCtor: MockWebSocket
        };
    });

    it('routes follow events to handlers and emits follow event', () => {
        const instance = new TwitchEventSub(
            { channel: 'testChannel', clientId: 'testClientId', accessToken: 'testToken', broadcasterId: 'test-broadcaster-id' },
            mockDependencies
        );

        const followEvents = [];
        instance.on('follow', (payload) => followEvents.push(payload));

        instance.handleNotificationEvent('channel.follow', {
            user_name: 'testFollower',
            user_id: 'follower123',
            followed_at: '2024-01-01T00:00:00Z'
        });

        expect(followEvents.length).toBe(1);
        expect(followEvents[0].userId).toBe('follower123');
        expect(followEvents[0].username).toBe('testFollower');
    });

    it('routes chat message events and includes timestamp context', () => {
        const instance = new TwitchEventSub(
            { channel: 'testChannel', clientId: 'testClientId', accessToken: 'testToken', broadcasterId: 'test-broadcaster-id' },
            mockDependencies
        );

        const messageEvents = [];
        instance.on('message', (payload) => messageEvents.push(payload));

        instance.handleNotificationEvent('channel.chat.message', {
            chatter_user_id: 'chatter123',
            broadcaster_user_id: 'broadcaster456',
            message: { text: 'Hello stream!', timestamp: '2024-01-01T12:00:00Z' },
            message_timestamp: '2024-01-01T12:00:00Z'
        });

        expect(messageEvents.length).toBe(1);
        expect(messageEvents[0].message).toBe('Hello stream!');
        expect(messageEvents[0].context['tmi-sent-ts']).toBe(String(Date.parse('2024-01-01T12:00:00Z')));
    });

    it('ignores duplicate notification message ids', () => {
        const instance = new TwitchEventSub(
            { channel: 'testChannel', clientId: 'testClientId', accessToken: 'testToken', broadcasterId: 'test-broadcaster-id' },
            mockDependencies
        );

        const followEvents = [];
        instance.on('follow', (payload) => followEvents.push(payload));

        const message = {
            metadata: {
                message_id: 'dedupe-test-id',
                message_type: 'notification',
                message_timestamp: '2024-01-01T00:00:00Z'
            },
            payload: {
                subscription: { type: 'channel.follow' },
                event: { user_name: 'testUser', user_id: 'user123', followed_at: '2024-01-01T00:00:00Z' }
            }
        };

        instance.handleWebSocketMessage(message);
        instance.handleWebSocketMessage(message);

        expect(followEvents.length).toBe(1);
    });

    it('retries subscriptions when a revocation arrives', async () => {
        const instance = new TwitchEventSub(
            { channel: 'testChannel', clientId: 'testClientId', accessToken: 'testToken', broadcasterId: 'test-broadcaster-id' },
            mockDependencies
        );
        const resubscribeCalls = [];
        instance.subscriptionManager.setupEventSubscriptions = async (payload) => {
            resubscribeCalls.push(payload);
            return { failures: [] };
        };
        instance.requiredSubscriptions = [{ name: 'Follows', type: 'channel.follow', version: '2', getCondition: ({ broadcasterId }) => ({ broadcaster_user_id: broadcasterId }) }];
        instance.sessionId = 'testSession123';
        instance._isConnected = true;
        instance.isInitialized = true;
        instance.broadcasterId = 'testUser123';

        await instance.handleWebSocketMessage({
            metadata: { message_type: 'revocation' },
            payload: {
                subscription: {
                    id: 'sub-1',
                    status: 'authorization_revoked',
                    type: 'channel.follow'
                }
            }
        });

        expect(resubscribeCalls.length).toBe(1);
        expect(resubscribeCalls[0].sessionId).toBe('testSession123');
        expect(resubscribeCalls[0].broadcasterId).toBe('testUser123');
    });

    it('validates configuration using centralized auth fallback', () => {
        const instance = new TwitchEventSub(
            { channel: 'testChannel', broadcasterId: 'test-broadcaster-id' },
            mockDependencies
        );

        const result = instance._validateConfigurationFields();

        expect(result.valid).toBe(true);
        expect(result.details.accessToken.source).toBe('authManager');
    });

    it('parses subscription errors with critical flag for auth failures', () => {
        const instance = new TwitchEventSub(
            { channel: 'testChannel', clientId: 'testClientId', accessToken: 'testToken', broadcasterId: 'test-broadcaster-id' },
            mockDependencies
        );

        const parsed = instance._parseSubscriptionError(
            { response: { data: { error: 'Unauthorized', message: 'invalid token' }, status: 401 } },
            { type: 'channel.follow' }
        );

        expect(parsed.isCritical).toBe(true);
    });

    it('parses subscription errors with retryable flag for rate limits', () => {
        const instance = new TwitchEventSub(
            { channel: 'testChannel', clientId: 'testClientId', accessToken: 'testToken', broadcasterId: 'test-broadcaster-id' },
            mockDependencies
        );

        const parsed = instance._parseSubscriptionError(
            { response: { data: { error: 'Too Many Requests', message: 'rate limit exceeded' }, status: 429 } },
            { type: 'channel.follow' }
        );

        expect(parsed.isRetryable).toBe(true);
    });

    it('validates connection readiness before subscription setup', () => {
        const instance = new TwitchEventSub(
            { channel: 'testChannel', clientId: 'testClientId', accessToken: 'testToken', broadcasterId: 'test-broadcaster-id' },
            mockDependencies
        );
        instance.ws = { readyState: 1 };
        instance._isConnected = true;
        instance.isInitialized = true;
        instance.sessionId = 'testSession123';

        const valid = instance._validateConnectionForSubscriptions();

        expect(valid).toBe(true);
    });

    it('continues reconnecting when WebSocket close throws', async () => {
        const instance = new TwitchEventSub(
            { channel: 'testChannel', clientId: 'testClientId', accessToken: 'testToken', broadcasterId: 'test-broadcaster-id' },
            mockDependencies
        );
        instance.isInitialized = true;
        instance.maxRetryAttempts = 1;
        instance.ws = {
            readyState: 1,
            close: () => { throw new Error('close failed'); }
        };

        let reconnected = false;
        instance._connectWebSocket = async () => { reconnected = true; };

        await instance._reconnect();

        expect(reconnected).toBe(true);
    });

    it('continues deleting WebSocket subscriptions after a deletion error', async () => {
        const logErrors = [];
        const mockAxios = {
            get: createMockFn().mockResolvedValue({
                data: {
                    data: [
                        { id: 'sub-1', type: 'channel.follow', status: 'enabled', transport: { method: 'websocket', session_id: 'testSession123' } },
                        { id: 'sub-2', type: 'channel.subscribe', status: 'enabled', transport: { method: 'websocket', session_id: 'otherSession' } }
                    ]
                }
            }),
            delete: createMockFn()
                .mockRejectedValueOnce(new Error('delete failed'))
                .mockResolvedValueOnce({})
        };

        const instance = new TwitchEventSub(
            { channel: 'testChannel', clientId: 'testClientId', accessToken: 'testToken', broadcasterId: 'test-broadcaster-id' },
            { ...mockDependencies, axios: mockAxios }
        );
        instance._logEventSubError = (message, error, eventType, payload) => {
            logErrors.push({ message, error, eventType, payload });
        };
        instance.sessionId = 'testSession123';

        await instance._cleanupAllWebSocketSubscriptions();

        expect(mockAxios.delete.mock.calls.length).toBe(1);
        expect(logErrors.some((entry) => entry.eventType === 'subscription-delete')).toBe(true);
    });

    it('continues deleting session subscriptions after a deletion error', async () => {
        const logErrors = [];
        const mockAxios = {
            get: createMockFn().mockResolvedValue({
                data: {
                    data: [
                        { id: 'sub-1', type: 'channel.follow', transport: { method: 'websocket', session_id: 'testSession123' } },
                        { id: 'sub-2', type: 'channel.subscribe', transport: { method: 'websocket', session_id: 'testSession123' } },
                        { id: 'sub-3', type: 'channel.subscribe', transport: { method: 'websocket', session_id: 'otherSession' } }
                    ]
                }
            }),
            delete: createMockFn()
                .mockRejectedValueOnce(new Error('delete failed'))
                .mockResolvedValueOnce({})
        };

        const instance = new TwitchEventSub(
            { channel: 'testChannel', clientId: 'testClientId', accessToken: 'testToken', broadcasterId: 'test-broadcaster-id' },
            { ...mockDependencies, axios: mockAxios }
        );
        instance._logEventSubError = (message, error, eventType, payload) => {
            logErrors.push({ message, error, eventType, payload });
        };
        instance.sessionId = 'testSession123';
        instance.subscriptions.set('sub-1', { id: 'sub-1' });
        instance.subscriptions.set('sub-2', { id: 'sub-2' });
        instance.subscriptions.set('sub-3', { id: 'sub-3' });

        await instance._deleteAllSubscriptions();

        expect(instance.subscriptions.has('sub-2')).toBe(false);
        expect(instance.subscriptions.has('sub-3')).toBe(true);
        expect(logErrors.some((entry) => entry.eventType === 'subscription-delete')).toBe(true);
        expect(logErrors.length).toBeGreaterThan(0);
    });
});
