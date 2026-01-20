const { describe, test, expect } = require('bun:test');
const { createMockFn } = require('../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../helpers/mock-factories');
const { createTwitchEventSubSubscriptionManager } = require('../../../../src/platforms/twitch/eventsub/subscription-manager');

const createAuthManager = (overrides = {}) => ({
    authState: { executeWhenReady: async (fn) => fn() },
    getAccessToken: async () => 'testToken',
    getClientId: () => 'authClientId',
    ...overrides
});

const createManager = (overrides = {}) => createTwitchEventSubSubscriptionManager({
    logger: noOpLogger,
    authManager: createAuthManager(),
    config: { clientId: 'testClientId', accessToken: 'testAccessToken' },
    subscriptions: new Map(),
    getClientId: () => 'testClientId',
    validateConnectionForSubscriptions: () => true,
    logError: () => {},
    ...overrides
});

describe('Twitch EventSub subscription manager', () => {
    test('categorizes subscription errors as critical or retryable', () => {
        const manager = createManager();

        const critical = manager.parseSubscriptionError(
            { response: { data: { error: 'Unauthorized', message: 'bad' }, status: 401 } },
            { type: 'channel.follow' }
        );
        const retryable = manager.parseSubscriptionError(
            { response: { data: { error: 'Too Many Requests', message: 'rate' }, status: 429 } },
            { type: 'channel.follow' }
        );

        expect(critical.isCritical).toBe(true);
        expect(retryable.isRetryable).toBe(true);
    });

    test('retries subscription creation for retryable failures', async () => {
        const post = createMockFn()
            .mockRejectedValueOnce({ response: { data: { error: 'Too Many Requests', message: 'rate' }, status: 429 } })
            .mockResolvedValueOnce({ data: { data: [{ id: 'sub-1', status: 'enabled' }] } });
        const manager = createManager({ axios: { post }, getClientId: () => 'testClientId' });

        const result = await manager.setupEventSubscriptions({
            requiredSubscriptions: [{
                name: 'Follows',
                type: 'channel.follow',
                version: '2',
                getCondition: () => ({ broadcaster_user_id: 'broadcaster-1' })
            }],
            userId: 'user-1',
            broadcasterId: 'broadcaster-1',
            sessionId: 'session-1',
            subscriptionDelay: 0,
            isConnected: true
        });

        expect(post).toHaveBeenCalledTimes(2);
        expect(result.failures).toHaveLength(0);
    });

    test('uses auth-provided clientId and token when config is missing', async () => {
        const post = createMockFn().mockResolvedValue({ data: { data: [{ id: 'sub-1', status: 'enabled' }] } });
        const getAccessToken = createMockFn(async () => 'authToken');
        const getClientId = createMockFn(() => 'authClientId');
        const authManager = createAuthManager({ getClientId, getAccessToken });
        const manager = createManager({
            authManager,
            config: {},
            axios: { post },
            getClientId: () => authManager.getClientId()
        });

        await manager.setupEventSubscriptions({
            requiredSubscriptions: [{
                name: 'Chat',
                type: 'channel.chat.message',
                version: '1',
                getCondition: () => ({ broadcaster_user_id: 'broadcaster-1', user_id: 'user-1' })
            }],
            userId: 'user-1',
            broadcasterId: 'broadcaster-1',
            sessionId: 'session-1',
            subscriptionDelay: 0,
            isConnected: true
        });

        expect(getClientId).toHaveBeenCalled();
        expect(getAccessToken).toHaveBeenCalled();
        expect(post).toHaveBeenCalledTimes(1);
    });

    test('uses auth-provided clientId and token for cleanup when config is missing', async () => {
        const get = createMockFn().mockResolvedValue({
            data: {
                data: [{ id: 'sub-1', transport: { method: 'websocket', session_id: 'session-1' } }]
            }
        });
        const deleteCall = createMockFn().mockResolvedValue({});
        const getAccessToken = createMockFn(async () => 'authToken');
        const getClientId = createMockFn(() => 'authClientId');
        const authManager = createAuthManager({ getClientId, getAccessToken });
        const manager = createManager({
            authManager,
            config: {},
            axios: { get, delete: deleteCall },
            getClientId: () => authManager.getClientId()
        });

        await manager.cleanupAllWebSocketSubscriptions({ sessionId: 'session-1' });

        expect(getClientId).toHaveBeenCalled();
        expect(getAccessToken).toHaveBeenCalled();
        expect(get).toHaveBeenCalledTimes(1);
        expect(deleteCall).toHaveBeenCalledTimes(1);
    });
});
