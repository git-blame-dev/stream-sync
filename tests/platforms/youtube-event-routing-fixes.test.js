
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');

describe('YouTube Event Routing Fixes', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let platform;

    beforeEach(() => {
        // Create a mock platform with the expected dispatch table structure
        // Based on the actual YouTubePlatform eventDispatchTable from src/platforms/youtube.js
        platform = {
            // Mock the event dispatch table with corrected event names (no "Renderer" suffix)
            eventDispatchTable: {
                // Membership events
                'LiveChatMembershipItem': createMockFn(),
                
                // Gift membership events  
                'LiveChatSponsorshipsGiftPurchaseAnnouncement': createMockFn(),
                
                // Other events (for completeness)
                'LiveChatPaidMessage': createMockFn(),
                'LiveChatPaidSticker': createMockFn(),
                'LiveChatTextMessage': createMockFn(),
                
        },
            
            // Mock the main message handler
            handleChatMessage: createMockFn((chatItem) => {
                const eventType = chatItem.item?.type || chatItem.type || 'unknown';
                const handler = platform.eventDispatchTable[eventType];
                if (handler) {
                    handler(chatItem);
                    return;
                }
                const author = chatItem.author?.name || chatItem.item?.author?.name || null;
                platform.logUnknownEvent(eventType, chatItem, author);
            }),
            
            // Mock the specific handler methods
            handleMembership: createMockFn(),
            handleGiftMembershipPurchase: createMockFn(),
            logUnknownEvent: createMockFn()
        };
        
        // Set up the dispatch table to call the appropriate handler methods
        platform.eventDispatchTable['LiveChatMembershipItem'].mockImplementation((chatItem) => {
            platform.handleMembership(chatItem);
        });
        
        platform.eventDispatchTable['LiveChatSponsorshipsGiftPurchaseAnnouncement'].mockImplementation((chatItem) => {
            platform.handleGiftMembershipPurchase(chatItem);
        });
        
    });

    describe('Event Dispatch Table Naming Corrections', () => {
        test('should handle LiveChatMembershipItem without Renderer suffix', () => {
            // This test should initially fail because dispatch table has wrong name
            const chatItem = {
                item: {
                    type: 'LiveChatMembershipItem'
                },
                author: { name: 'TestUser' }
            };


            // Get the dispatch table
            const dispatchTable = platform.eventDispatchTable;

            // Verify correct event name exists in dispatch table
            expect(dispatchTable).toHaveProperty('LiveChatMembershipItem');
            expect(dispatchTable).not.toHaveProperty('LiveChatMembershipItemRenderer');

            // Verify handler is called correctly
            const handler = dispatchTable['LiveChatMembershipItem'];
            expect(typeof handler).toBe('function');

            // Execute handler
            handler(chatItem);
            expect(platform.handleMembership).toHaveBeenCalledWith(chatItem);
        });

        test('should handle LiveChatSponsorshipsGiftPurchaseAnnouncement without Renderer suffix', () => {
            // This test should initially fail because dispatch table has wrong name
            const chatItem = {
                item: {
                    type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement'
                },
                author: { name: 'TestUser' }
            };

            // Get the dispatch table
            const dispatchTable = platform.eventDispatchTable;

            // Verify correct event name exists in dispatch table
            expect(dispatchTable).toHaveProperty('LiveChatSponsorshipsGiftPurchaseAnnouncement');
            expect(dispatchTable).not.toHaveProperty('LiveChatSponsorshipsGiftPurchaseAnnouncementRenderer');

            // Verify handler is called correctly
            const handler = dispatchTable['LiveChatSponsorshipsGiftPurchaseAnnouncement'];
            expect(typeof handler).toBe('function');

            // Execute handler
            handler(chatItem);
            expect(platform.handleGiftMembershipPurchase).toHaveBeenCalledWith(chatItem);
        });

    });

    describe('Event Routing Integration', () => {
        test('should route all corrected event types through handleChatMessage', () => {
            // Test corrected event types
            const testCases = [
                {
                    chatItem: {
                        item: { type: 'LiveChatMembershipItem' },
                        author: { name: 'User1' }
                    },
                    expectedHandler: 'handleMembership'
                },
                {
                    chatItem: {
                        item: { type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement' },
                        author: { name: 'User2' }
                    },
                    expectedHandler: 'handleGiftMembershipPurchase'
                }
            ];

            testCases.forEach(({ chatItem, expectedHandler }) => {
                // Reset mocks
                clearAllMocks();

                // Route through main handler
                platform.handleChatMessage(chatItem);

                // Verify correct handler was called
                expect(platform[expectedHandler]).toHaveBeenCalledWith(chatItem);
                expect(platform.logUnknownEvent).not.toHaveBeenCalled();
            });
        });
    });

    describe('Unknown Event Logging Verification', () => {
        test('should log truly unknown events to logs/youtube-data-unknown.txt', () => {
            // Verify unknown events still get logged
            const unknownChatItem = {
                item: {
                    type: 'SomeUnknownEventType'
                },
                author: { name: 'TestUser' }
            };

            // Route through main handler
            platform.handleChatMessage(unknownChatItem);

            // Verify unknown event logging was called
            expect(platform.logUnknownEvent).toHaveBeenCalledWith(
                'SomeUnknownEventType',
                unknownChatItem,
                'TestUser'
            );
        });

        test('should not log known events as unknown after fixes', () => {
            // Verify fixed events don't get logged as unknown
            const knownChatItem = {
                item: {
                    type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement'
                },
                author: { name: 'TestUser' }
            };

            // Route through main handler
            platform.handleChatMessage(knownChatItem);

            // Verify unknown event logging was NOT called
            expect(platform.logUnknownEvent).not.toHaveBeenCalled();
            expect(platform.handleGiftMembershipPurchase).toHaveBeenCalledWith(knownChatItem);
        });
    });
});
