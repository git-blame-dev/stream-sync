const { normalizeTikTokMessage } = require('../../../utils/message-normalization');
const { extractTikTokUserData, extractTikTokGiftData } = require('../../../utils/tiktok-data-extraction');
const { resolveTikTokTimestampISO } = require('../../../utils/tiktok-timestamp');

function normalizeTikTokChatEvent(data, options = {}) {
    const platformName = options.platformName || 'tiktok';
    const timestampService = options.timestampService;
    return normalizeTikTokMessage(data, platformName, timestampService);
}

function normalizeTikTokGiftEvent(data, options = {}) {
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
        if (options.timestampService && typeof options.timestampService.extractTimestamp === 'function') {
            return options.timestampService.extractTimestamp('tiktok', data);
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

    const normalized = {
        platform: platformName,
        userId,
        username,
        giftType: giftData.giftType,
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

module.exports = {
    normalizeTikTokChatEvent,
    normalizeTikTokGiftEvent
};
