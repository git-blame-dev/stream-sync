const { describe, test, expect, afterEach } = require('bun:test');
const EventEmitter = require('events');
const { noOpLogger } = require('../helpers/mock-factories');
const { TikTokPlatform } = require('../../src/platforms/tiktok');

describe('TikTokPlatform connection state', () => {
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
            on: emitter.on.bind(emitter),
            emit: emitter.emit.bind(emitter),
            removeAllListeners: emitter.removeAllListeners.bind(emitter),
            isConnected: false,
            isConnecting: false,
            roomId: 'testRoom123'
        };
    };

    const buildPlatform = () => {
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
                ensureConnection: () => createMockConnection()
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
                recordFailure: () => {}
            }
        };

        return new TikTokPlatform(config, deps);
    };

    test('starts with connectionActive as false', () => {
        platform = buildPlatform();

        expect(platform.connectionActive).toBe(false);
    });

    test('handleConnectionSuccess sets connectionActive to true', async () => {
        platform = buildPlatform();
        platform.connectionStateManager = {
            markConnected: () => {}
        };

        expect(platform.connectionActive).toBe(false);

        await platform.handleConnectionSuccess();

        expect(platform.connectionActive).toBe(true);
    });

    test('handleConnectionSuccess is idempotent', async () => {
        platform = buildPlatform();
        platform.connectionStateManager = {
            markConnected: () => {}
        };

        await platform.handleConnectionSuccess();
        const connectionTime1 = platform.connectionTime;

        await platform.handleConnectionSuccess();
        const connectionTime2 = platform.connectionTime;

        expect(connectionTime1).toBe(connectionTime2);
    });

    test('_handleStreamEnd sets connectionActive to false', async () => {
        platform = buildPlatform();
        platform.connection = createMockConnection();
        platform.connectionActive = true;

        await platform._handleStreamEnd();

        expect(platform.connectionActive).toBe(false);
    });

    test('stores handlers in handlers object', () => {
        platform = buildPlatform();
        const testHandler = () => {};

        platform.handlers.onViewerCount = testHandler;

        expect(platform.handlers.onViewerCount).toBe(testHandler);
    });
});
