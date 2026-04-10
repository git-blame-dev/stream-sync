const { describe, it, expect, afterEach } = require('bun:test');
export {};
const { createMockFn, restoreAllMocks } = require('../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../helpers/mock-factories');
const { YouTubePlatform } = require('../../../../src/platforms/youtube');
const { DEFAULT_AVATAR_URL } = require('../../../../src/constants/avatar');

const FALLBACK_AVATAR_URL = DEFAULT_AVATAR_URL;

const createStreamDetectionService = (overrides = {}) => ({
    detectLiveStreams: createMockFn().mockResolvedValue({
        success: true,
        videoIds: [],
        detectionMethod: 'mock'
    }),
    ...overrides
});

const createPlatform = (overrides = {}) => {
    const logger = overrides.logger || noOpLogger;
    const streamDetectionService = overrides.streamDetectionService || createStreamDetectionService();

    const dependencies = {
        logger,
        streamDetectionService,
        notificationManager: overrides.notificationManager || {
            emit: createMockFn(),
            on: createMockFn(),
            removeListener: createMockFn()
        },
        USER_AGENTS: ['test-agent'],
        Innertube: null,
        ...overrides
    };

    return new YouTubePlatform(
        { enabled: true, username: 'test-channel' },
        dependencies
    );
};

describe('YouTubePlatform behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('throws when dependencies argument is not an object', () => {
        expect(() => new YouTubePlatform({}, 'bad')).toThrow('Dependencies should be a single object');
    });

    it('throws when dependencies argument is a number', () => {
        expect(() => new YouTubePlatform({}, 123)).toThrow('Dependencies should be a single object');
    });

    it('connects to live videos and uses connection manager', async () => {
        const streamDetectionService = createStreamDetectionService({
            detectLiveStreams: createMockFn().mockResolvedValue({
                success: true,
                videoIds: ['v1'],
                detectionMethod: 'mock'
            })
        });

        const platform = createPlatform({ streamDetectionService });
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

    it('fails fast when stream detection throws', async () => {
        const streamDetectionService = createStreamDetectionService({
            detectLiveStreams: createMockFn().mockRejectedValue(new Error('detection failed'))
        });

        const platform = createPlatform({ streamDetectionService });
        platform.startMultiStreamMonitoring = createMockFn().mockImplementation(async () => {
            await platform.checkMultiStream({ throwOnError: true });
        });

        await expect(platform.initialize({})).rejects.toThrow();
    });

    it('emits platform events and invokes handler map', () => {
        const platform = createPlatform();
        const handlerCalls = [];
        platform.handlers.onChat = (payload) => handlerCalls.push(payload);
        const emittedEvents = [];
        platform.on('platform:event', (event) => emittedEvents.push(event));

        platform._emitPlatformEvent('platform:chat-message', {
            platform: 'youtube',
            type: 'chat:event',
            message: { text: 'hi' }
        });

        expect(handlerCalls).toHaveLength(1);
        expect(emittedEvents).toHaveLength(1);
        expect(emittedEvents[0]).toMatchObject({
            type: 'platform:chat-message',
            data: expect.objectContaining({ message: { text: 'hi' } })
        });
    });

    it('skips remove/delete chat actions in message filtering', () => {
        const platform = createPlatform();
        const skipTypes = [
            'RemoveChatItemAction',
            'RemoveChatItemByAuthorAction',
            'MarkChatItemsByAuthorAsDeletedAction'
        ];

        const results = skipTypes.map((type) => platform._shouldSkipEvent({ type }));

        expect(results).toEqual([true, true, true]);
    });

    it('emits monetization events with canonical avatarUrl from author thumbnail', async () => {
        const platform = createPlatform();
        const giftEvents = [];
        platform.handlers.onGift = (payload) => giftEvents.push(payload);

        await platform.handleSuperChat({
            item: {
                type: 'LiveChatPaidMessage',
                id: 'LCC.avatar-test-superchat',
                timestamp_usec: '1700000000000000',
                purchase_amount: 5,
                purchase_currency: 'USD',
                author: {
                    id: 'UC_TEST_CHANNEL_AVATAR',
                    name: 'AvatarViewer',
                    thumbnails: [{ url: 'https://example.invalid/youtube-monetization-avatar.jpg' }]
                },
                message: { text: 'Avatar super chat' }
            }
        });

        expect(giftEvents).toHaveLength(1);
        expect(giftEvents[0].avatarUrl).toBe('https://example.invalid/youtube-monetization-avatar.jpg');
    });

    it('emits fallback avatarUrl for super chat when author thumbnail is missing', async () => {
        const platform = createPlatform();
        const giftEvents = [];
        platform.handlers.onGift = (payload) => giftEvents.push(payload);

        await platform.handleSuperChat({
            item: {
                type: 'LiveChatPaidMessage',
                id: 'LCC.avatar-fallback-superchat',
                timestamp_usec: '1700000000000000',
                purchase_amount: 5,
                purchase_currency: 'USD',
                author: {
                    id: 'UC_TEST_CHANNEL_NO_AVATAR',
                    name: 'NoAvatarViewer',
                    thumbnails: []
                },
                message: { text: 'Fallback super chat' }
            }
        });

        expect(giftEvents).toHaveLength(1);
        expect(giftEvents[0].avatarUrl).toBe(FALLBACK_AVATAR_URL);
    });

    it('emits fallback avatarUrl on degraded super chat error payloads', async () => {
        const platform = createPlatform();
        const giftEvents = [];
        platform.handlers.onGift = (payload) => giftEvents.push(payload);

        await platform.handleSuperChat({
            item: {
                type: 'LiveChatPaidMessage',
                id: 'LCC.avatar-fallback-superchat-error',
                timestamp_usec: '1700000000000000',
                author: {
                    id: 'UC_TEST_CHANNEL_NO_AVATAR_ERROR',
                    name: 'NoAvatarErrorViewer',
                    thumbnails: []
                },
                message: { text: 'Fallback super chat error' }
            }
        });

        expect(giftEvents).toHaveLength(1);
        expect(giftEvents[0].isError).toBe(true);
        expect(giftEvents[0].avatarUrl).toBe(FALLBACK_AVATAR_URL);
    });

    it('emits fallback avatarUrl for chat messages when thumbnail is missing', () => {
        const platform = createPlatform();
        const chatEvents = [];
        platform.handlers.onChat = (payload) => chatEvents.push(payload);

        platform.handleChatTextMessage({
            item: {
                type: 'LiveChatTextMessage',
                id: 'LCC.chat-avatar-fallback',
                timestamp_usec: '1700000000000000',
                author: {
                    id: 'UC_TEST_CHAT_NO_AVATAR',
                    name: 'NoAvatarChatUser',
                    is_moderator: false,
                    badges: [],
                    thumbnails: []
                },
                message: { text: 'Chat fallback avatar message' }
            }
        });

        expect(chatEvents).toHaveLength(1);
        expect(chatEvents[0].avatarUrl).toBe(FALLBACK_AVATAR_URL);
    });

    it('emits badgeImages for chat messages when author badges include custom thumbnails', () => {
        const platform = createPlatform();
        const chatEvents = [];
        platform.handlers.onChat = (payload) => chatEvents.push(payload);

        platform.handleChatTextMessage({
            item: {
                type: 'LiveChatTextMessage',
                id: 'LCC.chat-badge-images',
                timestamp_usec: '1700000000000000',
                author: {
                    id: 'test-user-id-chat-badges',
                    name: 'test-badge-chat-user',
                    is_moderator: true,
                    badges: [
                        {
                            type: 'LiveChatAuthorBadge',
                            icon_type: 'MODERATOR',
                            tooltip: 'Moderator',
                            custom_thumbnail: []
                        },
                        {
                            type: 'LiveChatAuthorBadge',
                            tooltip: 'Member (6 months)',
                            custom_thumbnail: [
                                { url: 'https://example.invalid/member-s16.png', width: 16, height: 16 },
                                { url: 'https://example.invalid/member-s32.png', width: 32, height: 32 }
                            ]
                        }
                    ],
                    thumbnails: [{ url: 'https://example.invalid/youtube-chat-avatar.jpg' }]
                },
                message: { text: 'chat with member badge' }
            }
        });

        expect(chatEvents).toHaveLength(1);
        expect(chatEvents[0].badgeImages).toEqual([
            {
                imageUrl: 'https://example.invalid/member-s32.png',
                source: 'youtube',
                label: 'Member (6 months)'
            }
        ]);
    });

    it('requests one immediate refresh for duplicate terminal disconnect events', async () => {
        const platform = createPlatform();
        const refreshCalls = [];

        platform.connectionManager.getConnectionCount = createMockFn()
            .mockReturnValueOnce(1)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0);
        platform.connectionManager.disconnectFromStream = createMockFn()
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);
        platform._emitStreamStatusIfNeeded = createMockFn();
        platform._youtubeMultiStreamManager.requestImmediateRefresh = createMockFn(async (context) => {
            refreshCalls.push(context);
        });

        const first = await platform.disconnectFromYouTubeStream('video-1', 'stream ended', {
            requestImmediateRefresh: true,
            source: 'livechat-end'
        });
        const second = await platform.disconnectFromYouTubeStream('video-1', 'stream ended', {
            requestImmediateRefresh: true,
            source: 'livechat-end'
        });

        expect(first).toBe(true);
        expect(second).toBe(false);
        expect(refreshCalls).toEqual([{ videoId: 'video-1', reason: 'stream ended', source: 'livechat-end' }]);
    });

    it('does not request immediate refresh without explicit context', async () => {
        const platform = createPlatform();
        platform.connectionManager.getConnectionCount = createMockFn().mockReturnValue(1);
        platform.connectionManager.disconnectFromStream = createMockFn().mockResolvedValue(true);
        platform._emitStreamStatusIfNeeded = createMockFn();
        const refreshSpy = createMockFn().mockResolvedValue(undefined);
        platform._youtubeMultiStreamManager.requestImmediateRefresh = refreshSpy;

        await platform.disconnectFromYouTubeStream('video-2', 'stream ended');

        expect(refreshSpy).toHaveBeenCalledTimes(0);
    });

    it('does not block disconnect completion when refresh is requested during active check', async () => {
        const platform = createPlatform();
        let resolveRefresh = (..._args) => {};
        const refreshPromise = new Promise((resolve) => {
            resolveRefresh = resolve;
        });

        platform.connectionManager.getConnectionCount = createMockFn().mockReturnValue(1);
        platform.connectionManager.disconnectFromStream = createMockFn().mockResolvedValue(true);
        platform._emitStreamStatusIfNeeded = createMockFn();
        platform._handleConnectionErrorLogging = createMockFn();
        platform._youtubeMultiStreamManager.isCheckInProgress = createMockFn().mockReturnValue(true);
        platform._youtubeMultiStreamManager.requestImmediateRefresh = createMockFn(() => refreshPromise);

        const disconnectPromise = platform.disconnectFromYouTubeStream('video-3', 'stream ended', {
            requestImmediateRefresh: true,
            source: 'stream-reconciler'
        });

        let settled = false;
        disconnectPromise.then(() => {
            settled = true;
        });

        await Promise.resolve();
        await Promise.resolve();

        expect(settled).toBe(true);

        resolveRefresh();
        await disconnectPromise;
    });
});
