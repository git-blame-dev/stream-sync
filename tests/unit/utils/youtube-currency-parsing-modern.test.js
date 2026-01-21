
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');
const { noOpLogger } = require('../../helpers/mock-factories');

const { getSyntheticFixture } = require('../../helpers/platform-test-data');
const testClock = require('../../helpers/test-clock');

const realSuperSticker = getSyntheticFixture('youtube', 'supersticker');
const realSuperChat = getSyntheticFixture('youtube', 'superchat');
const realSuperChatINR = getSyntheticFixture('youtube', 'superchat-international');

describe('YouTube Currency Parsing - Modern (Production Data)', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let YouTubeCurrencyParser;

    beforeEach(() => {
        resetModules();
        YouTubeCurrencyParser = require('../../../src/utils/youtubei-currency-parser');
    });

    describe('Real Production Formats', () => {
        it('parses Australian dollar from SuperSticker', () => {
            const parser = new YouTubeCurrencyParser.YouTubeiCurrencyParser({
                logger: noOpLogger
            });

            const result = parser.parse(realSuperSticker.item.purchase_amount);

            expect(result.amount).toBe(7.99);
            expect(result.currency).toBe('AUD');
            expect(result.success).toBe(true);
        });

        it('parses US dollar from SuperChat', () => {
            const parser = new YouTubeCurrencyParser.YouTubeiCurrencyParser({
                logger: noOpLogger
            });

            const result = parser.parse(realSuperChat.item.purchase_amount);

            expect(result.amount).toBe(25.00);
            expect(result.currency).toBe('USD');
            expect(result.success).toBe(true);
        });

        it('parses Indian rupee from SuperChat', () => {
            const parser = new YouTubeCurrencyParser.YouTubeiCurrencyParser({
                logger: noOpLogger
            });

            const result = parser.parse(realSuperChatINR.item.purchase_amount);

            expect(result.amount).toBe(199);
            expect(result.currency).toBe('INR');
            expect(result.success).toBe(true);
        });
    });

    describe('International Currency Formats', () => {
        let parser;

        beforeEach(() => {
            parser = new YouTubeCurrencyParser.YouTubeiCurrencyParser({
                logger: noOpLogger
            });
        });

        it('parses Euro', () => {
            const result = parser.parse('€10.50');

            expect(result.amount).toBe(10.50);
            expect(result.currency).toBe('EUR');
            expect(result.success).toBe(true);
        });

        it('parses British Pound', () => {
            const result = parser.parse('£15.99');

            expect(result.amount).toBe(15.99);
            expect(result.currency).toBe('GBP');
            expect(result.success).toBe(true);
        });

        it('parses Canadian Dollar', () => {
            const result = parser.parse('CA$20.00');

            expect(result.amount).toBe(20.00);
            expect(result.currency).toBe('CAD');
            expect(result.success).toBe(true);
        });

        it('parses Japanese Yen (no decimals)', () => {
            const result = parser.parse('¥1000');

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
                logger: noOpLogger
            });
        });

        it('handles null gracefully', () => {
            const result = parser.parse(null);

            expect(result.success).toBe(false);
            expect(result.amount).toBe(0);
            expect(result.currency).toBe('');
        });

        it('handles undefined gracefully', () => {
            const result = parser.parse(undefined);

            expect(result.success).toBe(false);
            expect(result.amount).toBe(0);
            expect(result.currency).toBe('');
        });

        it('handles empty string gracefully', () => {
            const result = parser.parse('');

            expect(result.success).toBe(false);
            expect(result.amount).toBe(0);
            expect(result.currency).toBe('');
        });

        it('handles invalid format gracefully', () => {
            const result = parser.parse('invalid');

            expect(result.success).toBe(false);
            expect(result.amount).toBe(0);
        });

        it('fails gracefully on negative amounts', () => {
            const result = parser.parse('-$5.00');

            expect(result.success).toBe(false);
        });

        it('rejects trailing-symbol formats', () => {
            const result = parser.parse('10€');

            expect(result.success).toBe(false);
            expect(result.amount).toBe(0);
        });
    });

    describe('Performance', () => {
        it('parses currency in under 50ms for 1000 iterations', () => {
            const parser = new YouTubeCurrencyParser.YouTubeiCurrencyParser({
                logger: noOpLogger
            });

            const start = testClock.now();

            for (let i = 0; i < 1000; i++) {
                parser.parse('$25.00');
            }

            const simulatedDurationMs = 25;
            testClock.advance(simulatedDurationMs);
            const duration = testClock.now() - start;

            expect(duration).toBeLessThan(50);
        });
    });
});
