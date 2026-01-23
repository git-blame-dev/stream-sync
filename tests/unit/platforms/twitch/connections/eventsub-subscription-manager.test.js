const { describe, test, expect } = require('bun:test');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { createTwitchEventSubSubscriptionManager } = require('../../../../../src/platforms/twitch/connections/eventsub-subscription-manager');

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
        const postCalls = [];
        let callCount = 0;
        const post = async (url, payload, options) => {
            postCalls.push({ url, payload, headers: options?.headers });
            callCount++;
            if (callCount === 1) {
                const error = new Error('Too Many Requests');
                error.response = { data: { error: 'Too Many Requests', message: 'rate' }, status: 429 };
                throw error;
            }
            return { data: { data: [{ id: 'sub-1', status: 'enabled' }] } };
        };
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

        expect(result.failures).toHaveLength(0);
        expect(result.successful).toBe(1);
        expect(postCalls.length).toBeGreaterThan(1);
        expect(postCalls[0].url).toContain('/eventsub/subscriptions');
        expect(postCalls[0].payload.type).toBe('channel.follow');
    });

    test('uses auth-provided clientId and token when config is missing', async () => {
        const postCalls = [];
        const post = async (url, payload, options) => {
            postCalls.push({ url, payload, headers: options?.headers });
            return { data: { data: [{ id: 'sub-1', status: 'enabled' }] } };
        };
        const authManager = createAuthManager({
            getClientId: () => 'authClientId',
            getAccessToken: async () => 'authToken'
        });
        const manager = createManager({
            authManager,
            config: {},
            axios: { post },
            getClientId: () => authManager.getClientId()
        });

        const result = await manager.setupEventSubscriptions({
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

        expect(result.successful).toBe(1);
        expect(postCalls).toHaveLength(1);
        expect(postCalls[0].headers['Client-Id']).toBe('authClientId');
        expect(postCalls[0].headers['Authorization']).toBe('Bearer authToken');
        expect(postCalls[0].payload.type).toBe('channel.chat.message');
    });

    test('uses auth-provided clientId and token for cleanup when config is missing', async () => {
        const getCalls = [];
        const deleteCalls = [];
        const get = async (url, options) => {
            getCalls.push({ url, headers: options?.headers });
            return {
                data: {
                    data: [{ id: 'sub-1', transport: { method: 'websocket', session_id: 'session-1' } }]
                }
            };
        };
        const deleteCall = async (url, options) => {
            deleteCalls.push({ url, headers: options?.headers });
            return {};
        };
        const authManager = createAuthManager({
            getClientId: () => 'authClientId',
            getAccessToken: async () => 'authToken'
        });
        const manager = createManager({
            authManager,
            config: {},
            axios: { get, delete: deleteCall },
            getClientId: () => authManager.getClientId()
        });

        await manager.cleanupAllWebSocketSubscriptions({ sessionId: 'session-1' });

        expect(getCalls).toHaveLength(1);
        expect(getCalls[0].headers['Client-Id']).toBe('authClientId');
        expect(getCalls[0].headers['Authorization']).toBe('Bearer authToken');
        expect(deleteCalls).toHaveLength(1);
        expect(deleteCalls[0].url).toContain('sub-1');
    });
});
