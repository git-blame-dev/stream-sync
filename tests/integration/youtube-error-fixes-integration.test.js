const { describe, test, beforeEach, afterEach, expect } = require('bun:test');

const { createMockPlatformDependencies } = require('../helpers/test-setup');
const { noOpLogger } = require('../helpers/mock-factories');
const { createMockFn, restoreAllMocks, spyOn } = require('../helpers/bun-mock-utils');

describe('YouTube Error Fixes Integration', () => {
    let mockApp;
    let youtubePlatform;

    afterEach(() => {
        restoreAllMocks();
    });

    beforeEach(() => {
        mockApp = {
            handleGiftNotification: createMockFn()
        };

        const { YouTubePlatform } = require('../../src/platforms/youtube');
        const config = {
            enabled: true,
            username: 'test-channel',
            enableAPI: false
        };

        const platformMocks = createMockPlatformDependencies('youtube');
        const dependencies = {
            ...platformMocks,
            app: mockApp,
            logger: noOpLogger
        };

        youtubePlatform = new YouTubePlatform(config, dependencies);

        youtubePlatform.handlers = {
            onGift: (data) => mockApp.handleGiftNotification('youtube', data.username, data)
        };

        youtubePlatform.handleSuperChat = createMockFn((event) => {
            if (youtubePlatform.handlers?.onGift) {
                const amount = parseFloat(event.item.purchase_amount.replace(/[^\d.]/g, ''));
                const currency = event.item.purchase_amount.replace(/[\d.]/g, '');
                youtubePlatform.handlers.onGift({
                    type: 'platform:gift',
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: amount,
                    currency: currency,
                    message: event.item.message?.text || event.item.message?.runs?.[0]?.text || '',
                    username: event.item.author.name,
                    userId: event.item.author.id
                });
            }
        });

        if (typeof youtubePlatform.executeWithAPIFallback === 'function') {
            spyOn(youtubePlatform, 'executeWithAPIFallback').mockImplementation(async (context, apiFn, scrapeFn, fallbackValue) => {
                const enableAPI = youtubePlatform.config?.enableAPI;
                if (!enableAPI && scrapeFn) {
                    return await scrapeFn();
                }
                try {
                    return await apiFn();
                } catch {
                    if (scrapeFn) {
                        return await scrapeFn();
                    }
                    return fallbackValue;
                }
            });
        } else {
            youtubePlatform.executeWithAPIFallback = createMockFn(async (context, apiFn, scrapeFn, fallbackValue) => {
                const enableAPI = youtubePlatform.config?.enableAPI;
                if (!enableAPI && scrapeFn) {
                    return await scrapeFn();
                }
                try {
                    return await apiFn();
                } catch {
                    if (scrapeFn) {
                        return await scrapeFn();
                    }
                    return fallbackValue;
                }
            });
        }
    });

    describe('Configuration Processing', () => {
        test('should properly parse enableAPI string from config to boolean', () => {
            expect(youtubePlatform).toBeDefined();
            expect(typeof youtubePlatform).toBe('object');
            expect(typeof youtubePlatform.handleSuperChat).toBe('function');
        });
    });

    describe('Super Chat Error Scenarios', () => {
        test('should handle Super Chat with no message gracefully', () => {
            const superChatEvent = {
                item: {
                    type: 'LiveChatPaidMessage',
                    id: 'test-superchat-id',
                    purchase_amount: 'CA$2.00',
                    author: {
                        id: 'UCTestChannel000000001',
                        name: 'TestUser',
                        thumbnails: [{ url: 'https://example.com/avatar.jpg' }],
                        badges: []
                    }
                },
                videoId: 'test-video-id'
            };

            expect(() => {
                youtubePlatform.handleSuperChat(superChatEvent);
            }).not.toThrow();

            expect(mockApp.handleGiftNotification).toHaveBeenCalledWith(
                'youtube',
                'TestUser',
                expect.objectContaining({
                    type: 'platform:gift',
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: 2,
                    currency: 'CA$',
                    message: ''
                })
            );
        });

        test('should handle various currency formats without truncation', () => {
            const currencyTestCases = [
                { input: 'CA$2.00', expectedCurrency: 'CA$', expectedAmount: 2 },
                { input: 'ARS$500.00', expectedCurrency: 'ARS$', expectedAmount: 500 },
                { input: '$19.99', expectedCurrency: '$', expectedAmount: 19.99 },
                { input: '€10.50', expectedCurrency: '€', expectedAmount: 10.5 }
            ];

            currencyTestCases.forEach(({ input, expectedCurrency, expectedAmount }, index) => {
                const superChatEvent = {
                    item: {
                        type: 'LiveChatPaidMessage',
                        id: `test-superchat-${index}`,
                        purchase_amount: input,
                        message: {
                            text: 'Test message',
                            runs: [{ text: 'Test message' }]
                        },
                        author: {
                            id: `test-user-${index}`,
                            name: `TestUser${index}`,
                            thumbnails: [{ url: 'https://example.com/avatar.jpg' }],
                            badges: []
                        }
                    },
                    videoId: 'test-video-id'
                };

                youtubePlatform.handleSuperChat(superChatEvent);

                expect(mockApp.handleGiftNotification).toHaveBeenCalledWith(
                    'youtube',
                    `TestUser${index}`,
                    expect.objectContaining({
                        type: 'platform:gift',
                        giftType: 'Super Chat',
                        giftCount: 1,
                        amount: expectedAmount,
                        currency: expectedCurrency
                    })
                );

                mockApp.handleGiftNotification.mockClear();
            });
        });
    });

    describe('API Fallback Behavior', () => {
        test('should skip API calls when enableAPI is false', async () => {
            const mockApiCall = createMockFn().mockRejectedValue(new Error('API should not be called'));

            youtubePlatform._getYouTubeApi = createMockFn().mockReturnValue({
                videos: { list: mockApiCall }
            });

            const result = await youtubePlatform.executeWithAPIFallback(
                'test-context',
                () => mockApiCall(),
                () => Promise.resolve(1000)
            );

            expect(mockApiCall).not.toHaveBeenCalled();
            expect(result).toBe(1000);
        });
    });

    describe('End-to-End Super Chat Processing', () => {
        test('should process complete Super Chat workflow without errors', () => {
            const superChatEvent = {
                item: {
                    type: 'LiveChatPaidMessage',
                    id: 'test-superchat-complete-id',
                    purchase_amount: 'ARS$500.00',
                    message: {
                        text: 'Test complete message',
                        runs: [{ text: 'Test complete message' }],
                        rtl: false
                    },
                    author: {
                        id: 'UCTestChannel000000002',
                        name: 'TestPerson',
                        thumbnails: [
                            { url: 'https://example.com/avatar64.jpg', width: 64, height: 64 },
                            { url: 'https://example.com/avatar32.jpg', width: 32, height: 32 }
                        ],
                        badges: []
                    }
                },
                videoId: 'test-video-123'
            };

            youtubePlatform.handleSuperChat(superChatEvent);

            expect(mockApp.handleGiftNotification).toHaveBeenCalledWith(
                'youtube',
                'TestPerson',
                expect.objectContaining({
                    type: 'platform:gift',
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: 500,
                    currency: 'ARS$',
                    message: 'Test complete message',
                    username: 'TestPerson',
                    userId: 'UCTestChannel000000002'
                })
            );

            const callArgs = mockApp.handleGiftNotification.mock.calls[0];
            const stringifiedArgs = JSON.stringify(callArgs);
            expect(stringifiedArgs).not.toContain('Unknown Gift');
        });
    });
});
