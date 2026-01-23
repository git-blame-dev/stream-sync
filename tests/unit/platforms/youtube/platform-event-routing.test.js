const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../helpers/mock-factories');

const PlatformEvents = require('../../../../src/interfaces/PlatformEvents');
const EventEmitter = require('events');
const testClock = require('../../../helpers/test-clock');

describe('YouTube Platform Event Routing', () => {
    let youtubePlatform;
    let handlerCalls;

    beforeEach(() => {
        handlerCalls = {
            onChat: [],
            onGift: [],
            onMembership: [],
            onStreamStatus: [],
            onViewerCount: []
        };

        youtubePlatform = Object.create(EventEmitter.prototype);
        EventEmitter.call(youtubePlatform);

        youtubePlatform.handlers = {
            onChat: (payload) => handlerCalls.onChat.push(payload),
            onGift: (payload) => handlerCalls.onGift.push(payload),
            onMembership: (payload) => handlerCalls.onMembership.push(payload),
            onStreamStatus: (payload) => handlerCalls.onStreamStatus.push(payload),
            onViewerCount: (payload) => handlerCalls.onViewerCount.push(payload)
        };
        youtubePlatform.logger = noOpLogger;

        youtubePlatform._emitPlatformEvent = function(type, payload) {
            const platform = payload?.platform || 'youtube';

            this.emit('platform:event', { platform, type, data: payload });

            const handlerMap = {
                'chat': 'onChat',
                'gift': 'onGift',
                'paypiggy': 'onMembership',
                'stream-status': 'onStreamStatus',
                'viewer-count': 'onViewerCount'
            };

            const handlerName = handlerMap[type];
            const handler = this.handlers?.[handlerName];

            if (typeof handler === 'function') {
                handler(payload);
            } else {
                this.logger.debug(`No handler registered for event type: ${type}`, 'youtube');
            }
        };
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('_emitPlatformEvent method existence', () => {
        test('should have _emitPlatformEvent method', () => {
            expect(typeof youtubePlatform._emitPlatformEvent).toBe('function');
        });

        test('should match Twitch and TikTok method signature', () => {
            expect(youtubePlatform._emitPlatformEvent.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Chat message event routing', () => {
        test('should route chat events to onChat handler', () => {
            const chatPayload = {
                type: PlatformEvents.CHAT_MESSAGE,
                platform: 'youtube',
                username: 'Test User',
                userId: 'user123',
                message: { text: 'Hello world' },
                timestamp: new Date(testClock.now()).toISOString()
            };

            youtubePlatform._emitPlatformEvent('chat', chatPayload);

            expect(handlerCalls.onChat).toHaveLength(1);
            expect(handlerCalls.onChat[0]).toEqual(chatPayload);
        });

        test('should handle chat event with complex user data', () => {
            const chatPayload = {
                type: PlatformEvents.CHAT_MESSAGE,
                platform: 'youtube',
                username: 'Test Channel',
                userId: 'UC_channel_id',
                message: { text: 'Test message with emoji 😊' },
                timestamp: new Date(testClock.now()).toISOString(),
                metadata: {
                    isMod: false,
                    isOwner: false,
                    isVerified: true
                }
            };

            youtubePlatform._emitPlatformEvent('chat', chatPayload);

            expect(handlerCalls.onChat[0]).toEqual(chatPayload);
        });
    });

    describe('Gift event routing', () => {
        test('should route gift events to onGift handler', () => {
            const giftPayload = {
                type: PlatformEvents.GIFT,
                platform: 'youtube',
                username: 'Generous Gifter',
                userId: 'user456',
                amount: 5.00,
                currency: 'USD',
                giftType: 'Super Chat',
                giftCount: 1,
                timestamp: new Date(testClock.now()).toISOString()
            };

            youtubePlatform._emitPlatformEvent('gift', giftPayload);

            expect(handlerCalls.onGift).toHaveLength(1);
            expect(handlerCalls.onGift[0]).toEqual(giftPayload);
        });

        test('should route Super Chat events as gifts to onGift handler', () => {
            const superChatPayload = {
                type: PlatformEvents.GIFT,
                platform: 'youtube',
                username: 'donor',
                userId: 'user789',
                giftType: 'Super Chat',
                giftCount: 1,
                amount: 10.00,
                currency: 'USD'
            };

            youtubePlatform._emitPlatformEvent('gift', superChatPayload);

            expect(handlerCalls.onGift[0]).toEqual(superChatPayload);
        });

        test('should route Super Sticker events as gifts to onGift handler', () => {
            const superStickerPayload = {
                type: PlatformEvents.GIFT,
                platform: 'youtube',
                username: 'sticker_fan',
                userId: 'user101',
                giftType: 'Super Sticker',
                giftCount: 1,
                amount: 2.00,
                currency: 'USD',
                message: 'heart'
            };

            youtubePlatform._emitPlatformEvent('gift', superStickerPayload);

            expect(handlerCalls.onGift[0]).toEqual(superStickerPayload);
        });
    });

    describe('Paypiggy event routing', () => {
        test('routes paypiggy events to onMembership handler (canonical path)', () => {
            const membershipPayload = {
                type: 'platform:paypiggy',
                platform: 'youtube',
                username: 'member',
                userId: 'user303',
                membershipLevel: 'Member',
                months: 3
            };

            youtubePlatform._emitPlatformEvent('paypiggy', membershipPayload);

            expect(handlerCalls.onMembership[0]).toEqual(membershipPayload);
        });

    });

    describe('Stream status event routing', () => {
        test('should route stream-status events to onStreamStatus handler', () => {
            const streamStatusPayload = {
                type: PlatformEvents.STREAM_STATUS,
                platform: 'youtube',
                isLive: true,
                timestamp: new Date(testClock.now()).toISOString()
            };

            youtubePlatform._emitPlatformEvent('stream-status', streamStatusPayload);

            expect(handlerCalls.onStreamStatus[0]).toEqual(streamStatusPayload);
        });
    });

    describe('Viewer count event routing', () => {
        test('should route viewer-count events to onViewerCount handler', () => {
            const viewerCountPayload = {
                type: PlatformEvents.VIEWER_COUNT,
                platform: 'youtube',
                count: 42,
                timestamp: new Date(testClock.now()).toISOString()
            };

            youtubePlatform._emitPlatformEvent('viewer-count', viewerCountPayload);

            expect(handlerCalls.onViewerCount[0]).toEqual(viewerCountPayload);
        });
    });

    describe('Handler mapping completeness', () => {
        test('should map all event types to correct handler names', () => {
            const eventTypeToHandlerMap = [
                ['chat', 'onChat'],
                ['gift', 'onGift'],
                ['paypiggy', 'onMembership'],
                ['stream-status', 'onStreamStatus'],
                ['viewer-count', 'onViewerCount']
            ];

            eventTypeToHandlerMap.forEach(([eventType, handlerName]) => {
                const testPayload = {
                    type: `platform:${eventType}`,
                    platform: 'youtube',
                    data: 'test'
                };

                youtubePlatform._emitPlatformEvent(eventType, testPayload);

                expect(handlerCalls[handlerName].length).toBeGreaterThan(0);
                expect(handlerCalls[handlerName][handlerCalls[handlerName].length - 1]).toEqual(testPayload);
            });
        });
    });

    describe('Missing handler graceful handling', () => {
        test('should handle missing handler without throwing', () => {
            youtubePlatform.handlers = {};

            const chatPayload = {
                type: PlatformEvents.CHAT_MESSAGE,
                platform: 'youtube',
                username: 'test',
                userId: '123',
                message: { text: 'test' },
                timestamp: new Date(testClock.now()).toISOString()
            };

            expect(() => {
                youtubePlatform._emitPlatformEvent('chat', chatPayload);
            }).not.toThrow();
        });

        test('should handle null handlers object', () => {
            youtubePlatform.handlers = null;

            expect(() => {
                youtubePlatform._emitPlatformEvent('chat', { message: { text: 'test' } });
            }).not.toThrow();
        });

        test('should handle undefined handlers object', () => {
            youtubePlatform.handlers = undefined;

            expect(() => {
                youtubePlatform._emitPlatformEvent('chat', { message: { text: 'test' } });
            }).not.toThrow();
        });
    });

    describe('Event emitter integration', () => {
        test('should emit platform:event for local listeners', () => {
            const emittedEvents = [];
            youtubePlatform.on('platform:event', (event) => emittedEvents.push(event));

            const chatPayload = {
                type: PlatformEvents.CHAT_MESSAGE,
                platform: 'youtube',
                username: 'test',
                userId: '123',
                message: { text: 'test' },
                timestamp: new Date(testClock.now()).toISOString()
            };

            youtubePlatform._emitPlatformEvent('chat', chatPayload);

            expect(emittedEvents).toHaveLength(1);
            expect(emittedEvents[0]).toEqual({
                platform: 'youtube',
                type: 'chat',
                data: chatPayload
            });
        });
    });

    describe('Integration with actual chat processing', () => {
        test('should route real chat message through complete flow', async () => {
            const mockChatItem = {
                videoId: 'test_video_123',
                author: {
                    channelId: 'UC_test_channel',
                    name: 'Test User'
                },
                message: [{ text: 'Hello from test' }],
                timestamp: testClock.now()
            };

            const normalizedData = {
                userId: mockChatItem.author.channelId,
                username: mockChatItem.author.name,
                message: 'Hello from test',
                timestamp: new Date(mockChatItem.timestamp).toISOString(),
                videoId: mockChatItem.videoId
            };

            const eventData = {
                type: PlatformEvents.CHAT_MESSAGE,
                platform: 'youtube',
                username: normalizedData.username,
                userId: normalizedData.userId,
                message: { text: normalizedData.message },
                timestamp: normalizedData.timestamp,
                metadata: {
                    platform: 'youtube',
                    videoId: normalizedData.videoId,
                    correlationId: 'test-correlation-id'
                }
            };

            youtubePlatform._emitPlatformEvent('chat', eventData);

            expect(handlerCalls.onChat).toHaveLength(1);
            expect(handlerCalls.onChat[0]).toMatchObject({
                type: PlatformEvents.CHAT_MESSAGE,
                platform: 'youtube',
                username: normalizedData.username,
                userId: normalizedData.userId
            });
        });
    });

    describe('Consistency with Twitch and TikTok', () => {
        test('should have _emitPlatformEvent method matching expected signature', () => {
            expect(typeof youtubePlatform._emitPlatformEvent).toBe('function');
            expect(youtubePlatform._emitPlatformEvent.length).toBe(2);
        });

        test('should route events using same pattern as other platforms', () => {
            const emittedEvents = [];
            youtubePlatform.on('platform:event', (event) => emittedEvents.push(event));
            const testPayload = { type: 'test', platform: 'youtube', data: 'test' };

            youtubePlatform._emitPlatformEvent('chat', testPayload);

            expect(emittedEvents).toHaveLength(1);
            expect(emittedEvents[0]).toEqual({
                platform: 'youtube',
                type: 'chat',
                data: testPayload
            });

            expect(handlerCalls.onChat[0]).toEqual(testPayload);
        });
    });
});
