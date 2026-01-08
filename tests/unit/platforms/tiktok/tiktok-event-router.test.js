const {
    setupTikTokEventListeners
} = require('../../../../src/platforms/tiktok/events/tiktok-event-router');

describe('TikTok event router', () => {
    const createPlatformHarness = () => {
        const listeners = {};
        const emitted = [];
        const handledChatMessages = [];

        const connection = {
            on: jest.fn((eventName, handler) => {
                listeners[eventName] = handler;
            }),
            removeAllListeners: jest.fn()
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
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn()
            },
            errorHandler: {
                handleConnectionError: jest.fn(),
                handleEventProcessingError: jest.fn(),
                handleCleanupError: jest.fn()
            },
            _logIncomingEvent: jest.fn().mockResolvedValue(),
            _emitPlatformEvent: (type, payload) => emitted.push({ type, payload }),
            _handleStreamEnd: jest.fn(),
            handleConnectionIssue: jest.fn(),
            handleConnectionError: jest.fn(),
            handleRetry: jest.fn(),
            connectionActive: false,
            cachedViewerCount: 0,
            connectionTime: 0,
            _handleChatMessage: async () => handledChatMessages.push(true)
        };

        return { platform, connection, listeners, emitted, handledChatMessages };
    };

    test('caches viewer count and emits viewer-count', async () => {
        const { platform, listeners, emitted } = createPlatformHarness();

        setupTikTokEventListeners(platform);

        await listeners[platform.WebcastEvent.ROOM_USER]({ viewerCount: 42 });

        expect(platform.cachedViewerCount).toBe(42);
        expect(emitted.some((entry) => entry.type === 'viewer-count' && entry.payload.count === 42)).toBe(true);
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
