const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { unmockModule, restoreAllModuleMocks, resetModules } = require('../../helpers/bun-module-mocks');
const { noOpLogger } = require('../../helpers/mock-factories');

unmockModule('../../../src/platforms/youtube');

const { YouTubePlatform } = require('../../../src/platforms/youtube');

const createTimestampService = () => ({
    extractTimestamp: createMockFn().mockReturnValue('2024-01-01T00:00:00.000Z')
});

const createStreamDetectionService = () => ({
    detectLiveStreams: createMockFn().mockResolvedValue({
        success: true,
        videoIds: [],
        detectionMethod: 'mock'
    })
});

const createPlatform = (overrides = {}) => {
    const logger = overrides.logger || noOpLogger;
    const streamDetectionService = overrides.streamDetectionService || createStreamDetectionService();
    const timestampService = overrides.timestampService || createTimestampService();

    const dependencies = {
        USER_AGENTS: ['test-agent'],
        Innertube: null,
        logger,
        streamDetectionService,
        timestampService,
        viewerService: overrides.viewerService || null,
        notificationDispatcher: overrides.notificationDispatcher,
        ChatFileLoggingService: overrides.ChatFileLoggingService,
        notificationManager: overrides.notificationManager || {
            emit: createMockFn(),
            on: createMockFn(),
            removeListener: createMockFn()
        }
    };

    const platform = new YouTubePlatform({ enabled: true, username: 'test-channel' }, dependencies);
    platform.startMultiStreamMonitoring = createMockFn().mockResolvedValue();

    if (!platform.connectionManager) {
        platform.connectionManager = {
            connectToStream: createMockFn().mockResolvedValue(true),
            getConnectionCount: createMockFn().mockReturnValue(0),
            getAllVideoIds: createMockFn().mockReturnValue([]),
            getActiveVideoIds: createMockFn().mockReturnValue([]),
            hasConnection: createMockFn().mockReturnValue(false),
            disconnectFromStream: createMockFn().mockResolvedValue(true),
            cleanupAllConnections: createMockFn().mockResolvedValue(),
            removeConnection: createMockFn()
        };
    } else {
        platform.connectionManager.connectToStream = createMockFn().mockResolvedValue(true);
        platform.connectionManager.getConnectionCount = createMockFn().mockReturnValue(0);
        platform.connectionManager.getAllVideoIds = createMockFn().mockReturnValue([]);
        platform.connectionManager.getActiveVideoIds = createMockFn().mockReturnValue([]);
        platform.connectionManager.hasConnection = createMockFn().mockReturnValue(false);
        platform.connectionManager.disconnectFromStream = createMockFn().mockResolvedValue(true);
        platform.connectionManager.cleanupAllConnections = createMockFn().mockResolvedValue();
        platform.connectionManager.removeConnection = createMockFn();
    }

    if (!platform.connectionStateManager) {
        platform.connectionStateManager = {
            markConnecting: createMockFn(),
            markConnected: createMockFn(),
            markError: createMockFn()
        };
    } else {
        platform.connectionStateManager.markConnecting = createMockFn();
        platform.connectionStateManager.markConnected = createMockFn();
        platform.connectionStateManager.markError = createMockFn();
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

    return { platform, logger, streamDetectionService, timestampService };
};

describe('YouTubePlatform modern architecture', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    it('emits aggregated viewer counts as platform events after stream updates', () => {
        const { platform } = createPlatform();
        const received = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === 'platform:viewer-count') {
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

    it('emits platform:event error with context and metadata', () => {
        const { platform } = createPlatform();
        const received = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === 'platform:error') {
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
            type: 'platform:error',
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

    it('emits platform chat events for normalized chat items', async () => {
        const { platform } = createPlatform();
        const received = new Promise((resolve) => {
            const handler = (payload) => {
                if (payload.type !== 'platform:chat-message') {
                    return;
                }
                platform.removeListener('platform:event', handler);
                resolve(payload.data);
            };
            platform.on('platform:event', handler);
        });

        const chatItem = {
            id: 'test-msg-1',
            videoId: 'vid-1',
            author: { id: 'user-123', name: 'TestUser' },
            message: { runs: [{ text: 'Hello world' }] }
        };

        platform._processRegularChatMessage(chatItem, 'TestUser');

        const payload = await received;
        expect(payload.platform).toBe('youtube');
        expect(payload.message.text).toBe('Hello world');
        expect(payload.metadata.videoId).toBe('vid-1');
    });

    it('emits chat connected event when connectToYouTubeStream succeeds', async () => {
        const mockConnectionManager = {
            hasConnection: createMockFn().mockReturnValue(false),
            connectToStream: createMockFn().mockResolvedValue(true),
            getConnectionCount: createMockFn().mockReturnValueOnce(0).mockReturnValueOnce(1),
            getConnectionId: createMockFn().mockReturnValue('youtube-abc123')
        };

        const youtubePlatform = new YouTubePlatform(
            { enableAPI: false, username: 'creator', viewerCountEnabled: true },
            { logger: noOpLogger, streamDetectionService: createStreamDetectionService() }
        );

        youtubePlatform.connectionManager = mockConnectionManager;
        const events = [];
        youtubePlatform.on('platform:event', (payload) => events.push(payload));

        await youtubePlatform.connectToYouTubeStream('abc123');

        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    platform: 'youtube',
                    type: 'platform:stream-status',
                    data: expect.objectContaining({
                        platform: 'youtube',
                        isLive: true
                    })
                })
            ])
        );
    });

    it('emits stream-status when the first YouTube stream becomes live', async () => {
        const mockConnectionManager = {
            hasConnection: createMockFn().mockReturnValue(false),
            connectToStream: createMockFn().mockResolvedValue(true),
            getConnectionCount: createMockFn().mockReturnValueOnce(0).mockReturnValueOnce(1),
            getConnectionId: createMockFn().mockReturnValue('youtube-abc123')
        };

        const youtubePlatform = new YouTubePlatform(
            { enableAPI: false, username: 'creator', viewerCountEnabled: true },
            { logger: noOpLogger, streamDetectionService: createStreamDetectionService() }
        );

        youtubePlatform.connectionManager = mockConnectionManager;
        const events = [];
        youtubePlatform.on('platform:event', (payload) => events.push(payload));

        await youtubePlatform.connectToYouTubeStream('abc123');

        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    platform: 'youtube',
                    type: 'platform:stream-status',
                    data: expect.objectContaining({
                        platform: 'youtube',
                        isLive: true
                    })
                })
            ])
        );
    });

    it('emits stream-status when the last YouTube stream disconnects', async () => {
        const mockConnectionManager = {
            hasConnection: createMockFn().mockReturnValue(true),
            disconnectFromStream: createMockFn().mockResolvedValue(true),
            getConnectionCount: createMockFn().mockReturnValueOnce(1).mockReturnValueOnce(0)
        };

        const youtubePlatform = new YouTubePlatform(
            { enableAPI: false, username: 'creator', viewerCountEnabled: true },
            { logger: noOpLogger, streamDetectionService: createStreamDetectionService() }
        );

        youtubePlatform.connectionManager = mockConnectionManager;
        const events = [];
        youtubePlatform.on('platform:event', (payload) => events.push(payload));

        await youtubePlatform.disconnectFromYouTubeStream('abc123', 'stream ended');

        expect(events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    platform: 'youtube',
                    type: 'platform:stream-status',
                    data: expect.objectContaining({
                        platform: 'youtube',
                        isLive: false
                    })
                })
            ])
        );
    });
});
