
const { YouTubeiCurrencyParser } = require('../../../src/utils/youtubei-currency-parser');
const NotificationManager = require('../../../src/notifications/NotificationManager');
const { createTextProcessingManager } = require('../../../src/utils/text-processing');
const { 
    createMockLogger,
    createMockNotificationManager,
    createMockPlatform
} = require('../../helpers/mock-factories');
const { 
    setupAutomatedCleanup 
} = require('../../helpers/mock-lifecycle');

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true
});

const createMockConfigService = () => ({
    areNotificationsEnabled: jest.fn().mockReturnValue(true),
    getPlatformConfig: jest.fn().mockReturnValue(true),
    get: jest.fn((section) => {
        if (section === 'general') {
            return {
                enabled: true,
                chatEnabled: true,
                greetingsEnabled: true,
                giftsEnabled: true,
                userSuppressionEnabled: false,
                maxNotificationsPerUser: 5,
                suppressionWindowMs: 60000,
                suppressionDurationMs: 300000,
                suppressionCleanupIntervalMs: 300000
            };
        }
        return {};
    }),
    isDebugEnabled: jest.fn().mockReturnValue(false),
    getTimingConfig: jest.fn().mockReturnValue({ greetingDuration: 5000 }),
    getTTSConfig: jest.fn().mockReturnValue({ enabled: false })
});

describe('YouTube Turkish Lira (TRY) Currency Parsing', () => {
    describe('YouTubei Currency Parser - TRY Format Support', () => {
        let parser;
        let mockLogger;

        beforeEach(() => {
            mockLogger = createMockLogger('debug');
            parser = new YouTubeiCurrencyParser({ logger: mockLogger });
        });

        describe('Turkish Lira Code+Space Format (TRY XXX.XX)', () => {
            it('should parse "TRY 219.99" correctly', () => {
                const result = parser.parse('TRY 219.99');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(219.99);
                expect(result.currency).toBe('TRY');
                expect(result.symbol).toBe('₺');
                expect(result.originalString).toBe('TRY 219.99');
            });

            it('should parse "TRY 1000" without decimals', () => {
                const result = parser.parse('TRY 1000');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(1000);
                expect(result.currency).toBe('TRY');
                expect(result.symbol).toBe('₺');
            });

            it('should parse "TRY 5,999.99" with thousands separator', () => {
                const result = parser.parse('TRY 5,999.99');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(5999.99);
                expect(result.currency).toBe('TRY');
                expect(result.symbol).toBe('₺');
            });

            it('should parse "TRY 0.50" small amounts', () => {
                const result = parser.parse('TRY 0.50');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(0.50);
                expect(result.currency).toBe('TRY');
                expect(result.symbol).toBe('₺');
            });
        });

        describe('Turkish Lira Symbol Format (₺XXX.XX)', () => {
            it('should parse "₺219.99" symbol-prefixed format', () => {
                const result = parser.parse('₺219.99');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(219.99);
                expect(result.currency).toBe('TRY');
                expect(result.symbol).toBe('₺');
            });

            it('should parse "₺1,000.00" with thousands separator', () => {
                const result = parser.parse('₺1,000.00');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(1000.00);
                expect(result.currency).toBe('TRY');
                expect(result.symbol).toBe('₺');
            });
        });

        describe('Other International Currency Code+Space Formats', () => {
            it('should parse "EUR 50.00" European format', () => {
                const result = parser.parse('EUR 50.00');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(50.00);
                expect(result.currency).toBe('EUR');
                expect(result.symbol).toBe('€');
            });

            it('should parse "GBP 25.50" British format', () => {
                const result = parser.parse('GBP 25.50');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(25.50);
                expect(result.currency).toBe('GBP');
                expect(result.symbol).toBe('£');
            });

            it('should parse "JPY 5000" Japanese format (no decimals)', () => {
                const result = parser.parse('JPY 5000');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(5000);
                expect(result.currency).toBe('JPY');
                expect(result.symbol).toBe('¥');
            });

            it('should parse "KRW 50000" Korean format (no decimals)', () => {
                const result = parser.parse('KRW 50000');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(50000);
                expect(result.currency).toBe('KRW');
                expect(result.symbol).toBe('₩');
            });

            it('should parse "BRL 100.00" Brazilian format', () => {
                const result = parser.parse('BRL 100.00');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(100.00);
                expect(result.currency).toBe('BRL');
                expect(result.symbol).toBe('R$');
            });

            it('should parse "RUB 1500.00" Russian format', () => {
                const result = parser.parse('RUB 1500.00');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(1500.00);
                expect(result.currency).toBe('RUB');
                expect(result.symbol).toBe('₽');
            });

            it('should parse "PLN 75.50" Polish format', () => {
                const result = parser.parse('PLN 75.50');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(75.50);
                expect(result.currency).toBe('PLN');
                expect(result.symbol).toBe('zł');
            });

            it('should parse "THB 1000.00" Thai format', () => {
                const result = parser.parse('THB 1000.00');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(1000.00);
                expect(result.currency).toBe('THB');
                expect(result.symbol).toBe('฿');
            });

            it('should parse "PHP 2500.00" Philippine format', () => {
                const result = parser.parse('PHP 2500.00');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(2500.00);
                expect(result.currency).toBe('PHP');
                expect(result.symbol).toBe('₱');
            });

            it('should parse "MYR 50.00" Malaysian format', () => {
                const result = parser.parse('MYR 50.00');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(50.00);
                expect(result.currency).toBe('MYR');
                expect(result.symbol).toBe('RM');
            });

            it('should parse "ZAR 200.00" South African format', () => {
                const result = parser.parse('ZAR 200.00');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(200.00);
                expect(result.currency).toBe('ZAR');
                expect(result.symbol).toBe('R');
            });

            it('should parse "NGN 5000.00" Nigerian format', () => {
                const result = parser.parse('NGN 5000.00');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(5000.00);
                expect(result.currency).toBe('NGN');
                expect(result.symbol).toBe('₦');
            });
        });

        describe('Edge Cases and Error Conditions', () => {
            it('should handle TRY with European decimal format "TRY 219,99"', () => {
                const result = parser.parse('TRY 219,99');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(219.99);
                expect(result.currency).toBe('TRY');
            });

            it('should handle extra spaces "TRY  219.99"', () => {
                const result = parser.parse('TRY  219.99');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(219.99);
                expect(result.currency).toBe('TRY');
            });

            it('should handle lowercase "try 219.99"', () => {
                const result = parser.parse('try 219.99');
                
                expect(result.success).toBe(true);
                expect(result.amount).toBe(219.99);
                expect(result.currency).toBe('TRY');
            });

            it('should NOT parse as zero when format is unrecognized', () => {
                const result = parser.parse('TRY 219.99');
                
                // Should not return 0 for a valid TRY amount
                expect(result.amount).not.toBe(0);
            });
        });
    });

    describe('Notification Manager - Zero Amount Filtering', () => {
        let notificationManager;
        let mockConfigService;
        let mockDisplayQueue;
        let mockLogger;

        beforeEach(() => {
            mockLogger = createMockLogger('debug');
            mockDisplayQueue = {
                add: jest.fn().mockReturnValue(true),
                addItem: jest.fn().mockReturnValue(true),
                getQueueLength: jest.fn().mockReturnValue(0)
            };
            mockConfigService = createMockConfigService();

            const mockEventBus = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
            const constants = require('../../../src/core/constants');
            const textProcessing = createTextProcessingManager({ logger: mockLogger });
            const obsGoals = require('../../../src/obs/goals').getDefaultGoalsManager();
            const vfxCommandService = { getVFXConfig: jest.fn().mockResolvedValue(null) };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                configService: mockConfigService,
                constants,
                textProcessing,
                obsGoals,
                vfxCommandService
            });
        });

        describe('SuperChat with Parsing Failures', () => {
            it('should NOT filter out TRY 219.99 SuperChat', async () => {
                const superChatData = {
                    username: 'TurkishUser',
                    userId: 'user123',
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: 219.99, // Should be parsed correctly
                    currency: 'TRY',
                    message: 'Merhaba!',
                    displayString: 'TRY 219.99'
                };

                const result = await notificationManager.handleNotification(
                    'gift',
                    'youtube',
                    superChatData
                );

                // Should NOT be filtered
                expect(result.success).toBe(true);
                expect(result.filtered).not.toBe(true);
                expect(result.reason).not.toBe('Zero amount not displayed');
                expect(mockDisplayQueue.addItem).toHaveBeenCalled();
            });

            it('should correctly filter actual zero-amount gifts', async () => {
                const zeroGiftData = {
                    username: 'TestUser',
                    userId: 'user456',
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: 0, // Actually zero
                    currency: 'USD',
                    message: 'Test'
                };

                const result = await notificationManager.handleNotification(
                    'gift',
                    'youtube',
                    zeroGiftData
                );

                // Should be filtered
                expect(result.success).toBe(false);
                expect(result.filtered).toBe(true);
                expect(result.reason).toBe('Zero amount not displayed');
                expect(mockDisplayQueue.add).not.toHaveBeenCalled();
            });

            it('should handle SuperChat with unparseable currency gracefully', async () => {
                const superChatData = {
                    username: 'TestUser',
                    userId: 'user789',
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: null, // Failed to parse
                    currency: 'UNKNOWN',
                    displayString: 'XYZ 100.00',
                    message: 'Test message'
                };

                const result = await notificationManager.handleNotification(
                    'gift',
                    'youtube',
                    superChatData
                );

                // Should handle gracefully - not crash, but may be filtered
                expect(result).toBeDefined();
                expect(result.success).toBeDefined();
            });
        });

        describe('International Currency Support in Notifications', () => {
            const testCurrencies = [
                { code: 'TRY', amount: 219.99, symbol: '₺' },
                { code: 'EUR', amount: 50.00, symbol: '€' },
                { code: 'GBP', amount: 25.50, symbol: '£' },
                { code: 'JPY', amount: 5000, symbol: '¥' },
                { code: 'KRW', amount: 50000, symbol: '₩' },
                { code: 'BRL', amount: 100.00, symbol: 'R$' },
                { code: 'RUB', amount: 1500.00, symbol: '₽' },
                { code: 'PLN', amount: 75.50, symbol: 'zł' }
            ];

            testCurrencies.forEach(({ code, amount, symbol }) => {
                it(`should process ${code} SuperChat with amount ${amount}`, async () => {
                    const superChatData = {
                        username: `${code}User`,
                        userId: `user_${code}`,
                        giftType: 'Super Chat',
                        giftCount: 1,
                        amount: amount,
                        currency: code,
                        message: `Test ${code} donation`,
                        displayString: `${code} ${amount}`
                    };

                    const result = await notificationManager.handleNotification(
                        'gift',
                        'youtube',
                        superChatData
                    );

                    expect(result.success).toBe(true);
                    expect(result.filtered).not.toBe(true);
                    expect(mockDisplayQueue.addItem).toHaveBeenCalled();
                    
                    const addedNotification = mockDisplayQueue.addItem.mock.calls[0][0];
                    expect(addedNotification).toBeDefined();
                    expect(addedNotification.data).toBeDefined();
                    // Check that the amount is preserved in the notification data
                    expect(addedNotification.data.amount).toBe(amount);
                });
            });
        });
    });

    describe('End-to-End Integration Test', () => {
        it('should correctly process a Turkish Lira SuperChat from YouTube event', async () => {
            // Simulate the full flow from YouTube event to notification display
            const youtubeEvent = {
                type: 'superchat',
                data: {
                    author: {
                        name: 'TurkishViewer',
                        channelId: 'UC123456'
                    },
                    superchat: {
                        amount: 'TRY 219.99', // Raw format from YouTube
                        message: 'Harika yayın!' // "Great stream!" in Turkish
                    }
                }
            };

            // Parse currency
            const parser = new YouTubeiCurrencyParser();
            const parseResult = parser.parse(youtubeEvent.data.superchat.amount);
            
            // Verify parsing succeeded
            expect(parseResult.success).toBe(true);
            expect(parseResult.amount).toBe(219.99);
            expect(parseResult.currency).toBe('TRY');

            // Create notification data
            const notificationData = {
                username: youtubeEvent.data.author.name,
                userId: youtubeEvent.data.author.channelId,
                giftType: 'Super Chat',
                giftCount: 1,
                amount: parseResult.amount,
                currency: parseResult.currency,
                message: youtubeEvent.data.superchat.message,
                displayString: youtubeEvent.data.superchat.amount
            };

            // Process through notification manager
            const mockDisplayQueue = { 
                add: jest.fn().mockReturnValue(true),
                addItem: jest.fn().mockReturnValue(true),
                getQueueLength: jest.fn().mockReturnValue(0)
            };
            const mockEventBus = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
            const constants = require('../../../src/core/constants');
            const logger = createMockLogger('debug');
            const textProcessing = createTextProcessingManager({ logger });
            const obsGoals = require('../../../src/obs/goals').getDefaultGoalsManager();
            const vfxCommandService = { getVFXConfig: jest.fn().mockResolvedValue(null) };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger,
                eventBus: mockEventBus,
                configService: createMockConfigService(),
                constants,
                textProcessing,
                obsGoals,
                vfxCommandService
            });

            const result = await notificationManager.handleNotification(
                'gift',
                'youtube',
                notificationData
            );

            // Verify notification was NOT filtered
            expect(result.success).toBe(true);
            expect(result.filtered).not.toBe(true);
        });
    });
});

describe('Currency Parsing Performance and Reliability', () => {
    let parser;

    beforeEach(() => {
        parser = new YouTubeiCurrencyParser({ logger: createMockLogger('error') });
    });

    it('should parse 1000 TRY amounts quickly', () => {
        const startTime = Date.now();
        
        for (let i = 0; i < 1000; i++) {
            const amount = (Math.random() * 10000).toFixed(2);
            const result = parser.parse(`TRY ${amount}`);
            expect(result.success).toBe(true);
        }
        
        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(1300); // Keep within a reasonable CI-safe bound
    });

    it('should handle malformed inputs without crashing', () => {
        const malformedInputs = [
            'TRY',
            'TRY ',
            ' TRY',
            'TRY NaN',
            'TRY infinity',
            'TRY -100',
            'TRY 1.2.3.4',
            'TRY 1,2,3,4',
            null,
            undefined,
            {},
            [],
            123,
            true
        ];

        malformedInputs.forEach(input => {
            expect(() => parser.parse(input)).not.toThrow();
            const result = parser.parse(input);
            expect(result).toBeDefined();
            expect(result.success).toBeDefined();
        });
    });
});
