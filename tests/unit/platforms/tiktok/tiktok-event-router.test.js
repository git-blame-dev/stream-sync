const { describe, test, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../helpers/bun-mock-utils');
const {
    setupTikTokEventListeners
} = require('../../../../src/platforms/tiktok/events/tiktok-event-router');

describe('TikTok event router', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const createPlatformHarness = () => {
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
            logger: {
                debug: createMockFn(),
                info: createMockFn(),
                warn: createMockFn()
            },
            errorHandler: {
                handleConnectionError: createMockFn(),
                handleEventProcessingError: createMockFn(),
                handleCleanupError: createMockFn()
            },
            _logIncomingEvent: createMockFn().mockResolvedValue(),
            _emitPlatformEvent: (type, payload) => emitted.push({ type, payload }),
            _handleStreamEnd: createMockFn(),
            handleConnectionIssue: createMockFn(),
            handleConnectionError: createMockFn(),
            handleRetry: createMockFn(),
            connectionActive: false,
            cachedViewerCount: 0,
            connectionTime: 0,
            _getTimestamp: createMockFn(() => '2025-01-02T03:04:05.000Z'),
            _handleChatMessage: async () => handledChatMessages.push(true)
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
});
