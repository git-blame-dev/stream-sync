const { normalizeCurrency, getCodeToSymbolMap } = require('../../../src/utils/currency-utils');

describe('currency-utils behavior', () => {
    it('normalizes unknown currency to XXX and warns via logger', () => {
        const logger = { warn: jest.fn() };
        const code = normalizeCurrency('💰', { logger });
        expect(code).toBe('XXX');
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown currency input "💰"'), 'currency-utils');
    });

    it('maps known symbols and codes to canonical values', () => {
        expect(normalizeCurrency('$')).toBe('USD');
        expect(normalizeCurrency('usd')).toBe('USD');
        expect(getCodeToSymbolMap().get('USD')).toBe('$');
    });
});
