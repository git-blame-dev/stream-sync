const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks, resetModules } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/utils/youtube-connection-manager', () => {
    class MockYouTubeConnectionManager {
        constructor() {
            this.connectToStream = createMockFn(async () => {});
            this.disconnectFromStream = createMockFn(async () => {});
            this.cleanupAllConnections = createMockFn(async () => {});
            this.getConnectionCount = createMockFn(() => 0);
            this.getAllConnections = createMockFn(() => []);
            this.getAllVideoIds = createMockFn(() => []);
            this.getActiveVideoIds = createMockFn(() => []);
            this.hasConnection = createMockFn(() => false);
            this.removeConnection = createMockFn();
        }
    }

    return {
        YouTubeConnectionManager: MockYouTubeConnectionManager
    };
});

mockModule('../../../src/utils/youtube-notification-dispatcher', () => ({
    YouTubeNotificationDispatcher: createMockFn(() => ({ dispatchSuperChat: createMockFn() }))
}));

mockModule('../../../src/utils/youtube-author-extractor', () => ({ extractAuthor: createMockFn(() => ({ name: 'User' })) }));
mockModule('../../../src/utils/notification-builder', () => ({ build: createMockFn((data) => ({ ...data, built: true })) }));
mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: () => ({
        handleEventProcessingError: createMockFn(),
        handleConnectionError: createMockFn(),
        handleCleanupError: createMockFn(),
        logOperationalError: createMockFn(),
        handleConfigurationError: createMockFn()
    })
}));
mockModule('../../../src/utils/dependency-validator', () => ({
    validateYouTubePlatformDependencies: createMockFn(() => true),
    validateLoggerInterface: createMockFn(() => true)
}));

const { YouTubePlatform } = require('../../../src/platforms/youtube');

const createPlatform = (overrides = {}) => {
    const logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() };
    const notificationManager = { addHandler: createMockFn() };
    const eventBus = { emit: createMockFn(), on: createMockFn() };
    return new YouTubePlatform({ enabled: true, username: 'abc', channel: 'abc', clientId: 'cid', clientSecret: 'sec', accessToken: 'tok', refreshToken: 'rt' }, {
        logger,
        notificationManager,
        eventBus,
        ...overrides
    });
};

describe('YouTubePlatform behavior', () => {
    beforeEach(() => {
        clearAllMocks();
    });

    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    it('throws when dependencies argument is not an object', () => {
        expect(() => new YouTubePlatform({}, 'bad')).toThrow('Dependencies should be a single object');
    });

    it('connects to live videos and uses connection manager', async () => {
        const platform = createPlatform({ streamDetectionService: { getLiveStreams: createMockFn(async () => [{ videoId: 'v1' }]) } });
        platform.getLiveVideoIds = createMockFn(async () => ['v1']);
        const connected = [];
        platform.connectionManager.connectToStream = async (videoId, createConnection, options) => {
            connected.push({ videoId, reason: options?.reason });
        };
        platform.startMultiStreamMonitoring = createMockFn().mockImplementation(async () => {
            await platform.checkMultiStream({ throwOnError: true });
        });
        await platform.initialize({});

        expect(connected).toEqual([{ videoId: 'v1', reason: 'stream detected' }]);
    });

    it('fails fast when getLiveVideoIds throws', async () => {
        const logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() };
        const platform = createPlatform({ logger, streamDetectionService: { getLiveStreams: createMockFn() } });
        platform.getLiveVideoIds = createMockFn(async () => { throw new Error('fail'); });

        platform.startMultiStreamMonitoring = createMockFn().mockImplementation(async () => {
            await platform.checkMultiStream({ throwOnError: true });
        });

        await expect(platform.initialize({})).rejects.toThrow('fail');
        expect(platform.errorHandler.handleConnectionError).toHaveBeenCalled();
    });

    it('emits platform events and invokes handler map', () => {
        const platform = createPlatform();
        const handler = createMockFn();
        platform.handlers.onChat = handler;
        const eventSpy = createMockFn();
        platform.on('platform:event', eventSpy);

        platform._emitPlatformEvent('platform:chat-message', { platform: 'youtube', type: 'chat:event', message: { text: 'hi' } });

        expect(handler).toHaveBeenCalled();
        expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'platform:chat-message', data: expect.objectContaining({ message: { text: 'hi' } }) }));
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
