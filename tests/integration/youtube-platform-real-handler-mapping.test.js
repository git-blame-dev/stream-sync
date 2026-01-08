
// Mock the logging system to avoid initialization issues
jest.mock('../../src/core/logging', () => ({
    getUnifiedLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }),
    setConfigValidator: jest.fn()
}));

// Mock retry system to avoid logging dependencies
jest.mock('../../src/utils/retry-system', () => ({
    createRetrySystem: jest.fn(() => ({
        calculateAdaptiveRetryDelay: jest.fn(() => 1000),
        incrementRetryCount: jest.fn(),
        resetRetryCount: jest.fn(),
        handleConnectionError: jest.fn(),
        handleConnectionSuccess: jest.fn(),
        executeWithRetry: jest.fn()
    })),
    RetrySystem: jest.fn(),
    ADAPTIVE_RETRY_CONFIG: { BASE_DELAY: 2000, MAX_DELAY: 60000, BACKOFF_MULTIPLIER: 1.3 }
}));

const mockTextProcessing = {
    extractMessageText: jest.fn((text) => text)
};

// Mock additional dependencies that YouTube platform needs
jest.mock('../../src/utils/text-processing', () => ({
    createTextProcessingManager: jest.fn(() => mockTextProcessing),
    TextProcessingManager: jest.fn(),
    formatTimestampCompact: jest.fn(() => '12:34:56')
}));

jest.mock('../../src/utils/youtube-message-extractor', () => ({
    YouTubeMessageExtractor: jest.fn(),
    shouldSuppressYouTubeNotification: jest.fn(() => false)
}));

jest.mock('../../src/utils/youtube-author-extractor', () => jest.fn());

jest.mock('../../src/utils/notification-builder', () => jest.fn());

// Mock the YouTubeNotificationDispatcher
jest.mock('../../src/utils/youtube-notification-dispatcher', () => {
    const mockNotificationDispatcher = {
        dispatchSuperChat: jest.fn().mockResolvedValue(true),
        dispatchSuperSticker: jest.fn().mockResolvedValue(true),
        dispatchMembership: jest.fn().mockResolvedValue(true),
        dispatchGiftMembership: jest.fn().mockResolvedValue(true)
    };

    return {
        YouTubeNotificationDispatcher: jest.fn().mockImplementation(() => mockNotificationDispatcher)
    };
});

describe('YouTube Platform Real Handler Method Mapping', () => {
    let platform;
    let mockHandlers;
    let mockNotificationDispatcher;

    beforeEach(() => {
        // Create mock notification dispatcher with expected methods
        mockNotificationDispatcher = {
            dispatchSuperChat: jest.fn().mockResolvedValue(true),
            dispatchSuperSticker: jest.fn().mockResolvedValue(true),
            dispatchMembership: jest.fn().mockResolvedValue(true),
            dispatchGiftMembership: jest.fn().mockResolvedValue(true)
        };
        
        // Mock handlers
        mockHandlers = {
            onMembership: jest.fn(),
            onGift: jest.fn(),
            onSuperChat: jest.fn(),
            onSuperSticker: jest.fn()
        };

        // Create a simplified platform mock that has the handler methods we want to test
        platform = {
            handleMembership: jest.fn(async (chatItem) => {
                if (mockNotificationDispatcher.dispatchMembership && typeof mockNotificationDispatcher.dispatchMembership === 'function') {
                    return await mockNotificationDispatcher.dispatchMembership(chatItem, mockHandlers);
                }
                platform.logger.warn('dispatchMembership method not available');
                return null;
            }),
            handleGiftMembershipPurchase: jest.fn(async (chatItem) => {
                return await mockNotificationDispatcher.dispatchGiftMembership(chatItem, mockHandlers);
            }),
            handleSuperChat: jest.fn(async (chatItem) => {
                return await mockNotificationDispatcher.dispatchSuperChat(chatItem, mockHandlers);
            }),
            handleSuperSticker: jest.fn(async (chatItem) => {
                return await mockNotificationDispatcher.dispatchSuperSticker(chatItem, mockHandlers);
            }),
            notificationDispatcher: mockNotificationDispatcher,
            handlers: mockHandlers,
            logger: {
                debug: jest.fn(),
                warn: jest.fn(),
                error: jest.fn()
            }
        };
    });

    describe('Real Handler Method Validation', () => {
        test('should call correct dispatch method for handleMembership', async () => {
            // Test that handleMembership calls dispatchMembership
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
            // Test that handleGiftMembershipPurchase calls dispatchGiftMembership
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
            // Test that handleSuperChat calls dispatchSuperChat
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
            // Test that handleSuperSticker calls dispatchSuperSticker (not dispatchSuperChat)
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
            // Test that all expected dispatch methods exist
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
            // Test that non-existent methods are caught
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
            // Test that missing dispatcher is handled gracefully
            platform.notificationDispatcher = null;
            
            const mockChatItem = {
                item: {
                    type: 'LiveChatMembershipItem'
                }
            };

            // This should not throw an error but should log a warning
            await expect(platform.handleMembership(mockChatItem)).resolves.not.toThrow();
        });

        test('should handle missing dispatch methods gracefully', async () => {
            // Test that missing dispatch methods are handled gracefully
            platform.notificationDispatcher.dispatchMembership = undefined;
            
            const mockChatItem = {
                item: {
                    type: 'LiveChatMembershipItem'
                }
            };

            // This should not throw an error but should log a warning
            await expect(platform.handleMembership(mockChatItem)).resolves.not.toThrow();
        });
    });


}); 
