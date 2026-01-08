const {
    formatCurrencyForTTS,
    getCurrencyWord
} = require('../../../src/utils/notification-strings');

describe('Currency TTS Formatting', () => {
    describe('formatCurrencyForTTS', () => {
        test('formats USD amounts with cents and singular/plural', () => {
            expect(formatCurrencyForTTS(5, '$')).toBe('5 dollars');
            expect(formatCurrencyForTTS(1, '$')).toBe('1 dollar');
            expect(formatCurrencyForTTS(4.99, '$')).toBe('4 dollars 99');
            expect(formatCurrencyForTTS(0.99, '$')).toBe('0 dollars 99');
        });

        test('formats other major currencies', () => {
            expect(formatCurrencyForTTS(10.5, '€')).toBe('10 euros 50');
            expect(formatCurrencyForTTS(1000, 'JPY')).toBe('1000 yen');
        });

        test('returns zero for invalid amounts', () => {
            expect(formatCurrencyForTTS(0, '$')).toBe('0');
            expect(formatCurrencyForTTS(null, '$')).toBe('0');
            expect(formatCurrencyForTTS(undefined, '$')).toBe('0');
            expect(formatCurrencyForTTS(NaN, '$')).toBe('0');
        });

        test('falls back to dollars for unknown currencies', () => {
            expect(formatCurrencyForTTS(5, 'XYZ')).toBe('5 dollars');
            expect(formatCurrencyForTTS(1, 'UNKNOWN')).toBe('1 dollar');
        });
    });

    describe('getCurrencyWord', () => {
        test('maps common symbols and codes', () => {
            expect(getCurrencyWord('$')).toBe('dollars');
            expect(getCurrencyWord('USD')).toBe('dollars');
            expect(getCurrencyWord('€')).toBe('euros');
            expect(getCurrencyWord('JPY')).toBe('yen');
            expect(getCurrencyWord('INR')).toBe('rupees');
        });

        test('maps extended currency names', () => {
            expect(getCurrencyWord('CAD')).toBe('canadian dollars');
            expect(getCurrencyWord('BRL')).toBe('brazilian reais');
        });

        test('falls back to dollars on invalid input', () => {
            expect(getCurrencyWord('')).toBe('dollars');
            expect(getCurrencyWord(null)).toBe('dollars');
            expect(getCurrencyWord(undefined)).toBe('dollars');
            expect(getCurrencyWord('usd')).toBe('dollars');
        });
    });
});
