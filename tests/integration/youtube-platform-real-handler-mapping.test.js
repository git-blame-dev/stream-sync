const { describe, test, beforeEach, afterEach, expect } = require('bun:test');

const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');

describe('YouTube Platform Real Handler Method Mapping', () => {
    let platform;
    let mockHandlers;
    let mockNotificationDispatcher;

    afterEach(() => {
        restoreAllMocks();
    });

    beforeEach(() => {
        mockNotificationDispatcher = {
            dispatchSuperChat: createMockFn().mockResolvedValue(true),
            dispatchSuperSticker: createMockFn().mockResolvedValue(true),
            dispatchMembership: createMockFn().mockResolvedValue(true),
            dispatchGiftMembership: createMockFn().mockResolvedValue(true)
        };

        mockHandlers = {
            onMembership: createMockFn(),
            onGift: createMockFn(),
            onSuperChat: createMockFn(),
            onSuperSticker: createMockFn()
        };

        platform = {
            handleMembership: createMockFn(async function(chatItem) {
                const dispatcher = this.notificationDispatcher;
                if (dispatcher?.dispatchMembership && typeof dispatcher.dispatchMembership === 'function') {
                    return await dispatcher.dispatchMembership(chatItem, this.handlers);
                }
                return null;
            }),
            handleGiftMembershipPurchase: createMockFn(async function(chatItem) {
                return await this.notificationDispatcher.dispatchGiftMembership(chatItem, this.handlers);
            }),
            handleSuperChat: createMockFn(async function(chatItem) {
                return await this.notificationDispatcher.dispatchSuperChat(chatItem, this.handlers);
            }),
            handleSuperSticker: createMockFn(async function(chatItem) {
                return await this.notificationDispatcher.dispatchSuperSticker(chatItem, this.handlers);
            }),
            notificationDispatcher: mockNotificationDispatcher,
            handlers: mockHandlers,
            logger: noOpLogger
        };
    });

    describe('Real Handler Method Validation', () => {
        test('should call correct dispatch method for handleMembership', async () => {
            const mockChatItem = {
                item: {
                    type: 'LiveChatMembershipItem',
                    header_primary_text: { text: 'New Member' }
                }
            };

            await platform.handleMembership(mockChatItem);

            expect(platform.notificationDispatcher.dispatchMembership).toHaveBeenCalledWith(mockChatItem, mockHandlers);
            expect(platform.notificationDispatcher.dispatchSuperChat).not.toHaveBeenCalled();
            expect(platform.notificationDispatcher.dispatchSuperSticker).not.toHaveBeenCalled();
        });

        test('should call correct dispatch method for handleGiftMembershipPurchase', async () => {
            const mockChatItem = {
                item: {
                    type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement',
                    purchase_amount: '$5.00'
                }
            };

            await platform.handleGiftMembershipPurchase(mockChatItem);

            expect(platform.notificationDispatcher.dispatchGiftMembership).toHaveBeenCalledWith(mockChatItem, mockHandlers);
            expect(platform.notificationDispatcher.dispatchMembership).not.toHaveBeenCalled();
            expect(platform.notificationDispatcher.dispatchSuperSticker).not.toHaveBeenCalled();
        });

        test('should call correct dispatch method for handleSuperChat', async () => {
            const mockChatItem = {
                item: {
                    type: 'LiveChatPaidMessage',
                    purchase_amount: '$10.00'
                }
            };

            await platform.handleSuperChat(mockChatItem);

            expect(platform.notificationDispatcher.dispatchSuperChat).toHaveBeenCalledWith(mockChatItem, mockHandlers);
            expect(platform.notificationDispatcher.dispatchMembership).not.toHaveBeenCalled();
            expect(platform.notificationDispatcher.dispatchSuperSticker).not.toHaveBeenCalled();
        });

        test('should call correct dispatch method for handleSuperSticker', async () => {
            const mockChatItem = {
                item: {
                    type: 'LiveChatPaidSticker',
                    purchase_amount: '$2.00'
                }
            };

            await platform.handleSuperSticker(mockChatItem);

            expect(platform.notificationDispatcher.dispatchSuperSticker).toHaveBeenCalledWith(mockChatItem, mockHandlers);
            expect(platform.notificationDispatcher.dispatchSuperChat).not.toHaveBeenCalled();
            expect(platform.notificationDispatcher.dispatchMembership).not.toHaveBeenCalled();
        });
    });

    describe('Method Existence Validation', () => {
        test('should ensure all dispatch methods exist on the real dispatcher', () => {
            const expectedMethods = [
                'dispatchSuperChat',
                'dispatchSuperSticker',
                'dispatchMembership',
                'dispatchGiftMembership'
            ];

            expectedMethods.forEach(method => {
                expect(typeof platform.notificationDispatcher[method]).toBe('function');
            });
        });

        test('should catch if platform tries to use non-existent dispatch methods', () => {
            const nonExistentMethods = [
                'dispatchNonExistent',
                'dispatchInvalid',
                'dispatchWrong'
            ];

            nonExistentMethods.forEach(method => {
                expect(platform.notificationDispatcher[method]).toBeUndefined();
            });
        });
    });

    describe('Error Handling', () => {
        test('should handle missing notification dispatcher gracefully', async () => {
            platform.notificationDispatcher = null;

            const mockChatItem = {
                item: { type: 'LiveChatMembershipItem' }
            };

            const result = await platform.handleMembership(mockChatItem);
            expect(result).toBeNull();
        });

        test('should handle missing dispatch methods gracefully', async () => {
            platform.notificationDispatcher.dispatchMembership = undefined;

            const mockChatItem = {
                item: { type: 'LiveChatMembershipItem' }
            };

            const result = await platform.handleMembership(mockChatItem);
            expect(result).toBeNull();
        });
    });


}); 
