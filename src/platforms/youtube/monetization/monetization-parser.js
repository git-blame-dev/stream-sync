const { extractMessageText } = require('../youtube-message-extractor');
const { YouTubeiCurrencyParser } = require('../youtubei-currency-parser');

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

    const resolveAuthorAvatarUrl = (chatItem) => {
        const avatarUrl = chatItem?.item?.author?.thumbnails?.[0]?.url;
        if (typeof avatarUrl !== 'string') {
            return '';
        }
        return avatarUrl.trim();
    };

    const normalizeStickerImageUrl = (url) => {
        if (typeof url !== 'string') {
            return '';
        }
        const trimmed = url.trim();
        if (!trimmed) {
            return '';
        }
        if (trimmed.startsWith('//')) {
            return `https:${trimmed}`;
        }
        return trimmed;
    };

    const resolveStickerImageUrl = (stickerField) => {
        const rawCandidates = Array.isArray(stickerField)
            ? stickerField
            : (stickerField && typeof stickerField === 'object' ? [stickerField] : []);

        const candidates = rawCandidates
            .map((candidate) => {
                const imageUrl = normalizeStickerImageUrl(candidate?.url);
                const width = Number(candidate?.width);
                const height = Number(candidate?.height);
                return {
                    imageUrl,
                    width: Number.isFinite(width) && width > 0 ? width : 0,
                    height: Number.isFinite(height) && height > 0 ? height : 0
                };
            })
            .filter((candidate) => !!candidate.imageUrl);

        if (candidates.length === 0) {
            return '';
        }

        candidates.sort((left, right) => {
            const leftArea = left.width * left.height;
            const rightArea = right.width * right.height;
            if (rightArea !== leftArea) {
                return rightArea - leftArea;
            }
            if (right.width !== left.width) {
                return right.width - left.width;
            }
            return right.height - left.height;
        });

        return candidates[0].imageUrl;
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
            avatarUrl: resolveAuthorAvatarUrl(chatItem),
            message: extractMessageText(chatItem?.item?.message)
        };
    };

    const parseSuperSticker = (chatItem) => {
        const { amount, currency } = parsePurchaseAmount(chatItem, 'YouTube Super Sticker');
        const sticker = chatItem?.item?.sticker;
        const stickerAccessibilityLabel = typeof chatItem?.item?.sticker_accessibility_label === 'string'
            ? chatItem.item.sticker_accessibility_label.trim()
            : '';
        const stickerMessage = stickerAccessibilityLabel || (
            sticker && !Array.isArray(sticker)
                ? (sticker.name || sticker.altText || extractStructuredText(sticker.label))
                : ''
        );
        const giftImageUrl = resolveStickerImageUrl(sticker);

        const payload = {
            id: resolveId(chatItem, 'YouTube Super Sticker'),
            timestamp: resolveTimestamp(chatItem, 'YouTube Super Sticker'),
            giftType: 'Super Sticker',
            giftCount: 1,
            amount,
            currency,
            avatarUrl: resolveAuthorAvatarUrl(chatItem),
            message: stickerMessage || ''
        };

        if (giftImageUrl) {
            payload.giftImageUrl = giftImageUrl;
        }

        return payload;
    };

    const parseGiftPurchase = (chatItem) => {
        const giftCount = Number(chatItem?.item?.giftMembershipsCount);
        if (!Number.isFinite(giftCount) || giftCount <= 0) {
            throw new Error('YouTube gift purchase requires giftMembershipsCount');
        }

        const payload = {
            timestamp: resolveTimestamp(chatItem, 'YouTube gift purchase'),
            giftCount,
            avatarUrl: resolveAuthorAvatarUrl(chatItem),
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
            avatarUrl: resolveAuthorAvatarUrl(chatItem),
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
