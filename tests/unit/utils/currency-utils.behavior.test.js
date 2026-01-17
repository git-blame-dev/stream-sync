const { describe, expect, it } = require('bun:test');
const { noOpLogger } = require('../../helpers/mock-factories');
const { normalizeCurrency, getCodeToSymbolMap } = require('../../../src/utils/currency-utils');

describe('currency-utils behavior', () => {
    it('normalizes unknown currency to XXX', () => {
        const code = normalizeCurrency('💰', { logger: noOpLogger });
        expect(code).toBe('XXX');
    });

    it('maps known symbols and codes to canonical values', () => {
        expect(normalizeCurrency('$')).toBe('USD');
        expect(normalizeCurrency('usd')).toBe('USD');
        expect(getCodeToSymbolMap().get('USD')).toBe('$');
    });
});
