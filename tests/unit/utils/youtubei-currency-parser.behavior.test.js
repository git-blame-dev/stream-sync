const { describe, expect, it } = require('bun:test');

const { YouTubeiCurrencyParser } = require('../../../src/utils/youtubei-currency-parser');
const { noOpLogger } = require('../../helpers/mock-factories');

describe('YouTubeiCurrencyParser unknown currency handling', () => {
    it('returns failure result for unknown currency formats', () => {
        const parser = new YouTubeiCurrencyParser({ logger: noOpLogger });

        const result = parser.parse('@@@');

        expect(result.success).toBe(false);
        expect(result.reason).toBe('Unknown currency format');
    });

    it('returns failure result for invalid input', () => {
        const parser = new YouTubeiCurrencyParser({ logger: noOpLogger });

        expect(parser.parse(null).success).toBe(false);
        expect(parser.parse('').success).toBe(false);
        expect(parser.parse('   ').success).toBe(false);
    });

    it('returns failure result for negative amounts', () => {
        const parser = new YouTubeiCurrencyParser({ logger: noOpLogger });

        const result = parser.parse('-$50.00');

        expect(result.success).toBe(false);
        expect(result.reason).toBe('Negative amount not allowed');
    });

    it('parses known currency formats successfully', () => {
        const parser = new YouTubeiCurrencyParser({ logger: noOpLogger });

        const tryResult = parser.parse('TRY 219.99');
        expect(tryResult.success).toBe(true);
        expect(tryResult.currency).toBe('TRY');
        expect(tryResult.amount).toBe(219.99);

        const usdResult = parser.parse('$10.00');
        expect(usdResult.success).toBe(true);
        expect(usdResult.currency).toBe('USD');
        expect(usdResult.amount).toBe(10);

        const eurResult = parser.parse('€25.50');
        expect(eurResult.success).toBe(true);
        expect(eurResult.currency).toBe('EUR');
        expect(eurResult.amount).toBe(25.5);
    });

    it('handles various currency symbol formats', () => {
        const parser = new YouTubeiCurrencyParser({ logger: noOpLogger });

        expect(parser.parse('₹200.00').success).toBe(true);
        expect(parser.parse('£50.00').success).toBe(true);
        expect(parser.parse('¥1000').success).toBe(true);
    });

    it('handles code+symbol formats', () => {
        const parser = new YouTubeiCurrencyParser({ logger: noOpLogger });

        const cadResult = parser.parse('CA$25.99');
        expect(cadResult.success).toBe(true);
        expect(cadResult.currency).toBe('CAD');

        const audResult = parser.parse('A$30.00');
        expect(audResult.success).toBe(true);
        expect(audResult.currency).toBe('AUD');
    });

    it('preserves original string in result', () => {
        const parser = new YouTubeiCurrencyParser({ logger: noOpLogger });

        const result = parser.parse('TRY 100');
        expect(result.originalString).toBe('TRY 100');

        const unknownResult = parser.parse('XYZ123');
        expect(unknownResult.originalString).toBe('XYZ123');
    });
});
