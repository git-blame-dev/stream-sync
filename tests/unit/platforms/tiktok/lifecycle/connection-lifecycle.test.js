const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { TikTokPlatform } = require('../../../../../src/platforms/tiktok');
const { PlatformEvents } = require('../../../../../src/interfaces/PlatformEvents');

const createPlatform = (configOverrides = {}, dependencyOverrides = {}) => {
    const logger = dependencyOverrides.logger || noOpLogger;
    const notificationManager = dependencyOverrides.notificationManager || {
        emit: createMockFn(),
        on: createMockFn(),
        removeListener: createMockFn(),
        handleNotification: createMockFn().mockResolvedValue()
    };
    const connectionFactory = dependencyOverrides.connectionFactory || {
        createConnection: createMockFn().mockReturnValue({
            on: createMockFn(),
            emit: createMockFn(),
            removeAllListeners: createMockFn(),
            connect: createMockFn().mockResolvedValue(),
            disconnect: createMockFn()
        })
    };

    const TikTokWebSocketClient = dependencyOverrides.TikTokWebSocketClient || createMockFn().mockImplementation(() => ({
        on: createMockFn(),
        off: createMockFn(),
        connect: createMockFn(),
        disconnect: createMockFn(),
        getState: createMockFn().mockReturnValue('DISCONNECTED'),
        isConnecting: false,
        isConnected: false
    }));

    const WebcastEvent = dependencyOverrides.WebcastEvent || { ERROR: 'error', DISCONNECT: 'disconnect' };
    const ControlEvent = dependencyOverrides.ControlEvent || {};

    const config = {
        enabled: true,
        username: 'testUser',
        ...configOverrides
    };

    return new TikTokPlatform(config, {
        logger,
        notificationManager,
        TikTokWebSocketClient,
        WebcastEvent,
        ControlEvent,
        connectionFactory,
        ...dependencyOverrides
    });
};

describe('TikTokPlatform connection lifecycle', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    describe('initialize', () => {
        it('returns early when beginInitialization returns false', async () => {
            const initializationManager = {
                beginInitialization: createMockFn().mockReturnValue(false),
                markInitializationSuccess: createMockFn(),
                markInitializationFailure: createMockFn()
            };
            const platform = createPlatform({}, { initializationManager });
            const connectCalls = [];
            platform._connect = async () => { connectCalls.push('called'); };

            await platform.initialize({});

            expect(connectCalls).toHaveLength(0);
        });

        it('stores handlers and merges with defaults', async () => {
            const platform = createPlatform();
            platform._connect = createMockFn().mockResolvedValue();
            const testHandler = createMockFn();

            await platform.initialize({ onChat: testHandler });

            expect(platform.handlers.onChat).toBe(testHandler);
        });

        it('resets retry count on initialization', async () => {
            const retrySystem = {
                resetRetryCount: createMockFn(),
                handleConnectionError: createMockFn(),
                isConnected: createMockFn()
            };
            const platform = createPlatform({}, { retrySystem });
            platform._connect = createMockFn().mockResolvedValue();

            await platform.initialize({});

            expect(retrySystem.resetRetryCount.mock.calls.length).toBeGreaterThan(0);
        });

        it('propagates error when connection fails', async () => {
            const platform = createPlatform();
            platform._connect = createMockFn().mockRejectedValue(new Error('connection failed'));

            await expect(platform.initialize({})).rejects.toThrow('connection failed');
        });

        it('queues retry on initialization failure when retrySystem exists', async () => {
            const retrySystem = {
                resetRetryCount: createMockFn(),
                handleConnectionError: createMockFn(),
                isConnected: createMockFn()
            };
            const platform = createPlatform({}, { retrySystem });
            platform._connect = createMockFn().mockRejectedValue(new Error('init failed'));

            try {
                await platform.initialize({});
            } catch {
                // Expected to throw
            }

            expect(retrySystem.handleConnectionError.mock.calls.length).toBe(1);
        });
    });

    describe('handleConnectionSuccess', () => {
        it('returns early when connectionActive is already true', async () => {
            const platform = createPlatform();
            platform.connectionActive = true;
            const emittedEvents = [];
            platform.on('platform:event', (e) => emittedEvents.push(e));

            await platform.handleConnectionSuccess();

            expect(emittedEvents).toHaveLength(0);
        });

        it('sets connectionActive=true and records connectionTime', async () => {
            const platform = createPlatform();
            platform.connectionActive = false;
            platform.connectionTime = 0;

            await platform.handleConnectionSuccess();

            expect(platform.connectionActive).toBe(true);
            expect(platform.connectionTime).toBeGreaterThan(0);
        });

        it('clears tiktok-stream-reconnect interval', async () => {
            const intervalManager = {
                clearInterval: createMockFn(),
                setInterval: createMockFn(),
                cleanup: createMockFn()
            };
            const platform = createPlatform({}, { intervalManager });
            platform.connectionActive = false;

            await platform.handleConnectionSuccess();

            const clearCalls = intervalManager.clearInterval.mock.calls;
            expect(clearCalls.some(call => call[0] === 'tiktok-stream-reconnect')).toBe(true);
        });

        it('resets isPlannedDisconnection flag', async () => {
            const platform = createPlatform();
            platform.connectionActive = false;
            platform.isPlannedDisconnection = true;

            await platform.handleConnectionSuccess();

            expect(platform.isPlannedDisconnection).toBe(false);
        });

        it('emits CHAT_CONNECTED event', async () => {
            const platform = createPlatform();
            platform.connectionActive = false;
            const emittedEvents = [];
            platform.on('platform:event', (e) => emittedEvents.push(e));

            await platform.handleConnectionSuccess();

            const connectedEvent = emittedEvents.find(e => e.type === PlatformEvents.CHAT_CONNECTED);
            expect(connectedEvent).toBeDefined();
            expect(connectedEvent.platform).toBe('tiktok');
        });

        it('resets retrySystem retry count', async () => {
            const retrySystem = {
                resetRetryCount: createMockFn(),
                handleConnectionError: createMockFn(),
                isConnected: createMockFn()
            };
            const platform = createPlatform({}, { retrySystem });
            platform.connectionActive = false;

            await platform.handleConnectionSuccess();

            expect(retrySystem.resetRetryCount.mock.calls.length).toBeGreaterThan(0);
        });
    });

    describe('handleConnectionError', () => {
        it('cleans up event listeners and resets connection state', () => {
            const platform = createPlatform();
            platform.connection = { removeAllListeners: createMockFn() };
            platform.listenersConfigured = true;
            platform.connectionActive = true;

            platform.handleConnectionError(new Error('test error'));

            expect(platform.connection).toBeNull();
            expect(platform.listenersConfigured).toBe(false);
            expect(platform.connectionActive).toBe(false);
        });

        it('calls handleRetry at the end', () => {
            const platform = createPlatform();
            const handleRetryCalls = [];
            platform.handleRetry = (err) => handleRetryCalls.push(err);

            platform.handleConnectionError(new Error('test error'));

            expect(handleRetryCalls).toHaveLength(1);
        });
    });

    describe('handleRetry', () => {
        it('skips retry for non-recoverable errors', () => {
            const retrySystem = {
                resetRetryCount: createMockFn(),
                handleConnectionError: createMockFn(),
                isConnected: createMockFn()
            };
            const platform = createPlatform({}, { retrySystem });
            const queueRetryCalls = [];
            platform.queueRetry = (err) => queueRetryCalls.push(err);

            platform.handleRetry(new Error('username is required'));

            expect(queueRetryCalls).toHaveLength(0);
        });

        it('queues retry for recoverable errors', () => {
            const retrySystem = {
                resetRetryCount: createMockFn(),
                handleConnectionError: createMockFn(),
                isConnected: createMockFn()
            };
            const platform = createPlatform({}, { retrySystem });
            const queueRetryCalls = [];
            platform.queueRetry = (err) => queueRetryCalls.push(err);

            platform.handleRetry(new Error('timeout error'));

            expect(queueRetryCalls).toHaveLength(1);
        });
    });

    describe('queueRetry', () => {
        it('returns early when retryLock is true', () => {
            const retrySystem = {
                resetRetryCount: createMockFn(),
                handleConnectionError: createMockFn(),
                isConnected: createMockFn()
            };
            const platform = createPlatform({}, { retrySystem });
            platform.retryLock = true;

            platform.queueRetry(new Error('test'));

            expect(retrySystem.handleConnectionError.mock.calls).toHaveLength(0);
        });

        it('sets retryLock=true and calls retrySystem.handleConnectionError', () => {
            const retrySystem = {
                resetRetryCount: createMockFn(),
                handleConnectionError: createMockFn(),
                isConnected: createMockFn()
            };
            const platform = createPlatform({}, { retrySystem });
            platform.retryLock = false;

            platform.queueRetry(new Error('test'));

            expect(platform.retryLock).toBe(true);
            expect(retrySystem.handleConnectionError.mock.calls).toHaveLength(1);
        });
    });

    describe('handleConnectionIssue', () => {
        it('sets connectionActive=false and cleans up', async () => {
            const platform = createPlatform();
            platform.connectionActive = true;
            platform.connection = { removeAllListeners: createMockFn(), disconnect: createMockFn() };

            await platform.handleConnectionIssue('stream ended');

            expect(platform.connectionActive).toBe(false);
            expect(platform.connection).toBeNull();
        });

        it('emits disconnection event', async () => {
            const platform = createPlatform();
            const emittedEvents = [];
            platform.on('platform:event', (e) => emittedEvents.push(e));

            await platform.handleConnectionIssue('stream ended');

            const disconnectEvent = emittedEvents.find(e => e.type === PlatformEvents.CHAT_DISCONNECTED);
            expect(disconnectEvent).toBeDefined();
        });

        it('queues retry when retrySystem exists', async () => {
            const retrySystem = {
                resetRetryCount: createMockFn(),
                handleConnectionError: createMockFn(),
                isConnected: createMockFn()
            };
            const platform = createPlatform({}, { retrySystem });
            platform.retryLock = false;

            await platform.handleConnectionIssue('stream ended');

            expect(retrySystem.handleConnectionError.mock.calls.length).toBeGreaterThan(0);
        });

    });
});
