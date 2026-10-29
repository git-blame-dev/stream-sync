import { expect, test } from 'bun:test';
import { YouTubeiCurrencyParser } from '../../../src/platforms/youtube/youtubei-currency-parser';
import { createYouTubeMonetizationParser } from '../../../src/platforms/youtube/monetization/monetization-parser';
import { createYouTubeEventFactory } from '../../../src/platforms/youtube/events/event-factory';
import { noOpLogger } from '../../helpers/mock-factories';

const parser = new YouTubeiCurrencyParser({ logger: noOpLogger });
const money = createYouTubeMonetizationParser({ logger: noOpLogger });
const factory = createYouTubeEventFactory();
const item = (purchase_amount: string) => ({ item: { id: 'synthetic-purchase', timestamp_usec: '1700000000000000', purchase_amount } });
for (const method of ['parseSuperChat', 'parseSuperSticker'] as const) {
    test.each(['R$5.00', 'NT$5.00', 'HK$5.00', 'S$5.00', 'NZ$5.00', 'garbage$5.00tail', '$5.00tail',
        '$1,2,3.45', '$1,,000', '$1.2.3', '€1.23,45', 'TRY 12oops', 'A$12oops', 'CA$12oops',
        'USD 1,2,3', 'XYZ$1,2,3', '$-5', '-$5', '+$5', '$0', '$NaN', '$Infinity', `$${'9'.repeat(400)}`])(
        `${method} rejects incomplete or malformed purchase %s`, input => {
            expect(parser.parse(input).success).toBe(false);
            expect(() => money[method](item(input))).toThrow('valid purchase_amount');
        });
    test.each([
        ['$5.00', 5, 'USD'], ['A$5.00', 5, 'AUD'], ['CA$5.00', 5, 'CAD'], ['€1.234,56', 1234.56, 'EUR'],
        ['$1,234.56', 1234.56, 'USD'], ['€12,50', 12.5, 'EUR'], ['TRY 12.50', 12.5, 'TRY'],
        ['XYZ 5.00', 5, 'XYZ'], ['XYZ$5.00', 5, 'XYZ'], ['uSd 5.00', 5, 'USD'],
    ] as const)(`${method} preserves supported whole purchase %s`, (input, amount, currency) => {
        const result = factory.createGiftEvent({ ...money[method](item(input)), userId: 'synthetic-viewer', username: 'Synthetic Viewer' });
        expect(result.amount).toBe(amount);
        expect(result.currency).toBe(currency);
        expect(result.isError).not.toBe(true);
    });
}
