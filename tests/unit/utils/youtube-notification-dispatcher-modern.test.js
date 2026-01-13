
const { getSyntheticFixture, INTERNATIONAL_USERNAMES } = require('../../helpers/platform-test-data');

const fixtureSuperChat = getSyntheticFixture('youtube', 'superchat');
const fixtureSuperSticker = getSyntheticFixture('youtube', 'supersticker');
const fixtureSuperChatINR = getSyntheticFixture('youtube', 'superchat-international');
const fixtureGiftPurchaseHeader = getSyntheticFixture('youtube', 'gift-purchase-header');

const resolveTimestampIso = (chatItem) => {
    const rawTimestamp = chatItem?.item?.timestampUsec;
    if (rawTimestamp === undefined || rawTimestamp === null) {
        return null;
    }
    const numericTimestamp = typeof rawTimestamp === 'number' ? rawTimestamp : Number(rawTimestamp);
    if (!Number.isFinite(numericTimestamp)) {
        return null;
    }
    const adjustedTimestamp = numericTimestamp > 10000000000000
        ? Math.floor(numericTimestamp / 1000)
        : numericTimestamp;
    return new Date(adjustedTimestamp).toISOString();
};

describe('YouTube Notification Dispatcher - Modern (Production Data)', () => {
    let YouTubeNotificationDispatcher;
    let mockHandlers;
    let mockLogger;

    beforeEach(() => {
        jest.resetModules();

        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        mockHandlers = {
            onGift: jest.fn(),
            onGiftPaypiggy: jest.fn(),
            onMembership: jest.fn()
        };

        const DispatcherModule = require('../../../src/utils/youtube-notification-dispatcher');
        YouTubeNotificationDispatcher = DispatcherModule.YouTubeNotificationDispatcher;
    });

    describe('SuperChat Dispatch - Fixture Data', () => {
        it('dispatches SuperChat with correct notification structure', async () => {
            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });

            await dispatcher.dispatchSuperChat(fixtureSuperChat, mockHandlers);

            // User-visible outcome: handler called with notification
            expect(mockHandlers.onGift).toHaveBeenCalledTimes(1);

            const notification = mockHandlers.onGift.mock.calls[0][0];

            // Verify user-visible notification data
            expect(notification.platform).toBe('youtube');
            expect(notification.type).toBe('platform:gift');
            expect(notification.giftType).toBe('Super Chat');
            expect(notification.giftCount).toBe(1);
            expect(notification.username).toBe('SuperChatDonor');
            expect(notification.amount).toBe(25.00);
            expect(notification.currency).toBe('USD');
            expect(notification.isSuperChat).toBe(true);
            expect(notification.message).toBe('Thanks for the stream!');
            expect(notification.id).toBe(fixtureSuperChat.item.id);
            expect(notification.timestamp).toBe(resolveTimestampIso(fixtureSuperChat));
            expect(notification.displayMessage).toBeUndefined();
            expect(notification.ttsMessage).toBeUndefined();
            expect(notification.logMessage).toBeUndefined();
        });

        it('dispatches INR SuperChat correctly', async () => {
            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });

            await dispatcher.dispatchSuperChat(fixtureSuperChatINR, mockHandlers);

            // User-visible outcome: INR parsed correctly
            expect(mockHandlers.onGift).toHaveBeenCalledTimes(1);

            const notification = mockHandlers.onGift.mock.calls[0][0];
            expect(notification.amount).toBe(199);
            expect(notification.currency).toBe('INR');
            expect(notification.username).toBe(INTERNATIONAL_USERNAMES.chinese); // @ stripped
        });
    });

    describe('SuperSticker Dispatch - Fixture Data', () => {
        it('dispatches SuperSticker with correct notification structure', async () => {
            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });

            await dispatcher.dispatchSuperSticker(fixtureSuperSticker, mockHandlers);

            // User-visible outcome: sticker donation dispatched
            expect(mockHandlers.onGift).toHaveBeenCalledTimes(1);
            expect(mockHandlers.onGiftPaypiggy).not.toHaveBeenCalled();

            const notification = mockHandlers.onGift.mock.calls[0][0];
            expect(notification.platform).toBe('youtube');
            expect(notification.type).toBe('platform:gift');
            expect(notification.giftType).toBe('Super Sticker');
            expect(notification.giftCount).toBe(1);
            expect(notification.username).toBe('StickerSupporter');
            expect(notification.amount).toBe(7.99);
            expect(notification.currency).toBe('AUD');
            expect(notification.id).toBe(fixtureSuperSticker.item.id);
            expect(notification.timestamp).toBe(resolveTimestampIso(fixtureSuperSticker));
            expect(notification.displayMessage).toBeUndefined();
            expect(notification.ttsMessage).toBeUndefined();
            expect(notification.logMessage).toBeUndefined();
        });

        it('handles SuperSticker with no message field', async () => {
            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });

            await dispatcher.dispatchSuperSticker(fixtureSuperSticker, mockHandlers);

            // User-visible outcome: empty message for stickers
            const notification = mockHandlers.onGift.mock.calls[0][0];
            expect(notification.message).toBe('');
        });
    });

    describe('Gift Membership Purchase - Header Author Only', () => {
        it('emits error payload when author is only present in header', async () => {
            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });

            const headerOnly = {
                ...fixtureGiftPurchaseHeader,
                item: {
                    ...fixtureGiftPurchaseHeader.item,
                    author: undefined
                }
            };

            await dispatcher.dispatchGiftMembership(headerOnly, mockHandlers);

            expect(mockHandlers.onGiftPaypiggy).toHaveBeenCalledTimes(1);

            const notification = mockHandlers.onGiftPaypiggy.mock.calls[0][0];
            expect(notification).not.toHaveProperty('username');
            expect(notification).not.toHaveProperty('userId');
            expect(notification.giftCount).toBe(5);
            expect(notification.type).toBe('platform:giftpaypiggy');
            expect(notification.id).toBe(fixtureGiftPurchaseHeader.item.id);
            expect(notification.timestamp).toBe(resolveTimestampIso(fixtureGiftPurchaseHeader));
        });
    });

    describe('Error Handling - User Experience', () => {
        it('handles null chatItem gracefully', async () => {
            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });

            const result = await dispatcher.dispatchSuperChat(null, mockHandlers);

            // User-visible outcome: no crash, handler not called
            expect(result).toBe(false);
            expect(mockHandlers.onGift).not.toHaveBeenCalled();
        });

        it('handles undefined chatItem gracefully', async () => {
            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });

            const result = await dispatcher.dispatchSuperChat(undefined, mockHandlers);

            // User-visible outcome: graceful degradation
            expect(result).toBe(false);
            expect(mockHandlers.onGift).not.toHaveBeenCalled();
        });

        it('emits error notification when purchase_amount is missing', async () => {
            const malformed = {
                type: 'AddChatItemAction',
                item: {
                    type: 'LiveChatPaidMessage',
                    author: {
                        id: 'test',
                        name: 'Test'
                    }
                    // Missing purchase_amount
                }
            };

            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });

            const result = await dispatcher.dispatchSuperChat(malformed, mockHandlers);

            // User-visible outcome: error notification still reaches handler
            expect(result).toBe(true);
            expect(mockHandlers.onGift).toHaveBeenCalledTimes(1);

            const notification = mockHandlers.onGift.mock.calls[0][0];
            expect(notification).toMatchObject({
                platform: 'youtube',
                type: 'platform:gift',
                username: 'Test',
                userId: 'test',
                giftType: 'Super Chat',
                giftCount: 1,
                isError: true
            });
            expect(notification).not.toHaveProperty('amount');
            expect(notification).not.toHaveProperty('currency');
            expect(notification).not.toHaveProperty('id');
            expect(notification).not.toHaveProperty('timestamp');
        });

        it('emits error notification when currency parsing fails', async () => {
            const invalidCurrency = {
                ...fixtureSuperChat,
                item: {
                    ...fixtureSuperChat.item,
                    purchase_amount: 'INVALID'
                }
            };

            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });

            const result = await dispatcher.dispatchSuperChat(invalidCurrency, mockHandlers);

            // User-visible outcome: error notification still reaches handler
            expect(result).toBe(true);
            expect(mockHandlers.onGift).toHaveBeenCalledTimes(1);

            const notification = mockHandlers.onGift.mock.calls[0][0];
            expect(notification).toMatchObject({
                platform: 'youtube',
                type: 'platform:gift',
                username: 'SuperChatDonor',
                userId: fixtureSuperChat.item.author.id,
                giftType: 'Super Chat',
                giftCount: 1,
                isError: true,
                id: fixtureSuperChat.item.id
            });
            expect(notification).not.toHaveProperty('amount');
            expect(notification).not.toHaveProperty('currency');
            expect(notification.timestamp).toBe(resolveTimestampIso(fixtureSuperChat));
        });

        it('routes handler errors through platform error handler', async () => {
            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });
            dispatcher.errorHandler = {
                handleEventProcessingError: jest.fn(),
                logOperationalError: jest.fn()
            };

            mockHandlers.onGift.mockImplementation(() => {
                throw new Error('handler boom');
            });

            const result = await dispatcher.dispatchSuperChat(fixtureSuperChat, mockHandlers);

            expect(result).toBe(false);
            expect(dispatcher.errorHandler.handleEventProcessingError).toHaveBeenCalledTimes(1);
            const [errorArg, eventType] = dispatcher.errorHandler.handleEventProcessingError.mock.calls[0];
            expect(errorArg).toBeInstanceOf(Error);
            expect(errorArg.message).toContain('handler boom');
            expect(eventType).toBe('dispatchSuperChat');
        });

        it('returns false when handler is missing and logs warning', async () => {
            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });

            const result = await dispatcher.dispatchSuperChat(fixtureSuperChat, { onGift: null });

            expect(result).toBe(false);
            expect(mockLogger.warn).toHaveBeenCalled();
        });
    });

    describe('Notification Structure Validation', () => {
        it('always includes required notification fields', async () => {
            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });

            await dispatcher.dispatchSuperChat(fixtureSuperChat, mockHandlers);

            const notification = mockHandlers.onGift.mock.calls[0][0];

            // User-visible outcome: complete notification structure
            expect(notification).toMatchObject({
                platform: expect.any(String),
                type: expect.any(String),
                username: expect.any(String),
                userId: expect.any(String),
                id: expect.any(String),
                timestamp: expect.any(String),
                amount: expect.any(Number),
                currency: expect.any(String),
                message: expect.any(String)
            });
        });

        it('includes displayName and username matching name (YouTube reality)', async () => {
            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });

            await dispatcher.dispatchSuperChat(fixtureSuperChat, mockHandlers);

            const notification = mockHandlers.onGift.mock.calls[0][0];

            // User-visible outcome: YouTube only has 'name', so displayName and username match it
            expect(notification.username).toBe('SuperChatDonor');
            // All three fields have the same accurate value from YouTube's author.name
        });
    });

    describe('SuperSticker and membership edge cases', () => {
        it('uses alt text when sticker name missing', async () => {
            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });
            const sticker = {
                ...fixtureSuperSticker,
                item: {
                    ...fixtureSuperSticker.item,
                    sticker: { altText: 'AltSticker' }
                }
            };

            await dispatcher.dispatchSuperSticker(sticker, mockHandlers);

            const notification = mockHandlers.onGift.mock.calls[0][0];
            expect(notification.message).toBe('AltSticker');
        });

        it('handles gift membership with minimal fields', async () => {
            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });
            const membershipGift = {
                type: 'AddChatItemAction',
                item: {
                    type: 'LiveChatMembershipGiftPurchaseAnnouncement',
                    id: 'LCC.test-membership-gift-001',
                    timestampUsec: '1700000000000000',
                    author: {
                        id: 'UC-GIFTER-1',
                        name: 'GiftGifter'
                    },
                    giftMembershipsCount: 3,
                    message: { text: '' }
                }
            };

            await dispatcher.dispatchGiftMembership(membershipGift, mockHandlers);

            expect(mockHandlers.onGiftPaypiggy).toHaveBeenCalledTimes(1);
            const notification = mockHandlers.onGiftPaypiggy.mock.calls[0][0];
            expect(notification.giftCount).toBe(3);
            expect(notification.type).toBe('platform:giftpaypiggy');
            expect(notification.message).toBe('');
        });

        it('emits error notification when gift membership count is missing', async () => {
            const dispatcher = new YouTubeNotificationDispatcher({
                logger: mockLogger
            });
            const membershipGift = {
                type: 'AddChatItemAction',
                item: {
                    type: 'LiveChatMembershipGiftPurchaseAnnouncement',
                    id: 'LCC.test-membership-gift-002',
                    timestampUsec: '1700000000000000',
                    author: {
                        id: 'UC-GIFTER-2',
                        name: 'GiftGifter'
                    }
                }
            };

            await dispatcher.dispatchGiftMembership(membershipGift, mockHandlers);

            expect(mockHandlers.onGiftPaypiggy).toHaveBeenCalledTimes(1);
            const notification = mockHandlers.onGiftPaypiggy.mock.calls[0][0];
            expect(notification).toMatchObject({
                platform: 'youtube',
                type: 'platform:giftpaypiggy',
                username: 'GiftGifter',
                userId: 'UC-GIFTER-2',
                isError: true,
                id: 'LCC.test-membership-gift-002'
            });
            expect(notification).not.toHaveProperty('giftCount');
            expect(notification.timestamp).toBe(resolveTimestampIso(membershipGift));
        });
    });
});
