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
        it('stores handlers and merges with defaults', async () => {
            const platform = createPlatform();
            platform._connect = createMockFn().mockResolvedValue();
            const testHandler = createMockFn();

            await platform.initialize({ onChat: testHandler });

            expect(platform.handlers.onChat).toBe(testHandler);
        });

        it('propagates error when connection fails', async () => {
            const platform = createPlatform();
            platform._connect = createMockFn().mockRejectedValue(new Error('connection failed'));

            await expect(platform.initialize({})).rejects.toThrow('connection failed');
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
    });

    describe('handleRetry', () => {
        it('returns skipped result for non-recoverable errors', () => {
            const platform = createPlatform();

            const result = platform.handleRetry(new Error('username is required'));

            expect(result).toEqual({ action: 'skipped', reason: 'non-recoverable' });
        });

        it('returns retry-queued result for recoverable errors', () => {
            const retrySystem = {
                resetRetryCount: createMockFn(),
                handleConnectionError: createMockFn(),
                isConnected: createMockFn()
            };
            const platform = createPlatform({}, { retrySystem });
            platform.retryLock = false;

            const result = platform.handleRetry(new Error('connection timeout'));

            expect(result).toEqual({ action: 'retry-queued' });
        });
    });

    describe('queueRetry', () => {
        it('returns queued=true and sets retryLock when successful', () => {
            const retrySystem = {
                resetRetryCount: createMockFn(),
                handleConnectionError: createMockFn(),
                isConnected: createMockFn()
            };
            const platform = createPlatform({}, { retrySystem });
            platform.retryLock = false;

            const result = platform.queueRetry(new Error('test'));

            expect(result).toEqual({ queued: true });
            expect(platform.retryLock).toBe(true);
        });

        it('returns queued=false with reason locked when already locked', () => {
            const retrySystem = {
                resetRetryCount: createMockFn(),
                handleConnectionError: createMockFn(),
                isConnected: createMockFn()
            };
            const platform = createPlatform({}, { retrySystem });
            platform.retryLock = true;

            const result = platform.queueRetry(new Error('test'));

            expect(result).toEqual({ queued: false, reason: 'locked' });
            expect(platform.retryLock).toBe(true);
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

        it('returns issueType=disconnection for regular disconnections', async () => {
            const retrySystem = {
                resetRetryCount: createMockFn(),
                handleConnectionError: createMockFn(),
                isConnected: createMockFn()
            };
            const platform = createPlatform({}, { retrySystem });
            platform.retryLock = false;

            const result = await platform.handleConnectionIssue('stream ended');

            expect(result.issueType).toBe('disconnection');
            expect(result.retryResult).toEqual({ queued: true });
        });

        it('returns issueType=error when isError=true', async () => {
            const retrySystem = {
                resetRetryCount: createMockFn(),
                handleConnectionError: createMockFn(),
                isConnected: createMockFn()
            };
            const platform = createPlatform({}, { retrySystem });
            platform.retryLock = false;

            const result = await platform.handleConnectionIssue(new Error('test error'), true);

            expect(result.issueType).toBe('error');
            expect(result.retryResult).toEqual({ queued: true });
        });

        it('returns issueType=stream-not-live for not-live messages', async () => {
            const retrySystem = {
                resetRetryCount: createMockFn(),
                handleConnectionError: createMockFn(),
                isConnected: createMockFn()
            };
            const platform = createPlatform({}, { retrySystem });
            platform.retryLock = false;

            const result = await platform.handleConnectionIssue({ message: 'Stream is not live', code: 4404 });

            expect(result.issueType).toBe('stream-not-live');
            expect(result.retryResult).toEqual({ queued: true });
        });
    });
});
