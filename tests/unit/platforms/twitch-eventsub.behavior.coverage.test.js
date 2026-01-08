
jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: jest.fn(() => ({
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    }))
}));

jest.mock('ws', () => jest.fn(() => ({ readyState: 1 })));

jest.mock('../../../src/utils/timeout-validator', () => ({
    safeSetTimeout: jest.fn(),
    safeSetInterval: jest.fn(),
    validateTimeout: jest.fn((value) => value),
    safeDelay: jest.fn().mockResolvedValue()
}));

jest.unmock('../../../src/platforms/twitch-eventsub');
const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const TwitchEventSub = require('../../../src/platforms/twitch-eventsub');

const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
};

class MockChatFileLoggingService {
    constructor() {
        this.appendLog = jest.fn();
    }
}

const readyAuthManager = (overrides = {}) => ({
    getState: jest.fn(() => overrides.state || 'READY'),
    getScopes: jest.fn(() => overrides.scopes || []),
    getAccessToken: jest.fn().mockResolvedValue('token'),
    getClientId: jest.fn(() => overrides.clientId || null),
    clientId: overrides.clientId || null,
    twitchAuth: {
        triggerOAuthFlow: jest.fn().mockRejectedValue(new Error('oauth fail'))
    },
    authState: { executeWhenReady: jest.fn((cb) => cb()) },
    ...overrides
});

describe('TwitchEventSub behavior guardrails', () => {
    beforeEach(() => {
        jest.clearAllMocks();
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
            instance.errorHandler = { logOperationalError: jest.fn(), handleEventProcessingError: jest.fn() };
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
            instance.errorHandler = { logOperationalError: jest.fn(), handleEventProcessingError: jest.fn() };
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
