const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { EventEmitter } = require('events');
const { createMockFn, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { useFakeTimers, useRealTimers, advanceTimersByTime } = require('../../helpers/bun-timers');
const { safeSetInterval, safeSetTimeout } = require('../../../src/utils/timeout-validator');
const fs = require('fs').promises;
const path = require('path');
const { StreamElementsPlatform } = require('../../../src/platforms/streamelements');

class MockWebSocket extends EventEmitter {
    constructor(url) {
        super();
        this.url = url;
        this.readyState = MockWebSocket.CONNECTING;
        this.sent = [];
        MockWebSocket.instances.push(this);
    }

    send(payload) {
        this.sent.push(payload);
    }

    close() {
        this.readyState = MockWebSocket.CLOSED;
    }
}

MockWebSocket.instances = [];
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSED = 3;

const createPlatform = (configOverrides = {}, dependencyOverrides = {}) => {
    const retrySystem = dependencyOverrides.retrySystem || {
        incrementRetryCount: createMockFn(() => 10),
        resetRetryCount: createMockFn(),
        handleConnectionError: createMockFn(),
        handleConnectionSuccess: createMockFn()
    };

    const platform = new StreamElementsPlatform(
        {
            enabled: true,
            jwtToken: 'test-jwt-token',
            youtubeChannelId: 'test-youtube-channel',
            twitchChannelId: 'test-twitch-channel',
            dataLoggingEnabled: true,
            ...configOverrides
        },
        {
            logger: noOpLogger,
            WebSocketCtor: MockWebSocket,
            retrySystem,
            ...dependencyOverrides
        }
    );

    return { platform, retrySystem };
};

describe('StreamElementsPlatform behavior', () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
    });

    afterEach(() => {
        useRealTimers();
        restoreAllMocks();
    });

    it('initializes disabled platform and fails prerequisites', async () => {
        const platform = new StreamElementsPlatform({ enabled: false }, { logger: noOpLogger });

        const initialized = await platform.initialize({});

        expect(initialized).toBe(false);
        expect(platform.checkConnectionPrerequisites()).toBe(false);
        expect(platform.isConnected()).toBe(false);
    });

    it('skips connect when already connecting', async () => {
        const { platform } = createPlatform();

        platform.isConnecting = true;

        const result = await platform.connect();

        expect(result).toBe(false);
    });

    it('returns false when prerequisites fail', async () => {
        const platform = new StreamElementsPlatform({ enabled: true }, { logger: noOpLogger });

        const result = await platform.connect();

        expect(result).toBe(false);
    });

    it('connectToWebSocket resolves when the socket opens', async () => {
        const { platform } = createPlatform();

        const promise = platform.connectToWebSocket();
        const connection = MockWebSocket.instances[0];
        connection.readyState = MockWebSocket.OPEN;
        connection.emit('open');

        await expect(promise).resolves.toBeUndefined();
        expect(platform.connection).toBe(connection);
    });

    it('connectToWebSocket rejects when the socket errors', async () => {
        const { platform } = createPlatform();

        const promise = platform.connectToWebSocket();
        const connection = MockWebSocket.instances[0];
        const error = new Error('test websocket error');
        connection.emit('error', error);

        await expect(promise).rejects.toThrow('test websocket error');
    });

    it('setupEventListeners throws when connection is missing', () => {
        const { platform } = createPlatform();
        const errorHandler = { handleConnectionError: createMockFn() };
        platform.errorHandler = errorHandler;
        platform.connection = null;

        expect(() => platform.setupEventListeners()).toThrow('StreamElements connection missing connection object');
        expect(errorHandler.handleConnectionError.mock.calls).toHaveLength(1);
    });

    it('routes message types to the correct handlers', () => {
        const { platform } = createPlatform();
        platform.handleAuthResponse = createMockFn();
        platform.handleFollowEvent = createMockFn();
        platform.handlePing = createMockFn();

        platform.handleMessage(Buffer.from(JSON.stringify({ type: 'auth', success: true })));
        platform.handleMessage(Buffer.from(JSON.stringify({ type: 'event', data: {} })));
        platform.handleMessage(Buffer.from(JSON.stringify({ type: 'ping' })));
        platform.handleMessage(Buffer.from(JSON.stringify({ type: 'unknown' })));

        expect(platform.handleAuthResponse.mock.calls).toHaveLength(1);
        expect(platform.handleFollowEvent.mock.calls).toHaveLength(1);
        expect(platform.handlePing.mock.calls).toHaveLength(1);
    });

    it('handles auth responses for success and failure', () => {
        const { platform } = createPlatform();
        const errorHandler = { handleAuthenticationError: createMockFn() };
        platform.errorHandler = errorHandler;
        platform.subscribeToFollowEvents = createMockFn();
        platform.disconnect = createMockFn();

        platform.handleAuthResponse({ success: true });
        platform.handleAuthResponse({ success: false, error: 'denied' });

        expect(platform.subscribeToFollowEvents.mock.calls).toHaveLength(1);
        expect(errorHandler.handleAuthenticationError.mock.calls).toHaveLength(1);
        expect(platform.disconnect.mock.calls).toHaveLength(1);
    });

    it('emits follow events for supported platforms', async () => {
        const { platform } = createPlatform();
        platform.logRawPlatformData = createMockFn().mockResolvedValue();
        const emitted = [];
        platform.on('platform:event', (payload) => emitted.push(payload));

        await platform.handleFollowEvent({
            data: {
                platform: 'twitch',
                displayName: 'TestFollower',
                userId: 'test-user-1'
            }
        });

        expect(emitted).toHaveLength(1);
        expect(emitted[0].platform).toBe('twitch');
        expect(emitted[0].type).toBe('platform:follow');
        expect(emitted[0].data.username).toBe('TestFollower');
        expect(emitted[0].data.userId).toBe('test-user-1');
    });

    it('skips follow events with unknown platforms or missing usernames', async () => {
        const { platform } = createPlatform();
        platform.logRawPlatformData = createMockFn().mockResolvedValue();
        const emitted = [];
        platform.on('platform:event', (payload) => emitted.push(payload));

        await platform.handleFollowEvent({
            data: {
                platform: 'unknown',
                displayName: 'TestUser',
                userId: 'test-user-2'
            }
        });

        await platform.handleFollowEvent({
            data: {
                platform: 'youtube',
                displayName: '',
                userId: 'test-user-3'
            }
        });

        expect(emitted).toHaveLength(0);
    });

    it('logs raw platform data as NDJSON', async () => {
        const { platform } = createPlatform({ dataLoggingEnabled: true });
        const mkdirSpy = spyOn(fs, 'mkdir').mockResolvedValue();
        const appendSpy = spyOn(fs, 'appendFile').mockResolvedValue();
        const payload = { type: 'follow', data: { id: 'test-follow' } };

        await platform.logRawPlatformData('follow', payload);

        expect(mkdirSpy.mock.calls).toHaveLength(1);
        expect(appendSpy.mock.calls).toHaveLength(1);

        const [filePath, logLine] = appendSpy.mock.calls[0];
        expect(filePath).toBe(path.join('./logs', 'streamelements-data-log.ndjson'));

        const entry = JSON.parse(logLine);
        expect(entry).toMatchObject({
            platform: 'streamelements',
            eventType: 'follow',
            payload
        });
        expect(typeof entry.ingestTimestamp).toBe('string');
    });

    it('routes log errors through the error handler', async () => {
        const { platform } = createPlatform({ dataLoggingEnabled: true });
        const errorHandler = { handleDataLoggingError: createMockFn() };
        platform.errorHandler = errorHandler;
        spyOn(fs, 'mkdir').mockResolvedValue();
        spyOn(fs, 'appendFile').mockRejectedValue(new Error('disk full'));

        await platform.logRawPlatformData('follow', { id: 'test-follow' });

        expect(errorHandler.handleDataLoggingError.mock.calls).toHaveLength(1);
    });

    it('sends auth and ping messages when connected', () => {
        useFakeTimers();
        const { platform } = createPlatform();
        const connection = new MockWebSocket('ws://test');
        connection.readyState = MockWebSocket.OPEN;
        platform.connection = connection;

        platform.handleConnectionOpen();
        advanceTimersByTime(30000);

        const sentPayloads = connection.sent.map((payload) => JSON.parse(payload));
        expect(sentPayloads[0].type).toBe('auth');
        expect(sentPayloads[1].type).toBe('ping');
        expect(platform.isReady).toBe(true);
    });

    it('schedules reconnection attempts when requested', () => {
        useFakeTimers();
        const { platform } = createPlatform();
        platform.incrementRetryCount = createMockFn(() => 10);
        platform.connect = createMockFn();
        platform.isConnected = createMockFn(() => false);

        platform.scheduleReconnection();
        advanceTimersByTime(10);

        expect(platform.connect.mock.calls).toHaveLength(1);
    });

    it('cleans up connections when disconnecting', async () => {
        const { platform } = createPlatform();
        const removeAllListeners = createMockFn();
        platform.connection = {
            readyState: MockWebSocket.OPEN,
            close: createMockFn(),
            removeAllListeners
        };
        platform.pingInterval = safeSetInterval(() => {}, 1000);
        platform.reconnectTimeout = safeSetTimeout(() => {}, 1000);

        await platform.disconnect();

        expect(platform.connection).toBe(null);
        expect(platform.reconnectTimeout).toBe(null);
        expect(platform.pingInterval).toBe(null);
    });

    it('clears connections during cleanup even when listeners throw', () => {
        const { platform } = createPlatform();
        platform.connection = {
            removeAllListeners: () => {
                throw new Error('cleanup failed');
            }
        };

        platform.cleanup();

        expect(platform.connection).toBe(null);
        expect(platform.connectionTime).toBe(null);
    });

    it('does not send messages when the socket is closed', () => {
        const { platform } = createPlatform();
        const send = createMockFn();
        platform.connection = { readyState: MockWebSocket.CONNECTING, send };

        platform.sendMessage({ type: 'ping' });

        expect(send.mock.calls).toHaveLength(0);
    });
});
