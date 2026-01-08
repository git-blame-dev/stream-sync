jest.mock('../../../src/utils/youtube-connection-manager', () => {
    class MockYouTubeConnectionManager {
        constructor() {
            this.connectToStream = jest.fn(async () => {});
            this.disconnectFromStream = jest.fn(async () => {});
            this.cleanupAllConnections = jest.fn(async () => {});
            this.getConnectionCount = jest.fn(() => 0);
            this.getAllConnections = jest.fn(() => []);
            this.getAllVideoIds = jest.fn(() => []);
            this.getActiveVideoIds = jest.fn(() => []);
            this.hasConnection = jest.fn(() => false);
            this.removeConnection = jest.fn();
        }
    }

    return {
        YouTubeConnectionManager: MockYouTubeConnectionManager
    };
});

jest.mock('../../../src/utils/youtube-notification-dispatcher', () => ({
    YouTubeNotificationDispatcher: jest.fn(() => ({ dispatchSuperChat: jest.fn() }))
}));

jest.mock('../../../src/utils/youtube-author-extractor', () => ({ extractAuthor: jest.fn(() => ({ name: 'User' })) }));
jest.mock('../../../src/utils/notification-builder', () => ({ build: jest.fn((data) => ({ ...data, built: true })) }));
jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: () => ({
        handleEventProcessingError: jest.fn(),
        handleConnectionError: jest.fn(),
        handleCleanupError: jest.fn(),
        logOperationalError: jest.fn(),
        handleConfigurationError: jest.fn()
    })
}));
jest.mock('../../../src/utils/dependency-validator', () => ({
    validateYouTubePlatformDependencies: jest.fn(() => true),
    validateLoggerInterface: jest.fn(() => true)
}));

const { YouTubePlatform } = require('../../../src/platforms/youtube');

const createPlatform = (overrides = {}) => {
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const notificationManager = { addHandler: jest.fn() };
    const eventBus = { emit: jest.fn(), on: jest.fn() };
    return new YouTubePlatform({ enabled: true, username: 'abc', channel: 'abc', clientId: 'cid', clientSecret: 'sec', accessToken: 'tok', refreshToken: 'rt' }, {
        logger,
        notificationManager,
        eventBus,
        ...overrides
    });
};

describe('YouTubePlatform behavior', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('throws when dependencies argument is not an object', () => {
        expect(() => new YouTubePlatform({}, 'bad')).toThrow('Dependencies should be a single object');
    });

    it('connects to live videos and uses connection manager', async () => {
        const platform = createPlatform({ streamDetectionService: { getLiveStreams: jest.fn(async () => [{ videoId: 'v1' }]) } });
        platform.getLiveVideoIds = jest.fn(async () => ['v1']);
        const connected = [];
        platform.connectionManager.connectToStream = async (videoId, createConnection, options) => {
            connected.push({ videoId, reason: options?.reason });
        };
        platform.startMultiStreamMonitoring = jest.fn().mockImplementation(async () => {
            await platform.checkMultiStream({ throwOnError: true });
        });
        await platform.initialize({});

        expect(connected).toEqual([{ videoId: 'v1', reason: 'stream detected' }]);
    });

    it('fails fast when getLiveVideoIds throws', async () => {
        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const platform = createPlatform({ logger, streamDetectionService: { getLiveStreams: jest.fn() } });
        platform.getLiveVideoIds = jest.fn(async () => { throw new Error('fail'); });

        platform.startMultiStreamMonitoring = jest.fn().mockImplementation(async () => {
            await platform.checkMultiStream({ throwOnError: true });
        });

        await expect(platform.initialize({})).rejects.toThrow('fail');
        expect(platform.errorHandler.handleConnectionError).toHaveBeenCalled();
    });

    it('emits platform events and invokes handler map', () => {
        const platform = createPlatform();
        const handler = jest.fn();
        platform.handlers.onChat = handler;
        const eventSpy = jest.fn();
        platform.on('platform:event', eventSpy);

        platform._emitPlatformEvent('chat', { platform: 'youtube', type: 'chat:event', message: { text: 'hi' } });

        expect(handler).toHaveBeenCalled();
        expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat', data: expect.objectContaining({ message: { text: 'hi' } }) }));
    });

    it('skips remove/delete chat actions in message filtering', () => {
        const platform = createPlatform();
        const skipTypes = [
            'RemoveChatItemAction',
            'RemoveChatItemByAuthorAction',
            'MarkChatItemsByAuthorAsDeletedAction',
            'UpdateLiveChatPollAction'
        ];

        const results = skipTypes.map((type) => platform._shouldSkipMessage({ type }));

        expect(results).toEqual([true, true, true, true]);
    });
});
