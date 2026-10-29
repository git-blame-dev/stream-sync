import { parseNotificationCount } from './notification-count';

type TikTokUserData = {
    userId: string;
    username: string;
};

type TikTokGiftData = {
    giftType: string;
    giftCount: number;
    amount: number;
    currency: 'coins';
    unitAmount: number;
    combo: boolean;
    comboType: number;
    groupId: unknown;
    repeatEnd: boolean;
    giftImageUrl?: string;
};

function asObjectRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function resolveTikTokUserRecord(data: unknown): Record<string, unknown> | null {
    const record = asObjectRecord(data);
    if (!record) {
        return null;
    }
    const directUser = asObjectRecord(record.user);
    if (directUser) {
        return directUser;
    }
    const rawData = asObjectRecord(record.rawData);
    const rawUser = asObjectRecord(rawData?.user) ?? asObjectRecord(asObjectRecord(rawData?.data)?.user);
    if (rawUser) {
        return rawUser;
    }
    const enhancedGiftData = asObjectRecord(record.enhancedGiftData);
    return asObjectRecord(asObjectRecord(enhancedGiftData?.originalData)?.user);
}

function normalizeTikTokHttpUrl(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) return '';
    const trimmed = value.trim();
    try {
        const url = new URL(trimmed);
        return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : '';
    } catch {
        return '';
    }
}

function extractFirstTikTokImageUrl(...candidates: unknown[]): string {
    for (const candidate of candidates) {
        const directUrl = normalizeTikTokHttpUrl(candidate);
        if (directUrl) {
            return directUrl;
        }
        const candidateRecord = asObjectRecord(candidate);
        const urls = Array.isArray(candidateRecord?.url)
            ? candidateRecord.url
            : (Array.isArray(candidateRecord?.urlList) ? candidateRecord.urlList : []);
        for (const entry of urls) {
            const normalizedUrl = normalizeTikTokHttpUrl(entry);
            if (normalizedUrl) {
                return normalizedUrl;
            }
        }
    }
    return '';
}

function normalizeTikTokMessageId(value: unknown): string | null {
    if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) return null;
    return String(value).trim() || null;
}

function extractTikTokUserData(data: unknown): TikTokUserData {
    if (!data || typeof data !== 'object') {
        throw new Error('TikTok user payload must be an object');
    }

    const userData = ('user' in data && typeof (data as { user?: unknown }).user === 'object')
        ? (data as { user: Record<string, unknown> }).user
        : null;
    if (!userData) {
        throw new Error('TikTok user payload requires user object');
    }

    const userId = typeof userData.uniqueId === 'string'
        ? userData.uniqueId.trim()
        : (typeof userData.uniqueId === 'number' ? String(userData.uniqueId) : null);
    const username = typeof userData.nickname === 'string'
        ? userData.nickname.trim()
        : (typeof userData.nickname === 'number' ? String(userData.nickname) : null);

    if (!userId || !username) {
        throw new Error('TikTok user payload requires user.uniqueId and user.nickname');
    }

    return { userId, username };
}

function extractTikTokGiftData(data: unknown): TikTokGiftData {
    if (!data || typeof data !== 'object') {
        throw new Error('TikTok gift payload must be an object');
    }
    // The SDK adapter supplies the localized gift name and numeric fields in giftDetails.
    const payload = data as Record<string, unknown>;
    const giftDetails = payload.giftDetails;
    if (!giftDetails || typeof giftDetails !== 'object' || Array.isArray(giftDetails)) {
        throw new Error('TikTok gift payload requires giftDetails');
    }
    const giftDetailsRecord = giftDetails as Record<string, unknown>;
    if (typeof giftDetailsRecord.giftName !== 'string' || !giftDetailsRecord.giftName.trim()) {
        throw new Error('TikTok gift payload requires giftDetails.giftName');
    }
    const unitAmount = parseNotificationCount(giftDetailsRecord.diamondCount);
    if (unitAmount === null) {
        throw new Error('TikTok gift payload requires giftDetails.diamondCount');
    }
    const comboType = parseNotificationCount(giftDetailsRecord.giftType);
    if (comboType === null) {
        throw new Error('TikTok gift payload requires giftDetails.giftType');
    }
    const giftCount = parseNotificationCount(payload.repeatCount);
    if (giftCount === null || giftCount === 0) {
        throw new Error('TikTok gift payload requires repeatCount');
    }
    const amount = unitAmount * giftCount;
    if (!Number.isSafeInteger(amount)) {
        throw new Error('TikTok gift payload requires safe integer amount');
    }
    const giftData = typeof payload.gift === 'object' && payload.gift !== null
        ? payload.gift as Record<string, unknown>
        : null;
    const giftImageUrl = extractFirstTikTokImageUrl(
        giftData?.giftPictureUrl,
        giftDetailsRecord.giftPictureUrl,
        giftData?.image,
        giftData?.icon,
        giftDetailsRecord.giftImage,
        giftDetailsRecord.image,
        giftDetailsRecord.icon
    );
    const repeatEnd = typeof payload.repeatEnd === 'string' ? payload.repeatEnd.trim().toLowerCase() : payload.repeatEnd;

    return {
        giftType: giftDetailsRecord.giftName.trim(),

        giftCount,
        amount,
        currency: 'coins',
        unitAmount,

        // Combo detection: comboType === 1 means combo-enabled gift
        combo: comboType === 1,
        comboType,

        // Combo metadata fields at root level
        groupId: payload.groupId,
        repeatEnd: repeatEnd === true || repeatEnd === 1 || repeatEnd === 'true' || repeatEnd === '1',
        ...(giftImageUrl ? { giftImageUrl } : {})
    };
}

function extractTikTokAvatarUrl(data: unknown): string {
    const userData = resolveTikTokUserRecord(data);
    if (!userData) {
        return '';
    }

    return extractFirstTikTokImageUrl(
        userData.profilePictureUrl,
        userData.profilePicture,
        userData.avatarLarge,
        userData.avatarMedium,
        userData.avatarThumb,
        userData.avatarJpg
    );
}

function formatCoinAmount(amount: unknown, currency: unknown = 'coins'): string {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return '';
    }
    const coinText = numericAmount === 1 ? 'coin' : 'coins';
    const label = currency && typeof currency === 'string' ? currency : 'coins';
    if (label !== 'coins') {
        return ` [${numericAmount} ${label}]`;
    }
    return ` [${numericAmount} ${coinText}]`;
}

export {
    normalizeTikTokHttpUrl,
    normalizeTikTokMessageId,
    extractTikTokUserData,
    extractTikTokAvatarUrl,
    extractTikTokGiftData,
    formatCoinAmount
};
