
const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, unmockModule, requireActual, restoreAllModuleMocks, resetModules } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: createMockFn(() => ({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn()
    }))
}));

mockModule('ws', () => createMockFn(() => ({ readyState: 1 })));

mockModule('../../../src/utils/timeout-validator', () => ({
    safeSetTimeout: createMockFn(),
    safeSetInterval: createMockFn(),
    validateTimeout: createMockFn((value) => value),
    safeDelay: createMockFn().mockResolvedValue()
}));

unmockModule('../../../src/platforms/twitch-eventsub');
resetModules();
const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const TwitchEventSub = requireActual('../../../src/platforms/twitch-eventsub');

const mockLogger = {
    info: createMockFn(),
    warn: createMockFn(),
    error: createMockFn(),
    debug: createMockFn()
};

class MockChatFileLoggingService {
    constructor() {
        this.appendLog = createMockFn();
    }
}

const readyAuthManager = (overrides = {}) => ({
    getState: createMockFn(() => overrides.state || 'READY'),
    getScopes: createMockFn(() => overrides.scopes || []),
    getAccessToken: createMockFn().mockResolvedValue('token'),
    getClientId: createMockFn(() => overrides.clientId || null),
    clientId: overrides.clientId || null,
    twitchAuth: {
        triggerOAuthFlow: createMockFn().mockRejectedValue(new Error('oauth fail'))
    },
    authState: { executeWhenReady: createMockFn((cb) => cb()) },
    ...overrides
});

describe('TwitchEventSub behavior guardrails', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    beforeEach(() => {
        clearAllMocks();
    });

    it('warns when relying on centralized auth for clientId and optional fields mismatch types', async () => {
        const instance = new TwitchEventSub(
            { dataLoggingEnabled: 'not-bool' },
            { logger: mockLogger, authManager: readyAuthManager(), ChatFileLoggingService: MockChatFileLoggingService }
        );

        const result = instance._validateConfigurationFields();

        expect(result.valid).toBe(true);
        expect(result.warnings.some((w) => w.includes('centralized auth'))).toBe(true);
    });

    it('throws when auth manager is missing or not ready', () => {
        const missingAuth = () => new TwitchEventSub({}, { logger: mockLogger, authManager: null, ChatFileLoggingService: MockChatFileLoggingService })._validateAuthManager();
        expect(missingAuth).toThrow('AuthManager is required');

        const notReady = () => new TwitchEventSub({}, { logger: mockLogger, authManager: readyAuthManager({ state: 'STALE' }), ChatFileLoggingService: MockChatFileLoggingService })._validateAuthManager();
        expect(notReady).toThrow("AuthManager state is 'STALE'");
    });

    it('halts subscription validation when connection/session is missing and logs operational error', () => {
        const instance = new TwitchEventSub({}, { logger: mockLogger, authManager: readyAuthManager({ state: 'READY' }), ChatFileLoggingService: MockChatFileLoggingService });
        instance.sessionId = '';
        instance._isConnected = false;
        instance.ws = { readyState: 0 };
        instance.isInitialized = false;

        if (!instance.errorHandler) {
            instance.errorHandler = { logOperationalError: createMockFn(), handleEventProcessingError: createMockFn() };
        }
        const valid = instance._validateConnectionForSubscriptions();

        const handler = instance.errorHandler;
        expect(valid).toBe(false);
        expect(handler.logOperationalError).toHaveBeenCalled();
    });

    it('auto-triggers OAuth when scopes are missing and routes failures through error handler', async () => {
        const authManager = readyAuthManager({ scopes: ['user:read:chat'], clientId: 'id' });
        const instance = new TwitchEventSub({}, { logger: mockLogger, authManager, ChatFileLoggingService: MockChatFileLoggingService });

        if (!instance.errorHandler) {
            instance.errorHandler = { logOperationalError: createMockFn(), handleEventProcessingError: createMockFn() };
        }
        instance._handleMissingScopes(['bits:read']);
        await new Promise((resolve) => setImmediate(resolve));

        expect(authManager.twitchAuth.triggerOAuthFlow).toHaveBeenCalledWith(['bits:read']);
        expect(instance.errorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('categorizes subscription errors by severity and retryability', () => {
        const instance = new TwitchEventSub({}, { logger: mockLogger, authManager: readyAuthManager(), ChatFileLoggingService: MockChatFileLoggingService });
        const critical = instance._parseSubscriptionError({ response: { data: { error: 'Unauthorized', message: 'bad' } } }, { type: 'x' });
        const retryable = instance._parseSubscriptionError({ response: { data: { error: 'Too Many Requests', message: 'slow' } } }, { type: 'x' });
        const fallback = instance._parseSubscriptionError(new Error('boom'), { type: 'x' });

        expect(critical.isCritical).toBe(true);
        expect(retryable.isRetryable).toBe(true);
        expect(fallback.isCritical).toBe(false);
        expect(fallback.isRetryable).toBe(true);
    });

    it('reports missing scopes via logger warning', async () => {
        const authManager = readyAuthManager({ scopes: ['user:read:chat'], getState: () => 'READY', clientId: 'abc' });
        const instance = new TwitchEventSub({}, { logger: mockLogger, authManager, ChatFileLoggingService: MockChatFileLoggingService });

        const result = await instance._validateTokenScopes();

        expect(result.valid).toBe(false);
        expect(mockLogger.warn).toHaveBeenCalledWith('Token missing required scopes', 'twitch', expect.any(Object));
    });
});
