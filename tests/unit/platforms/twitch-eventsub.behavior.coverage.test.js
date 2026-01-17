const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const TwitchEventSub = require('../../../src/platforms/twitch-eventsub');

class MockChatFileLoggingService {
    logRawPlatformData() {}
}

const createAuthManager = (overrides = {}) => ({
    getState: () => overrides.state || 'READY',
    getScopes: async () => overrides.scopes || [],
    getAccessToken: async () => 'test-token',
    getUserId: () => 'test-user-123',
    getClientId: () => overrides.clientId || null,
    clientId: overrides.clientId || null,
    twitchAuth: { triggerOAuthFlow: createMockFn().mockRejectedValue(new Error('oauth fail')) },
    authState: { executeWhenReady: async (fn) => fn() },
    ...overrides
});

const createEventSub = (configOverrides = {}, depsOverrides = {}) => {
    return new TwitchEventSub(
        { dataLoggingEnabled: false, ...configOverrides },
        {
            logger: noOpLogger,
            authManager: createAuthManager(),
            axios: { post: createMockFn(), get: createMockFn(), delete: createMockFn() },
            WebSocketCtor: class { close() {} },
            ChatFileLoggingService: MockChatFileLoggingService,
            ...depsOverrides
        }
    );
};

describe('TwitchEventSub behavior guardrails', () => {
    let eventSub;

    afterEach(() => {
        if (eventSub?.cleanup) {
            eventSub.cleanup().catch(() => {});
        }
    });

    it('validates config fields and generates warnings for type mismatches', () => {
        eventSub = createEventSub(
            { dataLoggingEnabled: 'not-bool' },
            { authManager: createAuthManager() }
        );

        const result = eventSub._validateConfigurationFields();

        expect(result.valid).toBe(true);
        expect(result.warnings.some((w) => w.includes('centralized auth'))).toBe(true);
    });

    it('throws when auth manager is missing or not ready', () => {
        expect(() => {
            const es = createEventSub({}, { authManager: null });
            es._validateAuthManager();
        }).toThrow('AuthManager is required');

        expect(() => {
            const es = createEventSub({}, { authManager: createAuthManager({ state: 'STALE' }) });
            es._validateAuthManager();
        }).toThrow("AuthManager state is 'STALE'");
    });

    it('returns false from connection validation when session/connection is invalid', () => {
        eventSub = createEventSub();
        eventSub.sessionId = '';
        eventSub._isConnected = false;
        eventSub.ws = { readyState: 0 };
        eventSub.isInitialized = false;

        const valid = eventSub._validateConnectionForSubscriptions();

        expect(valid).toBe(false);
    });

    it('categorizes subscription errors by severity and retryability', () => {
        eventSub = createEventSub();

        const critical = eventSub._parseSubscriptionError(
            { response: { data: { error: 'Unauthorized', message: 'bad' } } },
            { type: 'test.sub' }
        );
        const retryable = eventSub._parseSubscriptionError(
            { response: { data: { error: 'Too Many Requests', message: 'slow' } } },
            { type: 'test.sub' }
        );
        const fallback = eventSub._parseSubscriptionError(
            new Error('boom'),
            { type: 'test.sub' }
        );

        expect(critical.isCritical).toBe(true);
        expect(retryable.isRetryable).toBe(true);
        expect(fallback.isCritical).toBe(false);
        expect(fallback.isRetryable).toBe(true);
    });

    it('detects missing scopes via token validation', async () => {
        eventSub = createEventSub(
            {},
            { authManager: createAuthManager({ scopes: ['user:read:chat'], clientId: 'test-client' }) }
        );

        const result = await eventSub._validateTokenScopes();

        expect(result.valid).toBe(false);
        expect(result.missingScopes.length).toBeGreaterThan(0);
    });

    it('validates auth manager state is READY', () => {
        eventSub = createEventSub(
            {},
            { authManager: createAuthManager({ state: 'READY' }) }
        );

        const result = eventSub._validateAuthManager();

        expect(result.valid).toBe(true);
        expect(result.details.state).toBe('READY');
    });
});
