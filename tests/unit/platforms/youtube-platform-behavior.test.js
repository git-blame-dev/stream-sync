jest.mock('../../../src/utils/message-normalization', () => ({
    normalizeYouTubeMessage: jest.fn().mockReturnValue({
        userId: 'user-id',
        authorChannelId: 'author-channel',
        username: 'user',
        authorName: 'user',
        displayName: 'User',
        message: 'Hello world',
        timestamp: '2024-01-01T00:00:00.000Z',
        videoId: 'vid-1',
        isMod: false,
        isOwner: false,
        isVerified: false
    })
}));

const { YouTubePlatform } = require('../../../src/platforms/youtube');
const createLogger = () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
});

const createPlatform = (overrides = {}) => {
    const logger = overrides.logger || createLogger();
    const streamDetectionService = overrides.streamDetectionService || {
        detectLiveStreams: jest.fn().mockResolvedValue({
            success: true,
            videoIds: [],
            detectionMethod: 'mock'
        })
    };

    const dependencies = {
        USER_AGENTS: ['test-agent'],
        Innertube: null,
        logger,
        streamDetectionService,
        viewerService: overrides.viewerService || null,
        notificationDispatcher: overrides.notificationDispatcher,
        ChatFileLoggingService: overrides.ChatFileLoggingService,
        notificationManager: overrides.notificationManager || {
            emit: jest.fn(),
            on: jest.fn(),
            removeListener: jest.fn()
        }
    };

    const platform = new YouTubePlatform({ enabled: true, username: 'test-channel' }, dependencies);
    platform.startMultiStreamMonitoring = jest.fn().mockResolvedValue();
    if (!platform.connectionManager) {
        platform.connectionManager = {
            connectToStream: jest.fn().mockResolvedValue(true),
            getConnectionCount: jest.fn().mockReturnValue(0),
            getAllVideoIds: jest.fn().mockReturnValue([]),
            getActiveVideoIds: jest.fn().mockReturnValue([]),
            hasConnection: jest.fn().mockReturnValue(false),
            disconnectFromStream: jest.fn().mockResolvedValue(true),
            cleanupAllConnections: jest.fn().mockResolvedValue(),
            removeConnection: jest.fn()
        };
    } else {
        platform.connectionManager.connectToStream = jest.fn().mockResolvedValue(true);
        platform.connectionManager.getConnectionCount = jest.fn().mockReturnValue(0);
        platform.connectionManager.getAllVideoIds = jest.fn().mockReturnValue([]);
        platform.connectionManager.getActiveVideoIds = jest.fn().mockReturnValue([]);
        platform.connectionManager.hasConnection = jest.fn().mockReturnValue(false);
        platform.connectionManager.disconnectFromStream = jest.fn().mockResolvedValue(true);
        platform.connectionManager.cleanupAllConnections = jest.fn().mockResolvedValue();
        platform.connectionManager.removeConnection = jest.fn();
    }
    if (!platform.connectionStateManager) {
        platform.connectionStateManager = {
            markConnecting: jest.fn(),
            markConnected: jest.fn(),
            markError: jest.fn()
        };
    } else {
        platform.connectionStateManager.markConnecting = jest.fn();
        platform.connectionStateManager.markConnected = jest.fn();
        platform.connectionStateManager.markError = jest.fn();
    }

    if (typeof platform.on !== 'function' || typeof platform.emit !== 'function') {
        const listeners = new Map();
        platform.on = (event, handler) => {
            const existing = listeners.get(event) || [];
            existing.push(handler);
            listeners.set(event, existing);
        };
        platform.removeListener = (event, handler) => {
            const existing = listeners.get(event) || [];
            listeners.set(event, existing.filter((fn) => fn !== handler));
        };
        platform.emit = (event, payload) => {
            const existing = listeners.get(event) || [];
            existing.forEach((fn) => fn(payload));
        };
    }

    return { platform, logger, streamDetectionService };
};

describe('YouTubePlatform modern architecture', () => {
    it('should emit aggregated viewer counts as platform events after stream updates', () => {
        const { platform } = createPlatform();
        const received = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === 'viewer-count') {
                received.push(payload.data);
            }
        });

        platform.updateViewerCountForStream('stream-1', 5);
        platform.updateViewerCountForStream('stream-2', 7);

        expect(received).not.toHaveLength(0);
        const latest = received[received.length - 1];
        expect(latest.count).toBe(12);
        expect(latest.streamId).toBe('stream-2');
        expect(latest.platform).toBe('youtube');
        expect(latest.timestamp).toEqual(expect.any(String));
    });

    it('should emit platform:event error with context and metadata', () => {
        const { platform } = createPlatform();
        const received = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === 'error') {
                received.push(payload);
            }
        });

        platform._handleError(new Error('Boom'), 'connectToYouTubeStream', {
            shouldEmit: true,
            shouldDisconnect: false,
            videoId: 'video-1'
        });

        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({
            type: 'error',
            platform: 'youtube',
            data: {
                type: 'platform:error',
                platform: 'youtube',
                error: {
                    message: 'Boom',
                    name: 'Error'
                },
                context: {
                    operation: 'connectToYouTubeStream'
                },
                recoverable: true,
                metadata: expect.objectContaining({
                    platform: 'youtube',
                    videoId: 'video-1',
                    correlationId: expect.any(String),
                    timestamp: expect.any(String)
                })
            }
        });
    });

    it('should emit platform chat events for normalized chat items', async () => {
        const { platform } = createPlatform();
        const received = new Promise((resolve) => {
            const handler = (payload) => {
                if (payload.type !== 'chat') {
                    return;
                }
                platform.removeListener('platform:event', handler);
                resolve(payload.data);
            };
            platform.on('platform:event', handler);
        });

        platform._processRegularChatMessage({ videoId: 'vid-1' }, 'User');

        const payload = await received;
        expect(payload.platform).toBe('youtube');
        expect(payload.message.text).toBe('Hello world');
        expect(payload.metadata.videoId).toBe('vid-1');
    });

    it('should emit chat connected event when connectToYouTubeStream succeeds', async () => {
        const mockConnectionManager = {
            hasConnection: jest.fn().mockReturnValue(false),
            connectToStream: jest.fn().mockResolvedValue(true),
            getConnectionCount: jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(1),
            getConnectionId: jest.fn().mockReturnValue('youtube-abc123')
        };

        const youtubePlatform = new YouTubePlatform(
            {
                enableAPI: false,
                username: 'creator',
                viewerCountEnabled: true
            },
            { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }, streamDetectionService: { detectLiveStreams: jest.fn() } }
        );

        youtubePlatform.connectionManager = mockConnectionManager;
        const events = [];
        youtubePlatform.on('platform:event', (payload) => events.push(payload));

        await youtubePlatform.connectToYouTubeStream('abc123');

        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    platform: 'youtube',
                    type: 'chat-connected',
                    data: expect.objectContaining({
                        platform: 'youtube',
                        videoId: 'abc123',
                        connectionId: 'youtube-abc123'
                    })
                })
            ])
        );
    });

    it('emits stream-status when the first YouTube stream becomes live', async () => {
        const mockConnectionManager = {
            hasConnection: jest.fn().mockReturnValue(false),
            connectToStream: jest.fn().mockResolvedValue(true),
            getConnectionCount: jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(1),
            getConnectionId: jest.fn().mockReturnValue('youtube-abc123')
        };

        const youtubePlatform = new YouTubePlatform(
            {
                enableAPI: false,
                username: 'creator',
                viewerCountEnabled: true
            },
            { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }, streamDetectionService: { detectLiveStreams: jest.fn() } }
        );

        youtubePlatform.connectionManager = mockConnectionManager;

        const events = [];
        youtubePlatform.on('platform:event', (payload) => events.push(payload));

        await youtubePlatform.connectToYouTubeStream('abc123');

        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    platform: 'youtube',
                    type: 'stream-status',
                    data: expect.objectContaining({
                        platform: 'youtube',
                        isLive: true,
                        videoId: 'abc123'
                    })
                })
            ])
        );
    });

    it('emits stream-status when the last YouTube stream disconnects', async () => {
        const mockConnectionManager = {
            hasConnection: jest.fn().mockReturnValue(true),
            disconnectFromStream: jest.fn().mockResolvedValue(true),
            getConnectionCount: jest.fn().mockReturnValueOnce(1).mockReturnValueOnce(0)
        };

        const youtubePlatform = new YouTubePlatform(
            {
                enableAPI: false,
                username: 'creator',
                viewerCountEnabled: true
            },
            { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }, streamDetectionService: { detectLiveStreams: jest.fn() } }
        );

        youtubePlatform.connectionManager = mockConnectionManager;

        const events = [];
        youtubePlatform.on('platform:event', (payload) => events.push(payload));

        await youtubePlatform.disconnectFromYouTubeStream('abc123', 'stream ended');

        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    platform: 'youtube',
                    type: 'stream-status',
                    data: expect.objectContaining({
                        platform: 'youtube',
                        isLive: false,
                        videoId: 'abc123',
                        reason: 'stream ended'
                    })
                })
            ])
        );
    });
});
