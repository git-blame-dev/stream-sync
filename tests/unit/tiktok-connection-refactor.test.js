jest.unmock('../../src/platforms/tiktok');

const EventEmitter = require('events');
const {
    initializeTestLogging,
    createMockPlatformDependencies,
    createMockConfig
} = require('../helpers/test-setup');

// Mock ConnectionStateManager to control connection lifecycle
jest.mock('../../src/utils/connection-state-manager', () => ({
    ConnectionStateManager: jest.fn()
}));

// Minimal ChatFileLoggingService stub to avoid filesystem usage
class MockChatFileLoggingService {
    constructor() {
        this.logChatData = jest.fn();
        this.logMemberData = jest.fn();
        this.logGiftData = jest.fn();
    }
}

const { TikTokPlatform } = require('../../src/platforms/tiktok');
const { ConnectionStateManager } = require('../../src/utils/connection-state-manager');

const createLogger = () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
});

const createConnectionStub = () => {
    const emitter = new EventEmitter();
    return {
        connect: jest.fn().mockResolvedValue({ roomId: 'room123' }),
        disconnect: jest.fn().mockResolvedValue(true),
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
        jest.clearAllMocks();
        initializeTestLogging();
        connectionStub = createConnectionStub();

        // Provide the stub via the mocked ConnectionStateManager
        connectionStateManager = {
            initialize: jest.fn(),
            markDisconnected: jest.fn(),
            markConnecting: jest.fn(),
            markConnected: jest.fn(),
            markError: jest.fn(),
            ensureConnection: jest.fn().mockReturnValue(connectionStub)
        };
        ConnectionStateManager.mockImplementation(() => connectionStateManager);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const buildPlatform = () => {
        const config = createMockConfig('tiktok', {
            enabled: true,
            username: 'hero_stream',
            dataLoggingEnabled: false,
            zombieTimeoutMs: 50
        });

        const connectionFactory = {
            createConnection: jest.fn().mockReturnValue(connectionStub)
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
        const successSpy = jest.spyOn(TikTokPlatform.prototype, 'handleConnectionSuccess');
        const { platform } = buildPlatform();

        await expect(platform.initialize({})).resolves.toBeUndefined();

        expect(connectionStub.connect).toHaveBeenCalledTimes(1);
        expect(successSpy).toHaveBeenCalledTimes(1);
    });

    it('does not call handleConnectionSuccess again when CONNECTED event fires after initial success', async () => {
        const successSpy = jest.spyOn(TikTokPlatform.prototype, 'handleConnectionSuccess');
        const { platform } = buildPlatform();

        await expect(platform.initialize({})).resolves.toBeUndefined();
        // Simulate ControlEvent.CONNECTED after initial success
        connectionStub.emit(platform.ControlEvent?.CONNECTED || 'connected', { roomId: 'room123' });

        expect(successSpy).toHaveBeenCalledTimes(1);
    });

    it('succeeds even when ControlEvent.CONNECTED never fires', async () => {
        const successSpy = jest.spyOn(TikTokPlatform.prototype, 'handleConnectionSuccess');
        const { platform } = buildPlatform();

        await expect(platform.initialize({})).resolves.toBeUndefined();

        expect(connectionStub.connect).toHaveBeenCalledTimes(1);
        expect(successSpy).toHaveBeenCalledTimes(1);
    });

    it('schedules reconnect checks on stream end', async () => {
        const intervalManager = {
            createInterval: jest.fn(),
            hasInterval: jest.fn().mockReturnValue(false),
            clearInterval: jest.fn(),
            clearAllIntervals: jest.fn()
        };

        const { platform } = buildPlatform();
        platform.intervalManager = intervalManager;
        platform.connection = { removeAllListeners: jest.fn() };
        platform.connectionStateManager.markDisconnected = jest.fn();

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
