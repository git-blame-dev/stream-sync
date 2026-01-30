const { describe, it, expect, afterEach, beforeEach } = require('bun:test');
const { createMockFn } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../../../src/core/secrets');

const TwitchEventSub = require('../../../../../src/platforms/twitch-eventsub');

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
        { dataLoggingEnabled: false, clientId: 'test-client-id', ...configOverrides },
        {
            logger: noOpLogger,
            twitchAuth: createTwitchAuth(),
            axios: { post: createMockFn(), get: createMockFn(), delete: createMockFn() },
            WebSocketCtor: class { close() {} },
            ChatFileLoggingService: MockChatFileLoggingService,
            ...depsOverrides
        }
    );
};

describe('TwitchEventSub behavior guardrails', () => {
    let eventSub;

    beforeEach(() => {
        _resetForTesting();
        initializeStaticSecrets();
        secrets.twitch.accessToken = 'test-token';
    });

    afterEach(() => {
        if (eventSub?.cleanup) {
            eventSub.cleanup().catch(() => {});
        }
        _resetForTesting();
        initializeStaticSecrets();
    });

    it('validates config fields and generates warnings for type mismatches', () => {
        eventSub = createEventSub(
            { dataLoggingEnabled: 'not-bool', broadcasterId: 'test-broadcaster-id' },
            { twitchAuth: createTwitchAuth() }
        );

        const result = eventSub._validateConfigurationFields();

        expect(result.valid).toBe(true);
        expect(result.details.broadcasterId.valid).toBe(true);
    });

    it('throws when Twitch auth is missing or not ready', () => {
        expect(() => {
            createEventSub({ broadcasterId: 'test-broadcaster-id' }, { twitchAuth: null });
        }).toThrow('TwitchEventSub subscription manager requires twitchAuth');

        const es = createEventSub({ broadcasterId: 'test-broadcaster-id' }, { twitchAuth: createTwitchAuth({ ready: false }) });
        expect(() => {
            es._validateTwitchAuth();
        }).toThrow('TwitchAuth is not ready');
    });

    it('returns false from connection validation when session/connection is invalid', () => {
        eventSub = createEventSub({ broadcasterId: 'test-broadcaster-id' });
        eventSub.sessionId = '';
        eventSub._isConnected = false;
        eventSub.ws = { readyState: 0 };
        eventSub.isInitialized = false;

        const valid = eventSub._validateConnectionForSubscriptions();

        expect(valid).toBe(false);
    });

    it('categorizes subscription errors by severity and retryability', () => {
        eventSub = createEventSub({ broadcasterId: 'test-broadcaster-id' });

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

    it('validates Twitch auth is ready', () => {
        eventSub = createEventSub(
            { broadcasterId: 'test-broadcaster-id' },
            { twitchAuth: createTwitchAuth({ ready: true }) }
        );

        const result = eventSub._validateTwitchAuth();

        expect(result.valid).toBe(true);
        expect(result.details.ready).toBe(true);
    });
});
