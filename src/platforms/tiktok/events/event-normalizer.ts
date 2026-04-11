import { normalizeTikTokMessage } from '../../../utils/message-normalization';
import { extractTikTokUserData, extractTikTokGiftData, extractTikTokAvatarUrl } from '../../../utils/tiktok-data-extraction';
import { resolveTikTokTimestampISO } from '../../../utils/platform-timestamp';

type UnknownRecord = Record<string, unknown>;

type TikTokEventNormalizerOptions = {
    platformName?: string;
    timestampService?: unknown;
    getTimestamp?: (data: UnknownRecord) => string | null;
    getPlatformMessageId?: (data: UnknownRecord) => string | null;
};

function normalizeTikTokChatEvent(data: UnknownRecord, options: TikTokEventNormalizerOptions = {}) {
    const platformName = options.platformName || 'tiktok';
    return normalizeTikTokMessage(data, platformName);
}

function normalizeTikTokGiftEvent(data: UnknownRecord, options: TikTokEventNormalizerOptions = {}) {
    if (!data || typeof data !== 'object') {
        throw new Error('TikTok gift payload must be an object');
    }

    const platformName = options.platformName || 'tiktok';
    const { userId, username } = extractTikTokUserData(data);
    const giftData = extractTikTokGiftData(data);

    const resolveTimestamp = () => {
        if (typeof options.getTimestamp === 'function') {
            return options.getTimestamp(data);
        }
        return resolveTikTokTimestampISO(data);
    };

    const timestamp = resolveTimestamp();
    if (!timestamp) {
        throw new Error('Missing TikTok gift timestamp');
    }

    const resolveMessageId = () => {
        if (typeof options.getPlatformMessageId === 'function') {
            return options.getPlatformMessageId(data);
        }
        if (data.msgId === undefined || data.msgId === null) {
            return null;
        }
        return String(data.msgId).trim();
    };

    const messageId = resolveMessageId();
    if (!messageId) {
        throw new Error('TikTok gift requires msgId');
    }

    const repeatCount = Number.isFinite(Number(data.repeatCount))
        ? Number(data.repeatCount)
        : giftData.giftCount;

    const normalized: {
        platform: string;
        userId: string;
        username: string;
        avatarUrl: string;
        giftType: string;
        giftImageUrl?: string;
        giftCount: number;
        repeatCount: number;
        amount: number;
        currency: string;
        unitAmount: number;
        comboType: number;
        repeatEnd: boolean;
        groupId: string | null;
        id: string;
        timestamp: string;
        rawData: UnknownRecord;
        sourceType?: string;
    } = {
        platform: platformName,
        userId,
        username,
        avatarUrl: extractTikTokAvatarUrl(data),
        giftType: giftData.giftType,
        ...(typeof giftData.giftImageUrl === 'string' && giftData.giftImageUrl.trim()
            ? { giftImageUrl: giftData.giftImageUrl.trim() }
            : {}),
        giftCount: giftData.giftCount,
        repeatCount,
        amount: giftData.amount,
        currency: giftData.currency,
        unitAmount: giftData.unitAmount,
        comboType: giftData.comboType,
        repeatEnd: giftData.repeatEnd,
        groupId: giftData.groupId,
        id: messageId,
        timestamp,
        rawData: data
    };

    if (typeof data.sourceType === 'string') {
        normalized.sourceType = data.sourceType;
    }

    return normalized;
}

export { normalizeTikTokChatEvent, normalizeTikTokGiftEvent };
