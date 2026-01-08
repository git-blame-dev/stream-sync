
const { getSyntheticFixture } = require('../../helpers/platform-test-data');

const realSuperSticker = getSyntheticFixture('youtube', 'supersticker');
const realSuperChat = getSyntheticFixture('youtube', 'superchat');
const realSuperChatINR = getSyntheticFixture('youtube', 'superchat-international');

describe('YouTube Currency Parsing - Modern (Production Data)', () => {
    let YouTubeCurrencyParser;

    beforeEach(() => {
        jest.resetModules();
        YouTubeCurrencyParser = require('../../../src/utils/youtubei-currency-parser');
    });

    describe('Real Production Formats', () => {
        it('parses Australian dollar from SuperSticker', () => {
            const parser = new YouTubeCurrencyParser.YouTubeiCurrencyParser({
                logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
            });

            // Real production data: "A$7.99"
            const result = parser.parse(realSuperSticker.item.purchase_amount);

            // User-visible outcome: correct amount and currency
            expect(result.amount).toBe(7.99);
            expect(result.currency).toBe('AUD');
            expect(result.success).toBe(true);
        });

        it('parses US dollar from SuperChat', () => {
            const parser = new YouTubeCurrencyParser.YouTubeiCurrencyParser({
                logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
            });

            // Real production data: "$25.00"
            const result = parser.parse(realSuperChat.item.purchase_amount);

            // User-visible outcome: US dollar parsed
            expect(result.amount).toBe(25.00);
            expect(result.currency).toBe('USD');
            expect(result.success).toBe(true);
        });

        it('parses Indian rupee from SuperChat', () => {
            const parser = new YouTubeCurrencyParser.YouTubeiCurrencyParser({
                logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
            });

            // Real production data: "₹199"
            const result = parser.parse(realSuperChatINR.item.purchase_amount);

            // User-visible outcome: INR parsed
            expect(result.amount).toBe(199);
            expect(result.currency).toBe('INR');
            expect(result.success).toBe(true);
        });
    });

    describe('International Currency Formats', () => {
        let parser;

        beforeEach(() => {
            parser = new YouTubeCurrencyParser.YouTubeiCurrencyParser({
                logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
            });
        });

        it('parses Euro', () => {
            const result = parser.parse('€10.50');

            // User-visible outcome
            expect(result.amount).toBe(10.50);
            expect(result.currency).toBe('EUR');
            expect(result.success).toBe(true);
        });

        it('parses British Pound', () => {
            const result = parser.parse('£15.99');

            // User-visible outcome
            expect(result.amount).toBe(15.99);
            expect(result.currency).toBe('GBP');
            expect(result.success).toBe(true);
        });

        it('parses Canadian Dollar', () => {
            const result = parser.parse('CA$20.00');

            // User-visible outcome
            expect(result.amount).toBe(20.00);
            expect(result.currency).toBe('CAD');
            expect(result.success).toBe(true);
        });

        it('parses Japanese Yen (no decimals)', () => {
            const result = parser.parse('¥1000');

            // User-visible outcome
            expect(result.amount).toBe(1000);
            expect(result.currency).toBe('JPY');
            expect(result.success).toBe(true);
        });

        it('parses European formatted Euro values', () => {
            const result = parser.parse('€1.234,50');

            expect(result.success).toBe(true);
            expect(result.amount).toBe(1234.5);
            expect(result.currency).toBe('EUR');
        });
    });

    describe('Error Handling - User Experience', () => {
        let parser;

        beforeEach(() => {
            parser = new YouTubeCurrencyParser.YouTubeiCurrencyParser({
                logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
            });
        });

        it('handles null gracefully', () => {
            const result = parser.parse(null);

            // User-visible outcome: graceful fallback
            expect(result.success).toBe(false);
            expect(result.amount).toBe(0);
            expect(result.currency).toBe('USD');
        });

        it('handles undefined gracefully', () => {
            const result = parser.parse(undefined);

            // User-visible outcome: graceful fallback
            expect(result.success).toBe(false);
            expect(result.amount).toBe(0);
            expect(result.currency).toBe('USD');
        });

        it('handles empty string gracefully', () => {
            const result = parser.parse('');

            // User-visible outcome: graceful fallback
            expect(result.success).toBe(false);
            expect(result.amount).toBe(0);
            expect(result.currency).toBe('USD');
        });

        it('handles invalid format gracefully', () => {
            const result = parser.parse('invalid');

            // User-visible outcome: fails gracefully
            expect(result.success).toBe(false);
            expect(result.amount).toBe(0);
        });

        it('fails gracefully on negative amounts', () => {
            const logger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
            const negativeParser = new YouTubeCurrencyParser.YouTubeiCurrencyParser({ logger });

            const result = negativeParser.parse('-$5.00');

            expect(result.success).toBe(false);
            expect(logger.warn).toHaveBeenCalled();
        });

        it('logs and rejects trailing-symbol formats', () => {
            const logger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
            const trailingParser = new YouTubeCurrencyParser.YouTubeiCurrencyParser({ logger });

            const result = trailingParser.parse('10€');

            expect(result.success).toBe(false);
            expect(result.amount).toBe(0);
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    describe('Performance', () => {
        it('parses currency in under 50ms for 1000 iterations', () => {
            const parser = new YouTubeCurrencyParser.YouTubeiCurrencyParser({
                logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
            });

            const start = Date.now();

            for (let i = 0; i < 1000; i++) {
                parser.parse('$25.00');
            }

            const duration = Date.now() - start;

            // User-visible outcome: fast parsing
            expect(duration).toBeLessThan(50);
        });
    });
});
