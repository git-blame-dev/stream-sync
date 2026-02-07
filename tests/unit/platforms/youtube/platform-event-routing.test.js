const { describe, test, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../helpers/bun-mock-utils');

const { YouTubePlatform } = require('../../../../src/platforms/youtube');
const { PlatformEvents } = require('../../../../src/interfaces/PlatformEvents');
const { createMockPlatformDependencies } = require('../../../helpers/test-setup');
const { createYouTubeConfigFixture } = require('../../../helpers/config-fixture');

describe('YouTube Platform Event Routing', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const baseConfig = createYouTubeConfigFixture({ enabled: true, username: 'test-channel' });

    const YOUTUBE_HANDLER_MAP = {
        [PlatformEvents.CHAT_MESSAGE]: { handlerName: 'onChat', dataKey: 'message' },
        [PlatformEvents.GIFT]: { handlerName: 'onGift', dataKey: 'giftType' },
        [PlatformEvents.GIFTPAYPIGGY]: { handlerName: 'onGiftPaypiggy', dataKey: 'giftCount' },
        [PlatformEvents.PAYPIGGY]: { handlerName: 'onPaypiggy', dataKey: 'tier' },
        [PlatformEvents.STREAM_STATUS]: { handlerName: 'onStreamStatus', dataKey: 'isLive' },
        [PlatformEvents.STREAM_DETECTED]: { handlerName: 'onStreamDetected', dataKey: 'newStreamIds' },
        [PlatformEvents.VIEWER_COUNT]: { handlerName: 'onViewerCount', dataKey: 'count' }
    };

    const FIXED_TIMESTAMP = '2024-06-15T12:00:00.000Z';

    const PAYLOAD_BY_TYPE = {
        [PlatformEvents.CHAT_MESSAGE]: { platform: 'youtube', username: 'test-user', userId: 'test-user-id', message: { text: 'test-message' }, timestamp: FIXED_TIMESTAMP },
        [PlatformEvents.GIFT]: { platform: 'youtube', username: 'test-user', userId: 'test-user-id', giftType: 'test-super-chat', giftCount: 1, amount: 5, currency: 'USD', timestamp: FIXED_TIMESTAMP },
        [PlatformEvents.GIFTPAYPIGGY]: { platform: 'youtube', username: 'test-user', userId: 'test-user-id', giftCount: 5, tier: 'test-tier-1', timestamp: FIXED_TIMESTAMP },
        [PlatformEvents.PAYPIGGY]: { platform: 'youtube', username: 'test-user', userId: 'test-user-id', tier: 'test-member', months: 3, timestamp: FIXED_TIMESTAMP },
        [PlatformEvents.STREAM_STATUS]: { platform: 'youtube', isLive: true, timestamp: FIXED_TIMESTAMP },
        [PlatformEvents.STREAM_DETECTED]: { platform: 'youtube', newStreamIds: ['test-stream-1'], allStreamIds: ['test-stream-1'], detectionTime: 1000 },
        [PlatformEvents.VIEWER_COUNT]: { platform: 'youtube', count: 42, timestamp: FIXED_TIMESTAMP }
    };

    const createPlatform = () => new YouTubePlatform(baseConfig, {
        ...createMockPlatformDependencies('youtube'),
        streamDetectionService: {
            detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
        }
    });

    describe('handler map dispatch', () => {
        for (const [eventType, { handlerName, dataKey }] of Object.entries(YOUTUBE_HANDLER_MAP)) {
            test(`${eventType} routes to ${handlerName} with payload data`, () => {
                const platform = createPlatform();
                const collected = [];
                platform.handlers = {
                    ...platform.handlers,
                    [handlerName]: (data) => collected.push(data)
                };

                const payload = { ...PAYLOAD_BY_TYPE[eventType] };
                platform._emitPlatformEvent(eventType, payload);

                expect(collected).toHaveLength(1);
                expect(collected[0][dataKey]).toBeDefined();
                expect(collected[0].platform).toBe('youtube');
            });
        }
    });

    test('emits platform:event on local EventEmitter for all mapped types', () => {
        const platform = createPlatform();
        const emittedEvents = [];
        platform.on('platform:event', (event) => emittedEvents.push(event));

        for (const eventType of Object.keys(YOUTUBE_HANDLER_MAP)) {
            const payload = { ...PAYLOAD_BY_TYPE[eventType] };
            platform._emitPlatformEvent(eventType, payload);
        }

        expect(emittedEvents).toHaveLength(Object.keys(YOUTUBE_HANDLER_MAP).length);
        for (const event of emittedEvents) {
            expect(event.platform).toBe('youtube');
            expect(event.data).toBeDefined();
        }
    });

    test('handles missing handler without throwing', () => {
        const platform = createPlatform();
        platform.handlers = {};

        expect(() => {
            platform._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, {
                platform: 'youtube',
                username: 'test-user',
                message: { text: 'test-message' }
            });
        }).not.toThrow();
    });

    test('handles null handlers without throwing', () => {
        const platform = createPlatform();
        platform.handlers = null;

        expect(() => {
            platform._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, {
                platform: 'youtube',
                message: { text: 'test-message' }
            });
        }).not.toThrow();
    });

    test('unmapped event type does not invoke any handler', () => {
        const platform = createPlatform();
        const collected = [];
        platform.handlers = {
            onChat: (data) => collected.push(data),
            onGift: (data) => collected.push(data)
        };

        platform._emitPlatformEvent('platform:nonexistent', { platform: 'youtube' });

        expect(collected).toHaveLength(0);
    });
});
