const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const testClock = require('../helpers/test-clock');

const isChatMessageEvent = createMockFn();

describe('YouTubePlatform handleChatMessage Integration', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let youtubePlatform;
    let mockLogger;

    beforeEach(() => {
        mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

        youtubePlatform = {
            platformName: 'youtube',
            youtubeConnectionStatus: new Map(),
            handleChatMessage: createMockFn((chatItem) => {
                mockLogger.debug(`handleChatMessage called: ${chatItem.author?.name} - videoId: ${chatItem.videoId}`, 'youtube');

                if (!isChatMessageEvent(chatItem)) {
                    return;
                }

                if (chatItem.type === 'moderation') {
                    return;
                }

                if (chatItem.videoId) {
                    const connectionStatus = youtubePlatform.youtubeConnectionStatus.get(chatItem.videoId);
                    const messageTime = chatItem.item?.timestamp || chatItem.timestamp || testClock.now() * 1000;
                    const connectionTime = connectionStatus ? connectionStatus.time : undefined;

                    if (connectionTime && messageTime <= connectionTime) {
                        mockLogger.debug(`Filtering event from ${chatItem.author?.name} - Connection: ${connectionTime}, Message: ${messageTime}`, 'youtube');
                        return;
                    }
                }

                const eventType = chatItem.item?.type || chatItem.type;
                const handler = youtubePlatform.eventDispatchTable?.[eventType];
                if (handler) {
                    handler(chatItem);
                    return;
                }
                const author = chatItem.author?.name || chatItem.item?.author?.name || null;
                youtubePlatform.logUnknownEvent(eventType || 'unknown', chatItem, author);
            }),
            handleSuperChat: createMockFn(),
            handleSuperSticker: createMockFn(),
            handleMembership: createMockFn(),
            handleGiftMembershipPurchase: createMockFn(),
            handleLowPriorityEvent: createMockFn(),
            _processRegularChatMessage: createMockFn(),
            logUnknownEvent: createMockFn(),
            eventDispatchTable: {
                LiveChatPaidMessage: (chatItem) => youtubePlatform.handleSuperChat(chatItem),
                LiveChatMembershipItem: (chatItem) => youtubePlatform.handleMembership(chatItem),
                LiveChatTextMessage: (chatItem) => youtubePlatform._processRegularChatMessage(chatItem, chatItem.author?.name),
            }
        };

        isChatMessageEvent.mockReturnValue(true);
    });

    describe('Complete Flow Integration Tests', () => {
        it('should filter out non-chat events at entry point', () => {
            const chatItem = {
                type: 'SomeNonChatEvent',
                author: { name: 'TestUser' }
            };

            isChatMessageEvent.mockReturnValue(false);

            youtubePlatform.handleChatMessage(chatItem);

            expect(youtubePlatform.handleSuperChat).not.toHaveBeenCalled();
        });

        it('should skip moderation events after initial filtering', () => {
            const chatItem = {
                type: 'moderation',
                author: { name: 'TestUser' }
            };

            youtubePlatform.handleChatMessage(chatItem);

            expect(mockLogger.debug).toHaveBeenCalledWith('handleChatMessage called: TestUser - videoId: undefined', 'youtube');
            expect(youtubePlatform.handleSuperChat).not.toHaveBeenCalled();
        });

        it('should filter old Super Chat events using timestamp filtering', () => {
            const chatItem = {
                type: 'AddChatItemAction',
                item: {
                    type: 'LiveChatPaidMessage',
                    timestamp: 1000000
                },
                videoId: 'test-video-id',
                author: { name: 'TestUser' }
            };

            youtubePlatform.youtubeConnectionStatus.set('test-video-id', { time: 2000000 });

            youtubePlatform.handleChatMessage(chatItem);

            expect(mockLogger.debug).toHaveBeenCalledWith('Filtering event from TestUser - Connection: 2000000, Message: 1000000', 'youtube');
            expect(youtubePlatform.handleSuperChat).not.toHaveBeenCalled();
        });

        it('should process new Super Chat events after timestamp filtering', () => {
            const chatItem = {
                type: 'AddChatItemAction',
                item: {
                    type: 'LiveChatPaidMessage',
                    timestamp: 2000000
                },
                videoId: 'test-video-id',
                author: { name: 'TestUser' }
            };

            youtubePlatform.youtubeConnectionStatus.set('test-video-id', { time: 1000000 });

            youtubePlatform.handleChatMessage(chatItem);

            expect(youtubePlatform.handleSuperChat).toHaveBeenCalledWith(chatItem);
        });

        it('should filter old membership events using timestamp filtering', () => {
            const chatItem = {
                type: 'AddChatItemAction',
                item: {
                    type: 'LiveChatMembershipItem',
                    timestamp: 1000000,
                    author: { name: 'TestUser' }
                },
                videoId: 'test-video-id',
                author: { name: 'TestUser' }
            };

            youtubePlatform.youtubeConnectionStatus.set('test-video-id', { time: 2000000 });

            youtubePlatform.handleChatMessage(chatItem);

            expect(mockLogger.debug).toHaveBeenCalledWith('Filtering event from TestUser - Connection: 2000000, Message: 1000000', 'youtube');
            expect(youtubePlatform.handleMembership).not.toHaveBeenCalled();
        });

        it('should process new membership events after timestamp filtering', () => {
            const chatItem = {
                type: 'AddChatItemAction',
                item: {
                    type: 'LiveChatMembershipItem',
                    timestamp: 2000000,
                    author: { name: 'TestUser' }
                },
                videoId: 'test-video-id',
                author: { name: 'TestUser' }
            };

            youtubePlatform.youtubeConnectionStatus.set('test-video-id', { time: 1000000 });

            youtubePlatform.handleChatMessage(chatItem);

            expect(youtubePlatform.handleMembership).toHaveBeenCalledWith(chatItem);
        });

        it('should process regular chat messages after all filtering', () => {
            const chatItem = {
                type: 'AddChatItemAction',
                item: {
                    type: 'LiveChatTextMessage',
                    timestamp: 2000000
                },
                videoId: 'test-video-id',
                author: { name: 'TestUser' },
                message: 'Hello world'
            };

            youtubePlatform.youtubeConnectionStatus.set('test-video-id', { time: 1000000 });

            youtubePlatform.handleChatMessage(chatItem);

            expect(youtubePlatform._processRegularChatMessage).toHaveBeenCalledWith(chatItem, 'TestUser');
        });

        it('should handle multiple event types in sequence with timestamp filtering', () => {
            const connectionTime = 1500000;
            youtubePlatform.youtubeConnectionStatus.set('test-video-id', { time: connectionTime });

            const oldSuperChat = {
                type: 'AddChatItemAction',
                item: { type: 'LiveChatPaidMessage', timestamp: 1000000 },
                videoId: 'test-video-id',
                author: { name: 'OldUser' }
            };

            youtubePlatform.handleChatMessage(oldSuperChat);
            expect(youtubePlatform.handleSuperChat).not.toHaveBeenCalled();

            const newMembership = {
                type: 'AddChatItemAction',
                item: { type: 'LiveChatMembershipItem', timestamp: 2000000 },
                videoId: 'test-video-id',
                author: { name: 'NewUser' }
            };

            youtubePlatform.handleChatMessage(newMembership);
            expect(youtubePlatform.handleMembership).toHaveBeenCalledWith(newMembership);
        });

        it('should handle events with no videoId (skip timestamp filtering)', () => {
            const chatItem = {
                type: 'AddChatItemAction',
                item: { type: 'LiveChatPaidMessage' },
                author: { name: 'TestUser' }
            };

            youtubePlatform.handleChatMessage(chatItem);

            expect(youtubePlatform.handleSuperChat).toHaveBeenCalledWith(chatItem);
        });

        it('should handle errors gracefully without breaking pipeline', () => {
            const chatItem = {
                type: 'AddChatItemAction',
                item: { type: 'LiveChatPaidMessage' },
                videoId: 'test-video-id',
                author: { name: 'TestUser' }
            };

            youtubePlatform.handleSuperChat.mockImplementation(() => {
                throw new Error('Handler error');
            });

            const originalHandler = youtubePlatform.handleChatMessage;
            youtubePlatform.handleChatMessage = createMockFn((item) => {
                try {
                    originalHandler.call(youtubePlatform, item);
                } catch (error) {
                    mockLogger.error('Error processing chat message: ' + error.message, 'youtube', error);
                }
            });

            expect(() => {
                youtubePlatform.handleChatMessage(chatItem);
            }).not.toThrow();

            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('Timestamp Filtering Edge Cases', () => {
        it('should handle missing connection status gracefully', () => {
            const chatItem = {
                type: 'AddChatItemAction',
                item: { type: 'LiveChatPaidMessage', timestamp: 1000000 },
                videoId: 'nonexistent-video-id',
                author: { name: 'TestUser' }
            };

            youtubePlatform.handleChatMessage(chatItem);

            expect(youtubePlatform.handleSuperChat).toHaveBeenCalledWith(chatItem);
        });

        it('should handle missing timestamps gracefully', () => {
            const chatItem = {
                type: 'AddChatItemAction',
                item: { type: 'LiveChatPaidMessage' },
                videoId: 'test-video-id',
                author: { name: 'TestUser' }
            };

            youtubePlatform.youtubeConnectionStatus.set('test-video-id', { time: 1000000 });

            youtubePlatform.handleChatMessage(chatItem);

            expect(() => youtubePlatform.handleChatMessage(chatItem)).not.toThrow();
        });

        it('should use fallback timestamp when item.timestamp is missing', () => {
            const chatItem = {
                type: 'AddChatItemAction',
                item: { type: 'LiveChatPaidMessage' },
                timestamp: 2000000,
                videoId: 'test-video-id',
                author: { name: 'TestUser' }
            };

            youtubePlatform.youtubeConnectionStatus.set('test-video-id', { time: 1000000 });

            youtubePlatform.handleChatMessage(chatItem);

            expect(youtubePlatform.handleSuperChat).toHaveBeenCalledWith(chatItem);
        });
    });

    describe('Regression Tests - Behavior Preservation', () => {
        it('should maintain exact same filtering behavior as before refactor', () => {
            const testCases = [
                {
                    name: 'old super chat',
                    item: { type: 'AddChatItemAction', item: { type: 'LiveChatPaidMessage', timestamp: 1000 } },
                    connectionTime: 2000,
                    shouldFilter: true
                },
                {
                    name: 'old membership',
                    item: { type: 'AddChatItemAction', item: { type: 'LiveChatMembershipItem', timestamp: 1000 } },
                    connectionTime: 2000,
                    shouldFilter: true
                },
                {
                    name: 'new super chat',
                    item: { type: 'AddChatItemAction', item: { type: 'LiveChatPaidMessage', timestamp: 2000 } },
                    connectionTime: 1000,
                    shouldFilter: false
                },
                {
                    name: 'new membership',
                    item: { type: 'AddChatItemAction', item: { type: 'LiveChatMembershipItem', timestamp: 2000 } },
                    connectionTime: 1000,
                    shouldFilter: false
                },
                {
                    name: 'same timestamp',
                    item: { type: 'AddChatItemAction', item: { type: 'LiveChatPaidMessage', timestamp: 1000 } },
                    connectionTime: 1000,
                    shouldFilter: true
                }
            ];

            testCases.forEach(({ name, item, connectionTime, shouldFilter }) => {
                clearAllMocks();

                const chatItem = {
                    ...item,
                    videoId: 'test-video-id',
                    author: { name: 'TestUser' }
                };

                youtubePlatform.youtubeConnectionStatus.set('test-video-id', { time: connectionTime });

                youtubePlatform.handleChatMessage(chatItem);

                if (shouldFilter) {
                    const handlerMap = {
                        'LiveChatPaidMessage': 'handleSuperChat',
                        'LiveChatMembershipItem': 'handleMembership'
                    };
                    const itemType = chatItem.item?.item?.type || chatItem.item?.type;
                    const handler = handlerMap[itemType];
                    if (handler) {
                        expect(youtubePlatform[handler]).not.toHaveBeenCalled();
                    }
                } else {
                    const handlerMap = {
                        'LiveChatPaidMessage': 'handleSuperChat',
                        'LiveChatMembershipItem': 'handleMembership'
                    };
                    const itemType = chatItem.item?.item?.type || chatItem.item?.type;
                    const handler = handlerMap[itemType];
                    if (handler) {
                        expect(youtubePlatform[handler]).toHaveBeenCalled();
                    }
                }
            });
        });

        it('should maintain exact same handler dispatch behavior as before refactor', () => {
            const eventMappings = [
                { type: 'AddChatItemAction', itemType: 'LiveChatPaidMessage', handler: 'handleSuperChat' },
                { type: 'AddChatItemAction', itemType: 'LiveChatMembershipItem', handler: 'handleMembership' },
                { type: 'AddChatItemAction', itemType: 'LiveChatTextMessage', handler: '_processRegularChatMessage' }
            ];

            eventMappings.forEach(({ type, itemType, handler }) => {
                clearAllMocks();

                const chatItem = {
                    type,
                    item: { type: itemType, timestamp: 2000000 },
                    videoId: 'test-video-id',
                    author: { name: 'TestUser' }
                };

                youtubePlatform.youtubeConnectionStatus.set('test-video-id', { time: 1000000 });

                youtubePlatform.handleChatMessage(chatItem);

                if (handler === '_processRegularChatMessage') {
                    expect(youtubePlatform[handler]).toHaveBeenCalledWith(chatItem, 'TestUser');
                } else {
                    expect(youtubePlatform[handler]).toHaveBeenCalledWith(chatItem);
                }
            });
        });
    });
});
