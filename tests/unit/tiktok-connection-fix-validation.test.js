const { describe, test, expect, afterEach } = require('bun:test');
const EventEmitter = require('events');

const { TikTokPlatform } = require('../../src/platforms/tiktok');

const noOpLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe('TikTok Connection State Management', () => {
    let platform;

    afterEach(() => {
        if (platform) {
            platform.removeAllListeners?.();
        }
    });

    const createMockConnection = () => {
        const emitter = new EventEmitter();
        return {
            connect: async () => ({ roomId: 'testRoom123' }),
            disconnect: async () => true,
            fetchIsLive: async () => true,
            waitUntilLive: async () => {},
            on: emitter.on.bind(emitter),
            emit: emitter.emit.bind(emitter),
            removeAllListeners: emitter.removeAllListeners.bind(emitter),
            isConnected: false,
            isConnecting: false,
            roomId: 'testRoom123'
        };
    };

    const buildPlatform = () => {
        const mockConnection = createMockConnection();

        const config = {
            enabled: true,
            username: 'testTikTokUser',
            dataLoggingEnabled: false
        };

        const deps = {
            logger: noOpLogger,
            connectionStateManager: {
                initialize: () => {},
                markDisconnected: () => {},
                markConnecting: () => {},
                markConnected: () => {},
                markError: () => {},
                ensureConnection: () => mockConnection,
                getState: () => 'disconnected',
                isConnected: () => false,
                getConnectionInfo: () => ({
                    platform: 'tiktok',
                    state: 'disconnected',
                    hasConnection: false
                })
            },
            connectionFactory: {
                createConnection: () => mockConnection
            },
            intervalManager: {
                createInterval: () => {},
                hasInterval: () => false,
                clearInterval: () => {},
                clearAllIntervals: () => {}
            },
            retrySystem: { resetRetryCount: () => {}, handleConnectionError: () => {} },
            TikTokWebSocketClient: class {},
            WebcastEvent: {},
            ControlEvent: { CONNECTED: 'connected' },
            initializationManager: {
                beginInitialization: () => true,
                markInitializationSuccess: () => {},
                markInitializationFailure: () => {},
                reset: () => {}
            },
            initializationStats: {
                startInitializationAttempt: () => 'test-attempt',
                recordSuccess: () => {},
                recordFailure: () => {},
                reset: () => {}
            }
        };

        return new TikTokPlatform(config, deps);
    };

    test('has connectionStateManager defined', () => {
        platform = buildPlatform();

        expect(platform.connectionStateManager).toBeDefined();
    });

    test('has connectionFactory defined', () => {
        platform = buildPlatform();

        expect(platform.connectionFactory).toBeDefined();
    });

    test('connectionStateManager reports disconnected state initially', () => {
        platform = buildPlatform();

        expect(platform.connectionStateManager.getState()).toBe('disconnected');
        expect(platform.connectionStateManager.isConnected()).toBe(false);
    });

    test('connectionStateManager provides connection info', () => {
        platform = buildPlatform();

        const info = platform.connectionStateManager.getConnectionInfo();

        expect(info.platform).toBe('tiktok');
        expect(info.state).toBe('disconnected');
        expect(info.hasConnection).toBe(false);
    });

    test('connectionFactory creates connection with required methods', () => {
        platform = buildPlatform();

        const connection = platform.connectionFactory.createConnection();

        expect(connection).not.toBeNull();
        expect(typeof connection.connect).toBe('function');
        expect(typeof connection.disconnect).toBe('function');
    });

    test('cleanup sets connection to null', async () => {
        platform = buildPlatform();
        platform.connection = createMockConnection();

        expect(platform.connection).not.toBeNull();

        await platform.cleanup();

        expect(platform.connection).toBeNull();
    });
});
