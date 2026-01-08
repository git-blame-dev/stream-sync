
// Manual overrides for symbols that may be missing from the current locale data
const MANUAL_SYMBOL_TO_CODE = {
    '₽': 'RUB', // Russian Ruble
    '฿': 'THB', // Thai Baht
    '₫': 'VND', // Vietnamese Dong
    '₱': 'PHP', // Philippine Peso
    '元': 'CNY', // Chinese Yuan (character symbol)
    '円': 'JPY', // Japanese Yen (character symbol)
    'NT$': 'TWD', // New Taiwan Dollar
    '₩': 'KRW', // South Korean Won (alternate glyph)
    '₴': 'UAH', // Ukrainian Hryvnia
    '₦': 'NGN', // Nigerian Naira
    '₵': 'GHS', // Ghanaian Cedi
    '₭': 'LAK', // Lao Kip
    '₲': 'PYG', // Paraguayan Guaraní
    '₡': 'CRC', // Costa Rican Colón
    '₺': 'TRY', // Turkish Lira
    '₸': 'KZT', // Kazakhstani Tenge
    '₮': 'MNT'  // Mongolian Tögrög
};

let _symbolToCodeMap = null;
let _codeToSymbolMap = null;

function buildSymbolToCodeMap() {
    const map = new Map();

    const codes = typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('currency')
        : [];

    for (const code of codes) {
        try {
            const parts = new Intl.NumberFormat('en', {
                style: 'currency',
                currency: code,
                currencyDisplay: 'symbol'
            }).formatToParts(1);
            const symbol = parts.find(p => p.type === 'currency')?.value;
            if (symbol) {
                map.set(symbol, code);
            }
        } catch {
            // Ignore unsupported currencies in current ICU data
        }
    }

    for (const [symbol, code] of Object.entries(MANUAL_SYMBOL_TO_CODE)) {
        if (!map.has(symbol)) {
            map.set(symbol, code);
        }
    }

    // Ensure a sensible default for plain dollar sign even if Intl data varies
    if (!map.has('$')) {
        map.set('$', 'USD');
    }

    return map;
}

function buildCodeToSymbolMap() {
    const map = new Map();

    const codes = typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('currency')
        : [];

    for (const code of codes) {
        try {
            const parts = new Intl.NumberFormat('en', {
                style: 'currency',
                currency: code,
                currencyDisplay: 'symbol'
            }).formatToParts(1);
            const symbol = parts.find(p => p.type === 'currency')?.value;
            if (symbol) {
                map.set(code, symbol);
            }
        } catch {
            // Ignore unsupported currencies in current ICU data
        }
    }

    // Seed manual overrides in the other direction
    for (const [symbol, code] of Object.entries(MANUAL_SYMBOL_TO_CODE)) {
        if (!map.has(code)) {
            map.set(code, symbol);
        }
    }

    // Ensure base currencies are mapped even if ICU data is minimal
    if (!map.has('USD')) map.set('USD', '$');

    return map;
}

function getSymbolToCodeMap() {
    if (!_symbolToCodeMap) {
        _symbolToCodeMap = buildSymbolToCodeMap();
    }
    return _symbolToCodeMap;
}

function getCodeToSymbolMap() {
    if (!_codeToSymbolMap) {
        _codeToSymbolMap = buildCodeToSymbolMap();
    }
    return _codeToSymbolMap;
}

function warnUnknownCurrency(input, logger) {
    if (logger && typeof logger.warn === 'function') {
        logger.warn(`Unknown currency input "${input}", normalized to XXX`, 'currency-utils');
    }
}

function normalizeCurrency(currency, { logger = null, warnUnknown = true } = {}) {
    if (!currency) {
        if (warnUnknown) warnUnknownCurrency(currency, logger);
        return 'XXX';
    }

    const trimmed = String(currency).trim();

    if (/^[A-Za-z]{3}$/.test(trimmed)) {
        return trimmed.toUpperCase();
    }

    const code = getSymbolToCodeMap().get(trimmed);
    if (code) {
        return code;
    }

    if (warnUnknown) warnUnknownCurrency(currency, logger);
    return 'XXX';
}

module.exports = {
    normalizeCurrency,
    getCodeToSymbolMap
};
