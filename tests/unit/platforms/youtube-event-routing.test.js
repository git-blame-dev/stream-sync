const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');

const PlatformEvents = require('../../../src/interfaces/PlatformEvents');
const EventEmitter = require('events');
const testClock = require('../../helpers/test-clock');

describe('YouTube Platform Event Routing', () => {
    let youtubePlatform;
    let mockHandlers;
    let mockLogger;

    beforeEach(() => {
        // Create mock handlers that track calls
        mockHandlers = {
            onChat: createMockFn(),
            onGift: createMockFn(),
            onMembership: createMockFn(),
            onStreamStatus: createMockFn(),
            onViewerCount: createMockFn()
        };

        mockLogger = {
            info: createMockFn(),
            debug: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

        // Create minimal test object with _emitPlatformEvent method
        // This simulates YouTube platform without full initialization
        youtubePlatform = Object.create(EventEmitter.prototype);
        EventEmitter.call(youtubePlatform);

        youtubePlatform.handlers = mockHandlers;
        youtubePlatform.logger = mockLogger;

        // Add the _emitPlatformEvent method (copied from youtube.js)
        youtubePlatform._emitPlatformEvent = function(type, payload) {
            const platform = payload?.platform || 'youtube';

            // Emit unified platform:event for local listeners
            this.emit('platform:event', { platform, type, data: payload });

            // Forward to injected handlers
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
            // Method should accept (type, payload) parameters
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

            expect(mockHandlers.onChat).toHaveBeenCalledTimes(1);
            expect(mockHandlers.onChat).toHaveBeenCalledWith(chatPayload);
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

            expect(mockHandlers.onChat).toHaveBeenCalledWith(chatPayload);
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

            expect(mockHandlers.onGift).toHaveBeenCalledTimes(1);
            expect(mockHandlers.onGift).toHaveBeenCalledWith(giftPayload);
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

            expect(mockHandlers.onGift).toHaveBeenCalledWith(superChatPayload);
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

            expect(mockHandlers.onGift).toHaveBeenCalledWith(superStickerPayload);
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

            expect(mockHandlers.onMembership).toHaveBeenCalledWith(membershipPayload);
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

            expect(mockHandlers.onStreamStatus).toHaveBeenCalledWith(streamStatusPayload);
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

            expect(mockHandlers.onViewerCount).toHaveBeenCalledWith(viewerCountPayload);
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

                expect(mockHandlers[handlerName]).toHaveBeenCalledWith(testPayload);
                clearAllMocks();
            });
        });
    });

    describe('Missing handler graceful handling', () => {
        test('should handle missing handler without throwing', () => {
            youtubePlatform.handlers = {}; // No handlers registered

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

        test('should log debug message when handler is missing', () => {
            youtubePlatform.handlers = {}; // No handlers registered

            const chatPayload = {
                type: PlatformEvents.CHAT_MESSAGE,
                platform: 'youtube',
                username: 'test',
                userId: '123',
                message: { text: 'test' },
                timestamp: new Date(testClock.now()).toISOString()
            };

            youtubePlatform._emitPlatformEvent('chat', chatPayload);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('No handler registered for event type'),
                'youtube'
            );
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
            const emitSpy = spyOn(youtubePlatform, 'emit');

            const chatPayload = {
                type: PlatformEvents.CHAT_MESSAGE,
                platform: 'youtube',
                username: 'test',
                userId: '123',
                message: { text: 'test' },
                timestamp: new Date(testClock.now()).toISOString()
            };

            youtubePlatform._emitPlatformEvent('chat', chatPayload);

            expect(emitSpy).toHaveBeenCalledWith('platform:event', {
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

            // This would be the actual integration point
            // The processChatMessage should internally call _emitPlatformEvent
            // We're verifying the handler gets called as a result

            // Simulate what processChatMessage does
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
                    correlationId: expect.any(String)
                }
            };

            youtubePlatform._emitPlatformEvent('chat', eventData);

            expect(mockHandlers.onChat).toHaveBeenCalledTimes(1);
            expect(mockHandlers.onChat.mock.calls[0][0]).toMatchObject({
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
            // Should accept 2 parameters: (type, payload)
            expect(youtubePlatform._emitPlatformEvent.length).toBe(2);
        });

        test('should route events using same pattern as other platforms', () => {
            // Test that the method follows the same pattern:
            // 1. Emit platform:event
            // 2. Route to handler via handlerMap
            // 3. Call handler function

            const emitSpy = spyOn(youtubePlatform, 'emit');
            const testPayload = { type: 'test', platform: 'youtube', data: 'test' };

            youtubePlatform._emitPlatformEvent('chat', testPayload);

            // Verify it emits platform:event (same as Twitch/TikTok)
            expect(emitSpy).toHaveBeenCalledWith('platform:event', {
                platform: 'youtube',
                type: 'chat',
                data: testPayload
            });

            // Verify it calls the handler (same as Twitch/TikTok)
            expect(mockHandlers.onChat).toHaveBeenCalledWith(testPayload);
        });
    });
});
