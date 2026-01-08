
function extractTwitchUserData(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Twitch user payload must be an object');
    }

    const source = data.user && typeof data.user === 'object' ? data.user : null;
    if (!source) {
        throw new Error('Twitch user payload requires user object');
    }
    if (!source.id || !source.display_name) {
        throw new Error('Twitch user payload requires user.id and user.display_name');
    }
    return {
        userId: source.id,
        username: source.display_name
    };
}

function extractTwitchBitsData(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Twitch bits payload must be an object');
    }

    if (typeof data.bits !== 'number' || !Number.isFinite(data.bits)) {
        throw new Error('Twitch bits payload requires numeric bits');
    }
    if (!data.user || typeof data.user !== 'object') {
        throw new Error('Twitch bits payload requires user object');
    }
    if (!data.user.id || !data.user.display_name) {
        throw new Error('Twitch bits payload requires user.id and user.display_name');
    }
    const result = {
        bits: data.bits,
        userId: data.user.id,
        username: data.user.display_name
    };
    if (typeof data.message === 'string') {
        result.message = data.message;
    }
    if (typeof data.isAnonymous === 'boolean') {
        result.isAnonymous = data.isAnonymous;
    }
    return result;
}

function extractTwitchSubscriptionData(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Twitch subscription payload must be an object');
    }

    const normalizePositiveInteger = (value) => {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : undefined;
    };

    if (!data.user || typeof data.user !== 'object') {
        throw new Error('Twitch subscription payload requires user object');
    }
    if (!data.user.id || !data.user.display_name) {
        throw new Error('Twitch subscription payload requires user.id and user.display_name');
    }
    if (!data.tier || typeof data.tier !== 'string') {
        throw new Error('Twitch subscription payload requires tier');
    }
    const months = normalizePositiveInteger(data.months);
    const isRenewal = data.isRenewal === true || (months !== undefined && months > 1);

    const result = {
        username: data.user.display_name,
        userId: data.user.id,
        tier: data.tier,
        isRenewal
    };
    if (months !== undefined) {
        result.months = months;
    }
    if (typeof data.isGift === 'boolean') {
        result.isGift = data.isGift;
    }
    if (typeof data.message === 'string') {
        result.message = data.message;
    }
    return result;
}

function extractTwitchRaidData(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Twitch raid payload must be an object');
    }
    if (!data.from_broadcaster_user_name || !data.from_broadcaster_user_id) {
        throw new Error('Twitch raid payload requires from_broadcaster_user_name and from_broadcaster_user_id');
    }
    if (typeof data.viewers !== 'number' || !Number.isFinite(data.viewers)) {
        throw new Error('Twitch raid payload requires numeric viewers');
    }

    return {
        raiderName: data.from_broadcaster_user_name,
        raiderId: data.from_broadcaster_user_id,
        viewerCount: data.viewers
    };
}

function formatTwitchBits(bits) {
    if (!bits || bits <= 0) {
        return '';
    }
    
    const dollars = (bits * 0.01).toFixed(2);
    return ` (${bits} bits - $${dollars})`;
}

function formatTwitchTier(tier) {
    if (!tier || tier === '1000') {
        return '';
    }
    
    const tierNumber = tier === '2000' ? '2' : tier === '3000' ? '3' : tier;
    return ` (Tier ${tierNumber})`;
}

module.exports = {
    extractTwitchUserData,
    extractTwitchBitsData,
    extractTwitchSubscriptionData,
    extractTwitchRaidData,
    formatTwitchBits,
    formatTwitchTier
}; 
