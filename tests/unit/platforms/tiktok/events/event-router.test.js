const { describe, test, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const {
    cleanupTikTokEventListeners,
    setupTikTokEventListeners
} = require('../../../../../src/platforms/tiktok/events/event-router');

describe('TikTok event router', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const createPlatformHarness = (overrides = {}) => {
        const listeners = {};
        const emitted = [];
        const handledChatMessages = [];

        const connection = {
            on: createMockFn((eventName, handler) => {
                listeners[eventName] = handler;
            }),
            removeAllListeners: createMockFn()
        };

        const platform = {
            listenersConfigured: false,
            connection,
            WebcastEvent: {
                CHAT: 'chat',
                GIFT: 'gift',
                FOLLOW: 'follow',
                SOCIAL: 'social',
                ROOM_USER: 'roomUser',
                ENVELOPE: 'envelope',
                SUBSCRIBE: 'subscribe',
                SUPER_FAN: 'superfan',
                ERROR: 'error',
                DISCONNECT: 'disconnect',
                STREAM_END: 'streamEnd'
            },
            ControlEvent: {
                CONNECTED: 'connected',
                DISCONNECTED: 'disconnected',
                ERROR: 'control-error'
            },
            platformName: 'tiktok',
            timestampService: null,
            selfMessageDetectionService: null,
            config: { dataLoggingEnabled: false },
            logger: noOpLogger,
            errorHandler: {
                handleConnectionError: createMockFn(),
                handleEventProcessingError: createMockFn(),
                handleCleanupError: createMockFn()
            },
            constructor: {
                resolveEventTimestampMs: createMockFn(() => null)
            },
            _logIncomingEvent: createMockFn().mockResolvedValue(),
            _emitPlatformEvent: (type, payload) => emitted.push({ type, payload }),
            _handleStandardEvent: createMockFn().mockResolvedValue(),
            _handleStreamEnd: createMockFn(),
            handleConnectionIssue: createMockFn(),
            handleConnectionError: createMockFn(),
            handleRetry: createMockFn(),
            handleTikTokGift: createMockFn().mockResolvedValue(),
            handleTikTokFollow: createMockFn().mockResolvedValue(),
            handleTikTokSocial: createMockFn().mockResolvedValue(),
            connectionActive: false,
            cachedViewerCount: 0,
            connectionTime: 0,
            _getTimestamp: createMockFn(() => '2025-01-02T03:04:05.000Z'),
            _handleChatMessage: async () => handledChatMessages.push(true),
            ...overrides
        };

        return { platform, connection, listeners, emitted, handledChatMessages };
    };

    test('caches viewer count and emits viewer-count', async () => {
        const { platform, listeners, emitted } = createPlatformHarness();

        setupTikTokEventListeners(platform);

        await listeners[platform.WebcastEvent.ROOM_USER]({ viewerCount: 42 });

        expect(platform.cachedViewerCount).toBe(42);
        expect(emitted.some((entry) => entry.type === 'platform:viewer-count' && entry.payload.count === 42)).toBe(true);
    });

    test('throws when connection is missing', () => {
        const errorHandler = { handleConnectionError: createMockFn() };
        const platform = {
            listenersConfigured: false,
            connection: null,
            errorHandler
        };

        expect(() => setupTikTokEventListeners(platform)).toThrow('TikTok connection missing connection object');
        expect(errorHandler.handleConnectionError.mock.calls).toHaveLength(1);
    });

    test('throws when connection lacks event emitter methods', () => {
        const errorHandler = { handleConnectionError: createMockFn() };
        const platform = {
            listenersConfigured: false,
            connection: {},
            errorHandler
        };

        expect(() => setupTikTokEventListeners(platform)).toThrow(
            'TikTok connection missing event emitter interface (on/removeAllListeners)'
        );
        expect(errorHandler.handleConnectionError.mock.calls).toHaveLength(1);
    });

    test('cleans up listeners when removeAllListeners is missing', () => {
        const platform = {
            connection: {},
            listenersConfigured: true
        };

        cleanupTikTokEventListeners(platform);

        expect(platform.listenersConfigured).toBe(false);
    });

    test('removes listeners for all known event types', () => {
        const removeAllListeners = createMockFn();
        const platform = {
            connection: { removeAllListeners },
            listenersConfigured: true,
            WebcastEvent: {
                CHAT: 'chat',
                GIFT: 'gift',
                FOLLOW: 'follow',
                ROOM_USER: 'roomUser',
                ENVELOPE: 'envelope',
                SUBSCRIBE: 'subscribe',
                SUPER_FAN: 'superfan',
                SOCIAL: 'social',
                ERROR: 'error',
                DISCONNECT: 'disconnect',
                STREAM_END: 'streamEnd'
            },
            ControlEvent: {
                CONNECTED: 'connected',
                DISCONNECTED: 'disconnected',
                ERROR: 'control-error'
            },
            errorHandler: { handleCleanupError: createMockFn() }
        };

        cleanupTikTokEventListeners(platform);

        expect(removeAllListeners.mock.calls.length).toBe(14);
        expect(platform.listenersConfigured).toBe(false);
    });

    test('processes valid chat messages end-to-end', async () => {
        const timestampService = { extractTimestamp: () => '2025-01-02T03:04:05.000Z' };
        const selfMessageDetectionService = { shouldFilterMessage: createMockFn(() => false) };
        const { platform, listeners, handledChatMessages } = createPlatformHarness({
            timestampService,
            selfMessageDetectionService
        });

        setupTikTokEventListeners(platform);

        await listeners[platform.WebcastEvent.CHAT]({
            comment: 'hello stream',
            user: { userId: 'test-user-1', uniqueId: 'testuser', nickname: 'TestUser' },
            common: { createTime: '1700000000' },
            isModerator: false,
            isSubscriber: false,
            isOwner: false
        });

        expect(handledChatMessages).toHaveLength(1);
        expect(selfMessageDetectionService.shouldFilterMessage.mock.calls).toHaveLength(1);
    });

    test('filters historical chat messages based on connection time', async () => {
        const timestampService = { extractTimestamp: () => '2025-01-02T03:04:05.000Z' };
        const { platform, listeners, handledChatMessages } = createPlatformHarness({
            timestampService,
            connectionTime: 2000,
            constructor: {
                resolveEventTimestampMs: createMockFn(() => 1000)
            }
        });

        setupTikTokEventListeners(platform);

        await listeners[platform.WebcastEvent.CHAT]({
            comment: 'late message',
            user: { userId: 'test-user-2', uniqueId: 'testuser2', nickname: 'TestUser2' },
            common: { createTime: '1700000000' },
            isModerator: false,
            isSubscriber: false,
            isOwner: false
        });

        expect(handledChatMessages).toHaveLength(0);
    });

    test('filters self messages when detection service blocks', async () => {
        const timestampService = { extractTimestamp: () => '2025-01-02T03:04:05.000Z' };
        const selfMessageDetectionService = { shouldFilterMessage: createMockFn(() => true) };
        const { platform, listeners, handledChatMessages } = createPlatformHarness({
            timestampService,
            selfMessageDetectionService
        });

        setupTikTokEventListeners(platform);

        await listeners[platform.WebcastEvent.CHAT]({
            comment: 'self message',
            user: { userId: 'test-user-3', uniqueId: 'selfuser', nickname: 'SelfUser' },
            common: { createTime: '1700000000' },
            isModerator: false,
            isSubscriber: false,
            isOwner: true
        });

        expect(handledChatMessages).toHaveLength(0);
        expect(selfMessageDetectionService.shouldFilterMessage.mock.calls).toHaveLength(1);
    });

    test('routes non-chat events to platform handlers', async () => {
        const { platform, listeners } = createPlatformHarness();

        setupTikTokEventListeners(platform);

        await listeners[platform.WebcastEvent.GIFT]({ id: 'gift-1' });
        await listeners[platform.WebcastEvent.FOLLOW]({ id: 'follow-1' });
        await listeners[platform.WebcastEvent.ENVELOPE]({ id: 'envelope-1' });
        await listeners[platform.WebcastEvent.SUBSCRIBE]({ id: 'sub-1' });
        await listeners[platform.WebcastEvent.SUPER_FAN]({ id: 'fan-1' });
        await listeners[platform.WebcastEvent.SOCIAL]({ id: 'social-1' });

        expect(platform.handleTikTokGift.mock.calls).toHaveLength(1);
        expect(platform.handleTikTokFollow.mock.calls).toHaveLength(1);
        expect(platform.handleTikTokSocial.mock.calls).toHaveLength(1);
        expect(platform._handleStandardEvent.mock.calls).toHaveLength(3);
        expect(platform._handleStandardEvent.mock.calls[0][0]).toBe('envelope');
        expect(platform._handleStandardEvent.mock.calls[1][0]).toBe('paypiggy');
        expect(platform._handleStandardEvent.mock.calls[2][0]).toBe('paypiggy');
    });

    test('handles connection lifecycle events', async () => {
        const { platform, listeners } = createPlatformHarness({ connectionActive: true });

        setupTikTokEventListeners(platform);

        listeners[platform.ControlEvent.DISCONNECTED]('bye');
        listeners[platform.ControlEvent.ERROR](new Error('control-error'));
        listeners[platform.WebcastEvent.ERROR](new Error('webcast-error'));
        listeners[platform.WebcastEvent.DISCONNECT]();
        await listeners[platform.WebcastEvent.STREAM_END]({});

        expect(platform.handleConnectionIssue.mock.calls).toHaveLength(1);
        expect(platform.handleConnectionError.mock.calls).toHaveLength(1);
        expect(platform.handleRetry.mock.calls).toHaveLength(1);
        expect(platform.connectionActive).toBe(false);
        expect(platform._handleStreamEnd.mock.calls).toHaveLength(1);
    });

    test('warns when room user payload has no timestamp', async () => {
        const { platform, listeners, emitted } = createPlatformHarness({
            _getTimestamp: createMockFn(() => null)
        });

        setupTikTokEventListeners(platform);

        await listeners[platform.WebcastEvent.ROOM_USER]({ viewerCount: 12 });

        expect(emitted).toHaveLength(0);
        expect(platform.cachedViewerCount).toBe(12);
    });

    test('skips chat event when comment is invalid', async () => {
        const { platform, listeners, handledChatMessages } = createPlatformHarness();

        setupTikTokEventListeners(platform);

        await listeners[platform.WebcastEvent.CHAT]({ comment: 123 });

        expect(handledChatMessages).toHaveLength(0);
    });

    test('registers listeners only for supported events', () => {
        const { platform, listeners } = createPlatformHarness();

        setupTikTokEventListeners(platform);

        const registered = Object.keys(listeners).sort();
        const expected = [
            platform.WebcastEvent.CHAT,
            platform.WebcastEvent.GIFT,
            platform.WebcastEvent.FOLLOW,
            platform.WebcastEvent.SOCIAL,
            platform.WebcastEvent.ROOM_USER,
            platform.WebcastEvent.ENVELOPE,
            platform.WebcastEvent.SUBSCRIBE,
            platform.WebcastEvent.SUPER_FAN,
            platform.WebcastEvent.ERROR,
            platform.WebcastEvent.DISCONNECT,
            platform.WebcastEvent.STREAM_END,
            platform.ControlEvent.DISCONNECTED,
            platform.ControlEvent.ERROR,
            'rawData'
        ].sort();

        expect(registered).toEqual(expected);
    });

    test('logs rawData payloads without trimming the envelope', async () => {
        const { platform, listeners } = createPlatformHarness();

        setupTikTokEventListeners(platform);

        const payload = {
            type: 'chat',
            data: { comment: 'hello' },
            envelope: { source: 'sdk' }
        };

        await listeners.rawData(payload);

        expect(platform._logIncomingEvent.mock.calls).toHaveLength(1);
        expect(platform._logIncomingEvent.mock.calls[0][0]).toBe('chat');
        expect(platform._logIncomingEvent.mock.calls[0][1]).toBe(payload);
    });
});
