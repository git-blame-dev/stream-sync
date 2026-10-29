import { createPlatformErrorHandler } from '../../utils/platform-error-handler';
import { resolveLogger } from '../../utils/logger-resolver';

type CurrencySymbolMapping = {
    pattern: RegExp;
    currency: string;
    symbol: string;
};

type CurrencyParseSuccess = {
    amount: number;
    currency: string;
    symbol: string;
    success: true;
    originalString: string;
};

type CurrencyParseFailure = {
    amount: 0;
    currency: '';
    symbol: '';
    success: false;
    originalString: unknown;
    reason: string;
};

type CurrencyParseAttempt = CurrencyParseSuccess | { success: false };

type LoggerLike = ReturnType<typeof resolveLogger>;
type ErrorHandlerLike = ReturnType<typeof createPlatformErrorHandler>;

export interface YouTubeiCurrencyParserDependencies {
    logger?: unknown;
}

export type YouTubeiCurrencyParseResult = CurrencyParseSuccess | CurrencyParseFailure;

class YouTubeiCurrencyParser {
    private logger: LoggerLike;
    private errorHandler: ErrorHandlerLike;
    private codeSpacePattern: RegExp;
    private codeSymbolPattern: RegExp;
    private symbolMappings: CurrencySymbolMapping[];
    private currencySymbols: Record<string, string>;

    constructor(dependencies: YouTubeiCurrencyParserDependencies = {}) {
        this.logger = resolveLogger(dependencies.logger, 'YouTubeiCurrencyParser');
        this.errorHandler = createPlatformErrorHandler(this.logger, 'youtubei-currency');

        this.codeSpacePattern = /^([A-Za-z]{3})\s+([0-9,]+(?:[\.,][0-9]{1,2})?)$/;
        this.codeSymbolPattern = /^([A-Za-z]{3})\$([0-9,]+(?:\.[0-9]{1,2})?)$/;

        this.symbolMappings = [
            { pattern: /^₺([0-9,]+(?:\.[0-9]{1,2})?)$/, currency: 'TRY', symbol: '₺' },
            { pattern: /^₹([0-9,]+(?:\.[0-9]{1,2})?)$/, currency: 'INR', symbol: '₹' },
            { pattern: /^€([0-9,.]+)$/, currency: 'EUR', symbol: '€' },
            { pattern: /^£([0-9,]+(?:\.[0-9]{1,2})?)$/, currency: 'GBP', symbol: '£' },
            { pattern: /^¥([0-9,]+)$/, currency: 'JPY', symbol: '¥' },
            { pattern: /^₩([0-9,]+)$/, currency: 'KRW', symbol: '₩' },
            { pattern: /^₽([0-9,]+(?:\.[0-9]{1,2})?)$/, currency: 'RUB', symbol: '₽' },
            { pattern: /^฿([0-9,]+(?:\.[0-9]{1,2})?)$/, currency: 'THB', symbol: '฿' },
            { pattern: /^₱([0-9,]+(?:\.[0-9]{1,2})?)$/, currency: 'PHP', symbol: '₱' },
            { pattern: /^₦([0-9,]+(?:\.[0-9]{1,2})?)$/, currency: 'NGN', symbol: '₦' },
            { pattern: /^₴([0-9,]+(?:\.[0-9]{1,2})?)$/, currency: 'UAH', symbol: '₴' },
            { pattern: /^₪([0-9,]+(?:\.[0-9]{1,2})?)$/, currency: 'ILS', symbol: '₪' },
            { pattern: /^₫([0-9,]+)$/, currency: 'VND', symbol: '₫' },
            { pattern: /^৳([0-9,]+(?:\.[0-9]{1,2})?)$/, currency: 'BDT', symbol: '৳' },
            { pattern: /^₨([0-9,]+(?:\.[0-9]{1,2})?)$/, currency: 'PKR', symbol: '₨' },
            { pattern: /^\$([0-9,]+(?:\.[0-9]{1,2})?)$/, currency: 'USD', symbol: '$' }
        ];

        this.currencySymbols = {
            TRY: '₺',
            EUR: '€',
            GBP: '£',
            JPY: '¥',
            KRW: '₩',
            BRL: 'R$',
            RUB: '₽',
            PLN: 'zł',
            THB: '฿',
            PHP: '₱',
            MYR: 'RM',
            ZAR: 'R',
            NGN: '₦',
            INR: '₹',
            USD: '$',
            CAD: '$',
            AUD: '$',
            NZD: '$',
            SGD: '$',
            HKD: '$',
            TWD: 'NT$',
            CHF: 'Fr',
            SEK: 'kr',
            NOK: 'kr',
            DKK: 'kr',
            CZK: 'Kč',
            HUF: 'Ft',
            RON: 'lei',
            BGN: 'лв',
            HRK: 'kn',
            UAH: '₴',
            ILS: '₪',
            AED: 'د.إ',
            SAR: 'ر.س',
            EGP: '£',
            VND: '₫',
            IDR: 'Rp',
            PKR: '₨',
            BDT: '৳',
            LKR: '₨'
        };
    }

    parse(displayString: unknown): YouTubeiCurrencyParseResult {
        if (!displayString || typeof displayString !== 'string') {
            return this._createFailureResult(displayString, 'Invalid input');
        }

        const trimmed = displayString.trim();
        if (!trimmed) {
            return this._createFailureResult(displayString, 'Empty input');
        }

        if (trimmed.startsWith('-')) {
            this._logUnknownCurrency(displayString);
            return this._createFailureResult(displayString, 'Negative amount not allowed');
        }

        const codeSpaceResult = this._parseCodeSpaceFormat(trimmed);
        if (codeSpaceResult.success) {
            return codeSpaceResult;
        }

        const codeSymbolResult = this._parseCodeSymbolFormat(trimmed);
        if (codeSymbolResult.success) {
            return codeSymbolResult;
        }

        const symbolResult = this._parseSymbolFormat(trimmed);
        if (symbolResult.success) {
            return symbolResult;
        }

        this._logUnknownCurrency(displayString);
        return this._createFailureResult(displayString, 'Unknown currency format');
    }

    private _parseCodeSpaceFormat(input: string): CurrencyParseAttempt {
        const match = input.match(this.codeSpacePattern);
        if (!match) {
            return { success: false };
        }

        const currencyRaw = match[1];
        const amountStr = match[2];
        if (!currencyRaw || !amountStr) {
            return { success: false };
        }

        const currency = currencyRaw.toUpperCase();
        const amount = this._parseAmount(amountStr);
        if (amount <= 0) return { success: false };
        const symbol = currency === 'TRY' ? '₺' : (this.currencySymbols[currency] || currency);

        return {
            amount,
            currency,
            symbol,
            success: true,
            originalString: input
        };
    }

    private _parseCodeSymbolFormat(input: string): CurrencyParseAttempt {
        if (input.startsWith('A$')) {
            const amountStr = input.slice(2);
            const amount = this._parseAmount(amountStr);
            if (amount > 0) {
                return {
                    amount,
                    currency: 'AUD',
                    symbol: 'A$',
                    success: true,
                    originalString: input
                };
            }
        }

        if (input.startsWith('CA$')) {
            const amountStr = input.slice(3);
            const amount = this._parseAmount(amountStr);
            if (amount > 0) {
                return {
                    amount,
                    currency: 'CAD',
                    symbol: 'CA$',
                    success: true,
                    originalString: input
                };
            }
        }

        const match = input.match(this.codeSymbolPattern);
        if (!match) {
            return { success: false };
        }

        const currencyRaw = match[1];
        const amountStr = match[2];
        if (!currencyRaw || !amountStr) {
            return { success: false };
        }

        const currency = currencyRaw.toUpperCase();
        const amount = this._parseAmount(amountStr);
        if (amount <= 0) return { success: false };

        return {
            amount,
            currency,
            symbol: '$',
            success: true,
            originalString: input
        };
    }

    private _parseSymbolFormat(input: string): CurrencyParseAttempt {
        for (const mapping of this.symbolMappings) {
            const match = input.match(mapping.pattern);
            if (!match) {
                continue;
            }

            const amountStr = match[1];
            if (!amountStr) {
                continue;
            }

            const amount = this._parseAmount(amountStr);
            if (amount <= 0) return { success: false };
            return {
                amount,
                currency: mapping.currency,
                symbol: mapping.symbol,
                success: true,
                originalString: input
            };
        }

        return { success: false };
    }

    private _parseAmount(amountStr: string): number {
        // Ungrouped decimal, or groups of exactly three with an optional decimal part.
        // A lone comma with one/two trailing digits is a decimal separator.
        const western = /^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]{1,2})?$/;
        const european = /^(?:[0-9]+|[0-9]{1,3}(?:\.[0-9]{3})+),[0-9]{1,2}$/;
        let normalized: string;
        if (western.test(amountStr)) {
            normalized = amountStr.replace(/,/g, '');
        } else if (european.test(amountStr)) {
            normalized = amountStr.replace(/\./g, '').replace(',', '.');
        } else {
            return 0;
        }
        const amount = Number(normalized);
        return Number.isFinite(amount) && amount > 0 ? amount : 0;
    }

    private _createFailureResult(originalString: unknown, reason: string): CurrencyParseFailure {
        return {
            amount: 0,
            currency: '',
            symbol: '',
            success: false,
            originalString,
            reason
        };
    }

    private _logUnknownCurrency(originalString: unknown, giftData: Record<string, unknown> = {}): void {
        try {
            this.logger.warn(
                `Unknown currency format detected: "${String(originalString)}"`,
                'youtubei-currency',
                { originalString, giftData }
            );
        } catch (error) {
            const wrappedError = error instanceof Error ? error : new Error(String(error));
            this._handleCurrencyParserError(
                `Failed to log unknown currency: ${wrappedError.message}`,
                wrappedError,
                'unknown-currency'
            );
        }
    }

    private _handleCurrencyParserError(message: string, error: unknown, eventType?: string): void {
        if (error instanceof Error) {
            this.errorHandler.handleEventProcessingError(
                error,
                eventType || 'currency-parser',
                null,
                message,
                'youtubei-currency'
            );
            return;
        }

        this.errorHandler.logOperationalError(message, 'youtubei-currency', { eventType });
    }
}

export { YouTubeiCurrencyParser };
