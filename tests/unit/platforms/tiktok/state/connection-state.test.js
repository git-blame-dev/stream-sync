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
            connect: createMockFn(),
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

describe('TikTokPlatform connection state', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    describe('checkConnectionPrerequisites', () => {
        it('returns canConnect=false when platform disabled', () => {
            const platform = createPlatform({ enabled: false, username: 'testUser' });

            const result = platform.checkConnectionPrerequisites();

            expect(result.canConnect).toBe(false);
            expect(result.reasons).toContain('Platform disabled in configuration');
            expect(result.reason).toBe('Platform disabled in configuration');
        });

        it('returns canConnect=false when username missing', () => {
            const platform = createPlatform({ enabled: true, username: '' });

            const result = platform.checkConnectionPrerequisites();

            expect(result.canConnect).toBe(false);
            expect(result.reasons).toContain('Username is required');
        });

        it('returns canConnect=false when connection.isConnecting is true', () => {
            const platform = createPlatform();
            platform.connection = { isConnecting: true, isConnected: false };

            const result = platform.checkConnectionPrerequisites();

            expect(result.canConnect).toBe(false);
            expect(result.reasons).toContain('Already connecting');
        });

        it('returns canConnect=false when connection.isConnected is true', () => {
            const platform = createPlatform();
            platform.connection = { isConnecting: false, isConnected: true };

            const result = platform.checkConnectionPrerequisites();

            expect(result.canConnect).toBe(false);
            expect(result.reasons).toContain('Already connected');
        });

        it('returns canConnect=true when all prerequisites met', () => {
            const platform = createPlatform({ enabled: true, username: 'testUser' });
            platform.connection = null;

            const result = platform.checkConnectionPrerequisites();

            expect(result.canConnect).toBe(true);
            expect(result.reasons).toEqual([]);
            expect(result.reason).toBeUndefined();
        });
    });

    describe('connectionStatus getter', () => {
        it('returns false when connection is null', () => {
            const platform = createPlatform();
            platform.connection = null;

            expect(platform.connectionStatus).toBe(false);
        });

        it('returns true when connection.isConnected is true', () => {
            const platform = createPlatform();
            platform.connection = { isConnected: true };

            expect(platform.connectionStatus).toBe(true);
        });

        it('returns false when connection.isConnected is false', () => {
            const platform = createPlatform();
            platform.connection = { isConnected: false };

            expect(platform.connectionStatus).toBe(false);
        });
    });

    describe('isConnecting getter', () => {
        it('returns false when connection is null', () => {
            const platform = createPlatform();
            platform.connection = null;

            expect(platform.isConnecting).toBe(false);
        });

        it('returns true when connection.isConnecting is true', () => {
            const platform = createPlatform();
            platform.connection = { isConnecting: true };

            expect(platform.isConnecting).toBe(true);
        });

        it('returns false when connection.isConnecting is false', () => {
            const platform = createPlatform();
            platform.connection = { isConnecting: false };

            expect(platform.isConnecting).toBe(false);
        });
    });

    describe('getConnectionState', () => {
        it('returns isConnected/isConnecting from connection when present', () => {
            const platform = createPlatform();
            platform.connection = {
                isConnected: true,
                isConnecting: false,
                connectionId: 'test-conn-123'
            };
            platform.connectionTime = 1704067200000;

            const state = platform.getConnectionState();

            expect(state.isConnected).toBe(true);
            expect(state.isConnecting).toBe(false);
            expect(state.hasConnection).toBe(true);
            expect(state.connectionId).toBe('test-conn-123');
            expect(state.connectionTime).toBe(1704067200000);
        });

        it('returns hasConnection=false when connection is null', () => {
            const platform = createPlatform();
            platform.connection = null;

            const state = platform.getConnectionState();

            expect(state.hasConnection).toBe(false);
            expect(state.isConnected).toBe(false);
            expect(state.isConnecting).toBe(false);
            expect(state.connectionId).toBe('N/A');
        });
    });

    describe('getStats', () => {
        it('returns platform, enabled, connected state', () => {
            const platform = createPlatform({ enabled: true, username: 'testUser' });
            platform.connection = { isConnected: true, isConnecting: false };

            const stats = platform.getStats();

            expect(stats.platform).toBe('tiktok');
            expect(stats.enabled).toBe(true);
            expect(stats.connected).toBe(true);
            expect(stats.connecting).toBe(false);
        });

        it('returns config subset with username, viewerCountEnabled, greetingsEnabled', () => {
            const platform = createPlatform({
                enabled: true,
                username: 'testStreamer',
                viewerCountEnabled: true,
                greetingsEnabled: false
            });

            const stats = platform.getStats();

            expect(stats.config.username).toBe('testStreamer');
            expect(stats.config.viewerCountEnabled).toBe(true);
            expect(stats.config.greetingsEnabled).toBe(false);
        });
    });

    describe('getStatus', () => {
        it('returns platform, enabled, username, connection states', () => {
            const platform = createPlatform({
                enabled: true,
                username: 'testStreamer'
            });
            platform.connection = {
                isConnected: true,
                isConnecting: false,
                connectionId: 'conn-456'
            };

            const status = platform.getStatus();

            expect(status.platform).toBe('TikTok');
            expect(status.enabled).toBe(true);
            expect(status.username).toBe('testStreamer');
            expect(status.isConnecting).toBe(false);
            expect(status.isConnected).toBe(true);
            expect(status.hasConnection).toBe(true);
            expect(status.connectionId).toBe('conn-456');
        });

        it('returns connectionId="N/A" when connection is null', () => {
            const platform = createPlatform();
            platform.connection = null;

            const status = platform.getStatus();

            expect(status.connectionId).toBe('N/A');
            expect(status.hasConnection).toBe(false);
            expect(status.isConnected).toBe(false);
            expect(status.isConnecting).toBe(false);
        });
    });

    describe('isConfigured', () => {
        it('returns true when enabled and username set', () => {
            const platform = createPlatform({ enabled: true, username: 'testUser' });

            expect(platform.isConfigured()).toBe(true);
        });

        it('returns false when disabled', () => {
            const platform = createPlatform({ enabled: false, username: 'testUser' });

            expect(platform.isConfigured()).toBe(false);
        });

        it('returns false when username missing', () => {
            const platform = createPlatform({ enabled: true, username: '' });

            expect(platform.isConfigured()).toBe(false);
        });
    });

    describe('validateConfig', () => {
        it('delegates to validateTikTokPlatformConfig', () => {
            const platform = createPlatform({ enabled: true, username: 'testUser' });

            const result = platform.validateConfig();

            expect(result).toMatchObject({
                valid: true
            });
        });

        it('returns validation errors for invalid config', () => {
            const platform = createPlatform({ enabled: true, username: '' });

            const result = platform.validateConfig();

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });
});
