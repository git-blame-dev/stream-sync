const { describe, test, expect } = require('bun:test');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { createTwitchEventSubSubscriptionManager } = require('../../../../../src/platforms/twitch/connections/eventsub-subscription-manager');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../../../src/core/secrets');

const createTwitchAuth = (overrides = {}) => ({
    refreshTokens: async () => true,
    isReady: () => true,
    ...overrides
});

const createManager = (overrides = {}) => {
    _resetForTesting();
    initializeStaticSecrets();
    secrets.twitch.accessToken = 'testAccessToken';
    return createTwitchEventSubSubscriptionManager({
        logger: noOpLogger,
        twitchAuth: createTwitchAuth(),
        config: { clientId: 'testClientId' },
        subscriptions: new Map(),
        getClientId: () => 'testClientId',
        validateConnectionForSubscriptions: () => true,
        logError: () => {},
        ...overrides
    });
};

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

    test('uses config clientId and secrets token for subscription requests', async () => {
        const postCalls = [];
        const post = async (url, payload, options) => {
            postCalls.push({ url, payload, headers: options?.headers });
            return { data: { data: [{ id: 'sub-1', status: 'enabled' }] } };
        };
        const manager = createManager({ axios: { post } });
        secrets.twitch.accessToken = 'authToken';

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
        expect(postCalls[0].headers['Client-Id']).toBe('testClientId');
        expect(postCalls[0].headers['Authorization']).toBe('Bearer authToken');
        expect(postCalls[0].payload.type).toBe('channel.chat.message');
    });

    test('uses config clientId and secrets token for cleanup', async () => {
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
        const manager = createManager({ axios: { get, delete: deleteCall } });
        secrets.twitch.accessToken = 'authToken';

        await manager.cleanupAllWebSocketSubscriptions({ sessionId: 'session-1' });

        expect(getCalls).toHaveLength(1);
        expect(getCalls[0].headers['Client-Id']).toBe('testClientId');
        expect(getCalls[0].headers['Authorization']).toBe('Bearer authToken');
        expect(deleteCalls).toHaveLength(1);
        expect(deleteCalls[0].url).toContain('sub-1');
    });
});
