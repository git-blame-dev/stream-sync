const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../helpers/mock-factories');

const { YouTubePlatform } = require('../../../../src/platforms/youtube');

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
                timestamp: expect.any(String),
                metadata: expect.objectContaining({
                    platform: 'youtube',
                    videoId: 'video-1',
                    correlationId: expect.any(String)
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
                timestamp_usec: '1700000000000000',
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

        await platform.handleChatMessage({
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatSponsorshipsGiftRedemptionAnnouncement',
                id: 'test-gift-redemption-unknown',
                timestamp_usec: '1704067203000000',
                author: {
                    id: 'UC_TEST_CHANNEL_000100',
                    name: 'N/A'
                }
            }
        });

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

        await platform.handleChatMessage({
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatPaidMessageRenderer',
                id: 'test-renderer-duplicate',
                timestamp_usec: '1704067204000000',
                author: {
                    id: 'UC_TEST_CHANNEL_000200',
                    name: '@testRenderer'
                }
            }
        });

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

    it('catches async handler failures and logs error without unhandled rejection', async () => {
        const logger = createLogger();
        const { platform } = createPlatform({ logger });
        const handlerError = new Error('dispatch failed');
        platform.eventRouter = {
            routeEvent: createMockFn().mockRejectedValue(handlerError)
        };

        const errorHandlerCalls = [];
        platform.errorHandler = {
            handleEventProcessingError: (error, eventType, eventData, message) => {
                errorHandlerCalls.push({ error, eventType, eventData, message });
            }
        };

        const unhandled = [];
        const listener = (error) => unhandled.push(error);
        process.on('unhandledRejection', listener);

        try {
            await platform.handleChatMessage({
                item: {
                    type: 'LiveChatPaidMessage',
                    id: 'LCC.test-async-error',
                    timestamp_usec: '1704067205000000',
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

        expect(unhandled).toHaveLength(0);
        expect(errorHandlerCalls).toHaveLength(1);
        expect(errorHandlerCalls[0].error).toBe(handlerError);
        expect(errorHandlerCalls[0].eventType).toBe('LiveChatPaidMessage');
        expect(errorHandlerCalls[0].message).toContain('Error handling event type LiveChatPaidMessage');
    });

    it('emits error notification when gift purchase header author is missing', async () => {
        const { platform } = createPlatform();
        const giftErrors = [];
        platform.handlers = {
            ...platform.handlers,
            onGiftPaypiggy: (payload) => giftErrors.push(payload)
        };

        const chatItem = {
            item: {
                type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement',
                id: 'LCC.test-gift-purchase-missing-author',
                timestamp_usec: '1700000000000000',
                giftMembershipsCount: 3,
                header: {
                    type: 'LiveChatSponsorshipsHeader'
                }
            }
        };

        await platform.handleChatMessage(chatItem);

        expect(giftErrors).toHaveLength(1);
        expect(giftErrors[0]).toMatchObject({
            type: 'platform:giftpaypiggy',
            platform: 'youtube',
            giftCount: 3,
            id: 'LCC.test-gift-purchase-missing-author',
            isError: true
        });
        expect(giftErrors[0].timestamp).toBe(new Date(1700000000000).toISOString());
        expect(giftErrors[0].username).toBeUndefined();
    });

    it('emits gift error payloads when monetization timestamps are missing', async () => {
        const { platform } = createPlatform();
        const giftErrors = [];
        platform.handlers = {
            ...platform.handlers,
            onGift: (payload) => giftErrors.push(payload)
        };

        const chatItem = {
            item: {
                type: 'LiveChatPaidMessage',
                id: 'LCC.test-superchat-missing-timestamp',
                purchase_amount: 5,
                purchase_currency: 'USD',
                author: {
                    id: 'yt-user-missing-ts',
                    name: 'TestViewer'
                },
                message: { text: 'Super chat' }
            }
        };

        await platform.handleChatMessage(chatItem);

        expect(giftErrors).toHaveLength(1);
        expect(giftErrors[0]).toMatchObject({
            type: 'platform:gift',
            platform: 'youtube',
            giftType: 'Super Chat',
            giftCount: 1,
            id: 'LCC.test-superchat-missing-timestamp',
            isError: true
        });
        expect(giftErrors[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
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

    it('removeYouTubeConnection clears active stream in viewer service when matching', () => {
        const { platform } = createPlatform();
        const clearCalled = [];
        platform.viewerService = {
            _activeStream: { videoId: 'vid-123' },
            clearActiveStream: () => clearCalled.push('cleared')
        };
        platform.connectionManager.removeConnection = createMockFn();

        platform.removeYouTubeConnection('vid-123');

        expect(clearCalled).toEqual(['cleared']);
    });

    it('removeYouTubeConnection does not clear viewer service when videoId does not match', () => {
        const { platform } = createPlatform();
        const clearCalled = [];
        platform.viewerService = {
            _activeStream: { videoId: 'other-vid' },
            clearActiveStream: () => clearCalled.push('cleared')
        };
        platform.connectionManager.removeConnection = createMockFn();

        platform.removeYouTubeConnection('vid-123');

        expect(clearCalled).toEqual([]);
    });

    it('removeYouTubeConnection completes when viewer service throws error', () => {
        const { platform } = createPlatform();
        let removeConnectionCalled = false;
        platform.viewerService = {
            _activeStream: { videoId: 'vid-123' },
            clearActiveStream: () => { throw new Error('service error'); }
        };
        platform.connectionManager.removeConnection = () => { removeConnectionCalled = true; };

        platform.removeYouTubeConnection('vid-123');

        expect(removeConnectionCalled).toBe(true);
    });

    it('disconnectFromYouTubeStream returns false when connectionManager is null', async () => {
        const { platform } = createPlatform();
        platform.connectionManager = null;

        const result = await platform.disconnectFromYouTubeStream('vid-123');

        expect(result).toBe(false);
    });

    it('getActiveYouTubeVideoIds returns empty array when connectionManager is null', () => {
        const { platform } = createPlatform();
        platform.connectionManager = null;

        const result = platform.getActiveYouTubeVideoIds();

        expect(result).toEqual([]);
    });

    it('getDetectedStreamIds returns empty array when connectionManager is null', () => {
        const { platform } = createPlatform();
        platform.connectionManager = null;

        const result = platform.getDetectedStreamIds();

        expect(result).toEqual([]);
    });

    it('getViewerCount returns 0 when provider is not available', async () => {
        const { platform } = createPlatform();
        platform.viewerCountProvider = null;

        const count = await platform.getViewerCount();

        expect(count).toBe(0);
    });

    it('getViewerCount returns 0 on provider error', async () => {
        const { platform } = createPlatform();
        platform.viewerCountProvider = {
            getViewerCount: createMockFn().mockRejectedValue(new Error('provider error'))
        };

        const count = await platform.getViewerCount();

        expect(count).toBe(0);
    });

    it('getViewerCountForVideo returns 0 when provider is not available', async () => {
        const { platform } = createPlatform();
        platform.viewerCountProvider = null;

        const count = await platform.getViewerCountForVideo('vid-123');

        expect(count).toBe(0);
    });

    it('getViewerCountForVideo returns 0 when provider lacks single-video method', async () => {
        const { platform } = createPlatform();
        platform.viewerCountProvider = {};

        const count = await platform.getViewerCountForVideo('vid-123');

        expect(count).toBe(0);
    });

    it('getViewerCountForVideo returns 0 on provider error', async () => {
        const { platform } = createPlatform();
        platform.viewerCountProvider = {
            getViewerCountForVideo: createMockFn().mockRejectedValue(new Error('provider error'))
        };

        const count = await platform.getViewerCountForVideo('vid-123');

        expect(count).toBe(0);
    });

    it('isActive returns false when isConnected throws', () => {
        const { platform } = createPlatform();
        platform.isConnected = () => { throw new Error('connection check failed'); };

        const result = platform.isActive();

        expect(result).toBe(false);
    });

    it('getHealthStatus returns degraded when no active connections and not monitoring', () => {
        const { platform } = createPlatform();
        platform.connectionManager.getConnectionCount = createMockFn().mockReturnValue(0);
        platform.monitoringInterval = null;

        const status = platform.getHealthStatus();

        expect(status.overall).toBe('degraded');
    });

    it('getHealthStatus returns idle when no connections but monitoring active', () => {
        const { platform } = createPlatform();
        platform.connectionManager.getConnectionCount = createMockFn().mockReturnValue(0);
        platform.monitoringInterval = 123;

        const status = platform.getHealthStatus();

        expect(status.overall).toBe('idle');
    });

    it('getHealthStatus returns healthy when connections exist', () => {
        const { platform } = createPlatform();
        platform.connectionManager.getConnectionCount = createMockFn().mockReturnValue(1);

        const status = platform.getHealthStatus();

        expect(status.overall).toBe('healthy');
    });

    it('cleanup handles viewerService cleanup error gracefully', async () => {
        const { platform } = createPlatform();
        platform.viewerService = {
            cleanup: () => { throw new Error('cleanup failed'); }
        };

        await platform.cleanup();

        expect(platform.isInitialized).toBe(false);
    });

    it('reconnect calls initialize with existing handlers', async () => {
        const { platform } = createPlatform();
        platform.handlers = { onChat: createMockFn() };
        const initCalls = [];
        platform.initialize = createMockFn(async (handlers) => {
            initCalls.push(handlers);
        });

        await platform.reconnect();

        expect(initCalls).toHaveLength(1);
        expect(initCalls[0]).toEqual(platform.handlers);
    });

    it('_emitStreamStatusIfNeeded does nothing when connectionManager is null', () => {
        const { platform } = createPlatform();
        platform.connectionManager = null;
        const events = [];
        platform.on('platform:event', (e) => events.push(e));

        platform._emitStreamStatusIfNeeded(0, {});

        expect(events).toEqual([]);
    });

    it('_emitStreamStatusIfNeeded does nothing when count unchanged', () => {
        const { platform } = createPlatform();
        platform.connectionManager.getConnectionCount = createMockFn().mockReturnValue(1);
        const events = [];
        platform.on('platform:event', (e) => events.push(e));

        platform._emitStreamStatusIfNeeded(1, {});

        expect(events).toEqual([]);
    });

    it('sendMessage tries all active connections and returns true on success', async () => {
        const { platform } = createPlatform();
        platform.connectionManager.getAllVideoIds = createMockFn().mockReturnValue(['v1', 'v2']);
        platform.connectionManager.getConnection = createMockFn((id) => ({
            sendMessage: createMockFn().mockResolvedValue(id === 'v2')
        }));
        platform.connectionManager.getConnectionStatus = createMockFn().mockReturnValue({ ready: true });

        const result = await platform.sendMessage('Hello');

        expect(result).toBe(true);
    });

    it('sendMessage returns false when no connections succeed', async () => {
        const { platform } = createPlatform();
        platform.connectionManager.getAllVideoIds = createMockFn().mockReturnValue(['v1']);
        platform.connectionManager.getConnection = createMockFn(() => ({
            sendMessage: createMockFn().mockResolvedValue(false)
        }));
        platform.connectionManager.getConnectionStatus = createMockFn().mockReturnValue({ ready: true });

        const result = await platform.sendMessage('Hello');

        expect(result).toBe(false);
    });

    it('sendMessage handles connection send error gracefully', async () => {
        const { platform } = createPlatform();
        platform.connectionManager.getAllVideoIds = createMockFn().mockReturnValue(['v1']);
        platform.connectionManager.getConnection = createMockFn(() => ({
            sendMessage: createMockFn().mockRejectedValue(new Error('send failed'))
        }));
        platform.connectionManager.getConnectionStatus = createMockFn().mockReturnValue({ ready: true });

        const result = await platform.sendMessage('Hello');

        expect(result).toBe(false);
    });

    it('getStatus returns isReady=false with no issues when disabled (by design)', () => {
        const { platform } = createPlatform();
        platform.config.enabled = false;

        const result = platform.getStatus();

        expect(result.isReady).toBe(false);
        expect(result.issues).toEqual([]);
    });

    it('getStatus returns issue when enabled but not connected', () => {
        const { platform } = createPlatform();
        platform.config.enabled = true;
        platform.connectionManager = { getConnectionCount: () => 0 };

        const result = platform.getStatus();

        expect(result.isReady).toBe(false);
        expect(result.issues).toContain('Not connected');
    });

    it('getNextUserAgent delegates to userAgentManager', () => {
        const { platform } = createPlatform();
        platform.userAgentManager = { getNextUserAgent: createMockFn().mockReturnValue('test-ua') };

        const result = platform.getNextUserAgent();

        expect(result).toBe('test-ua');
    });

    it('setYouTubeConnectionReady updates connection ready state', () => {
        const { platform } = createPlatform();
        let readyVideoId = null;
        platform.connectionManager.setConnectionReady = (videoId) => { readyVideoId = videoId; };

        platform.setYouTubeConnectionReady('vid-123');

        expect(readyVideoId).toBe('vid-123');
    });

    it('isAnyYouTubeStreamReady delegates to connectionManager', () => {
        const { platform } = createPlatform();
        platform.connectionManager.isAnyConnectionReady = createMockFn().mockReturnValue(true);

        const result = platform.isAnyYouTubeStreamReady();

        expect(result).toBe(true);
    });

    it('getLiveVideoIds throws when no username configured', async () => {
        const { platform } = createPlatform();
        platform.config.username = null;

        await expect(platform.getLiveVideoIds()).rejects.toThrow('No channel username provided');
    });

    it('getLiveVideoIdsByYoutubei throws when stream detection service unavailable', async () => {
        const { platform } = createPlatform();
        platform.streamDetectionService = null;

        await expect(platform.getLiveVideoIdsByYoutubei()).rejects.toThrow('Service unavailable');
    });

    it('getLiveVideoIdsByYoutubei returns empty array when no streams found', async () => {
        const { platform, streamDetectionService } = createPlatform();
        streamDetectionService.detectLiveStreams = createMockFn().mockResolvedValue({
            success: false,
            videoIds: [],
            message: 'No streams'
        });

        const result = await platform.getLiveVideoIdsByYoutubei();

        expect(result).toEqual([]);
    });

    it('getConnectionState returns state with connection info', () => {
        const { platform } = createPlatform();
        platform.connectionManager.getConnectionCount = createMockFn().mockReturnValue(1);
        platform.connectionManager.getActiveVideoIds = createMockFn().mockReturnValue(['v1']);
        platform.connectionManager.isConnectionReady = createMockFn().mockReturnValue(true);
        platform.monitoringInterval = 123;

        const state = platform.getConnectionState();

        expect(state.isConnected).toBe(true);
        expect(state.isMonitoring).toBe(true);
        expect(state.totalConnections).toBe(1);
    });

    it('getStats returns platform stats', () => {
        const { platform } = createPlatform();
        platform.connectionManager.getConnectionCount = createMockFn().mockReturnValue(2);
        platform.connectionManager.getActiveVideoIds = createMockFn().mockReturnValue(['v1', 'v2']);
        platform.connectionManager.isConnectionReady = createMockFn().mockReturnValue(true);

        const stats = platform.getStats();

        expect(stats.platform).toBe('youtube');
        expect(stats.totalConnections).toBe(2);
    });

    it('isConfigured returns true when enabled and username set', () => {
        const { platform } = createPlatform();
        platform.config.enabled = true;
        platform.config.username = 'test-user';

        expect(platform.isConfigured()).toBe(true);
    });

    it('isConfigured returns false when disabled', () => {
        const { platform } = createPlatform();
        platform.config.enabled = false;

        expect(platform.isConfigured()).toBe(false);
    });

    it('isConnected returns true when connectionManager has connections', () => {
        const { platform } = createPlatform();
        platform.connectionManager.getConnectionCount = createMockFn().mockReturnValue(1);

        expect(platform.isConnected()).toBe(true);
    });

    it('isConnected returns false when connectionManager has no connections', () => {
        const { platform } = createPlatform();
        platform.connectionManager.getConnectionCount = createMockFn().mockReturnValue(0);

        expect(platform.isConnected()).toBe(false);
    });

    it('getConnectionStatus returns current status', async () => {
        const { platform } = createPlatform();
        platform.connectionManager.getConnectionCount = createMockFn().mockReturnValue(1);

        const status = await platform.getConnectionStatus();

        expect(status.platform).toBe('youtube');
        expect(status.status).toBe('connected');
    });

    it('getTotalViewerCount sums all stream viewer counts', () => {
        const { platform } = createPlatform();
        platform.streamViewerCounts = new Map([['v1', 10], ['v2', 20]]);

        const total = platform.getTotalViewerCount();

        expect(total).toBe(30);
    });

    it('getTotalViewerCount returns 0 when no counts tracked', () => {
        const { platform } = createPlatform();
        platform.streamViewerCounts = null;

        const total = platform.getTotalViewerCount();

        expect(total).toBe(0);
    });

    it('_clearMonitoringInterval clears and nullifies interval', () => {
        const { platform } = createPlatform();
        platform.monitoringInterval = 123;
        const cleared = [];
        const originalClearInterval = global.clearInterval;
        global.clearInterval = (id) => cleared.push(id);

        platform._clearMonitoringInterval();

        global.clearInterval = originalClearInterval;
        expect(cleared).toContain(123);
        expect(platform.monitoringInterval).toBeNull();
    });

    it('handleChatTextMessage returns early when chatItem is invalid', () => {
        const { platform } = createPlatform();
        const events = [];
        platform.on('platform:event', (e) => events.push(e));

        platform.handleChatTextMessage(null);
        platform.handleChatTextMessage({ item: null });

        const chatEvents = events.filter(e => e.type === 'platform:chat-message');
        expect(chatEvents).toHaveLength(0);
    });

    it('handleChatTextMessage returns early when author name is missing', () => {
        const { platform } = createPlatform();
        const events = [];
        platform.on('platform:event', (e) => events.push(e));

        platform.handleChatTextMessage({ item: { type: 'test' } });

        const chatEvents = events.filter(e => e.type === 'platform:chat-message');
        expect(chatEvents).toHaveLength(0);
    });

    it('_handleError emits error event and triggers cleanup when shouldDisconnect', async () => {
        const { platform } = createPlatform();
        const events = [];
        platform.on('platform:event', (e) => events.push(e));
        platform.isInitialized = true;

        platform._handleError(new Error('fatal'), 'liveChatListener', { shouldEmit: true, shouldDisconnect: true });

        await new Promise(resolve => setImmediate(resolve));
        expect(events.some(e => e.type === 'platform:error')).toBe(true);
        expect(platform.isInitialized).toBe(false);
    });

    it('_generateErrorMessage returns context-specific messages', () => {
        const { platform } = createPlatform();

        expect(platform._generateErrorMessage('connectToYouTubeStream', 'v1')).toContain('Failed to connect');
        expect(platform._generateErrorMessage('liveChatListener')).toContain('live chat error');
        expect(platform._generateErrorMessage('checkMultiStream')).toContain('multi-stream');
        expect(platform._generateErrorMessage('getLiveVideoIds')).toContain('live video IDs');
        expect(platform._generateErrorMessage('unknown')).toContain('unexpected error');
    });
});
