
function extractTikTokUserData(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('TikTok user payload must be an object');
    }

    const userData = (data.user && typeof data.user === 'object') ? data.user : null;
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

    return {
        userId,
        username
    };
}

function extractTikTokGiftData(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('TikTok gift payload must be an object');
    }
    // TikTok gift data is in giftDetails (verified: present in 100% of 639 production samples)
    // giftDetails and extendedGiftInfo are both always present, but giftDetails has the
    // localized user-facing name, so we use it as the single source of truth
    const giftDetails = data.giftDetails;
    if (!giftDetails || typeof giftDetails !== 'object') {
        throw new Error('TikTok gift payload requires giftDetails');
    }
    if (typeof giftDetails.giftName !== 'string' || !giftDetails.giftName.trim()) {
        throw new Error('TikTok gift payload requires giftDetails.giftName');
    }
    if (typeof giftDetails.diamondCount !== 'number' || !Number.isFinite(giftDetails.diamondCount)) {
        throw new Error('TikTok gift payload requires giftDetails.diamondCount');
    }
    if (typeof giftDetails.giftType !== 'number' || !Number.isFinite(giftDetails.giftType)) {
        throw new Error('TikTok gift payload requires giftDetails.giftType');
    }
    if (typeof data.repeatCount !== 'number' || !Number.isFinite(data.repeatCount) || data.repeatCount <= 0) {
        throw new Error('TikTok gift payload requires repeatCount');
    }
    const comboType = giftDetails.giftType;
    const giftCount = data.repeatCount;
    const unitAmount = giftDetails.diamondCount;
    const amount = unitAmount * giftCount;

    return {
        // giftDetails.giftName is the user-facing localized name (e.g., "Popular Vote")
        // extendedGiftInfo.name is the generic English name (e.g., "Go Popular")
        // Use giftDetails as single source since it's always present (verified 639/639 samples)
        giftType: giftDetails.giftName,

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
        groupId: data.groupId,
        repeatEnd: data.repeatEnd  // TikTok sends 0 or 1 (integer)
    };
}

function extractTikTokViewerCount(data) {
    if (!data || typeof data !== 'object') {
        return null;
    }
    return Number.isFinite(data.viewerCount) ? data.viewerCount : null;
}

function formatCoinAmount(amount, currency = 'coins') {
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


module.exports = {
    extractTikTokUserData,
    extractTikTokGiftData,
    extractTikTokViewerCount,
    formatCoinAmount
};
