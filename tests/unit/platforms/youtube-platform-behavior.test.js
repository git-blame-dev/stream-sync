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

const getDebugCalls = (logger) => logger.debug.mock.calls.map(([message, _scope, metadata]) => ({
    message,
    metadata: metadata || null
}));
const createLogger = () => ({
    debug: createMockFn(),
    info: createMockFn(),
    warn: createMockFn(),
    error: createMockFn()
});
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

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
            item: {
                id: 'test-msg-1',
                timestampUsec: '1700000000000000',
                author: { id: 'user-123', name: 'TestUser' },
                message: { runs: [{ text: 'Hello world' }] }
            },
            videoId: 'vid-1'
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

    it('ignores gift redemption announcements with fallback logging', async () => {
        const logger = createLogger();
        const { platform } = createPlatform({ logger });
        platform.logRawPlatformData = createMockFn().mockResolvedValue();

        platform.handleChatMessage({
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatSponsorshipsGiftRedemptionAnnouncement',
                id: 'test-gift-redemption-unknown',
                timestampUsec: '1704067203000000',
                author: {
                    id: 'UC_TEST_CHANNEL_000100',
                    name: 'N/A'
                }
            }
        });

        expect(platform.logRawPlatformData).toHaveBeenCalledTimes(0);
        const debugCalls = getDebugCalls(logger);
        const giftLog = debugCalls.find(({ message }) =>
            message.includes('ignored gifted membership announcement for Unknown User')
        );
        expect(giftLog).toBeTruthy();
        expect(giftLog.metadata).toMatchObject({
            action: 'ignored_gifted_membership_announcement',
            recipient: 'Unknown User',
            eventType: 'LiveChatSponsorshipsGiftRedemptionAnnouncement'
        });
    });

    it('logs renderer variants as ignored duplicates', async () => {
        const logger = createLogger();
        const { platform } = createPlatform({ logger });
        platform.logRawPlatformData = createMockFn().mockResolvedValue();

        platform.handleChatMessage({
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatPaidMessageRenderer',
                id: 'test-renderer-duplicate',
                timestampUsec: '1704067204000000',
                author: {
                    id: 'UC_TEST_CHANNEL_000200',
                    name: '@testRenderer'
                }
            }
        });

        expect(platform.logRawPlatformData).toHaveBeenCalledTimes(0);
        const debugCalls = getDebugCalls(logger);
        const duplicateLog = debugCalls.find(({ message }) =>
            message.includes('ignored duplicate LiveChatPaidMessageRenderer')
        );
        expect(duplicateLog).toBeTruthy();
        expect(duplicateLog.metadata).toMatchObject({
            action: 'ignored_duplicate',
            eventType: 'LiveChatPaidMessageRenderer',
            author: 'testRenderer'
        });
    });

    it('routes async handler failures through _handleProcessingError', async () => {
        const logger = createLogger();
        const { platform } = createPlatform({ logger });
        const handlerError = new Error('dispatch failed');
        platform._cachedEventDispatchTable = {
            LiveChatPaidMessage: () => Promise.reject(handlerError)
        };
        platform._handleProcessingError = createMockFn();

        const unhandled = [];
        const listener = (error) => unhandled.push(error);
        process.on('unhandledRejection', listener);

        try {
            await platform.handleChatMessage({
                item: {
                    type: 'LiveChatPaidMessage',
                    id: 'LCC.test-async-error',
                    timestampUsec: '1704067205000000',
                    author: {
                        id: 'UC_TEST_CHANNEL_000400',
                        name: 'AsyncTester'
                    }
                }
            });
            await flushPromises();
        } finally {
            process.off('unhandledRejection', listener);
        }

        expect(platform._handleProcessingError).toHaveBeenCalledTimes(1);
        const [message, error, eventType] = platform._handleProcessingError.mock.calls[0];
        expect(message).toContain('Error handling event type LiveChatPaidMessage');
        expect(error).toBe(handlerError);
        expect(eventType).toBe('LiveChatPaidMessage');
        expect(unhandled).toHaveLength(0);
    });

    it('emits error notification when gift purchase header author is missing', () => {
        const notificationDispatcher = {
            dispatchErrorNotification: createMockFn().mockResolvedValue(true)
        };
        const { platform } = createPlatform({ notificationDispatcher });
        platform.baseEventHandler = { handleEvent: createMockFn() };

        const chatItem = {
            item: {
                type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement',
                id: 'LCC.test-gift-purchase-missing-author',
                timestampUsec: '1700000000000000',
                giftMembershipsCount: 3,
                header: {
                    type: 'LiveChatSponsorshipsHeader'
                }
            }
        };

        platform.handleChatMessage(chatItem);

        const [errorCall] = notificationDispatcher.dispatchErrorNotification.mock.calls;
        expect(errorCall).toBeTruthy();
        expect(errorCall[0]).toBe(chatItem);
        expect(errorCall[1]).toBe('platform:giftpaypiggy');
        expect(errorCall[2]).toBe(platform.handlers?.onGiftPaypiggy);
        expect(errorCall[3]).toBe('onGiftPaypiggy');
        expect(errorCall[4]).toMatchObject({ giftCount: 3 });
        expect(platform.baseEventHandler.handleEvent).toHaveBeenCalledTimes(0);
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
