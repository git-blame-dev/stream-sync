const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, spyOn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, unmockModule, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

unmockModule('../../src/platforms/tiktok');

const EventEmitter = require('events');
const {
    initializeTestLogging,
    createMockPlatformDependencies,
    createMockConfig
} = require('../helpers/test-setup');

// Mock ConnectionStateManager to control connection lifecycle
mockModule('../../src/utils/connection-state-manager', () => ({
    ConnectionStateManager: createMockFn()
}));

// Minimal ChatFileLoggingService stub to avoid filesystem usage
class MockChatFileLoggingService {
    constructor() {
        this.logChatData = createMockFn();
        this.logMemberData = createMockFn();
        this.logGiftData = createMockFn();
    }
}

const { TikTokPlatform } = require('../../src/platforms/tiktok');
const { ConnectionStateManager } = require('../../src/utils/connection-state-manager');

const createLogger = () => ({
    debug: createMockFn(),
    info: createMockFn(),
    warn: createMockFn(),
    error: createMockFn()
});

const createConnectionStub = () => {
    const emitter = new EventEmitter();
    return {
        connect: createMockFn().mockResolvedValue({ roomId: 'room123' }),
        disconnect: createMockFn().mockResolvedValue(true),
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
        isConnected: false,
        isConnecting: false,
        roomId: 'room123',
        availableGifts: [],
        roomInfo: { data: { status: 1 } }
    };
};

describe('TikTokPlatform initialize flow', () => {
    let connectionStub;
    let connectionStateManager;

    beforeEach(() => {
        initializeTestLogging();
        connectionStub = createConnectionStub();

        // Provide the stub via the mocked ConnectionStateManager
        connectionStateManager = {
            initialize: createMockFn(),
            markDisconnected: createMockFn(),
            markConnecting: createMockFn(),
            markConnected: createMockFn(),
            markError: createMockFn(),
            ensureConnection: createMockFn().mockReturnValue(connectionStub)
        };
        ConnectionStateManager.mockImplementation(() => connectionStateManager);
    });

    afterEach(() => {
        restoreAllMocks();
    
        restoreAllModuleMocks();});

    const buildPlatform = () => {
        const config = createMockConfig('tiktok', {
            enabled: true,
            username: 'hero_stream',
            dataLoggingEnabled: false,
            zombieTimeoutMs: 50
        });

        const connectionFactory = {
            createConnection: createMockFn().mockReturnValue(connectionStub)
        };

        const deps = createMockPlatformDependencies('tiktok', {
            connectionStateManager,
            connectionFactory,
            ChatFileLoggingService: MockChatFileLoggingService,
            logger: createLogger(),
            ControlEvent: { CONNECTED: 'connected' }
        });

        const platform = new TikTokPlatform(config, deps);
        return { platform, logger: deps.logger };
    };

    it('calls handleConnectionSuccess once when connect promise resolves', async () => {
        const successSpy = spyOn(TikTokPlatform.prototype, 'handleConnectionSuccess');
        const { platform } = buildPlatform();

        await expect(platform.initialize({})).resolves.toBeUndefined();

        expect(connectionStub.connect).toHaveBeenCalledTimes(1);
        expect(successSpy).toHaveBeenCalledTimes(1);
    });

    it('does not call handleConnectionSuccess again when CONNECTED event fires after initial success', async () => {
        const successSpy = spyOn(TikTokPlatform.prototype, 'handleConnectionSuccess');
        const { platform } = buildPlatform();

        await expect(platform.initialize({})).resolves.toBeUndefined();
        // Simulate ControlEvent.CONNECTED after initial success
        connectionStub.emit(platform.ControlEvent?.CONNECTED || 'connected', { roomId: 'room123' });

        expect(successSpy).toHaveBeenCalledTimes(1);
    });

    it('succeeds even when ControlEvent.CONNECTED never fires', async () => {
        const successSpy = spyOn(TikTokPlatform.prototype, 'handleConnectionSuccess');
        const { platform } = buildPlatform();

        await expect(platform.initialize({})).resolves.toBeUndefined();

        expect(connectionStub.connect).toHaveBeenCalledTimes(1);
        expect(successSpy).toHaveBeenCalledTimes(1);
    });

    it('schedules reconnect checks on stream end', async () => {
        const intervalManager = {
            createInterval: createMockFn(),
            hasInterval: createMockFn().mockReturnValue(false),
            clearInterval: createMockFn(),
            clearAllIntervals: createMockFn()
        };

        const { platform } = buildPlatform();
        platform.intervalManager = intervalManager;
        platform.connection = { removeAllListeners: createMockFn() };
        platform.connectionStateManager.markDisconnected = createMockFn();

        await platform._handleStreamEnd();

        expect(platform.connectionActive).toBe(false);
        expect(intervalManager.createInterval).toHaveBeenCalledWith(
            'tiktok-stream-reconnect',
            expect.any(Function),
            60000,
            'reconnect'
        );
    });
});
