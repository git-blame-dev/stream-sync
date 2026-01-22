const { extractMessageText } = require('../../../utils/youtube-message-extractor');
const { YouTubeiCurrencyParser } = require('../../../utils/youtubei-currency-parser');

function createYouTubeMonetizationParser(options = {}) {
    const currencyParser = new YouTubeiCurrencyParser({ logger: options.logger });

    const resolveTimestamp = (chatItem, label) => {
        const rawUsec = chatItem?.item?.timestamp_usec;
        const rawTimestamp = rawUsec !== undefined && rawUsec !== null
            ? rawUsec
            : chatItem?.item?.timestamp;
        if (rawTimestamp === undefined || rawTimestamp === null) {
            throw new Error(`${label} requires timestamp`);
        }

        if (typeof rawTimestamp === 'string' && rawTimestamp.trim() === '') {
            throw new Error(`${label} requires timestamp`);
        }

        const numericTimestamp = typeof rawTimestamp === 'number' ? rawTimestamp : Number(rawTimestamp);
        if (!Number.isFinite(numericTimestamp)) {
            throw new Error(`${label} requires valid timestamp`);
        }
        const adjustedTimestamp = rawUsec !== undefined && rawUsec !== null
            ? Math.floor(numericTimestamp / 1000)
            : (numericTimestamp > 10000000000000
                ? Math.floor(numericTimestamp / 1000)
                : numericTimestamp);
        const parsed = new Date(adjustedTimestamp);
        if (Number.isNaN(parsed.getTime())) {
            throw new Error(`${label} requires valid timestamp`);
        }
        return parsed.toISOString();
    };

    const resolveId = (chatItem, label) => {
        const rawId = chatItem?.item?.id;
        if (rawId === undefined || rawId === null) {
            throw new Error(`${label} requires id`);
        }
        const id = String(rawId).trim();
        if (!id) {
            throw new Error(`${label} requires id`);
        }
        return id;
    };

    const resolveOptionalId = (chatItem) => {
        const rawId = chatItem?.item?.id;
        if (rawId === undefined || rawId === null) {
            return undefined;
        }
        const id = String(rawId).trim();
        return id ? id : undefined;
    };

    const resolveNumericAmount = (amount, label) => {
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            throw new Error(`${label} requires valid amount`);
        }
        return numericAmount;
    };

    const resolveCurrencyCode = (currency, label) => {
        if (typeof currency !== 'string') {
            throw new Error(`${label} requires currency`);
        }
        const normalized = currency.trim().toUpperCase();
        if (!normalized) {
            throw new Error(`${label} requires currency`);
        }
        return normalized;
    };

    const parsePurchaseAmount = (chatItem, label) => {
        const purchaseAmount = chatItem?.item?.purchase_amount;
        if (purchaseAmount === undefined || purchaseAmount === null) {
            throw new Error(`${label} requires purchase_amount`);
        }

        if (typeof purchaseAmount === 'number') {
            const currency = resolveCurrencyCode(chatItem?.item?.purchase_currency, label);
            return {
                amount: resolveNumericAmount(purchaseAmount, label),
                currency
            };
        }

        if (typeof purchaseAmount === 'string') {
            const result = currencyParser.parse(purchaseAmount);
            if (!result.success || !Number.isFinite(result.amount) || result.amount <= 0) {
                throw new Error(`${label} requires valid purchase_amount`);
            }
            return {
                amount: result.amount,
                currency: result.currency
            };
        }

        throw new Error(`${label} requires purchase_amount`);
    };

    const extractStructuredText = (field) => {
        if (!field) {
            return '';
        }

        if (Array.isArray(field.runs)) {
            return field.runs.map((run) => run?.text || '').join('').trim();
        }

        const raw = field.simpleText || field.text || '';
        return typeof raw === 'string' ? raw.trim() : '';
    };

    const parseSuperChat = (chatItem) => {
        const { amount, currency } = parsePurchaseAmount(chatItem, 'YouTube Super Chat');
        return {
            id: resolveId(chatItem, 'YouTube Super Chat'),
            timestamp: resolveTimestamp(chatItem, 'YouTube Super Chat'),
            giftType: 'Super Chat',
            giftCount: 1,
            amount,
            currency,
            message: extractMessageText(chatItem?.item?.message)
        };
    };

    const parseSuperSticker = (chatItem) => {
        const { amount, currency } = parsePurchaseAmount(chatItem, 'YouTube Super Sticker');
        const sticker = chatItem?.item?.sticker;
        const stickerMessage = sticker
            ? (sticker.name || sticker.altText || extractStructuredText(sticker.label))
            : '';

        return {
            id: resolveId(chatItem, 'YouTube Super Sticker'),
            timestamp: resolveTimestamp(chatItem, 'YouTube Super Sticker'),
            giftType: 'Super Sticker',
            giftCount: 1,
            amount,
            currency,
            message: stickerMessage || ''
        };
    };

    const parseGiftPurchase = (chatItem) => {
        const giftCount = Number(chatItem?.item?.giftMembershipsCount);
        if (!Number.isFinite(giftCount) || giftCount <= 0) {
            throw new Error('YouTube gift purchase requires giftMembershipsCount');
        }

        const payload = {
            timestamp: resolveTimestamp(chatItem, 'YouTube gift purchase'),
            giftCount,
            message: extractMessageText(chatItem?.item?.message)
        };
        const id = resolveOptionalId(chatItem);
        if (id) {
            payload.id = id;
        }
        return payload;
    };

    const parseMembership = (chatItem) => {
        const payload = {
            timestamp: resolveTimestamp(chatItem, 'YouTube membership'),
            membershipLevel: extractStructuredText(chatItem?.item?.headerPrimaryText),
            message: extractStructuredText(chatItem?.item?.headerSubtext) || extractMessageText(chatItem?.item?.message),
            months: Number.isFinite(Number(chatItem?.item?.memberMilestoneDurationInMonths))
                ? Number(chatItem?.item?.memberMilestoneDurationInMonths)
                : undefined
        };
        const id = resolveOptionalId(chatItem);
        if (id) {
            payload.id = id;
        }
        return payload;
    };

    return {
        parseSuperChat,
        parseSuperSticker,
        parseMembership,
        parseGiftPurchase,
        resolveTimestamp,
        resolveOptionalId
    };
}

module.exports = {
    createYouTubeMonetizationParser
};
