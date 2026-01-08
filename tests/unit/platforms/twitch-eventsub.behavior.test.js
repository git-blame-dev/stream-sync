jest.mock('../../../src/utils/timeout-validator', () => ({
    safeSetTimeout: jest.fn((fn) => {
        if (typeof fn === 'function') fn();
        return null;
    }),
    safeSetInterval: jest.fn(() => null),
    validateTimeout: jest.fn((v) => v),
    safeDelay: jest.fn(async () => {})
}));

jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: jest.fn(() => ({
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    }))
}));

const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const TwitchEventSub = jest.requireActual('../../../src/platforms/twitch-eventsub');

describe('TwitchEventSub behavior', () => {
    const baseAuthManager = () => ({
        getState: () => 'READY',
        getUserId: () => '123',
        getAccessToken: async () => 'token',
        getClientId: () => 'cid',
        getScopes: async () => ['user:read:chat'],
        authState: { executeWhenReady: async (fn) => fn() },
        twitchAuth: { triggerOAuthFlow: jest.fn() }
    });
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const ChatFileLoggingService = class { constructor() {} };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('routes notification events to handlers and emits follow/message', () => {
        const instance = new TwitchEventSub({ channel: 'chan', clientId: 'cid', accessToken: 'tok' }, {
            logger,
            authManager: baseAuthManager(),
            ChatFileLoggingService
        });

        const followSpy = jest.fn();
        const messageSpy = jest.fn();
        instance.emit = jest.fn((event, payload) => {
            if (event === 'follow') followSpy(payload);
            if (event === 'message') messageSpy(payload);
        });

        instance.handleNotificationEvent('channel.follow', { user_name: 'u', user_id: '1', followed_at: '2024-01-01T00:00:00Z' });
        instance.handleNotificationEvent('channel.chat.message', {
            chatter_user_id: '1',
            broadcaster_user_id: '2',
            message: { text: 'hi', timestamp: '2024-01-01T00:00:00Z' },
            message_timestamp: '2024-01-01T00:00:00Z'
        });

        expect(followSpy).toHaveBeenCalledWith(expect.objectContaining({ userId: '1', username: 'u' }));
        expect(messageSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'hi' }));
        expect(messageSpy.mock.calls[0][0].context['tmi-sent-ts']).toBe(String(Date.parse('2024-01-01T00:00:00Z')));
    });

    it('validates configuration using centralized auth fallback', async () => {
        const authManager = baseAuthManager();
        const instance = new TwitchEventSub({ channel: 'chan' }, { logger, authManager, ChatFileLoggingService });

        const result = instance._validateConfigurationFields();

        expect(result.valid).toBe(true);
        expect(result.details.accessToken.source).toBe('authManager');
    });

    it('parses subscription errors with critical and retryable flags', () => {
        const instance = new TwitchEventSub({ channel: 'chan', clientId: 'cid', accessToken: 'tok' }, { logger, authManager: baseAuthManager(), ChatFileLoggingService });

        const critical = instance._parseSubscriptionError({ response: { data: { error: 'Unauthorized', message: 'bad' }, status: 401 } }, { type: 't' });
        const retryable = instance._parseSubscriptionError({ response: { data: { error: 'Too Many Requests', message: 'rate' }, status: 429 } }, { type: 't' });

        expect(critical.isCritical).toBe(true);
        expect(retryable.isRetryable).toBe(true);
    });

    it('validates connection readiness before subscription setup', () => {
        const instance = new TwitchEventSub({ channel: 'chan', clientId: 'cid', accessToken: 'tok' }, { logger, authManager: baseAuthManager(), ChatFileLoggingService });
        instance.ws = { readyState: 1 };
        instance._isConnected = true;
        instance.isInitialized = true;
        instance.sessionId = 'abcdef1234';

        const valid = instance._validateConnectionForSubscriptions();

        expect(valid).toBe(true);
        expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Connection validation passed'), 'twitch', expect.any(Object));
    });

    it('uses platform error handler when simulator operations fail', () => {
        const instance = new TwitchEventSub({ channel: 'chan', clientId: 'cid', accessToken: 'tok' }, { logger, authManager: baseAuthManager(), ChatFileLoggingService });
        instance.errorHandler = { handleEventProcessingError: jest.fn(), logOperationalError: jest.fn() };

        instance._logEventSubError('msg', new Error('boom'), 'stage');

        expect(instance.errorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('continues reconnecting when WebSocket close throws', async () => {
        const instance = new TwitchEventSub(
            { channel: 'chan', clientId: 'cid', accessToken: 'tok' },
            { logger, authManager: baseAuthManager(), ChatFileLoggingService }
        );
        instance.isInitialized = true;
        instance.maxRetryAttempts = 1;
        instance.ws = {
            readyState: 1,
            close: () => {
                throw new Error('close failed');
            }
        };

        let didConnect = false;
        instance._connectWebSocket = async () => {
            didConnect = true;
        };

        await instance._reconnect();

        expect(didConnect).toBe(true);
    });

    it('continues deleting WebSocket subscriptions after a deletion error', async () => {
        const instance = new TwitchEventSub(
            { channel: 'chan', clientId: 'cid', accessToken: 'tok' },
            { logger, authManager: baseAuthManager(), ChatFileLoggingService }
        );

        const axios = require('axios');
        axios.get.mockResolvedValueOnce({
            data: {
                data: [
                    { id: 'sub-1', type: 'channel.follow', status: 'enabled', transport: { method: 'websocket' } },
                    { id: 'sub-2', type: 'channel.subscribe', status: 'enabled', transport: { method: 'websocket' } }
                ]
            }
        });

        let attemptedSecondDelete = false;
        axios.delete
            .mockImplementationOnce(async () => {
                throw new Error('delete failed');
            })
            .mockImplementationOnce(async () => {
                attemptedSecondDelete = true;
            });

        await instance._cleanupAllWebSocketSubscriptions();

        expect(attemptedSecondDelete).toBe(true);
    });

    it('continues deleting session subscriptions after a deletion error', async () => {
        const instance = new TwitchEventSub(
            { channel: 'chan', clientId: 'cid', accessToken: 'tok' },
            { logger, authManager: baseAuthManager(), ChatFileLoggingService }
        );
        instance.sessionId = 'session-123';
        instance.subscriptions.set('sub-1', { id: 'sub-1' });
        instance.subscriptions.set('sub-2', { id: 'sub-2' });

        const axios = require('axios');
        axios.get.mockResolvedValueOnce({
            data: {
                data: [
                    { id: 'sub-1', type: 'channel.follow', transport: { method: 'websocket', session_id: 'session-123' } },
                    { id: 'sub-2', type: 'channel.subscribe', transport: { method: 'websocket', session_id: 'session-123' } }
                ]
            }
        });

        axios.delete
            .mockImplementationOnce(async () => {
                throw new Error('delete failed');
            })
            .mockImplementationOnce(async () => {});

        await instance._deleteAllSubscriptions();

        expect(instance.subscriptions.has('sub-2')).toBe(false);
    });
});
