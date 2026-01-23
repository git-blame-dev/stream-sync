const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { TikTokPlatform } = require('../../../../../src/platforms/tiktok');

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

describe('TikTokPlatform _handleConnectionError classification', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('returns errorCategory stream-status for fetchIsLive errors', () => {
        const platform = createPlatform();

        const result = platform._handleConnectionError(new Error('fetchIsLive failed'));

        expect(result.errorCategory).toBe('stream-status');
        expect(result.username).toBe('testUser');
    });

    it('returns errorCategory stream-wait for waitUntilLive errors', () => {
        const platform = createPlatform();

        const result = platform._handleConnectionError(new Error('waitUntilLive timeout'));

        expect(result.errorCategory).toBe('stream-wait');
    });

    it('returns errorCategory connection-establishment for connect errors', () => {
        const platform = createPlatform();

        const result = platform._handleConnectionError(new Error('Failed to connect to server'));

        expect(result.errorCategory).toBe('connection-establishment');
    });

    it('returns errorCategory network for TLS errors', () => {
        const platform = createPlatform();

        const result = platform._handleConnectionError(new Error('TLS handshake failed'));

        expect(result.errorCategory).toBe('network');
    });

    it('returns errorCategory network for socket disconnected errors', () => {
        const platform = createPlatform();

        const result = platform._handleConnectionError(new Error('socket disconnected unexpectedly'));

        expect(result.errorCategory).toBe('network');
    });

    it('returns errorCategory room-info for room info errors', () => {
        const platform = createPlatform();

        const result = platform._handleConnectionError(new Error('Failed to retrieve room info'));

        expect(result.errorCategory).toBe('room-info');
    });

    it('returns errorCategory unknown for unrecognized errors', () => {
        const platform = createPlatform();

        const result = platform._handleConnectionError(new Error('Something unexpected happened'));

        expect(result.errorCategory).toBe('unknown');
    });

    it('handles null/undefined errors gracefully', () => {
        const platform = createPlatform();

        const result = platform._handleConnectionError(null);

        expect(result.errorCategory).toBe('unknown');
        expect(result.username).toBe('testUser');
    });
});
