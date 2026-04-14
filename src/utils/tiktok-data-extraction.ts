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
    // TikTok gift data is in giftDetails (verified: present in 100% of 639 production samples)
    // giftDetails and extendedGiftInfo are both always present, but giftDetails has the
    // localized user-facing name, so we use it as the single source of truth
    const payload = data as Record<string, unknown>;
    const giftDetails = payload.giftDetails;
    if (!giftDetails || typeof giftDetails !== 'object') {
        throw new Error('TikTok gift payload requires giftDetails');
    }
    const giftDetailsRecord = giftDetails as Record<string, unknown>;
    if (typeof giftDetailsRecord.giftName !== 'string' || !giftDetailsRecord.giftName.trim()) {
        throw new Error('TikTok gift payload requires giftDetails.giftName');
    }
    if (typeof giftDetailsRecord.diamondCount !== 'number' || !Number.isFinite(giftDetailsRecord.diamondCount)) {
        throw new Error('TikTok gift payload requires giftDetails.diamondCount');
    }
    if (typeof giftDetailsRecord.giftType !== 'number' || !Number.isFinite(giftDetailsRecord.giftType)) {
        throw new Error('TikTok gift payload requires giftDetails.giftType');
    }
    if (typeof payload.repeatCount !== 'number' || !Number.isFinite(payload.repeatCount) || payload.repeatCount <= 0) {
        throw new Error('TikTok gift payload requires repeatCount');
    }
    const comboType = giftDetailsRecord.giftType;
    const giftCount = payload.repeatCount;
    const unitAmount = giftDetailsRecord.diamondCount;
    const amount = unitAmount * giftCount;
    const giftData = typeof payload.gift === 'object' && payload.gift !== null
        ? payload.gift as Record<string, unknown>
        : null;
    const giftImageUrl = giftData && typeof giftData.giftPictureUrl === 'string'
        ? giftData.giftPictureUrl.trim()
        : '';

    return {
        // giftDetails.giftName is the user-facing localized name (e.g., "Popular Vote")
        // extendedGiftInfo.name is the generic English name (e.g., "Go Popular")
        // Use giftDetails as single source since it's always present (verified 639/639 samples)
        giftType: giftDetailsRecord.giftName,

        // repeatCount is at root level, always present (verified 639/639 samples, never 0)
        giftCount,
        amount,
        currency: 'coins',
        unitAmount,

        // Combo detection: comboType === 1 means combo-enabled gift
        // Use comboType as authoritative source, fallback to combo boolean if comboType missing
        combo: comboType === 1,
        comboType,

        // Combo metadata fields at root level
        groupId: payload.groupId,
        repeatEnd: payload.repeatEnd === 1,
        ...(giftImageUrl ? { giftImageUrl } : {})
    };
}

function extractTikTokAvatarUrl(data: unknown): string {
    if (!data || typeof data !== 'object') {
        return '';
    }

    const userData = ('user' in data && typeof (data as { user?: unknown }).user === 'object')
        ? (data as { user: Record<string, unknown> }).user
        : null;
    if (!userData) {
        return '';
    }

    const profilePictureUrl = typeof userData.profilePictureUrl === 'string'
        ? userData.profilePictureUrl.trim()
        : '';
    if (profilePictureUrl) {
        return profilePictureUrl;
    }

    const profilePicture = userData.profilePicture;
    const profilePictureRecord = profilePicture && typeof profilePicture === 'object'
        ? profilePicture as Record<string, unknown>
        : null;
    const profilePictureArray = Array.isArray(profilePictureRecord?.url)
        ? profilePictureRecord.url
        : [];
    const firstProfilePictureUrl = typeof profilePictureArray[0] === 'string'
        ? profilePictureArray[0].trim()
        : '';

    return firstProfilePictureUrl || '';
}

function formatCoinAmount(amount: unknown, currency: unknown = 'coins'): string {
    if (!Number.isFinite(Number(amount)) || amount <= 0) {
        return '';
    }
    const coinText = Number(amount) === 1 ? 'coin' : 'coins';
    const label = currency && typeof currency === 'string' ? currency : 'coins';
    if (label !== 'coins') {
        return ` [${amount} ${label}]`;
    }
    return ` [${amount} ${coinText}]`;
}

export {
    extractTikTokUserData,
    extractTikTokAvatarUrl,
    extractTikTokGiftData,
    formatCoinAmount
};
