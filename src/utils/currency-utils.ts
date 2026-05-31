type LoggerLike = {
    warn: (message: string, context: string) => void;
};

const MANUAL_SYMBOL_TO_CODE: Record<string, string> = {
    '₽': 'RUB',
    '฿': 'THB',
    '₫': 'VND',
    '₱': 'PHP',
    '元': 'CNY',
    '円': 'JPY',
    'NT$': 'TWD',
    '₩': 'KRW',
    '₴': 'UAH',
    '₦': 'NGN',
    '₵': 'GHS',
    '₭': 'LAK',
    '₲': 'PYG',
    '₡': 'CRC',
    '₺': 'TRY',
    '₸': 'KZT',
    '₮': 'MNT'
};

let symbolToCodeMap: Map<string, string> | null = null;

function buildSymbolToCodeMap(): Map<string, string> {
    const map = new Map<string, string>();
    const intlWithSupportedValues = Intl as typeof Intl & {
        supportedValuesOf?: (key: 'currency') => string[];
    };

    const codes = typeof intlWithSupportedValues.supportedValuesOf === 'function'
        ? intlWithSupportedValues.supportedValuesOf('currency')
        : [];

    for (const code of codes) {
        try {
            const parts = new Intl.NumberFormat('en', {
                style: 'currency',
                currency: code,
                currencyDisplay: 'symbol'
            }).formatToParts(1);
            const symbol = parts.find((part) => part.type === 'currency')?.value;
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

function getSymbolToCodeMap(): Map<string, string> {
    if (!symbolToCodeMap) {
        symbolToCodeMap = buildSymbolToCodeMap();
    }
    return symbolToCodeMap;
}

function warnUnknownCurrency(input: unknown, logger: LoggerLike | null): void {
    if (logger && typeof logger.warn === 'function') {
        logger.warn(`Unknown currency input "${input}", normalized to XXX`, 'currency-utils');
    }
}

function normalizeCurrency(currency: unknown, { logger = null, warnUnknown = true }: { logger?: LoggerLike | null; warnUnknown?: boolean } = {}): string {
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

export {
    normalizeCurrency
};
