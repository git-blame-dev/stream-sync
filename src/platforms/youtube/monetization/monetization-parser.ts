import { extractMessageText } from '../youtube-message-extractor';
import { YouTubeiCurrencyParser } from '../youtubei-currency-parser';
import type { UnknownRecord } from '../../../utils/record-contracts';

interface YouTubeMonetizationParserOptions {
    logger?: unknown;
}


interface ParsedSuperSticker {
    id: string;
    timestamp: string;
    giftType: 'Super Sticker';
    giftCount: number;
    amount: number;
    currency: string;
    avatarUrl: string;
    message: string;
    giftImageUrl?: string;
}

interface ParsedGiftPurchase {
    timestamp: string;
    giftCount: number;
    avatarUrl: string;
    message: string;
    id?: string;
}

interface ParsedMembership {
    timestamp: string;
    avatarUrl: string;
    membershipLevel: string;
    message: string;
    months?: number;
    id?: string;
}

interface ParsedGiftMessageView {
    id: string;
    timestamp: string;
    giftType: string;
    giftCount: 1;
    amount: number;
    currency: 'jewels';
    message: string;
}

interface MembershipLevelInput {
    headerPrimaryText: string;
    headerSubtext: string;
}

const isRecord = (value: unknown): value is UnknownRecord => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
);

const toRecord = (value: unknown): UnknownRecord => (isRecord(value) ? value : {});

function createYouTubeMonetizationParser(options: YouTubeMonetizationParserOptions = {}) {
    const currencyParser = new YouTubeiCurrencyParser({ logger: options.logger });

    const resolveTimestamp = (chatItem: UnknownRecord, label: string): string => {
        const item = toRecord(chatItem.item);
        const rawUsec = item.timestamp_usec;
        const rawTimestamp = rawUsec !== undefined && rawUsec !== null
            ? rawUsec
            : item.timestamp;
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

    const resolveId = (chatItem: UnknownRecord, label: string): string => {
        const item = toRecord(chatItem.item);
        const rawId = item.id;
        if (rawId === undefined || rawId === null) {
            throw new Error(`${label} requires id`);
        }
        const id = String(rawId).trim();
        if (!id) {
            throw new Error(`${label} requires id`);
        }
        return id;
    };

    const resolveOptionalId = (chatItem: UnknownRecord): string | undefined => {
        const item = toRecord(chatItem.item);
        const rawId = item.id;
        if (rawId === undefined || rawId === null) {
            return undefined;
        }
        const id = String(rawId).trim();
        return id ? id : undefined;
    };

    const resolveNumericAmount = (amount: unknown, label: string): number => {
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            throw new Error(`${label} requires valid amount`);
        }
        return numericAmount;
    };

    const resolveCurrencyCode = (currency: unknown, label: string): string => {
        if (typeof currency !== 'string') {
            throw new Error(`${label} requires currency`);
        }
        const normalized = currency.trim().toUpperCase();
        if (!normalized) {
            throw new Error(`${label} requires currency`);
        }
        return normalized;
    };

    const parsePurchaseAmount = (
        chatItem: UnknownRecord,
        label: string
    ): { amount: number; currency: string } => {
        const item = toRecord(chatItem.item);
        const purchaseAmount = item.purchase_amount;
        if (purchaseAmount === undefined || purchaseAmount === null) {
            throw new Error(`${label} requires purchase_amount`);
        }

        if (typeof purchaseAmount === 'number') {
            const currency = resolveCurrencyCode(item.purchase_currency, label);
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

    const extractStructuredText = (field: unknown): string => {
        const fieldRecord = toRecord(field);
        if (!field) {
            return '';
        }

        if (Array.isArray(fieldRecord.runs)) {
            return fieldRecord.runs
                .map((run: unknown) => {
                    const runText = toRecord(run).text;
                    return runText ? String(runText) : '';
                })
                .join('')
                .trim();
        }

        if (typeof fieldRecord.simpleText === 'string') {
            return fieldRecord.simpleText.trim();
        }

        const rawText = fieldRecord.text;
        return typeof rawText === 'string' ? rawText.trim() : '';
    };

    const extractFirstStructuredText = (...fields: unknown[]): string => {
        for (const field of fields) {
            const extracted = extractStructuredText(field);
            if (extracted) {
                return extracted;
            }
        }

        return '';
    };

    const resolveGiftMessageText = (field: unknown): string => {
        if (typeof field === 'string') {
            return field.trim();
        }

        const fieldRecord = toRecord(field);
        const content = fieldRecord.content;
        if (typeof content === 'string' && content.trim()) {
            return content.trim();
        }

        return extractStructuredText(field);
    };

    const parseJewelsGiftText = (message: string): { giftType: string; amount: number } => {
        const match = message.match(/^sent\s+(.+?)\s+for\s+(\d+(?:\.\d+)?)\s+jewels$/i);
        if (!match) {
            throw new Error('YouTube GiftMessageView requires text in "sent <gift> for <amount> Jewels" format');
        }

        const giftType = match[1].trim();
        const amount = Number(match[2]);
        if (!giftType || !Number.isFinite(amount) || amount <= 0) {
            throw new Error('YouTube GiftMessageView requires text in "sent <gift> for <amount> Jewels" format');
        }

        return { giftType, amount };
    };

    const parseMembershipMonthsFromHeaderText = (text: unknown): number | undefined => {
        if (typeof text !== 'string') {
            return undefined;
        }

        const match = text.match(/\bmember\s+for\s+(\d+)\s+months?\b/i);
        if (!match) {
            return undefined;
        }

        const months = Number(match[1]);
        return Number.isFinite(months) && months > 0 ? months : undefined;
    };

    const resolveMembershipLevel = ({ headerPrimaryText, headerSubtext }: MembershipLevelInput): string => {
        const normalizedPrimary = typeof headerPrimaryText === 'string' ? headerPrimaryText.trim() : '';
        const normalizedSubtext = typeof headerSubtext === 'string' ? headerSubtext.trim() : '';
        const milestoneMonthsFromPrimary = parseMembershipMonthsFromHeaderText(normalizedPrimary);

        if (normalizedPrimary && milestoneMonthsFromPrimary === undefined) {
            return normalizedPrimary;
        }

        if (!normalizedSubtext) {
            return '';
        }

        const welcomeMatch = normalizedSubtext.match(/^Welcome to\s+(.+?)!?$/i);
        if (welcomeMatch) {
            const level = welcomeMatch[1].trim();
            if (!level || /^the\s+membership$/i.test(level)) {
                return '';
            }
            return level;
        }

        return normalizedSubtext;
    };

    const resolveAuthorAvatarUrl = (chatItem: UnknownRecord): string => {
        const item = toRecord(chatItem.item);
        const author = toRecord(item.author);
        const thumbnails = Array.isArray(author.thumbnails) ? author.thumbnails : [];
        const firstThumbnail = thumbnails.length > 0 ? toRecord(thumbnails[0]) : {};
        const avatarUrl = firstThumbnail.url;
        if (typeof avatarUrl !== 'string') {
            return '';
        }
        return avatarUrl.trim();
    };

    const normalizeStickerImageUrl = (url: unknown): string => {
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

    const resolveStickerImageUrl = (stickerField: unknown): string => {
        const rawCandidates = Array.isArray(stickerField)
            ? stickerField
            : (stickerField && typeof stickerField === 'object' ? [stickerField] : []);

        const candidates = rawCandidates
            .map((candidate: unknown) => {
                const candidateRecord = toRecord(candidate);
                const imageUrl = normalizeStickerImageUrl(candidateRecord.url);
                const width = Number(candidateRecord.width);
                const height = Number(candidateRecord.height);
                return {
                    imageUrl,
                    width: Number.isFinite(width) && width > 0 ? width : 0,
                    height: Number.isFinite(height) && height > 0 ? height : 0
                };
            })
            .filter((candidate: { imageUrl: string }) => !!candidate.imageUrl);

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

    const parseSuperChat = (chatItem: UnknownRecord) => {
        const { amount, currency } = parsePurchaseAmount(chatItem, 'YouTube Super Chat');
        const item = toRecord(chatItem.item);
        return {
            id: resolveId(chatItem, 'YouTube Super Chat'),
            timestamp: resolveTimestamp(chatItem, 'YouTube Super Chat'),
            giftType: 'Super Chat',
            giftCount: 1,
            amount,
            currency,
            avatarUrl: resolveAuthorAvatarUrl(chatItem),
            message: extractMessageText(item.message)
        };
    };

    const parseSuperSticker = (chatItem: UnknownRecord): ParsedSuperSticker => {
        const { amount, currency } = parsePurchaseAmount(chatItem, 'YouTube Super Sticker');
        const item = toRecord(chatItem.item);
        const sticker = item.sticker;
        const stickerRecord = sticker && !Array.isArray(sticker)
            ? toRecord(sticker)
            : {};
        const stickerAccessibilityLabel = typeof item.sticker_accessibility_label === 'string'
            ? item.sticker_accessibility_label.trim()
            : '';
        const stickerName = typeof stickerRecord.name === 'string' ? stickerRecord.name : '';
        const stickerAltText = typeof stickerRecord.altText === 'string' ? stickerRecord.altText : '';
        const stickerLabel = extractStructuredText(stickerRecord.label);
        const stickerMessage = stickerAccessibilityLabel || (
            sticker && !Array.isArray(sticker)
                ? (stickerName || stickerAltText || stickerLabel)
                : ''
        );
        const giftImageUrl = resolveStickerImageUrl(sticker);

        const payload: ParsedSuperSticker = {
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

    const parseGiftPurchase = (chatItem: UnknownRecord): ParsedGiftPurchase => {
        const item = toRecord(chatItem.item);
        const giftCount = Number(item.giftMembershipsCount);
        if (!Number.isFinite(giftCount) || giftCount <= 0) {
            throw new Error('YouTube gift purchase requires giftMembershipsCount');
        }

        const payload: ParsedGiftPurchase = {
            timestamp: resolveTimestamp(chatItem, 'YouTube gift purchase'),
            giftCount,
            avatarUrl: resolveAuthorAvatarUrl(chatItem),
            message: extractMessageText(item.message)
        };
        const id = resolveOptionalId(chatItem);
        if (id) {
            payload.id = id;
        }
        return payload;
    };

    const parseMembership = (chatItem: UnknownRecord): ParsedMembership => {
        const item = toRecord(chatItem.item);
        const headerPrimaryText = extractFirstStructuredText(
            item.headerPrimaryText,
            item.header_primary_text
        );
        const headerSubtext = extractFirstStructuredText(
            item.headerSubtext,
            item.header_subtext
        );
        const explicitMonths = Number.isFinite(Number(item.memberMilestoneDurationInMonths))
            ? Number(item.memberMilestoneDurationInMonths)
            : undefined;
        const months = explicitMonths ?? parseMembershipMonthsFromHeaderText(headerPrimaryText);

        const payload: ParsedMembership = {
            timestamp: resolveTimestamp(chatItem, 'YouTube membership'),
            avatarUrl: resolveAuthorAvatarUrl(chatItem),
            membershipLevel: resolveMembershipLevel({
                headerPrimaryText,
                headerSubtext
            }),
            message: extractMessageText(item.message) || headerSubtext,
            months
        };
        const id = resolveOptionalId(chatItem);
        if (id) {
            payload.id = id;
        }
        return payload;
    };

    const parseGiftMessageView = (chatItem: UnknownRecord): ParsedGiftMessageView => {
        const item = toRecord(chatItem.item);
        const message = resolveGiftMessageText(item.text);
        if (!message) {
            throw new Error('YouTube GiftMessageView requires text in "sent <gift> for <amount> Jewels" format');
        }

        const { giftType, amount } = parseJewelsGiftText(message);
        return {
            id: resolveId(chatItem, 'YouTube GiftMessageView'),
            timestamp: resolveTimestamp(chatItem, 'YouTube GiftMessageView'),
            giftType,
            giftCount: 1,
            amount,
            currency: 'jewels',
            message
        };
    };

    return {
        parseSuperChat,
        parseSuperSticker,
        parseMembership,
        parseGiftPurchase,
        parseGiftMessageView,
        resolveTimestamp,
        resolveOptionalId
    };
}

export { createYouTubeMonetizationParser };
